import csv
import math

from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User

from .models import ActivityLog
from .permissions import (
    ActivityLogPermission,
    SuperAdminPermission,
    admin_scope_q,
    created_by_admin_q,
    effective_role,
    unlinked_q,
    visible_logs,
)
from .recorder import record
from .serializers import ActivityLogSerializer

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 200


def _int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def scoped_logs(request):
    """The requester's visible entries, narrowed to one admin's users
    (owner_admin=<id>) or to users not linked to any admin (unlinked=1).
    The superadmin's per-admin pages use these; for an admin they can only
    narrow further, never widen."""
    params = request.query_params
    qs = visible_logs(request.user)
    owner = _int(params.get("owner_admin"), None)
    if owner is not None:
        qs = qs.filter(admin_scope_q(owner))
    if params.get("unlinked") in ("1", "true"):
        qs = qs.filter(unlinked_q())
    return qs


def filtered_logs(request):
    """scoped_logs narrowed by the list/export query-string filters.

    date_from / date_to are full ISO datetimes (the browser converts the
    picked local day to its start/end instant), so no DB timezone tables are
    needed for date filtering.
    """
    params = request.query_params
    qs = scoped_logs(request).select_related("edited_by")

    search = (params.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(username__icontains=search)
            | Q(description__icontains=search)
            | Q(target_name__icontains=search)
            | Q(project_name__icontains=search)
            | Q(note__icontains=search)
        )
    if params.get("action"):
        qs = qs.filter(action=params["action"])
    if params.get("target_type"):
        qs = qs.filter(target_type=params["target_type"])
    if params.get("user"):
        qs = qs.filter(user_id=params["user"])
    if params.get("project"):
        qs = qs.filter(project_id=params["project"])

    date_from = parse_datetime(params.get("date_from") or "")
    date_to = parse_datetime(params.get("date_to") or "")
    if date_from:
        qs = qs.filter(created_at__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__lte=date_to)
    return qs


class ActivityLogListView(APIView):
    """GET /api/v1/activity/ — paginated, filterable log (superadmin/admin)."""
    permission_classes = [ActivityLogPermission]

    def get(self, request):
        qs = filtered_logs(request)
        page_size = min(max(_int(request.query_params.get("page_size"), DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE)
        count = qs.count()
        total_pages = max(math.ceil(count / page_size), 1)
        page = min(max(_int(request.query_params.get("page"), 1), 1), total_pages)
        rows = qs[(page - 1) * page_size: page * page_size]
        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            # Anyone allowed in may edit/delete what they can see.
            "can_edit": True,
            "results": ActivityLogSerializer(rows, many=True).data,
        })


class ActivityLogFiltersView(APIView):
    """GET /api/v1/activity/filters/ — options for the filter dropdowns."""
    permission_classes = [ActivityLogPermission]

    def get(self, request):
        base = scoped_logs(request)
        users = (
            base.exclude(user__isnull=True)
            .values("user_id", "username").distinct().order_by("username")
        )
        projects = (
            base.exclude(project__isnull=True)
            .values("project_id", "project__project_name").distinct().order_by("project__project_name")
        )
        target_types = (
            base.exclude(target_type="")
            .values_list("target_type", flat=True).distinct().order_by("target_type")
        )
        return Response({
            "users": [{"id": u["user_id"], "username": u["username"]} for u in users],
            "projects": [{"id": p["project_id"], "name": p["project__project_name"]} for p in projects],
            "actions": [{"value": v, "label": l} for v, l in ActivityLog.ACTION_CHOICES],
            "target_types": list(target_types),
            "can_edit": True,
        })


class ActivityLogExportView(APIView):
    """GET /api/v1/activity/export/ — every row matching the filters, as CSV."""
    permission_classes = [ActivityLogPermission]

    def get(self, request):
        qs = filtered_logs(request)
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        stamp = timezone.now().strftime("%Y-%m-%d")
        response["Content-Disposition"] = f'attachment; filename="activity_log_{stamp}.csv"'
        response.write("﻿")  # BOM so Excel opens UTF-8 correctly
        writer = csv.writer(response)
        writer.writerow([
            "ID", "Date & time (UTC)", "User", "Role", "Action", "Item type", "Item",
            "Project", "Description", "Note", "IP address", "Edited at (UTC)", "Edited by",
        ])
        for log in qs.iterator(chunk_size=1000):
            writer.writerow([
                log.id,
                log.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                log.username,
                log.user_role,
                log.get_action_display(),
                log.target_type,
                log.target_name,
                log.project_name,
                log.description,
                log.note,
                log.ip_address or "",
                log.edited_at.strftime("%Y-%m-%d %H:%M:%S") if log.edited_at else "",
                log.edited_by.username if log.edited_by else "",
            ])
        return response


def _record_deletion(request, logs):
    """Leave a trace of what was deleted, so removing entries is itself audited."""
    count = len(logs)
    record(
        action="delete",
        description=f"Deleted {count} activity log entr{'y' if count == 1 else 'ies'}",
        request=request,
        user=request.user,
        target_type="activity log",
        target_id=",".join(str(log.id) for log in logs)[:64],
        target_name=logs[0].description if count == 1 else f"{count} entries",
        details={"deleted": [
            {
                "id": log.id,
                "created_at": log.created_at.isoformat(),
                "username": log.username,
                "description": log.description,
            }
            for log in logs
        ]},
        status_code=200,
    )


class ActivityLogDetailView(APIView):
    """PATCH: edit description/note. DELETE: remove the entry.
    Only entries the requester can see (see permissions.visible_logs)."""
    permission_classes = [ActivityLogPermission]

    def get(self, request, pk):
        return Response(ActivityLogSerializer(get_object_or_404(visible_logs(request.user), pk=pk)).data)

    def patch(self, request, pk):
        log = get_object_or_404(visible_logs(request.user), pk=pk)
        serializer = ActivityLogSerializer(log, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(edited_at=timezone.now(), edited_by=request.user)
        return Response(serializer.data)

    def delete(self, request, pk):
        log = get_object_or_404(visible_logs(request.user), pk=pk)
        _record_deletion(request, [log])
        log.delete()
        return Response({"deleted": 1})


class ActivityLogBulkDeleteView(APIView):
    """POST /api/v1/activity/bulk-delete/ {ids: [...]}"""
    permission_classes = [ActivityLogPermission]

    def post(self, request):
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            return Response({"error": "ids must be a non-empty list"}, status=400)
        logs = list(visible_logs(request.user).filter(pk__in=[_int(i, None) for i in ids]))
        if not logs:
            return Response({"deleted": 0})
        _record_deletion(request, logs)
        ActivityLog.objects.filter(pk__in=[log.pk for log in logs]).delete()
        return Response({"deleted": len(logs)})


def _last(qs):
    return qs.order_by("-created_at").values_list("created_at", flat=True).first()


def _user_row(user):
    logs = ActivityLog.objects.filter(user=user)
    return {
        "id": user.id,
        "username": user.username,
        "full_name": f"{user.first_name} {user.last_name}".strip(),
        "role": effective_role(user),
        "is_active": user.is_active,
        "log_count": logs.count(),
        "last_activity": _last(logs),
    }


class ActivityAdminsView(APIView):
    """GET /api/v1/activity/admins/ — superadmin only.

    Every admin with their own activity count and the users they created
    (each with an activity count), plus a group for users not linked to any
    admin. Drives the superadmin's "activity by admin" page."""
    permission_classes = [SuperAdminPermission]

    def get(self, request):
        admins = (
            User.objects.filter(Q(role="admin") | Q(sub_role="admin"))
            .select_related("organization").order_by("username")
        )
        data = []
        for admin in admins:
            own = ActivityLog.objects.filter(user=admin)
            users_logs = ActivityLog.objects.filter(admin_scope_q(admin.id))
            users = User.objects.filter(created_by=admin).exclude(pk=admin.pk).order_by("username")
            last = [d for d in (_last(own), _last(users_logs)) if d]
            data.append({
                "id": admin.id,
                "username": admin.username,
                "full_name": f"{admin.first_name} {admin.last_name}".strip(),
                "email": admin.email,
                "organization": admin.organization.name if admin.organization else "",
                "is_active": admin.is_active,
                "own_log_count": own.count(),
                "users_log_count": users_logs.count(),
                "last_activity": max(last) if last else None,
                "users": [_user_row(u) for u in users],
            })

        unlinked_users = (
            User.objects.exclude(Q(role__in=["admin", "superadmin"]) | Q(sub_role__in=["admin", "superadmin"]))
            .exclude(created_by_admin_q()).order_by("username")
        )
        unlinked_logs = ActivityLog.objects.filter(unlinked_q())
        return Response({
            "admins": data,
            "unlinked": {
                "users": [_user_row(u) for u in unlinked_users],
                "log_count": unlinked_logs.count(),
                "last_activity": _last(unlinked_logs),
            },
        })
