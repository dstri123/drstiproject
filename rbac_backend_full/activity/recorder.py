import os

from django.apps import apps

from .models import ActivityLog
from .permissions import effective_role

VERBS = {
    "create": "Created",
    "upload": "Uploaded",
    "update": "Updated",
    "delete": "Deleted",
    "assign": "Assigned",
    "unassign": "Removed",
    "process": "Ran",
    "login": "Logged in",
    "login_failed": "Failed login",
    "password_reset": "Reset",
    "other": "Changed",
}

# Attributes tried, in order, to give a row a readable target name.
_NAME_ATTRS = ("project_name", "original_name", "batch_name", "username", "name", "description")
_FILE_ATTRS = ("file", "image")


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


def display_name(obj):
    for attr in _NAME_ATTRS:
        value = getattr(obj, attr, None)
        if value:
            return str(value)[:255]
    for attr in _FILE_ATTRS:
        f = getattr(obj, attr, None)
        if f and getattr(f, "name", None):
            return os.path.basename(f.name)[:255]
    date = getattr(obj, "date", None)
    return str(date) if date else ""


def get_project(project_id):
    """The Project row, or None if the id is empty/invalid/already deleted."""
    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return None
    return apps.get_model("projects", "Project").objects.filter(pk=project_id).first()


def owner_admin_for(user):
    """Which admin's activity `user`'s actions count as: admins own their
    own entries; everyone else belongs to whoever created their account."""
    if user is None:
        return None
    if effective_role(user) == "admin":
        return user
    creator = user.created_by
    if creator is not None and effective_role(creator) == "admin":
        return creator
    return None


def describe(action, label, name="", project_name=""):
    text = f"{VERBS.get(action, 'Changed')} {label}"
    if name:
        text += f' "{name}"'
    if project_name and label != "project":
        text += f' in project "{project_name}"'
    return text[:500]


def record(*, action, description, request=None, user=None, project=None, project_name="",
           target_type="", target_id="", target_name="", details=None, status_code=None,
           username=""):
    """Write one ActivityLog row. `user` may be None (failed logins)."""
    if user is not None and not getattr(user, "is_authenticated", False):
        user = None
    if project is not None and not project_name:
        project_name = project.project_name
    return ActivityLog.objects.create(
        user=user,
        username=(user.username if user else username)[:150],
        user_role=effective_role(user) if user else "",
        owner_admin=owner_admin_for(user),
        action=action,
        target_type=target_type[:50],
        target_id=str(target_id or "")[:64],
        target_name=(target_name or "")[:255],
        project=project,
        project_name=(project_name or "")[:255],
        description=description[:500],
        details=details or {},
        method=request.method if request else "",
        path=request.path[:500] if request else "",
        status_code=status_code,
        ip_address=client_ip(request) if request else None,
    )
