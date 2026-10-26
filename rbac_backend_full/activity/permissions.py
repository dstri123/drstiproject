from django.db.models import Q
from rest_framework.permissions import BasePermission

from .models import ActivityLog

# Who may open the activity log at all. Everyone else gets 403.
#   superadmin — sees, edits and deletes every entry (admins' included)
#   admin      — sees, edits and deletes entries made by the sub-role users
#                they created (managers, engineers, data contributors, ...);
#                not their own or other admins' entries, so admins' actions
#                stay under the superadmin's oversight
LOG_VIEWER_ROLES = {"superadmin", "admin"}
ADMIN_HIDDEN_ROLES = ("superadmin", "admin", "")


def effective_role(user):
    # Contributor accounts are stored with role="member" and the real role in
    # sub_role, so sub_role wins when it's set (same rule the login page uses).
    # Admin accounts can carry sub_role="admin" too, which resolves the same.
    return (getattr(user, "sub_role", None) or getattr(user, "role", None) or "").lower()


def can_view_logs(user):
    return bool(user and user.is_authenticated and effective_role(user) in LOG_VIEWER_ROLES)


def visible_logs(user):
    """The entries `user` may see — and therefore edit and delete.

    Filters on the user_role snapshot taken when the entry was written, so
    entries stay correctly scoped after the user is deleted or re-roled.
    Entries with no role (failed logins of unknown names) are superadmin-only.
    """
    qs = ActivityLog.objects.all()
    role = effective_role(user)
    if role == "superadmin":
        return qs
    if role == "admin":
        # owner_admin covers entries of since-deleted users; created_by
        # covers entries recorded before the user was linked to this admin.
        return qs.filter(Q(owner_admin=user) | Q(user__created_by=user)).exclude(
            user_role__in=ADMIN_HIDDEN_ROLES
        )
    return qs.none()


def admin_scope_q(admin_id):
    """Entries by the users `admin_id` created (not the admin's own)."""
    return (Q(owner_admin_id=admin_id) | Q(user__created_by_id=admin_id)) & ~Q(user_id=admin_id)


def created_by_admin_q(prefix=""):
    """Users (or `prefix`-related users) whose creator is an admin."""
    return Q(**{f"{prefix}created_by__role": "admin"}) | Q(**{f"{prefix}created_by__sub_role": "admin"})


def unlinked_q():
    """Entries by sub-role users who don't belong to any admin (created by a
    superadmin, before creators were recorded, or since deleted)."""
    return (
        Q(owner_admin__isnull=True)
        & ~Q(user_role__in=ADMIN_HIDDEN_ROLES)
        & ~created_by_admin_q("user__")
    )


class SuperAdminPermission(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated
                    and effective_role(request.user) == "superadmin")


class ActivityLogPermission(BasePermission):
    """Only superadmins and admins may use the activity log API."""

    def has_permission(self, request, view):
        return can_view_logs(request.user)
