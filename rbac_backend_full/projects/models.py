from django.db import models
from accounts.models import User
from django.core.exceptions import ValidationError
from django.utils.text import slugify
import os


class Project(models.Model):
    project_name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True, db_index=True, null=True, blank=True)
    description = models.TextField()

    start = models.DateField()
    end = models.DateField()

    created_at = models.DateTimeField(auto_now_add=True)

    image = models.ImageField(
        upload_to="project_images/",
        null=True,
        blank=True
    )

    # Geolocation fields
    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True
    )
    altitude = models.FloatField(null=True, blank=True)
    scale = models.FloatField(null=True, blank=True)
    zoom = models.IntegerField(null=True, blank=True)
    footprint_area = models.FloatField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.project_name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.project_name


class ProjectUser(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    project = models.ForeignKey(Project, on_delete=models.CASCADE)



def validate_bim_file(value):
    allowed = [".rvt", ".ifc", ".dwg", ".nwd", ".nwc", ".fbx"]
    ext = os.path.splitext(value.name)[1].lower()

    if ext not in allowed:
        raise ValidationError("Only BIM files allowed")


def validate_pointcloud_file(value):
    allowed = [".e57", ".las", ".laz", ".plz", ".pts", ".xyz", ".ply"]
    ext = os.path.splitext(value.name)[1].lower()

    if ext not in allowed:
        raise ValidationError("Only Point Cloud files allowed")
    
def validate_camera_file(value):
    allowed = [".txt"]
    ext = os.path.splitext(value.name)[1].lower()
    if ext not in allowed:
        raise ValidationError("Only .txt camera files allowed")


def validate_matrix_file(value):
    allowed = [".json"]
    ext = os.path.splitext(value.name)[1].lower()
    if ext not in allowed:
        raise ValidationError("Only .json matrix files allowed")


class CameraFile(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    batch_name = models.CharField(max_length=255)
    file = models.FileField(upload_to="camera_files/", validators=[validate_camera_file])
    date = models.DateField()
    is_latest = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.batch_name} - {self.file.name}"


class MatrixFile(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    batch_name = models.CharField(max_length=255)
    file = models.FileField(upload_to="matrix_files/", validators=[validate_matrix_file])
    date = models.DateField()
    is_latest = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.batch_name} - {self.file.name}"


class BIMData(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    description = models.CharField(max_length=255)
    file = models.FileField(
        upload_to="bim_files/",
        validators=[validate_bim_file]
    )
    date = models.DateField()
    is_latest = models.BooleanField(default=False)
    transform = models.JSONField(blank=True, null=True)


class PointCloudData(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    description = models.CharField(max_length=255)
    file = models.FileField(
        upload_to="pointcloud_files/",
        validators=[validate_pointcloud_file]
    )
    date = models.DateField()
    is_latest = models.BooleanField(default=False)
    transform = models.JSONField(blank=True, null=True)


class ProjectImage(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    image = models.ImageField(upload_to="project_images/")
    batch_name = models.CharField(max_length=255, blank=True)
    original_name = models.CharField(max_length=255, blank=True)
    original_path = models.CharField(max_length=500, blank=True)
    date = models.DateField(blank=True, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.original_name or self.image.name