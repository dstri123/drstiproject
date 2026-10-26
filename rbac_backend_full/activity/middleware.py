"""
Records every successful write to /api/v1/ in the activity log.

Runs around the view: before it, snapshots the object a delete/update targets
(so the entry can still name it once it's gone, and old values can be
compared); after it, reads the authenticated user and parsed request data
from the DRF request attached to the response and writes one ActivityLog row.

Logging must never break the request it's describing, so every failure here
is caught and only reported to the server log.
"""
import json
import logging
import os

from django.apps import apps
from django.core.serializers.json import DjangoJSONEncoder
from rest_framework.request import Empty

from .recorder import describe, display_name, get_project, record
from .routes import LOGIN_PATTERN, find_route, is_skipped, normalize

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1/"
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _jsonable(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def _short(value):
    text = "—" if value in (None, "") else str(value)
    return text if len(text) <= 40 else text[:37] + "..."


def _request_data(drf_request):
    """Data the view already parsed. Never triggers parsing itself, so large
    multipart uploads aren't read a second time."""
    data = getattr(drf_request, "_full_data", Empty)
    return data if data is not Empty and hasattr(data, "get") else {}


def _response_name(resp):
    if not isinstance(resp, dict):
        return ""
    for key in ("original_name", "description", "batch_name", "file_name", "username", "date"):
        if resp.get(key):
            return str(resp[key])
    if resp.get("file"):
        return os.path.basename(str(resp["file"]))
    return ""


class ActivityLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method not in WRITE_METHODS or not request.path_info.startswith(API_PREFIX):
            return self.get_response(request)

        path = normalize(request.path_info[len(API_PREFIX):])
        if is_skipped(path):
            return self.get_response(request)

        route, groups = find_route(request.method, path)
        before = None
        try:
            before = self._snapshot(route, groups)
        except Exception:
            logger.exception("activity log: snapshot failed for %s %s", request.method, path)

        response = self.get_response(request)

        try:
            self._log(request, response, path, route, groups, before)
        except Exception:
            logger.exception("activity log: could not record %s %s", request.method, path)
        return response

    # ── before the view ──────────────────────────────────────────────────────
    def _snapshot(self, route, groups):
        if not route or not route.model or "pk" not in groups:
            return None
        model = apps.get_model(route.model)
        obj = model.objects.filter(pk=groups["pk"]).first()
        if obj is None:
            return None
        is_project = model._meta.label == "projects.Project"
        return {
            "name": display_name(obj),
            "project_id": obj.pk if is_project else getattr(obj, "project_id", None),
            "project_name": obj.project_name if is_project else "",
            "fields": {f: _jsonable(getattr(obj, f, None)) for f in route.track},
        }

    # ── after the view ───────────────────────────────────────────────────────
    def _log(self, request, response, path, route, groups, before):
        drf_request = (getattr(response, "renderer_context", None) or {}).get("request")
        data = _request_data(drf_request)
        resp = getattr(response, "data", None)
        status = response.status_code

        if LOGIN_PATTERN.fullmatch(path):
            self._log_login(request, data, resp, status)
            return
        if status >= 400:
            return

        user = getattr(drf_request, "user", None) or getattr(request, "user", None)

        if route is None:
            # Unknown endpoint: still keep a trace, just a less friendly one.
            if user is not None and user.is_authenticated:
                record(
                    action="other",
                    description=f"{request.method} {request.path}",
                    request=request, user=user, status_code=status,
                )
            return

        details = {}
        name = (before or {}).get("name") or ""
        if not name and route.name_key:
            name = str(data.get(route.name_key) or "")
        if not name:
            name = _response_name(resp)

        if route.label == "photo batch" and request.method == "DELETE":
            name = request.GET.get("batch_name", "")
        if isinstance(resp, list):
            details["count"] = len(resp)
        if route.label == "schedule" and isinstance(data.get("activities"), list):
            details["activities"] = len(data["activities"])
        if route.label == "own profile" and user is not None:
            name = user.username

        User = apps.get_model("accounts", "User")
        if route.label == "users to project":
            ids = data.get("user_ids") or []
            details["user_ids"] = ids
            name = ", ".join(User.objects.filter(pk__in=ids).values_list("username", flat=True))
        elif route.label == "user from project":
            details["user_id"] = data.get("user_id")
            name = User.objects.filter(pk=data.get("user_id")).values_list("username", flat=True).first() or ""

        # Which project this happened in.
        project_id = (
            groups.get("project_id")
            or (before or {}).get("project_id")
            or (route.project_key and data.get(route.project_key))
            or (isinstance(resp, dict) and (resp.get("project_id") or resp.get("project")))
        )
        project = get_project(project_id)
        project_name = project.project_name if project else (before or {}).get("project_name", "")

        # Old → new values for tracked fields.
        description = describe(route.action, route.label, name, project_name)
        if route.track and before and route.action == "update":
            obj = apps.get_model(route.model).objects.filter(pk=groups["pk"]).first()
            if obj is not None:
                changes = {}
                for field, old in before["fields"].items():
                    new = _jsonable(getattr(obj, field, None))
                    if new != old:
                        changes[field] = [old, new]
                if changes:
                    details["changes"] = changes
                    shown = [
                        f"{f}: {_short(o)} → {_short(n)}" if f != "transform" else "position/rotation"
                        for f, (o, n) in list(changes.items())[:3]
                    ]
                    description = f"{description} ({'; '.join(shown)})"[:500]

        target_id = groups.get("pk") or (
            isinstance(resp, dict) and (resp.get("id") or resp.get("project_id"))
        ) or ""

        record(
            action=route.action,
            description=description,
            request=request,
            user=user,
            project=project,
            project_name=project_name,
            target_type=route.label,
            target_id=target_id,
            target_name=name,
            details=details,
            status_code=status,
        )

    def _log_login(self, request, data, resp, status):
        if status < 400 and isinstance(resp, dict) and isinstance(resp.get("user"), dict):
            User = apps.get_model("accounts", "User")
            user = User.objects.filter(pk=resp["user"].get("id")).first()
            if user is None:
                return
            record(
                action="login", description="Logged in", request=request, user=user,
                target_type="session", target_name=user.username, status_code=status,
            )
        elif status in (400, 401, 403):
            # Passwords are never stored — only the name that was tried.
            attempted = str(data.get("username") or "").strip()[:150]
            record(
                action="login_failed",
                description=f'Failed login attempt for "{attempted}"' if attempted else "Failed login attempt",
                request=request, username=attempted,
                target_type="session", target_name=attempted, status_code=status,
            )
