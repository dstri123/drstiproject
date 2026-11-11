import json

from rest_framework import serializers

from .models import Issue


class JSONInputField(serializers.JSONField):
    """Accepts JSON either as a value (JSON requests) or as a JSON-encoded
    string (multipart requests, which carry the photo upload)."""

    def to_internal_value(self, data):
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                self.fail("invalid")
        return super().to_internal_value(data)


def _vec3(value, name):
    if (not isinstance(value, (list, tuple)) or len(value) != 3
            or not all(isinstance(v, (int, float)) for v in value)):
        raise serializers.ValidationError(f"{name} must be [x, y, z] numbers.")
    return [float(v) for v in value]


def _user_label(user):
    if not user:
        return None
    return user.get_full_name() or user.username


class IssueSerializer(serializers.ModelSerializer):
    position = JSONInputField()
    viewpoint = JSONInputField(required=False, allow_null=True)
    assignee_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    priority_label = serializers.CharField(source="get_priority_display", read_only=True)
    clear_photo = serializers.BooleanField(write_only=True, required=False)

    class Meta:
        model = Issue
        fields = [
            "id", "guid", "number", "project", "bim",
            "title", "description", "status", "status_label",
            "priority", "priority_label", "assignee", "assignee_name", "due_date",
            "element_express_id", "element_global_id", "element_type",
            "position", "viewpoint", "photo", "snapshot", "clear_photo",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "guid", "number", "project", "created_by", "created_at", "updated_at"]

    def get_assignee_name(self, obj):
        return _user_label(obj.assignee)

    def get_created_by_name(self, obj):
        return _user_label(obj.created_by)

    def validate_position(self, value):
        return _vec3(value, "position")

    def validate_viewpoint(self, value):
        if value is None:
            return None
        if not isinstance(value, dict):
            raise serializers.ValidationError("viewpoint must be an object.")
        out = {
            "position": _vec3(value.get("position"), "viewpoint.position"),
            "direction": _vec3(value.get("direction"), "viewpoint.direction"),
            "up": _vec3(value.get("up") or [0, 0, 1], "viewpoint.up"),
        }
        fov = value.get("fov", 60)
        if not isinstance(fov, (int, float)) or not 1 <= fov <= 179:
            raise serializers.ValidationError("viewpoint.fov must be 1–179 degrees.")
        out["fov"] = float(fov)
        return out

    def validate_bim(self, value):
        project = self.context.get("project")
        if value and project and value.project_id != project.id:
            raise serializers.ValidationError("BIM file belongs to another project.")
        return value

    def validate_assignee(self, value):
        allowed = self.context.get("assignee_ids")
        if value and allowed is not None and value.id not in allowed:
            raise serializers.ValidationError("Assignee is not a member of this project.")
        return value

    def update(self, instance, validated_data):
        if validated_data.pop("clear_photo", False) and "photo" not in validated_data:
            instance.photo.delete(save=False)
            instance.photo = None
        return super().update(instance, validated_data)

    def create(self, validated_data):
        validated_data.pop("clear_photo", None)
        return super().create(validated_data)
