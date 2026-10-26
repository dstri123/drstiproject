from rest_framework import serializers

from .models import ActivityLog


class ActivityLogSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display", read_only=True)
    edited_by_username = serializers.CharField(source="edited_by.username", read_only=True, default=None)

    class Meta:
        model = ActivityLog
        fields = [
            "id", "created_at", "user", "username", "user_role",
            "action", "action_label", "target_type", "target_id", "target_name",
            "project", "project_name", "description", "details", "note",
            "method", "path", "status_code", "ip_address",
            "edited_at", "edited_by", "edited_by_username",
        ]
        # Only the human-written parts of an entry are editable; what
        # happened, who did it and when stay exactly as recorded.
        read_only_fields = [f for f in fields if f not in ("description", "note")]
