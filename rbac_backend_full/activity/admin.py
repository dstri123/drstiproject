from django.contrib import admin

from .models import ActivityLog


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "username", "user_role", "action", "target_type", "project_name", "description")
    list_filter = ("action", "target_type", "user_role")
    search_fields = ("username", "description", "target_name", "project_name", "note")
    readonly_fields = [f.name for f in ActivityLog._meta.fields if f.name not in ("description", "note")]
