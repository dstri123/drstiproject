"""
Activity log — one row per change anyone makes in the app (uploads, deletes,
alignment saves, role changes, logins, ...).

Rows are written automatically by activity.middleware.ActivityLogMiddleware,
so new endpoints are covered without touching their views. Only superadmins
(every row) and admins (rows made by sub-role users) can see, edit a row's
description/note, or delete rows — see activity.permissions.

Who/what/project are also stored as plain-text snapshots so a row still reads
correctly after the user, project or file it points at has been deleted.
"""
from django.conf import settings
from django.db import models


class ActivityLog(models.Model):
    ACTION_CHOICES = [
        ("create", "Created"),
        ("upload", "Uploaded"),
        ("update", "Updated"),
        ("delete", "Deleted"),
        ("assign", "Assigned"),
        ("unassign", "Unassigned"),
        ("process", "Processed"),
        ("login", "Logged in"),
        ("login_failed", "Failed login"),
        ("password_reset", "Password reset"),
        ("other", "Other"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    username = models.CharField(max_length=150, blank=True)
    user_role = models.CharField(max_length=50, blank=True)
    # The admin this entry belongs to: the acting user's creator, or the
    # acting admin themself. Snapshotted so the entry stays under its admin
    # even after the acting user is deleted.
    owner_admin = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_activity_logs",
    )

    action = models.CharField(max_length=20, choices=ACTION_CHOICES, default="other", db_index=True)
    target_type = models.CharField(max_length=50, blank=True, db_index=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_name = models.CharField(max_length=255, blank=True)

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    project_name = models.CharField(max_length=255, blank=True)

    description = models.CharField(max_length=500)
    details = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True)

    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=500, blank=True)
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="edited_activity_logs",
    )

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.username}: {self.description}"
