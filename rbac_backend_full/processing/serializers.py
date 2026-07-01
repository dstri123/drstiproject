from rest_framework import serializers
from .models import ProcessingJob, ModelBounds, ElementMetadata, AuditLog, DiagnosticReport


class ProcessingJobSerializer(serializers.ModelSerializer):
    duration_seconds = serializers.ReadOnlyField()
    created_by_name  = serializers.CharField(source='created_by.get_full_name', read_only=True)

    class Meta:
        model = ProcessingJob
        fields = [
            'id', 'job_type', 'status', 'progress', 'stage_label',
            'error_message', 'result',
            'created_by', 'created_by_name',
            'created_at', 'started_at', 'completed_at', 'duration_seconds',
            'bim_data', 'point_data',
        ]
        read_only_fields = [
            'id', 'status', 'progress', 'stage_label', 'error_message', 'result',
            'created_at', 'started_at', 'completed_at',
        ]


class ProcessingJobUpdateSerializer(serializers.ModelSerializer):
    """Used internally / by worker processes to update job progress."""
    class Meta:
        model = ProcessingJob
        fields = ['status', 'progress', 'stage_label', 'error_message', 'result', 'started_at', 'completed_at']


class ModelBoundsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModelBounds
        fields = [
            'id', 'bim_data', 'point_data',
            'xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax',
            'center_x', 'center_y', 'center_z', 'span',
            'point_count', 'triangle_count', 'computed_at',
        ]
        read_only_fields = ['id', 'computed_at']


class ElementMetadataSerializer(serializers.ModelSerializer):
    class Meta:
        model = ElementMetadata
        fields = [
            'id', 'bim_data', 'step_id', 'global_id', 'ifc_type',
            'name', 'category', 'bounds', 'convertible', 'fds_role',
        ]
        read_only_fields = ['id']


class ElementSummarySerializer(serializers.Serializer):
    """Aggregated element counts grouped by IFC type — mirrors IFCtoFDS mapping panel."""
    ifc_type   = serializers.CharField()
    category   = serializers.CharField()
    count      = serializers.IntegerField()
    convertible_count = serializers.IntegerField()


class AuditLogSerializer(serializers.ModelSerializer):
    user_name  = serializers.CharField(source='user.get_full_name', read_only=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id', 'user', 'user_name', 'user_email',
            'action', 'description', 'metadata',
            'bim_data', 'point_data', 'ip_address', 'timestamp',
        ]
        read_only_fields = fields


class DiagnosticReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiagnosticReport
        fields = [
            'id', 'bim_data', 'point_data',
            'level', 'title', 'detail', 'check_name', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class ValidationRequestSerializer(serializers.Serializer):
    """Request body for the file validation endpoint."""
    bim_data_id   = serializers.IntegerField(required=False)
    point_data_id = serializers.IntegerField(required=False)

    def validate(self, data):
        if not data.get('bim_data_id') and not data.get('point_data_id'):
            raise serializers.ValidationError('Provide either bim_data_id or point_data_id.')
        return data


class BoundsRequestSerializer(serializers.Serializer):
    """Request body for the bounds computation endpoint."""
    bim_data_id   = serializers.IntegerField(required=False)
    point_data_id = serializers.IntegerField(required=False)

    def validate(self, data):
        if not data.get('bim_data_id') and not data.get('point_data_id'):
            raise serializers.ValidationError('Provide either bim_data_id or point_data_id.')
        return data
