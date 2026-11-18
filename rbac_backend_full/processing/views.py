"""
Processing API views
Each view is inspired by an IFCtoFDS concept mapped to the backend:

  ValidationView      ← IFCtoFDS file validation + diagnostics panel
  ModelBoundsView     ← IFCtoFDS boundsForClipping() + clipping panel
  IFCMetadataView     ← IFCtoFDS IFC mapping panel (element types/counts)
  ProcessingJobView   ← IFCtoFDS Web Worker progress tracking
  DiagnosticsView     ← IFCtoFDS renderDiagnostics() / compare checks
  AuditLogView        ← IFCtoFDS undo stack history
  ProjectChecksView   ← IFCtoFDS runChecks(fdsModel, ifcModel)
"""
import io
import os
import tempfile
import shutil
import uuid
from datetime import datetime
from threading import Thread
from django.conf import settings
from django.core.files import File
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status

from projects.models import BIMData, PointCloudData
from .models import ProcessingJob, ModelBounds, ElementMetadata, AuditLog, DiagnosticReport
from .serializers import (
    ProcessingJobSerializer,
    ModelBoundsSerializer,
    ElementMetadataSerializer,
    ElementSummarySerializer,
    AuditLogSerializer,
    DiagnosticReportSerializer,
    ValidationRequestSerializer,
    BoundsRequestSerializer,
)
from .validators import validate_bim_upload, validate_pointcloud_upload
from .diagnostics import run_bim_checks, run_pointcloud_checks, run_project_checks
from .ifc_parser import parse_ifc_metadata
from .gaussian_splatting import train_colmap_gaussians


def _get_client_ip(request):
    x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded:
        return x_forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')

class GaussianSplatTrainingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        cameras = request.FILES.get("cameras")
        images_txt = request.FILES.get("images_txt")
        points = request.FILES.get("points")
        image_zip = request.FILES.get("images")
        if not all((cameras, images_txt, points, image_zip)):
            return Response({"error": "cameras, images_txt, points, and images are required"}, status=400)
        output_dir = os.path.join(settings.MEDIA_ROOT, "gaussian_models")
        os.makedirs(output_dir, exist_ok=True)
        output_name = f"{uuid.uuid4().hex}.ply"
        output_path = os.path.join(output_dir, output_name)
        try:
            result = train_colmap_gaussians(
                cameras.read().decode("utf-8", errors="replace"),
                images_txt.read().decode("utf-8", errors="replace"),
                points.read().decode("utf-8", errors="replace"),
                image_zip, output_path, request.data.get("iterations", 120),
            )
        except Exception as error:
            if os.path.exists(output_path):
                os.remove(output_path)
            import traceback
            traceback.print_exc()
            error_text = str(error)
            if "WinError 4551" in error_text or "c10.dll" in error_text:
                return Response(
                    {
                        "error": (
                            "Gaussian training is unavailable because Windows Application Control "
                            "blocked PyTorch (c10.dll). Ask your administrator to approve the "
                            "project Python environment or run training on an approved machine."
                        ),
                        "code": "TORCH_RUNTIME_BLOCKED",
                    },
                    status=503,
                )
            return Response({"error": error_text}, status=422)
        url = request.build_absolute_uri(f"{settings.MEDIA_URL}gaussian_models/{output_name}")
        return Response({"url": url, **result})

def _audit(request, action, description, bim_data=None, point_data=None, metadata=None):
    AuditLog.objects.create(
        user=request.user if request.user.is_authenticated else None,
        action=action,
        description=description,
        bim_data=bim_data,
        point_data=point_data,
        metadata=metadata,
        ip_address=_get_client_ip(request),
    )


# ─── File Validation ──────────────────────────────────────────────────────────

class ValidationView(APIView):
    """
    POST /api/processing/validate/
    Validates an already-uploaded BIM or point cloud file and returns
    diagnostic results. Inspired by IFCtoFDS's file validation on open.

    Body: { bim_data_id: int } or { point_data_id: int }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ValidationRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        bim_id = serializer.validated_data.get('bim_data_id')
        pc_id  = serializer.validated_data.get('point_data_id')
        results = []

        if bim_id:
            try:
                bim = BIMData.objects.get(pk=bim_id)
            except BIMData.DoesNotExist:
                return Response({'error': 'BIM file not found'}, status=404)

            with open(bim.file.path, 'rb') as f:
                results = validate_bim_upload(File(f, name=os.path.basename(bim.file.name)))

            # Persist diagnostics
            DiagnosticReport.objects.filter(bim_data=bim).delete()
            for d in results:
                DiagnosticReport.objects.create(
                    bim_data=bim,
                    level=d.level, title=d.title,
                    detail=d.detail, check_name=d.check_name,
                )
            _audit(request, 'validate', f'Validated BIM file: {bim.file.name}', bim_data=bim)

        elif pc_id:
            try:
                pc = PointCloudData.objects.get(pk=pc_id)
            except PointCloudData.DoesNotExist:
                return Response({'error': 'Point cloud not found'}, status=404)

            with open(pc.file.path, 'rb') as f:
                results = validate_pointcloud_upload(File(f, name=os.path.basename(pc.file.name)))

            DiagnosticReport.objects.filter(point_data=pc).delete()
            for d in results:
                DiagnosticReport.objects.create(
                    point_data=pc,
                    level=d.level, title=d.title,
                    detail=d.detail, check_name=d.check_name,
                )
            _audit(request, 'validate', f'Validated point cloud: {pc.file.name}', point_data=pc)

        return Response({
            'diagnostics': [d.to_dict() for d in results],
            'has_errors':   any(d.level == 'error' for d in results),
            'has_warnings': any(d.level == 'warning' for d in results),
        })


# ─── Model Bounds ─────────────────────────────────────────────────────────────

class ModelBoundsView(APIView):
    """
    GET  /api/processing/bounds/?bim_data_id=1
    POST /api/processing/bounds/  { bim_data_id: 1, xmin:..., xmax:..., ... }

    Inspired by IFCtoFDS setupClippingForBounds() — stores and retrieves
    model bounds so the frontend's ClippingPanel can initialise instantly.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        bim_id = request.query_params.get('bim_data_id')
        pc_id  = request.query_params.get('point_data_id')

        if bim_id:
            obj = ModelBounds.objects.filter(bim_data_id=bim_id).first()
        elif pc_id:
            obj = ModelBounds.objects.filter(point_data_id=pc_id).first()
        else:
            return Response({'error': 'Provide bim_data_id or point_data_id'}, status=400)

        if not obj:
            return Response({'bounds': None})

        return Response({'bounds': obj.to_dict()})

    def post(self, request):
        """Save bounds computed by the frontend viewer."""
        data = request.data
        bim_id = data.get('bim_data_id')
        pc_id  = data.get('point_data_id')

        required = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax']
        for key in required:
            if key not in data:
                return Response({'error': f'Missing field: {key}'}, status=400)

        try:
            xmin, xmax = float(data['xmin']), float(data['xmax'])
            ymin, ymax = float(data['ymin']), float(data['ymax'])
            zmin, zmax = float(data['zmin']), float(data['zmax'])
        except (TypeError, ValueError):
            return Response({'error': 'Bounds must be numbers'}, status=400)

        span = max(xmax - xmin, ymax - ymin, zmax - zmin)
        center_x = (xmin + xmax) / 2
        center_y = (ymin + ymax) / 2
        center_z = (zmin + zmax) / 2

        kwargs = dict(
            xmin=xmin, xmax=xmax, ymin=ymin, ymax=ymax, zmin=zmin, zmax=zmax,
            center_x=center_x, center_y=center_y, center_z=center_z, span=span,
            point_count=data.get('point_count'),
            triangle_count=data.get('triangle_count'),
        )

        if bim_id:
            obj, _ = ModelBounds.objects.update_or_create(bim_data_id=bim_id, defaults=kwargs)
        elif pc_id:
            obj, _ = ModelBounds.objects.update_or_create(point_data_id=pc_id, defaults=kwargs)
        else:
            return Response({'error': 'Provide bim_data_id or point_data_id'}, status=400)

        return Response(ModelBoundsSerializer(obj).data, status=status.HTTP_200_OK)


# ─── IFC Metadata / Element Mapping ──────────────────────────────────────────

class IFCMetadataView(APIView):
    """
    POST /api/processing/ifc-metadata/  { bim_data_id: 1 }

    Parses the IFC file server-side and returns element metadata +
    the mapping summary that mirrors IFCtoFDS's "IFC Mapping" panel.
    Results are persisted so subsequent calls return cached data.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Return cached element summary for a BIM file."""
        bim_id = request.query_params.get('bim_data_id')
        if not bim_id:
            return Response({'error': 'Provide bim_data_id'}, status=400)

        elements = ElementMetadata.objects.filter(bim_data_id=bim_id)
        if not elements.exists():
            return Response({'summary': [], 'element_count': 0, 'parsed': False})

        from collections import defaultdict
        groups = defaultdict(lambda: {'count': 0, 'convertible_count': 0, 'category': 'other', 'fds_role': ''})
        for el in elements:
            g = groups[el.ifc_type]
            g['count'] += 1
            if el.convertible:
                g['convertible_count'] += 1
            g['category'] = el.category
            g['fds_role'] = el.fds_role

        summary = [
            {'ifc_type': k, **v}
            for k, v in sorted(groups.items())
        ]
        return Response({'summary': summary, 'element_count': elements.count(), 'parsed': True})

    def post(self, request):
        """Trigger a fresh parse of the IFC file."""
        bim_id = request.data.get('bim_data_id')
        if not bim_id:
            return Response({'error': 'Provide bim_data_id'}, status=400)

        try:
            bim = BIMData.objects.get(pk=bim_id)
        except BIMData.DoesNotExist:
            return Response({'error': 'BIM file not found'}, status=404)

        ext = os.path.splitext(bim.file.name)[1].lower()
        if ext != '.ifc':
            return Response({
                'error': 'IFC metadata extraction only works for .ifc files.',
                'file_type': ext,
            }, status=400)

        result = parse_ifc_metadata(bim.file.path)

        # Persist elements
        ElementMetadata.objects.filter(bim_data=bim).delete()
        for el in result.get('elements', []):
            ElementMetadata.objects.create(
                bim_data=bim,
                step_id=el['step_id'],
                global_id=el.get('global_id', ''),
                ifc_type=el['ifc_type'],
                name=el.get('name', ''),
                category=el.get('category', 'other'),
                bounds=el.get('bounds'),
                convertible=el.get('convertible', True),
                fds_role=el.get('fds_role', ''),
            )

        # Persist bounds if available
        if result.get('bounds'):
            b = result['bounds']
            span = max(b['xmax'] - b['xmin'], b['ymax'] - b['ymin'], b['zmax'] - b['zmin'])
            ModelBounds.objects.update_or_create(
                bim_data=bim,
                defaults=dict(
                    xmin=b['xmin'], xmax=b['xmax'],
                    ymin=b['ymin'], ymax=b['ymax'],
                    zmin=b['zmin'], zmax=b['zmax'],
                    center_x=(b['xmin'] + b['xmax']) / 2,
                    center_y=(b['ymin'] + b['ymax']) / 2,
                    center_z=(b['zmin'] + b['zmax']) / 2,
                    span=span,
                )
            )

        _audit(request, 'process_done', f'IFC metadata extracted: {bim.file.name}', bim_data=bim,
               metadata={'element_count': len(result.get('elements', []))})

        return Response({
            'summary':       result.get('summary', []),
            'element_count': len(result.get('elements', [])),
            'bounds':        result.get('bounds'),
            'diagnostics':   result.get('diagnostics', []),
        })


# ─── Processing Jobs ──────────────────────────────────────────────────────────

class ProcessingJobListView(APIView):
    """
    GET  /api/processing/jobs/?bim_data_id=1
    POST /api/processing/jobs/  { job_type, bim_data_id or point_data_id }

    Create and list processing jobs. Inspired by IFCtoFDS's
    exportWorker pattern — each background task is tracked with progress.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        bim_id = request.query_params.get('bim_data_id')
        pc_id  = request.query_params.get('point_data_id')

        qs = ProcessingJob.objects.all()
        if bim_id:
            qs = qs.filter(bim_data_id=bim_id)
        if pc_id:
            qs = qs.filter(point_data_id=pc_id)

        return Response(ProcessingJobSerializer(qs[:50], many=True).data)

    def post(self, request):
        job_type = request.data.get('job_type')
        bim_id   = request.data.get('bim_data_id')
        pc_id    = request.data.get('point_data_id')

        if not job_type:
            return Response({'error': 'job_type is required'}, status=400)

        job = ProcessingJob.objects.create(
            job_type=job_type,
            bim_data_id=bim_id,
            point_data_id=pc_id,
            created_by=request.user,
            status='queued',
        )
        _audit(request, 'process_start', f'Job queued: {job_type}',
               bim_data=job.bim_data, point_data=job.point_data)

        return Response(ProcessingJobSerializer(job).data, status=status.HTTP_201_CREATED)


class ProcessingJobDetailView(APIView):
    """
    GET   /api/processing/jobs/<id>/   — poll job status + progress
    PATCH /api/processing/jobs/<id>/   — update progress (used by worker)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            job = ProcessingJob.objects.get(pk=pk)
        except ProcessingJob.DoesNotExist:
            return Response({'error': 'Job not found'}, status=404)
        return Response(ProcessingJobSerializer(job).data)

    def patch(self, request, pk):
        try:
            job = ProcessingJob.objects.get(pk=pk)
        except ProcessingJob.DoesNotExist:
            return Response({'error': 'Job not found'}, status=404)

        allowed = ['status', 'progress', 'stage_label', 'error_message', 'result']
        for field in allowed:
            if field in request.data:
                setattr(job, field, request.data[field])

        if request.data.get('status') == 'running' and not job.started_at:
            job.started_at = timezone.now()
        if request.data.get('status') in ('completed', 'failed', 'cancelled'):
            job.completed_at = timezone.now()

        job.save()
        return Response(ProcessingJobSerializer(job).data)


# ─── Diagnostics ──────────────────────────────────────────────────────────────

class DiagnosticsView(APIView):
    """
    GET /api/processing/diagnostics/?bim_data_id=1
    GET /api/processing/diagnostics/?project_id=1

    Run + return diagnostics checks. Inspired by IFCtoFDS's
    renderDiagnostics() which shows warnings/errors in the sidebar.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        bim_id     = request.query_params.get('bim_data_id')
        pc_id      = request.query_params.get('point_data_id')
        project_id = request.query_params.get('project_id')

        results = []

        if bim_id:
            try:
                bim = BIMData.objects.get(pk=bim_id)
                results = run_bim_checks(bim)
            except BIMData.DoesNotExist:
                return Response({'error': 'BIM file not found'}, status=404)

        elif pc_id:
            try:
                pc = PointCloudData.objects.get(pk=pc_id)
                results = run_pointcloud_checks(pc)
            except PointCloudData.DoesNotExist:
                return Response({'error': 'Point cloud not found'}, status=404)

        elif project_id:
            from projects.models import Project
            try:
                project = Project.objects.get(pk=project_id)
            except (Project.DoesNotExist, ValueError):
                return Response({'error': 'Project not found'}, status=404)
            results = run_project_checks(project)

        else:
            return Response({'error': 'Provide bim_data_id, point_data_id, or project_id'}, status=400)

        return Response({
            'diagnostics':  results,
            'has_errors':   any(r['level'] == 'error' for r in results),
            'has_warnings': any(r['level'] == 'warning' for r in results),
            'count':        len(results),
        })


# ─── Audit Log ────────────────────────────────────────────────────────────────

class AuditLogView(APIView):
    """
    GET /api/processing/audit/?bim_data_id=1
    GET /api/processing/audit/?project_id=1

    Returns the audit trail for a file or project.
    Inspired by IFCtoFDS's undo stack — shows who did what and when.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        bim_id     = request.query_params.get('bim_data_id')
        pc_id      = request.query_params.get('point_data_id')
        project_id = request.query_params.get('project_id')

        qs = AuditLog.objects.select_related('user')

        if bim_id:
            qs = qs.filter(bim_data_id=bim_id)
        elif pc_id:
            qs = qs.filter(point_data_id=pc_id)
        elif project_id:
            bim_ids = BIMData.objects.filter(project_id=project_id).values_list('id', flat=True)
            pc_ids  = PointCloudData.objects.filter(project_id=project_id).values_list('id', flat=True)
            qs = qs.filter(bim_data_id__in=bim_ids) | qs.filter(point_data_id__in=pc_ids)

        return Response(AuditLogSerializer(qs[:100], many=True).data)


# ─── Point-cloud → PLY conversion (for the viewer) ───────────────────────────

class PointCloudToPLYView(APIView):
    """
    POST /api/v1/processing/tools/pointcloud-to-ply/

    Accepts a LAS, LAZ, PTS, or XYZ file and returns a color-accurate binary
    PLY so the Three.js PLYLoader can render it with original RGB intact.
    PLY files are streamed back unchanged. PLZ (Leica Cyclone) has no open
    Python reader — uploads are stored but cannot be viewed.
    """
    permission_classes = [IsAuthenticated]

    _SUPPORTED = {".ply", ".las", ".laz", ".pts", ".xyz"}

    def post(self, request):
        import tempfile as _tempfile
        from django.http import HttpResponse

        if "file" not in request.FILES:
            return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)

        file_obj = request.FILES["file"]
        ext = os.path.splitext(file_obj.name)[1].lower()

        if ext not in self._SUPPORTED:
            return Response(
                {
                    "error": (
                        f"'{ext}' cannot be converted for viewing. "
                        f"Supported: {', '.join(sorted(self._SUPPORTED))}. "
                        "PLZ (Leica Cyclone) files can be stored but not yet rendered."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # PLY passes through unchanged — no conversion needed.
        if ext == ".ply":
            data = b"".join(file_obj.chunks())
            response = HttpResponse(data, content_type="application/octet-stream")
            response["Content-Disposition"] = f'attachment; filename="{file_obj.name}"'
            return response

        # Non-PLY: write to temp, convert to color PLY, stream back.
        work_dir = _tempfile.mkdtemp(prefix="pc2ply_")
        try:
            input_path = os.path.join(work_dir, os.path.basename(file_obj.name))
            with open(input_path, "wb") as f:
                for chunk in file_obj.chunks():
                    f.write(chunk)

            ply_bytes = _file_to_ply_bytes(input_path, ext, max_points=2_000_000)

            stem = os.path.splitext(file_obj.name)[0]
            response = HttpResponse(ply_bytes, content_type="application/octet-stream")
            response["Content-Disposition"] = f'attachment; filename="{stem}.ply"'
            return response

        except ImportError as e:
            return Response({"error": str(e)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({"error": f"Conversion failed: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


# ─── Viewer export: cropped point cloud → PLY ────────────────────────────────

class _DeleteDirOnClose(io.FileIO):
    """Read-only file that removes its temp directory once the response
    has been sent (FileResponse closes the file when it is done)."""

    def __init__(self, path, cleanup_dir):
        super().__init__(path, "rb")
        self._cleanup_dir = cleanup_dir

    def close(self):
        try:
            super().close()
        finally:
            shutil.rmtree(self._cleanup_dir, ignore_errors=True)


def _ascii_filename(name):
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in name)
    return safe.strip("._") or "pointcloud"


class PointCloudExportView(APIView):
    """
    POST /api/v1/processing/tools/pointcloud-export/

    JSON body:
      pointcloud_id | merge_id   the cloud shown in the viewer
      raw_to_world   16 numbers, Three.js column-major: raw file coords ->
                     viewer world (matrixWorld * translate(-centroid))
      box            {"min": [x,y,z], "max": [x,y,z]} in viewer world, or null
      frame          "original" (default) | "aligned"

    Returns a binary PLY of the points inside the box, read from the
    original upload at full density and precision.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.http import FileResponse
        from . import pointcloud_export as pe
        from . import pointcloud_merge as pm
        from .models import PointCloudMerge

        data = request.data
        pc_id, merge_id = data.get("pointcloud_id"), data.get("merge_id")
        if bool(pc_id) == bool(merge_id):
            return Response({"error": "Send exactly one of pointcloud_id or merge_id."},
                            status=status.HTTP_400_BAD_REQUEST)

        original_offset = None
        if pc_id:
            obj = PointCloudData.objects.select_related("project").filter(pk=pc_id).first()
            if obj is None:
                return Response({"error": "Point cloud not found."}, status=status.HTTP_404_NOT_FOUND)
        else:
            obj = PointCloudMerge.objects.select_related("project").filter(pk=merge_id).first()
            if obj is None or obj.status != "completed" or not obj.file:
                return Response({"error": "Merged point cloud not found."},
                                status=status.HTTP_404_NOT_FOUND)
            # The merged PLY is stored relative to `origin_offset`; "original"
            # coordinates of a merge are those of its merge frame.
            off = obj.origin_offset
            if isinstance(off, (list, tuple)) and len(off) == 3:
                original_offset = off

        if not _merge_access(request.user, obj.project):
            return Response({"error": "You are not assigned to this project."},
                            status=status.HTTP_403_FORBIDDEN)

        try:
            raw_to_world = pe.matrix_from_elements(data.get("raw_to_world"))
            box = pe.box_from_payload(data.get("box"))
        except pe.ExportError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        frame = data.get("frame") or "original"

        ext = pm.source_ext(obj)
        work_dir = tempfile.mkdtemp(prefix="pcexport_")
        try:
            src_path = pm._local_path(obj.file, work_dir)
            stem = os.path.splitext(os.path.basename(obj.file.name or ""))[0] or "pointcloud"
            out_name = _ascii_filename(f"{stem}_{'cropped' if box else 'export'}_{frame}.ply")
            out_path = os.path.join(work_dir, out_name)
            result = pe.export_cropped_ply(
                src_path, ext, out_path, raw_to_world=raw_to_world, box=box,
                frame=frame, original_offset=original_offset,
            )
        except pe.ExportError as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            import traceback
            traceback.print_exc()
            return Response({"error": f"Export failed: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response = FileResponse(
            _DeleteDirOnClose(out_path, work_dir),
            as_attachment=True,
            filename=out_name,
            content_type="application/octet-stream",
        )
        response["X-Point-Count"] = str(result["point_count"])
        return response


def _file_to_ply_bytes(path, ext, max_points=2_000_000):
    """
    Read a point cloud file and return a color-accurate binary_little_endian PLY
    blob.  RGB colors are preserved when the source file carries them.
    """
    import numpy as np

    if ext in (".las", ".laz"):
        try:
            import laspy
        except ImportError:
            raise ImportError(
                "laspy is required for LAS/LAZ support. pip install laspy[lazrs]"
            )
        las = laspy.read(path)
        x = np.asarray(las.x, dtype=np.float64)
        y = np.asarray(las.y, dtype=np.float64)
        z = np.asarray(las.z, dtype=np.float64)

        # LAS RGB channels are 16-bit (0–65535). Normalize to 8-bit (0–255).
        colors = None
        try:
            if hasattr(las, "red"):
                r16 = np.asarray(las.red, dtype=np.float64)
                g16 = np.asarray(las.green, dtype=np.float64)
                b16 = np.asarray(las.blue, dtype=np.float64)
                peak = max(float(r16.max()), float(g16.max()), float(b16.max()), 1.0)
                # Files stored with 8-bit data in 16-bit fields have peak ≤ 255;
                # true 16-bit files have peak > 255.  Scale appropriately.
                divisor = 65535.0 if peak > 255.0 else 255.0
                scale = 255.0 / divisor
                colors = np.stack([
                    np.clip(r16 * scale, 0, 255).astype(np.uint8),
                    np.clip(g16 * scale, 0, 255).astype(np.uint8),
                    np.clip(b16 * scale, 0, 255).astype(np.uint8),
                ], axis=1)
        except Exception:
            colors = None

        pts = np.stack([x, y, z], axis=1)

    elif ext in (".pts", ".xyz"):
        # Common ASCII formats: x y z [intensity] [r g b]  or  x y z r g b
        pts_rows, rgb_rows = [], []
        with open(path, "r", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) < 3:
                    continue
                try:
                    px, py, pz = float(parts[0]), float(parts[1]), float(parts[2])
                    pts_rows.append((px, py, pz))
                    if len(parts) >= 7:
                        # x y z intensity r g b
                        rgb_rows.append((int(parts[4]), int(parts[5]), int(parts[6])))
                    elif len(parts) == 6:
                        # x y z r g b
                        rgb_rows.append((int(parts[3]), int(parts[4]), int(parts[5])))
                except (ValueError, IndexError):
                    continue

        pts = np.array(pts_rows, dtype=np.float64) if pts_rows else np.empty((0, 3))
        colors = (
            np.array(rgb_rows, dtype=np.uint8)
            if len(rgb_rows) == len(pts_rows) and rgb_rows
            else None
        )

    else:
        from .progress import read_pointcloud_points
        pts = read_pointcloud_points(path, max_points=max_points)
        colors = None

    if len(pts) == 0:
        raise ValueError("The point-cloud file contains no readable points.")

    # Sub-sample large clouds. Seeded from the point data itself (not the
    # request's temp file path, which is a fresh random tempdir every call) so
    # the SAME uploaded file always converts to the SAME subsample no matter
    # which machine/session loads it in the viewer — otherwise two people
    # viewing the same point cloud would get different point sets and the
    # live "Overlapping PointCloud Points" check would disagree between them.
    if len(pts) > max_points:
        import hashlib
        seed = int.from_bytes(hashlib.sha256(pts.tobytes()).digest()[:4], "big")
        rng = np.random.default_rng(seed)
        idx = rng.choice(len(pts), max_points, replace=False)
        pts = pts[idx]
        if colors is not None:
            colors = colors[idx]

    return _xyz_to_ply_bytes(pts, colors)


def _xyz_to_ply_bytes(pts, colors=None):
    """
    Serialise xyz points (and optional Nx3 uint8 RGB) as binary_little_endian PLY.
    When colors is provided the PLY contains `property uchar red/green/blue`
    so Three.js PLYLoader loads them as vertex colors.
    """
    import numpy as np
    n = len(pts)
    has_color = colors is not None and len(colors) == n

    header = (
        b"ply\n"
        b"format binary_little_endian 1.0\n"
        b"element vertex " + str(n).encode() + b"\n"
        b"property float x\n"
        b"property float y\n"
        b"property float z\n"
    )
    if has_color:
        header += (
            b"property uchar red\n"
            b"property uchar green\n"
            b"property uchar blue\n"
        )
    header += b"end_header\n"

    if has_color:
        # Interleaved struct: 3×float32 + 3×uint8 = 15 bytes per vertex.
        dtype = np.dtype([
            ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
            ("r", "u1"),  ("g", "u1"),  ("b", "u1"),
        ])
        arr = np.empty(n, dtype=dtype)
        xyz = pts.astype(np.float32)
        arr["x"] = xyz[:, 0]
        arr["y"] = xyz[:, 1]
        arr["z"] = xyz[:, 2]
        rgb = np.asarray(colors, dtype=np.uint8)
        arr["r"] = rgb[:, 0]
        arr["g"] = rgb[:, 1]
        arr["b"] = rgb[:, 2]
        data = arr.tobytes()
    else:
        data = pts.astype(np.float32).tobytes(order="C")

    return header + data


# ─── Point-cloud ICP alignment ────────────────────────────────────────────────

class ICPAlignView(APIView):
    """
    POST /api/v1/processing/align/icp/

    Genuine dense point-to-point ICP refinement (numpy + scipy), replacing the
    browser's placeholder ICP. The frontend sends the point sets in viewer-world
    coordinates plus an optional coarse initial transform (e.g. from a 3-point
    Kabsch pick-align); we return a refined 4x4 the viewer applies to the cloud.

    Body (JSON):
      {
        "source": [[x,y,z], ...],        # point cloud points (world space)
        "target": [[x,y,z], ...],        # BIM surface/vertex points (world space)
        "init_transform": [[..4x4..]],   # optional coarse guess
        "threshold": float,              # optional max correspondence distance
        "max_iterations": int,           # optional (default 50)
        "with_scale": bool               # optional, allow similarity (scale) fit
      }

    Returns: { transform: 4x4, fitness, rmse, iterations }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .registration import run_icp_auto

        data = request.data or {}
        source = data.get('source')
        target = data.get('target')
        if not source or not target:
            return Response(
                {'error': 'Both "source" and "target" point arrays are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # run_icp_auto: with an init_transform (3-point pick-align) it refines
            # straight from it; without one it auto-seeds via PCA + identity so
            # alignment works with no manual picking.
            result = run_icp_auto(
                source,
                target,
                init_transform=data.get('init_transform'),
                max_iterations=int(data.get('max_iterations', 50)),
                threshold=data.get('threshold'),
                with_scale=bool(data.get('with_scale', False)),
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': f'ICP failed: {e}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(result)

class AutoAlignView(APIView):
    """
    POST /api/v1/processing/align/auto/

    One-click BIM <-> point-cloud registration with no manual picks:
    voxel downsample -> FPFH features -> correspondences -> RANSAC -> ICP,
    with an automatic scale search for unscaled (photogrammetry) clouds.
    See processing/auto_registration.py.

    Body (JSON):
      {
        "source": [[x,y,z], ...],        # point cloud points (world space)
        "target": [[x,y,z], ...],        # BIM surface points (world space)
        "init_transform": [[..4x4..]]    # optional, e.g. from picked pairs
      }

    Returns: { transform, fitness, coverage, rmse, scale, confidence,
               ambiguous, candidates: [...], voxel_size, timing_s }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .auto_registration import auto_register

        data = request.data or {}
        source = data.get('source')
        target = data.get('target')
        if not source or not target:
            return Response(
                {'error': 'Both "source" and "target" point arrays are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = auto_register(source, target,
                                   init_transform=data.get('init_transform'))
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': f'Auto alignment failed: {e}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(result)

# ─── OpenStreetMap tile proxy ─────────────────────────────────────────────────

class OSMTileProxyView(APIView):
    """
    GET /api/v1/processing/osm-tile/<z>/<x>/<y>.png

    Proxies OpenStreetMap raster tiles through our own backend. The viewer runs
    with cross-origin isolation (COEP) so it can use SharedArrayBuffer for IFC
    parsing; under COEP, cross-origin tiles fetched straight from
    tile.openstreetmap.org are blocked unless they carry a CORP header (they
    don't). By relaying them here and adding `Cross-Origin-Resource-Policy:
    cross-origin`, the tiles load in every browser and in production, without
    relying on the Chromium-only COEP "credentialless" mode.

    Public (no auth) because <img>/Leaflet tile requests can't send a token.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def _send(self, data, content_type="image/png"):
        from django.http import HttpResponse
        response = HttpResponse(data, content_type=content_type)
        # The header that lets the isolated (COEP) frontend load this tile.
        response["Cross-Origin-Resource-Policy"] = "cross-origin"
        response["Access-Control-Allow-Origin"] = "*"
        # Tiles are immutable; let the browser cache them hard.
        response["Cache-Control"] = "public, max-age=604800, immutable"
        return response

    def get(self, request, z, x, y):
        import urllib.request
        from django.conf import settings as _settings
        from django.http import HttpResponse

        # Clamp/validate the tile coordinates to keep the proxy from being used
        # as an open relay to arbitrary URLs.
        try:
            z, x, y = int(z), int(x), int(y)
        except (TypeError, ValueError):
            return HttpResponse(status=400)
        if not (0 <= z <= 19):
            return HttpResponse(status=400)
        max_index = 2 ** z
        if not (0 <= x < max_index and 0 <= y < max_index):
            return HttpResponse(status=400)

        # Disk cache: each tile is fetched from OSM only once, then served from
        # disk forever after. This is what makes the map load fast on repeat
        # views — no double round-trip out to openstreetmap.org every time.
        cache_dir = os.path.join(
            _settings.MEDIA_ROOT, "tile_cache", str(z), str(x)
        )
        cache_path = os.path.join(cache_dir, f"{y}.png")
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
            with open(cache_path, "rb") as f:
                return self._send(f.read())

        url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        # OSM's tile usage policy requires a valid, identifying User-Agent.
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "DstriViewer/1.0 (BIM viewer tile proxy)"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as upstream:
                data = upstream.read()
                content_type = upstream.headers.get_content_type() or "image/png"
        except Exception as e:
            print(f"[OSMTileProxy] failed to fetch {url}: {e}")
            return HttpResponse(status=502)

        # Persist to the disk cache (atomic write) for next time.
        try:
            os.makedirs(cache_dir, exist_ok=True)
            tmp = cache_path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, cache_path)
        except OSError as cache_err:
            print(f"[OSMTileProxy] failed to cache tile: {cache_err}")

        return self._send(data, content_type)


# ─── Scan-to-BIM Progress Assessment ───────────────────────────────────────────

class ProgressAnalyzeView(APIView):
    """
    POST /api/v1/processing/progress/analyze/
    Body: { bim_id, pointcloud_id, threshold?, built_coverage? }
    Runs the Scan-to-BIM element progress analysis and returns per-element
    completion, automatic built detection, and per-floor / per-trade
    rollups (does NOT save).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from projects.models import BIMData, PointCloudData
        from .progress import analyze, sanitize_result, BUILT_COVERAGE

        bim_id = request.data.get("bim_id")
        pc_id = request.data.get("pointcloud_id")
        try:
            threshold = float(request.data.get("threshold") or 0.15)
            built_coverage = float(request.data.get("built_coverage") or BUILT_COVERAGE)
        except (TypeError, ValueError):
            return Response({"error": "threshold and built_coverage must be numbers"},
                            status=status.HTTP_400_BAD_REQUEST)
        if not bim_id or not pc_id:
            return Response({"error": "bim_id and pointcloud_id are required"},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            bim = BIMData.objects.get(id=bim_id)
            pc = PointCloudData.objects.get(id=pc_id)
        except (BIMData.DoesNotExist, PointCloudData.DoesNotExist):
            return Response({"error": "BIM or Point Cloud not found"},
                            status=status.HTTP_404_NOT_FOUND)

        bim_path = bim.file.path if bim.file else None
        pc_path = pc.file.path if pc.file else None
        if not bim_path or not bim_path.lower().endswith(".ifc"):
            return Response(
                {"error": "Element analysis needs an IFC BIM file."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        _SUPPORTED_PC_EXTS = {".ply", ".las", ".laz", ".pts", ".xyz"}
        if not pc_path or os.path.splitext(pc_path)[1].lower() not in _SUPPORTED_PC_EXTS:
            return Response(
                {"error": "Point cloud must be .ply, .las, .laz, .pts, or .xyz for analysis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        warnings = []
        if not bim.transform or not pc.transform:
            warnings.append(
                "BIM and/or Point Cloud have no saved alignment transform — "
                "align and Save Position in the viewer for accurate overlap."
            )

        # Prefer a live overlap snapshot sent from the viewer (its own
        # voxel-hash "🟢 Overlapping Elements" check) over re-deriving overlap
        # from the saved bim/pc transforms here — the snapshot reflects
        # whatever alignment the user actually saw overlapping on screen, and
        # sidesteps any mismatch between the browser's and ifcopenshell's IFC
        # coordinate frames.
        from .models import AlignmentPair
        pair = AlignmentPair.objects.filter(bim_id=bim_id, pointcloud_id=pc_id).first()
        overlap_snapshot = pair.overlap_snapshot if pair and pair.overlap_snapshot else None
        # SAM labels only describe the points of the snapshot they came with.
        semantic_snapshot = (
            pair.semantic_snapshot if overlap_snapshot is not None and pair.semantic_snapshot else None
        )

        try:
            result = analyze(bim_path, pc_path, bim.transform, pc.transform,
                             threshold=threshold, overlap_snapshot=overlap_snapshot,
                             semantic_snapshot=semantic_snapshot,
                             built_coverage=built_coverage)
            # Ensure all numeric types are native Python types for JSON.
            result = sanitize_result(result)

            # If the analysis found no points or no overlap, add an explanatory warning
            point_count = int(result.get("point_count") or 0)
            try:
                overall = float(result.get("summary", {}).get("overall_completion") or 0.0)
            except Exception:
                overall = 0.0
            if overlap_snapshot is not None:
                warnings.append(
                    f"Using overlap data sent from the viewer ({pair.overlap_element_count or len(overlap_snapshot)} elements) "
                    f"instead of server-side alignment."
                )
                if semantic_snapshot is not None:
                    warnings.append(
                        f"Built detection uses SAM photo labels for {len(semantic_snapshot)} elements."
                    )
            elif point_count == 0:
                warnings.append(
                    "Point cloud appears empty or could not be read — check file format and server-side file path."
                )
            elif overall == 0.0 and not warnings:
                warnings.append(
                    "No overlap detected between BIM and point cloud. Ensure both models are aligned and saved in the viewer, and try a larger threshold — or open the viewer, turn on \"Overlapping PointCloud Points\", and use \"Send Overlap to Progress Assessment\"."
                )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({"error": f"Analysis failed: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # SAM labels are single-use: they apply to the Analyze right after an
        # "Auto-detect Built Elements" run. Later analyses go back to plain
        # overlap until the user runs the detection again.
        if semantic_snapshot is not None:
            pair.semantic_snapshot = None
            pair.semantic_snapshot_at = None
            pair.save(update_fields=["semantic_snapshot", "semantic_snapshot_at"])

        result["warnings"] = warnings
        result["bim"] = {"id": bim.id, "date": bim.date, "description": bim.description}
        result["pointcloud"] = {"id": pc.id, "date": pc.date,
                                "description": pc.description}
        return Response(result)


class ProgressSaveView(APIView):
    """
    POST /api/v1/processing/progress/save/
    Persists an assessment (header + per-element rows) for historical tracking.
    Body: { project_id, bim_id, pointcloud_id, pair_id?, summary, elements }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from projects.models import Project, BIMData, PointCloudData
        from .models import ProgressAssessment, ProgressElement, AlignmentPair

        data = request.data or {}
        project_id = data.get("project_id")
        summary = data.get("summary") or {}
        elements = data.get("elements") or []
        if not project_id:
            return Response({"error": "project_id required"}, status=400)

        try:
            project = Project.objects.get(id=project_id)
        except Project.DoesNotExist:
            return Response({"error": "Project not found"}, status=404)

        bim = BIMData.objects.filter(id=data.get("bim_id")).first()
        pc = PointCloudData.objects.filter(id=data.get("pointcloud_id")).first()

        # Prefer the pair the user explicitly selected on the Progress
        # Assessment page; fall back to looking one up by bim/pointcloud so
        # older frontend bundles (or a client-side "not registered yet"
        # sentinel) still link correctly.
        pair = None
        raw_pair_id = data.get("pair_id")
        if raw_pair_id not in (None, ""):
            try:
                pair = AlignmentPair.objects.filter(
                    id=int(raw_pair_id), project=project
                ).first()
            except (TypeError, ValueError):
                pair = None
        if not pair and bim and pc:
            # No pair was ever explicitly registered for this BIM/PointCloud
            # combination (e.g. a new scan date was uploaded and analyzed
            # straight from Progress Assessment without visiting the viewer's
            # "Save Alignment Pair" action first) — saving an assessment for
            # it registers the pair automatically so it appears as its own
            # row going forward.
            pair, _ = AlignmentPair.objects.get_or_create(
                bim=bim, pointcloud=pc,
                defaults={
                    "project": project,
                    "bim_date": bim.date,
                    "pointcloud_date": pc.date,
                },
            )

        assessment = ProgressAssessment.objects.create(
            project=project,
            alignment_pair=pair,
            bim=bim,
            pointcloud=pc,
            bim_date=bim.date if bim else None,
            pointcloud_date=pc.date if pc else None,
            total_elements=summary.get("total", 0),
            completed_elements=summary.get("completed", 0),
            in_progress_elements=summary.get("in_progress", 0),
            not_started_elements=summary.get("not_started", 0),
            overall_completion=summary.get("overall_completion", 0.0),
        )
        rows = [
            ProgressElement(
                assessment=assessment,
                element_id=str(e.get("element_id") or "")[:120],
                element_type=str(e.get("element_type") or "")[:80],
                category=str(e.get("category") or "")[:40],
                level=(e.get("level") or "")[:255],
                level_elevation=e.get("level_elevation"),
                name=str(e.get("name") or "")[:255],
                bim_volume=e.get("bim_volume", 0.0),
                bim_points=e.get("bim_points", 0),
                overlap_points=e.get("overlap_points", 0),
                completion=e.get("completion", 0.0),
                status=e.get("status", "not_started"),
                built_by=(e.get("built_by") or "")[:20],
                sam_built_ratio=e.get("sam_built_ratio"),
            )
            for e in elements
        ]
        ProgressElement.objects.bulk_create(rows, batch_size=500)

        return Response({
            "message": "Assessment saved",
            "assessment_id": assessment.id,
            "pair_id": pair.id if pair else None,
        })


class ProgressHistoryView(APIView):
    """
    GET /api/v1/processing/progress/history/<project_id>/?pair_id=<id>
    Saved assessments for a project (for the progress-over-time trend).
    Pass ?pair_id= to scope the trend to one registered alignment pair —
    each pair (e.g. a later Point Cloud scan registered against the same
    BIM) tracks its own history rather than sharing the whole project's.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        from .models import ProgressAssessment
        from .progress import count_completion
        rows = ProgressAssessment.objects.filter(project_id=project_id)
        pair_id = request.query_params.get("pair_id")
        if pair_id:
            rows = rows.filter(alignment_pair_id=pair_id)
        data = [{
            "id": a.id,
            "created_at": a.created_at,
            "bim_date": a.bim_date,
            "pointcloud_date": a.pointcloud_date,
            "alignment_pair_id": a.alignment_pair_id,
            "total_elements": a.total_elements,
            "completed_elements": a.completed_elements,
            "in_progress_elements": a.in_progress_elements,
            "not_started_elements": a.not_started_elements,
            "overall_completion": count_completion(a.completed_elements, a.total_elements),
        } for a in rows]
        return Response(data)


class ProgressPairAssessmentView(APIView):
    """
    GET /api/v1/processing/progress/pair/<pair_id>/latest/
    Returns the most recently saved assessment for one registered alignment
    pair, reconstructed into the same { elements, summary, categories } shape
    the analyze endpoint returns, so selecting a pair row can show its saved
    elements/charts immediately without re-running Analyze.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pair_id):
        from .models import ProgressAssessment, ProgressElement
        from .progress import _by_category, by_level, by_trade, count_completion

        assessment = (
            ProgressAssessment.objects.filter(alignment_pair_id=pair_id)
            .order_by("-created_at")
            .first()
        )
        if not assessment:
            return Response({"elements": [], "summary": None, "categories": []})

        elements = [{
            "element_id": e.element_id,
            "element_type": e.element_type,
            "category": e.category,
            "level": e.level,
            "level_elevation": e.level_elevation,
            "name": e.name,
            "bim_volume": e.bim_volume,
            "bim_points": e.bim_points,
            "overlap_points": e.overlap_points,
            "completion": e.completion,
            "status": e.status,
            "built_by": e.built_by,
            "sam_built_ratio": e.sam_built_ratio,
        } for e in ProgressElement.objects.filter(assessment=assessment)]

        summary = {
            "total": assessment.total_elements,
            "completed": assessment.completed_elements,
            "in_progress": assessment.in_progress_elements,
            "not_started": assessment.not_started_elements,
            # Recomputed from counts so assessments saved before completion
            # became count-based (completed / total) read consistently.
            "overall_completion": count_completion(
                assessment.completed_elements, assessment.total_elements),
        }

        return Response({
            "assessment_id": assessment.id,
            "saved_at": assessment.created_at,
            "elements": elements,
            "summary": summary,
            "categories": _by_category(elements),
            "levels": by_level(elements),
            "trades": by_trade(elements),
            "warnings": [],
        })


# ─── Alignment Pairs ───────────────────────────────────────────────────────────

class AlignmentPairView(APIView):
    """
    POST /api/v1/processing/alignment/pair/
    Upsert a BIM↔PointCloud registration record.
    Body: { project_id, bim_id, pointcloud_id, method?, fitness?, rmse?,
            relative_transform? }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from projects.models import Project, BIMData, PointCloudData
        from .models import AlignmentPair

        d = request.data or {}
        try:
            project = Project.objects.get(id=d.get("project_id"))
            bim = BIMData.objects.get(id=d.get("bim_id"))
            pc = PointCloudData.objects.get(id=d.get("pointcloud_id"))
        except (Project.DoesNotExist, BIMData.DoesNotExist,
                PointCloudData.DoesNotExist):
            return Response({"error": "project/bim/pointcloud not found"},
                            status=status.HTTP_404_NOT_FOUND)

        pair, created = AlignmentPair.objects.update_or_create(
            bim=bim, pointcloud=pc,
            defaults={
                "project": project,
                "bim_date": bim.date,
                "pointcloud_date": pc.date,
                "method": d.get("method", "manual"),
                "fitness": d.get("fitness"),
                "rmse": d.get("rmse"),
                "relative_transform": d.get("relative_transform"),
            },
        )
        return Response({
            "message": "Alignment pair saved",
            "pair_id": pair.id,
            "created": created,
            "bim_date": pair.bim_date,
            "pointcloud_date": pair.pointcloud_date,
        })


class OverlapSnapshotSaveView(APIView):
    """
    POST /api/v1/processing/progress/overlap-snapshot/
    Saves the viewer's live, voxel-hash-computed overlap data (per-element
    actual overlapping point counts, keyed by IFC expressID) onto the
    registered BIM↔PointCloud pair, so Progress Assessment can use these
    browser-verified counts instead of re-deriving overlap server-side.
    Body: { project_id, bim_id, pointcloud_id, bim_element_count,
            overlap_element_count, overlap_points_by_express_id }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.utils import timezone
        from projects.models import Project, BIMData, PointCloudData
        from .models import AlignmentPair

        d = request.data or {}
        try:
            project = Project.objects.get(id=d.get("project_id"))
            bim = BIMData.objects.get(id=d.get("bim_id"))
            pc = PointCloudData.objects.get(id=d.get("pointcloud_id"))
        except (Project.DoesNotExist, BIMData.DoesNotExist,
                PointCloudData.DoesNotExist):
            return Response({"error": "project/bim/pointcloud not found"},
                            status=status.HTTP_404_NOT_FOUND)

        raw_map = d.get("overlap_points_by_express_id") or {}
        try:
            overlap_map = {str(k): int(v) for k, v in raw_map.items()}
        except (AttributeError, TypeError, ValueError):
            return Response({"error": "overlap_points_by_express_id must map expressID -> count"},
                            status=status.HTTP_400_BAD_REQUEST)

        pair, created = AlignmentPair.objects.update_or_create(
            bim=bim, pointcloud=pc,
            defaults={
                "project": project,
                "bim_date": bim.date,
                "pointcloud_date": pc.date,
                "bim_element_count": d.get("bim_element_count"),
                "overlap_element_count": d.get("overlap_element_count"),
                "overlap_snapshot": overlap_map,
                "overlap_snapshot_at": timezone.now(),
                # Labels from an earlier SAM run belong to a different
                # snapshot/alignment.
                "semantic_snapshot": None,
                "semantic_snapshot_at": None,
            },
        )
        return Response({
            "message": "Overlap snapshot saved",
            "pair_id": pair.id,
            "created": created,
            "elements_with_overlap": len(overlap_map),
        })


class SemanticSnapshotSaveView(APIView):
    """
    POST /api/v1/processing/progress/sam-snapshot/
    Saves the viewer's "Auto-detect Built Elements" run: per-element overlap
    point counts (stored as the pair's overlap snapshot) plus the SAM labels
    of those points, keyed by IFC expressID. Progress Assessment's Analyze
    then removes clutter points and marks elements built automatically.
    Body: { project_id, bim_id, pointcloud_id, bim_element_count,
            cameras_used, elements: {express_id: {points, built, partial, clutter}} }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.utils import timezone
        from projects.models import Project, BIMData, PointCloudData
        from .models import AlignmentPair

        d = request.data or {}
        try:
            project = Project.objects.get(id=d.get("project_id"))
            bim = BIMData.objects.get(id=d.get("bim_id"), project=project)
            pc = PointCloudData.objects.get(id=d.get("pointcloud_id"), project=project)
        except (Project.DoesNotExist, BIMData.DoesNotExist,
                PointCloudData.DoesNotExist):
            return Response({"error": "project/bim/pointcloud not found"},
                            status=status.HTTP_404_NOT_FOUND)

        overlap_map, label_map = {}, {}
        try:
            for eid, row in (d.get("elements") or {}).items():
                points = int(row.get("points") or 0)
                if points <= 0:
                    continue
                overlap_map[str(eid)] = points
                label_map[str(eid)] = {
                    k: int(row.get(k) or 0) for k in ("built", "partial", "clutter")
                }
        except (AttributeError, TypeError, ValueError):
            return Response(
                {"error": "elements must map expressID -> {points, built, partial, clutter}"},
                status=status.HTTP_400_BAD_REQUEST)
        if not overlap_map:
            return Response({"error": "No overlapping elements in the detection result."},
                            status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        pair, created = AlignmentPair.objects.update_or_create(
            bim=bim, pointcloud=pc,
            defaults={
                "project": project,
                "bim_date": bim.date,
                "pointcloud_date": pc.date,
                "bim_element_count": d.get("bim_element_count"),
                "overlap_element_count": len(overlap_map),
                "overlap_snapshot": overlap_map,
                "overlap_snapshot_at": now,
                "semantic_snapshot": label_map,
                "semantic_snapshot_at": now,
            },
        )
        _audit(request, "process_done",
               f"SAM built detection: {len(overlap_map)} elements, "
               f"{d.get('cameras_used') or 0} photos",
               bim_data=bim, point_data=pc)
        return Response({
            "message": "SAM detection saved",
            "pair_id": pair.id,
            "created": created,
            "elements_with_overlap": len(overlap_map),
            "elements_with_labels": sum(
                1 for v in label_map.values() if sum(v.values()) > 0
            ),
        })


class AlignmentPairListView(APIView):
    """
    GET /api/v1/processing/alignment/pairs/<project_id>/
    Registered BIM↔PointCloud pairs for a project (for the Progress page).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        from .models import AlignmentPair
        rows = AlignmentPair.objects.filter(project_id=project_id).select_related(
            "bim", "pointcloud"
        )
        data = []
        for p in rows:
            data.append({
                "id": p.id,
                "bim_id": p.bim_id,
                "pointcloud_id": p.pointcloud_id,
                "bim_date": p.bim_date or (p.bim.date if p.bim else None),
                "pointcloud_date": p.pointcloud_date
                or (p.pointcloud.date if p.pointcloud else None),
                "bim_description": p.bim.description if p.bim else "",
                "pointcloud_description": p.pointcloud.description if p.pointcloud else "",
                "bim_is_latest": bool(p.bim.is_latest) if p.bim else False,
                "pointcloud_is_latest": bool(p.pointcloud.is_latest) if p.pointcloud else False,
                "method": p.method,
                "fitness": p.fitness,
                "rmse": p.rmse,
                "updated_at": p.updated_at,
                "has_overlap_snapshot": bool(p.overlap_snapshot),
                "overlap_element_count": p.overlap_element_count,
                "overlap_snapshot_at": p.overlap_snapshot_at,
            })
        return Response(data)


class ProgressTimelineView(APIView):
    """
    GET /api/v1/processing/progress/timeline/<project_id>/
    Date-wise progress across every registered alignment pair for a project,
    one entry per Point Cloud scan date — the BIM model is the same across
    all pairs for a project, so only `pointcloud_date` is used as the axis.
    Powers the standalone Progress Timeline page (Completed/In Progress/Not
    Started counts per date, and a per-category completion trend).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        from collections import defaultdict
        from .models import AlignmentPair, ProgressAssessment, ProgressElement
        from .progress import count_completion, points_coverage

        pairs = AlignmentPair.objects.filter(project_id=project_id).select_related(
            "pointcloud"
        )

        entries = []
        for pair in pairs:
            entry = {
                "pair_id": pair.id,
                "pointcloud_date": pair.pointcloud_date
                or (pair.pointcloud.date if pair.pointcloud else None),
                "pointcloud_description": pair.pointcloud.description
                if pair.pointcloud else "",
                "assessment_id": None,
                "saved_at": None,
                "summary": None,
                "categories": [],
            }

            assessment = (
                ProgressAssessment.objects.filter(alignment_pair=pair)
                .order_by("-created_at")
                .first()
            )
            if assessment:
                cats = defaultdict(lambda: {
                    "count": 0, "completed": 0, "in_progress": 0,
                    "not_started": 0, "bim_points": 0, "overlap_points": 0,
                })
                for e in ProgressElement.objects.filter(assessment=assessment):
                    c = cats[e.category or "Uncategorized"]
                    c["count"] += 1
                    c[e.status] += 1
                    c["bim_points"] += e.bim_points
                    c["overlap_points"] += min(e.overlap_points, e.bim_points) \
                        if e.bim_points else e.overlap_points

                categories = []
                for name, v in sorted(cats.items()):
                    categories.append({
                        "category": name,
                        "count": v["count"],
                        "completed": v["completed"],
                        "in_progress": v["in_progress"],
                        "not_started": v["not_started"],
                        "completion": count_completion(v["completed"], v["count"]),
                        "points_coverage": points_coverage(
                            v["overlap_points"], v["bim_points"]),
                    })

                entry.update({
                    "assessment_id": assessment.id,
                    "saved_at": assessment.created_at,
                    "summary": {
                        "total": assessment.total_elements,
                        "completed": assessment.completed_elements,
                        "in_progress": assessment.in_progress_elements,
                        "not_started": assessment.not_started_elements,
                        "overall_completion": count_completion(
                            assessment.completed_elements, assessment.total_elements),
                    },
                    "categories": categories,
                })

            entries.append(entry)

        entries.sort(key=lambda d: (d["pointcloud_date"] is None, d["pointcloud_date"]))
        return Response({"dates": entries})


class ScheduleProgressView(APIView):
    """
    GET /api/v1/processing/progress/schedule-status/<project_id>/
    Matches the project's schedule activities to BIM elements and returns,
    per activity, the measured progress across all saved assessments
    (actual %, actual start/finish, not-yet-built elements). Uses the latest
    assessment per scan (point cloud) date.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        from projects.models import ProjectSchedule
        from .models import ProgressAssessment, ProgressElement
        from .schedule_progress import compute

        schedule = ProjectSchedule.objects.filter(project_id=project_id).first()
        assessments = list(
            ProgressAssessment.objects.filter(project_id=project_id)
            .order_by("pointcloud_date", "created_at")
        )
        # Latest assessment per scan date (re-runs replace earlier ones).
        by_date = {}
        for a in assessments:
            key = (a.pointcloud_date or a.created_at.date()).isoformat()
            by_date[key] = a
        scan_dates = sorted(by_date)

        fields = ("element_id", "element_type", "level", "name", "category", "status", "completion")
        scans = []
        for d in scan_dates:
            rows = list(ProgressElement.objects.filter(assessment=by_date[d]).values(*fields))
            scans.append((d, rows))

        latest_rows = scans[-1][1] if scans else []
        ifc_levels = sorted({r["level"] for r in latest_rows if r["level"]})
        meta = schedule.meta if schedule else {}
        activities = compute(schedule.activities, meta, scans) if schedule else {}

        return Response({
            "has_schedule": schedule is not None,
            "scan_dates": scan_dates,
            "latest_scan_date": scan_dates[-1] if scan_dates else None,
            "latest_has_levels": bool(ifc_levels),
            "ifc_levels": ifc_levels,
            "level_map": (meta or {}).get("level_map") or {},
            "activities": activities,
        })


class Schedule4DView(APIView):
    """
    GET /api/v1/processing/progress/schedule-4d/<project_id>/?bim=<bim_id>
    Links every element of an IFC model to the schedule activity it belongs
    to (same matching rules as schedule-status), keyed by express ID so the
    browser can colour the web-ifc mesh directly. Also returns each element's
    measured status from the latest Progress Assessment, if any. Without
    ?bim= the latest IFC upload is used.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        from projects.models import ProjectSchedule
        from .models import ProgressAssessment, ProgressElement
        from .schedule_progress import element_index, link_elements

        schedule = ProjectSchedule.objects.filter(project_id=project_id).first()
        if not schedule:
            return Response({"error": "This project has no schedule."}, status=404)

        bims = BIMData.objects.filter(project_id=project_id).order_by("-is_latest", "-date", "-id")
        bim_id = request.query_params.get("bim")
        if bim_id:
            bims = bims.filter(id=bim_id)
        bim = next((b for b in bims if b.file.name.lower().endswith(".ifc")), None)
        if not bim:
            return Response({"error": "No IFC model found for this project."}, status=404)

        try:
            elements = element_index(bim.file.path)
        except Exception as e:
            return Response({"error": f"Couldn't read the IFC model: {e}"}, status=500)
        links = link_elements(schedule.activities, schedule.meta, elements)

        # Measured status per element from the latest assessment, matched by
        # GlobalId so it carries across re-uploads of the same model.
        actual, scan_date = {}, None
        latest = (
            ProgressAssessment.objects.filter(project_id=project_id)
            .order_by("-pointcloud_date", "-created_at")
            .first()
        )
        if latest:
            scan_date = (latest.pointcloud_date or latest.created_at.date()).isoformat()
            by_gid = {e["element_id"]: e["express_id"] for e in elements}
            for gid, st in ProgressElement.objects.filter(assessment=latest).values_list(
                "element_id", "status"
            ):
                if gid in by_gid:
                    actual[by_gid[gid]] = st

        return Response({
            "bim": {"id": bim.id, "date": bim.date, "file": bim.file.name},
            "element_count": len(elements),
            "linked_count": len(links),
            "elements": links,
            "actual": actual,
            "scan_date": scan_date,
        })


# ─── Monthly point-cloud merge ────────────────────────────────────────────────

def _merge_access(user, project, write=False):
    """Project members (and admins) may see merges; read-only `viewer`
    accounts may open a merged result but not start a merge."""
    from projects.views import user_can_upload_to_project
    if not user_can_upload_to_project(user, project):
        return False
    if write and "viewer" in (getattr(user, "sub_role", None), getattr(user, "role", None)):
        return False
    return True


def _merge_period(data):
    """((project_id, year, month), None) from request data, or (None, error)."""
    try:
        project_id = int(data.get("project_id"))
        year = int(data.get("year"))
        month = int(data.get("month"))
    except (TypeError, ValueError):
        return None, "project_id, year and month are required integers."
    if not 1 <= month <= 12:
        return None, "month must be between 1 and 12."
    if not 1900 <= year <= 2200:
        return None, "year is out of range."
    return (project_id, year, month), None


def _serialize_merge(m, request, current_fingerprint=None):
    if m is None:
        return None
    file_url = None
    if m.file:
        try:
            file_url = request.build_absolute_uri(m.file.url)
        except Exception:
            file_url = m.file.url
    data = {
        "id": m.id,
        "merged_file_id": m.id,
        "project_id": m.project_id,
        "year": m.year,
        "month": m.month,
        "status": m.status,
        "progress": m.progress,
        "stage_label": m.stage_label,
        "error_message": m.error_message,
        "failed_sources": m.failed_sources,
        "source_ids": [s["id"] for s in (m.source_snapshot or [])],
        "sources": m.source_snapshot,
        "excluded_sources": m.excluded_sources,
        "total_source_files": m.total_source_files,
        "file_url": file_url,
        "file_name": os.path.basename(m.file.name) if m.file else None,
        "file_size": m.file_size,
        "point_count": m.point_count,
        "input_point_count": m.input_point_count,
        "voxel_size": m.voxel_size,
        "coordinate_frame": m.coordinate_frame,
        "reference_source_id": m.reference_source_id,
        "transform": m.transform,
        "origin_offset": m.origin_offset,
        "registration": m.registration,
        "min_fitness": m.min_fitness,
        "max_rmse": m.max_rmse,
        "created_by": m.created_by.username if m.created_by_id and m.created_by else None,
        "created_at": m.created_at,
        "started_at": m.started_at,
        "completed_at": m.completed_at,
    }
    if current_fingerprint is not None:
        data["is_stale"] = m.source_fingerprint != current_fingerprint
    return data


def _expire_stale_merges(project_id, year, month):
    """A job whose worker died (server restart) stops sending heartbeats —
    mark it failed so it doesn't block new merges forever."""
    from datetime import timedelta
    from .models import PointCloudMerge
    from .pointcloud_merge import STALE_AFTER_SECONDS
    cutoff = timezone.now() - timedelta(seconds=STALE_AFTER_SECONDS)
    for job in PointCloudMerge.objects.filter(
        project_id=project_id, year=year, month=month, status__in=("queued", "running"),
    ):
        last = job.heartbeat_at or job.created_at
        if last < cutoff:
            job.status = "failed"
            job.stage_label = "Failed"
            job.error_message = "The merge was interrupted (the server stopped). Start it again."
            job.completed_at = timezone.now()
            job.save(update_fields=["status", "stage_label", "error_message", "completed_at"])


class PointCloudMergeView(APIView):
    """
    GET  /api/v1/pointcloud/merge/?project_id=&year=&month=
         Preview: which files of that month would be merged, plus the latest
         merge (running / completed / failed) and whether it is out of date.
    POST /api/v1/pointcloud/merge/  {project_id, year, month, force?, voxel_size?}
         Start a background merge (202). Returns the running job instead of
         starting a duplicate, and the existing up-to-date result unless
         `force` (regenerate) is set.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from projects.models import Project
        from .models import PointCloudMerge
        from . import pointcloud_merge as pm

        period, err = _merge_period(request.query_params)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
        project_id, year, month = period
        project = Project.objects.filter(pk=project_id).first()
        if project is None:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _merge_access(request.user, project):
            return Response({"error": "You are not assigned to this project."},
                            status=status.HTTP_403_FORBIDDEN)

        _expire_stale_merges(project_id, year, month)
        pcs = pm.month_sources(project_id, year, month)
        eligible, excluded, missing = pm.classify_sources(pcs)
        fp = pm.fingerprint(pcs)
        merges = PointCloudMerge.objects.filter(
            project_id=project_id, year=year, month=month).select_related("created_by")
        running = merges.filter(status__in=("queued", "running")).first()
        latest = merges.first()
        latest_completed = merges.filter(status="completed").first()
        return Response({
            "project_id": project.id,
            "project_name": project.project_name,
            "year": year,
            "month": month,
            "month_label": pm.month_label(year, month),
            "output_name": pm.merged_file_name(year, month),
            "sources": eligible,
            "excluded_sources": excluded,
            "missing_sources": missing,
            "eligible_count": len(eligible),
            "can_merge": _merge_access(request.user, project, write=True),
            "running": _serialize_merge(running, request, fp),
            "latest": _serialize_merge(latest, request, fp),
            "latest_completed": _serialize_merge(latest_completed, request, fp),
        })

    def post(self, request):
        from django.db import transaction
        from projects.models import Project
        from .models import PointCloudMerge
        from . import pointcloud_merge as pm

        period, err = _merge_period(request.data)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
        project_id, year, month = period
        force = str(request.data.get("force", "")).lower() in ("1", "true", "yes", "on")
        voxel_size = request.data.get("voxel_size")
        if voxel_size not in (None, ""):
            try:
                voxel_size = float(voxel_size)
                if not voxel_size > 0:
                    raise ValueError
            except (TypeError, ValueError):
                return Response({"error": "voxel_size must be a positive number."},
                                status=status.HTTP_400_BAD_REQUEST)
        else:
            voxel_size = None

        project = Project.objects.filter(pk=project_id).first()
        if project is None:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _merge_access(request.user, project, write=True):
            return Response({"error": "You do not have permission to merge point clouds "
                                      "for this project."},
                            status=status.HTTP_403_FORBIDDEN)

        label = pm.month_label(year, month)
        with transaction.atomic():
            # Serialise merge requests per project so two clicks / tabs can't
            # both pass the "already running?" check.
            Project.objects.select_for_update().filter(pk=project_id).first()
            _expire_stale_merges(project_id, year, month)

            pcs = pm.month_sources(project_id, year, month)
            eligible, excluded, missing = pm.classify_sources(pcs)
            if missing:
                return Response({
                    "error": f"{len(missing)} point cloud file(s) for {label} are missing "
                             "from storage. Re-upload or delete them, then merge again.",
                    "failed_sources": missing,
                }, status=status.HTTP_400_BAD_REQUEST)
            if not eligible:
                msg = (f"No point cloud files were uploaded in {label}." if not pcs else
                       f"None of the point clouds uploaded in {label} are in a format "
                       "the server can read (PLY, LAS, LAZ, PTS, XYZ).")
                return Response({"error": msg, "excluded_sources": excluded},
                                status=status.HTTP_400_BAD_REQUEST)

            fp = pm.fingerprint(pcs)
            merges = PointCloudMerge.objects.filter(project_id=project_id, year=year, month=month)
            running = merges.filter(status__in=("queued", "running")).first()
            if running:
                return Response({"merge": _serialize_merge(running, request, fp),
                                 "already_running": True}, status=status.HTTP_200_OK)
            if not force and voxel_size is None:
                done = merges.filter(status="completed", source_fingerprint=fp).first()
                if done and done.file:
                    return Response({"merge": _serialize_merge(done, request, fp),
                                     "reused": True}, status=status.HTTP_200_OK)

            eligible_ids = {s["id"] for s in eligible}
            job = PointCloudMerge.objects.create(
                project=project, year=year, month=month,
                source_snapshot=eligible, source_fingerprint=fp,
                excluded_sources=excluded, total_source_files=len(eligible),
                requested_voxel_size=voxel_size,
                created_by=request.user, stage_label="Queued",
                heartbeat_at=timezone.now(),
            )
            job.sources.set([pc for pc in pcs if pc.id in eligible_ids])

            if getattr(settings, "POINTCLOUD_MERGE_RUN_INLINE", False):
                transaction.on_commit(lambda: pm.run_merge_job(job.id))
            else:
                transaction.on_commit(lambda: pm.start_merge_job(job.id))

        job.refresh_from_db()
        return Response({"merge": _serialize_merge(job, request, fp)},
                        status=status.HTTP_202_ACCEPTED)


class PointCloudMergeDetailView(APIView):
    """GET /api/v1/pointcloud/merge/<id>/ — status polling and result."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from .models import PointCloudMerge
        from . import pointcloud_merge as pm

        m = PointCloudMerge.objects.select_related("project", "created_by").filter(pk=pk).first()
        if m is None:
            return Response({"error": "Merge not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _merge_access(request.user, m.project):
            return Response({"error": "You are not assigned to this project."},
                            status=status.HTTP_403_FORBIDDEN)
        _expire_stale_merges(m.project_id, m.year, m.month)
        m.refresh_from_db()
        fp = pm.fingerprint(pm.month_sources(m.project_id, m.year, m.month))
        return Response(_serialize_merge(m, request, fp))
