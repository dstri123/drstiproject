"""
Issues pinned in 3D.

  GET/POST          /api/v1/issues/project/<project_id>/          list / create
  GET               /api/v1/issues/project/<project_id>/assignees/
  GET               /api/v1/issues/project/<project_id>/bcf/      BCF 2.1 .bcfzip
  GET/PATCH/DELETE  /api/v1/issues/<pk>/

Create/update accept JSON or multipart (multipart when a photo or snapshot
is attached; `position` / `viewpoint` are then JSON-encoded strings).
"""
import logging

from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from projects.models import Project, ProjectUser
from projects.views import user_can_upload_to_project

from .bcf import build_bcfzip
from .models import Issue
from .serializers import IssueSerializer

logger = logging.getLogger(__name__)

PARSERS = [JSONParser, MultiPartParser, FormParser]


def _project_or_403(request, project_id):
    project = get_object_or_404(Project, id=project_id)
    if not user_can_upload_to_project(request.user, project):
        return project, Response({"error": "You are not assigned to this project"}, status=403)
    return project, None


def _assignees(project):
    """Project members plus the organization's admins."""
    member_ids = ProjectUser.objects.filter(project=project).values_list("user_id", flat=True)
    q = Q(id__in=member_ids)
    org_ids = User.objects.filter(id__in=member_ids).exclude(organization=None) \
        .values_list("organization_id", flat=True)
    q |= Q(role="admin", organization_id__in=org_ids)
    return User.objects.filter(q, is_active=True).distinct().order_by("first_name", "username")


def _filtered(request, project):
    qs = Issue.objects.filter(project=project).select_related(
        "assignee", "created_by", "updated_by", "bim")
    params = request.query_params
    if params.get("status"):
        qs = qs.filter(status__in=params["status"].split(","))
    if params.get("assignee") == "me":
        qs = qs.filter(assignee=request.user)
    elif params.get("assignee"):
        qs = qs.filter(assignee_id=params["assignee"])
    if params.get("bim"):
        qs = qs.filter(bim_id=params["bim"])
    if params.get("ids"):
        ids = [i for i in params["ids"].split(",") if i.strip().isdigit()]
        qs = qs.filter(id__in=ids)
    return qs


class IssueListView(APIView):
    parser_classes = PARSERS

    def get(self, request, project_id):
        project, denied = _project_or_403(request, project_id)
        if denied:
            return denied
        issues = _filtered(request, project)
        return Response(IssueSerializer(issues, many=True, context={"request": request}).data)

    def post(self, request, project_id):
        project, denied = _project_or_403(request, project_id)
        if denied:
            return denied
        serializer = IssueSerializer(data=request.data, context={
            "request": request, "project": project,
            "assignee_ids": set(_assignees(project).values_list("id", flat=True)),
        })
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        # Per-project numbering; retry if two issues are pinned at once.
        for _ in range(3):
            try:
                with transaction.atomic():
                    last = Issue.objects.filter(project=project).aggregate(n=Max("number"))["n"]
                    issue = serializer.save(project=project, number=(last or 0) + 1,
                                            created_by=request.user, updated_by=request.user)
                break
            except IntegrityError:
                continue
        else:
            return Response({"error": "Could not number the issue, try again."}, status=409)
        return Response(IssueSerializer(issue, context={"request": request}).data, status=201)


class IssueDetailView(APIView):
    parser_classes = PARSERS

    def _get(self, request, pk):
        issue = get_object_or_404(Issue.objects.select_related("project"), pk=pk)
        _project, denied = _project_or_403(request, issue.project_id)
        return issue, denied

    def get(self, request, pk):
        issue, denied = self._get(request, pk)
        if denied:
            return denied
        return Response(IssueSerializer(issue, context={"request": request}).data)

    def patch(self, request, pk):
        issue, denied = self._get(request, pk)
        if denied:
            return denied
        serializer = IssueSerializer(issue, data=request.data, partial=True, context={
            "request": request, "project": issue.project,
            "assignee_ids": set(_assignees(issue.project).values_list("id", flat=True)),
        })
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        issue = serializer.save(updated_by=request.user)
        return Response(IssueSerializer(issue, context={"request": request}).data)

    def delete(self, request, pk):
        issue, denied = self._get(request, pk)
        if denied:
            return denied
        if request.user.role not in ("admin", "superadmin") and issue.created_by_id != request.user.id:
            return Response({"error": "Only the issue's creator or an admin can delete it."},
                            status=403)
        issue.photo.delete(save=False)
        issue.snapshot.delete(save=False)
        issue.delete()
        return Response(status=204)


class IssueAssigneesView(APIView):
    def get(self, request, project_id):
        project, denied = _project_or_403(request, project_id)
        if denied:
            return denied
        return Response([
            {"id": u.id, "name": u.get_full_name() or u.username, "email": u.email, "role": u.role}
            for u in _assignees(project)
        ])


class IssueBCFExportView(APIView):
    """Same filters as the list (?status=, ?assignee=, ?ids=, ?bim=)."""

    def get(self, request, project_id):
        project, denied = _project_or_403(request, project_id)
        if denied:
            return denied
        issues = list(_filtered(request, project))
        if not issues:
            return Response({"error": "No issues to export."}, status=404)
        data = build_bcfzip(project, issues, _resolve_global_ids(issues))
        name = slugify(project.project_name) or f"project-{project.id}"
        resp = HttpResponse(data, content_type="application/octet-stream")
        resp["Content-Disposition"] = f'attachment; filename="{name}-issues.bcfzip"'
        return resp


def _resolve_global_ids(issues):
    """{issue.pk: IfcGuid} for issues pinned to an element whose GlobalId the
    browser couldn't read — looked up from the IFC by express ID."""
    from processing.schedule_progress import element_index

    out, by_bim = {}, {}
    for i in issues:
        if i.element_express_id is not None and not i.element_global_id and i.bim_id:
            by_bim.setdefault(i.bim, []).append(i)
    for bim, items in by_bim.items():
        if not bim.file or not bim.file.name.lower().endswith(".ifc"):
            continue
        try:
            gids = {e["express_id"]: e["element_id"] for e in element_index(bim.file.path)}
        except Exception:
            logger.warning("GlobalId lookup failed for BIM #%s", bim.id, exc_info=True)
            continue
        for i in items:
            if i.element_express_id in gids:
                out[i.pk] = gids[i.element_express_id]
    return out
