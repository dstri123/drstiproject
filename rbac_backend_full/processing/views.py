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
import os
import tempfile
import shutil
from datetime import datetime
from threading import Thread

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


def _get_client_ip(request):
    x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded:
        return x_forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


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
                f.name = os.path.basename(bim.file.name)
                f.size = os.path.getsize(bim.file.path)
                results = validate_bim_upload(f)

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
                f.name = os.path.basename(pc.file.name)
                f.size = os.path.getsize(pc.file.path)
                results = validate_pointcloud_upload(f)

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

        xmin, xmax = float(data['xmin']), float(data['xmax'])
        ymin, ymax = float(data['ymin']), float(data['ymax'])
        zmin, zmax = float(data['zmin']), float(data['zmax'])

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
            job.started_at = datetime.now()
        if request.data.get('status') in ('completed', 'failed', 'cancelled'):
            job.completed_at = datetime.now()

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
                results = run_project_checks(project)
            except Exception:
                return Response({'error': 'Project not found'}, status=404)

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

    # Sub-sample large clouds.
    if len(pts) > max_points:
        idx = np.random.choice(len(pts), max_points, replace=False)
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
    Body: { bim_id, pointcloud_id, threshold? }
    Runs the Scan-to-BIM element progress analysis and returns per-element
    completion + summary (does NOT save).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from projects.models import BIMData, PointCloudData
        from .progress import analyze, sanitize_result

        bim_id = request.data.get("bim_id")
        pc_id = request.data.get("pointcloud_id")
        threshold = float(request.data.get("threshold") or 0.15)
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

        try:
            result = analyze(bim_path, pc_path, bim.transform, pc.transform,
                             threshold=threshold)
            # Ensure all numeric types are native Python types for JSON.
            result = sanitize_result(result)

            # If the analysis found no points or no overlap, add an explanatory warning
            point_count = int(result.get("point_count") or 0)
            try:
                overall = float(result.get("summary", {}).get("overall_completion") or 0.0)
            except Exception:
                overall = 0.0
            if point_count == 0:
                warnings.append(
                    "Point cloud appears empty or could not be read — check file format and server-side file path."
                )
            elif overall == 0.0 and not warnings:
                warnings.append(
                    "No overlap detected between BIM and point cloud. Ensure both models are aligned and saved in the viewer, and try a larger threshold."
                )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({"error": f"Analysis failed: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        result["warnings"] = warnings
        result["bim"] = {"id": bim.id, "date": bim.date, "description": bim.description}
        result["pointcloud"] = {"id": pc.id, "date": pc.date,
                                "description": pc.description}
        return Response(result)


class ProgressSaveView(APIView):
    """
    POST /api/v1/processing/progress/save/
    Persists an assessment (header + per-element rows) for historical tracking.
    Body: { project_id, bim_id, pointcloud_id, summary, elements }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from projects.models import Project, BIMData, PointCloudData
        from .models import ProgressAssessment, ProgressElement

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

        assessment = ProgressAssessment.objects.create(
            project=project,
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
                element_id=e.get("element_id", ""),
                element_type=e.get("element_type", ""),
                category=e.get("category", ""),
                name=e.get("name", ""),
                bim_area=e.get("bim_area", 0.0),
                overlap_area=e.get("overlap_area", 0.0),
                completion=e.get("completion", 0.0),
                status=e.get("status", "not_started"),
            )
            for e in elements
        ]
        ProgressElement.objects.bulk_create(rows, batch_size=500)

        return Response({"message": "Assessment saved", "assessment_id": assessment.id})


class ProgressHistoryView(APIView):
    """
    GET /api/v1/processing/progress/history/<project_id>/
    Saved assessments for a project (for the progress-over-time trend).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        from .models import ProgressAssessment
        rows = ProgressAssessment.objects.filter(project_id=project_id)
        data = [{
            "id": a.id,
            "created_at": a.created_at,
            "bim_date": a.bim_date,
            "pointcloud_date": a.pointcloud_date,
            "total_elements": a.total_elements,
            "completed_elements": a.completed_elements,
            "in_progress_elements": a.in_progress_elements,
            "not_started_elements": a.not_started_elements,
            "overall_completion": a.overall_completion,
        } for a in rows]
        return Response(data)


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
                "method": p.method,
                "fitness": p.fitness,
                "rmse": p.rmse,
                "updated_at": p.updated_at,
            })
        return Response(data)
