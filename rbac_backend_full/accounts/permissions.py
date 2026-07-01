
from rest_framework.permissions import BasePermission

class RolePermission(BasePermission):
    allowed_roles = []

    def has_permission(self, request, view):
        return request.user.role in view.allowed_roles
