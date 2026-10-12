from rest_framework import serializers
from .models import Project, ProjectUser
from .models import BIMData, PointCloudData, ProjectImage
from .models import CameraFile, MatrixFile, EnvironmentalData


class ProjectSerializer(serializers.ModelSerializer):
    # Reverse relations are not included by `fields = '__all__'` by default.
    # The dashboard cards use these to show BIM/Cloud/Images badges and the
    # x/3 completion count, so expose lightweight id lists for each.
    bimdata_set = serializers.SerializerMethodField()
    pointclouddata_set = serializers.SerializerMethodField()
    images_set = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = '__all__'

    def get_bimdata_set(self, obj):
        return list(obj.bimdata_set.values_list('id', flat=True))

    def get_pointclouddata_set(self, obj):
        return list(obj.pointclouddata_set.values_list('id', flat=True))

    def get_images_set(self, obj):
        return list(obj.projectimage_set.values_list('id', flat=True))


class ProjectUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectUser
        fields = '__all__'


class BIMDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = BIMData
        fields = "__all__"
        read_only_fields = ["project"]

class PointCloudDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = PointCloudData
        fields = "__all__"
        read_only_fields = ["project"]


class ProjectImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectImage
        fields = "__all__"
        read_only_fields = ["project", "original_name"]


class CameraFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = CameraFile
        fields = "__all__"
        read_only_fields = ["project"]


class MatrixFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = MatrixFile
        fields = "__all__"
        read_only_fields = ["project"]

class EnvironmentalDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = EnvironmentalData
        fields = '__all__'
        read_only_fields = ['project']

    def validate_columns(self, value):
        if not isinstance(value, list) or not all(isinstance(c, str) for c in value):
            raise serializers.ValidationError("columns must be a list of strings.")
        return value

    def validate_rows(self, value):
        if not isinstance(value, dict) or not all(isinstance(r, dict) for r in value.values()):
            raise serializers.ValidationError("rows must be an object of {cameraId: {column: value}}.")
        return value
