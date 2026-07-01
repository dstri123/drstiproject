"""
Backend improvements inspired by IFCtoFDS
==========================================
IFCtoFDS does heavy client-side processing (parse, voxelize, export).
These models move the equivalent responsibilities to the Django backend:

  ProcessingJob   — tracks background file processing (inspired by IFCtoFDS Web Workers)
  ModelBounds     — stores pre-computed 3D bounds (inspired by IFCtoFDS clipping panel)
  ElementMetadata — stores extracted IFC element info (inspired by IFCtoFDS IFC mapping panel)
  AuditLog        — records every model action (inspired by IFCtoFDS undo stack)
  DiagnosticReport— stores validation results (inspired by IFCtoFDS diagnostics panel)
"""

from django.db import models
from accounts.models import User
from projects.models import BIMData, PointCloudData


# ─── Processing Job ────────────────────────────────────────────────────────────

class ProcessingJob(models.Model):
    """
    Tracks the lifecycle of a background file-processing task.
    Inspired by IFCtoFDS's Web Worker pattern — a job is created
    when a file is uploaded, progresses through stages, and either
    completes or fails.
    """
    STATUS_CHOICES = [
        ('queued',     'Queued'),
        ('running',    'Running'),
        ('completed',  'Completed'),
        ('failed',     'Failed'),
        ('cancelled',  'Cancelled'),
    ]

    JOB_TYPE_CHOICES = [
        ('bim_parse',       'BIM Metadata Extraction'),
        ('bim_validate',    'BIM File Validation'),
        ('pc_subsample',    'Point Cloud Subsampling'),
        ('pc_colorize',     'Point Cloud Colorization'),
        ('ifc_convert',     'IFC Format Conversion'),
        ('bounds_compute',  'Bounds Computation'),
        ('thumbnail',       'Thumbnail Generation'),
    ]

    # Link to the file being processed (one or the other, not both)
    bim_data      = models.ForeignKey(BIMData, on_delete=models.CASCADE, null=True, blank=True, related_name='jobs')
    point_data    = models.ForeignKey(PointCloudData, on_delete=models.CASCADE, null=True, blank=True, related_name='jobs')

    job_type      = models.CharField(max_length=30, choices=JOB_TYPE_CHOICES)
    status        = models.CharField(max_length=20, choices=STATUS_CHOICES, default='queued')

    # Progress tracking (mirrors IFCtoFDS setLoadingProgress)
    progress      = models.FloatField(default=0.0)   # 0.0 – 1.0
    stage_label   = models.CharField(max_length=120, blank=True)

    error_message = models.TextField(blank=True)
    result        = models.JSONField(null=True, blank=True)   # job-specific output

    created_by    = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    started_at    = models.DateTimeField(null=True, blank=True)
    completed_at  = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.job_type} [{self.status}] #{self.pk}'

    @property
    def duration_seconds(self):
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


# ─── Model Bounds ──────────────────────────────────────────────────────────────

class ModelBounds(models.Model):
    """
    Pre-computed 3D bounding box for a BIM or point cloud file.
    Inspired by IFCtoFDS's boundsForClipping() — eliminates the need
    for the frontend to recompute bounds on every load.
    Feeds directly into ClippingPanel min/max slider ranges.
    """
    bim_data   = models.OneToOneField(BIMData, on_delete=models.CASCADE, null=True, blank=True, related_name='bounds')
    point_data = models.OneToOneField(PointCloudData, on_delete=models.CASCADE, null=True, blank=True, related_name='bounds')

    # Axis-aligned bounding box in model-native coordinates
    xmin = models.FloatField()
    xmax = models.FloatField()
    ymin = models.FloatField()
    ymax = models.FloatField()
    zmin = models.FloatField()
    zmax = models.FloatField()

    # World center and overall span (convenience fields)
    center_x = models.FloatField(default=0)
    center_y = models.FloatField(default=0)
    center_z = models.FloatField(default=0)
    span     = models.FloatField(default=0)   # max(dx, dy, dz)

    point_count  = models.BigIntegerField(null=True, blank=True)   # PC only
    triangle_count = models.BigIntegerField(null=True, blank=True) # BIM only

    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Model bounds'

    def __str__(self):
        return f'Bounds [{self.xmin:.2f},{self.xmax:.2f}] [{self.ymin:.2f},{self.ymax:.2f}] [{self.zmin:.2f},{self.zmax:.2f}]'

    def to_dict(self):
        return {
            'xmin': self.xmin, 'xmax': self.xmax,
            'ymin': self.ymin, 'ymax': self.ymax,
            'zmin': self.zmin, 'zmax': self.zmax,
            'center': {'x': self.center_x, 'y': self.center_y, 'z': self.center_z},
            'span': self.span,
        }


# ─── Element Metadata ──────────────────────────────────────────────────────────

class ElementMetadata(models.Model):
    """
    Extracted IFC element information stored per BIM file.
    Inspired by IFCtoFDS's IFC mapping panel which shows element counts,
    types, and FDS roles — now persisted so the frontend doesn't re-parse.
    """
    bim_data    = models.ForeignKey(BIMData, on_delete=models.CASCADE, related_name='elements')

    # IFC identity
    step_id     = models.CharField(max_length=40)          # e.g. "1234"
    global_id   = models.CharField(max_length=64, blank=True)
    ifc_type    = models.CharField(max_length=80)          # e.g. "IFCWALL"
    name        = models.CharField(max_length=255, blank=True)

    # Classification (mirrors IFCtoFDS categoryForIfcType)
    CATEGORY_CHOICES = [
        ('structure', 'Structure'),
        ('fills',     'Doors & Windows'),
        ('other',     'Other'),
        ('space',     'Space'),
    ]
    category    = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='other')

    # Geometry bounds (axis-aligned, native coords)
    bounds      = models.JSONField(null=True, blank=True)  # {xmin,xmax,ymin,ymax,zmin,zmax}

    # Flags (mirrors IFCtoFDS element.convertible / element.fdsRole)
    convertible = models.BooleanField(default=True)
    fds_role    = models.CharField(max_length=40, blank=True)   # e.g. "OBST", "GEOM", "HOLE"

    class Meta:
        unique_together = ('bim_data', 'step_id')
        ordering = ['ifc_type', 'name']

    def __str__(self):
        return f'{self.ifc_type} #{self.step_id} — {self.name}'


# ─── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLog(models.Model):
    """
    Records every significant action performed on a model file.
    Inspired by IFCtoFDS's undo stack — each action is logged so
    project managers can see who changed what and when.
    """
    ACTION_CHOICES = [
        ('upload',         'File Uploaded'),
        ('delete',         'File Deleted'),
        ('transform_save', 'Transform Saved'),
        ('visibility',     'Visibility Changed'),
        ('convert',        'File Converted'),
        ('validate',       'File Validated'),
        ('export',         'Export Downloaded'),
        ('process_start',  'Processing Started'),
        ('process_done',   'Processing Completed'),
        ('process_fail',   'Processing Failed'),
    ]

    user        = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    action      = models.CharField(max_length=30, choices=ACTION_CHOICES)
    description = models.CharField(max_length=500)

    # Polymorphic target — whichever is relevant
    bim_data    = models.ForeignKey(BIMData, on_delete=models.SET_NULL, null=True, blank=True)
    point_data  = models.ForeignKey(PointCloudData, on_delete=models.SET_NULL, null=True, blank=True)

    metadata    = models.JSONField(null=True, blank=True)  # extra context (old/new values, etc.)
    ip_address  = models.GenericIPAddressField(null=True, blank=True)
    timestamp   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f'[{self.timestamp:%Y-%m-%d %H:%M}] {self.user} — {self.action}'


# ─── Diagnostic Report ─────────────────────────────────────────────────────────

class DiagnosticReport(models.Model):
    """
    Stores validation and quality-check results for an uploaded file.
    Inspired by IFCtoFDS's diagnostics panel which runs checks and
    categorises results as info / warning / error.
    """
    LEVEL_CHOICES = [
        ('info',    'Info'),
        ('warning', 'Warning'),
        ('error',   'Error'),
    ]

    bim_data   = models.ForeignKey(BIMData, on_delete=models.CASCADE, null=True, blank=True, related_name='diagnostics')
    point_data = models.ForeignKey(PointCloudData, on_delete=models.CASCADE, null=True, blank=True, related_name='diagnostics')

    level       = models.CharField(max_length=10, choices=LEVEL_CHOICES)
    title       = models.CharField(max_length=200)
    detail      = models.TextField(blank=True)
    check_name  = models.CharField(max_length=80, blank=True)   # which check produced this

    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['level', 'title']

    def __str__(self):
        return f'[{self.level.upper()}] {self.title}'


# ─── Scan-to-BIM Progress Assessment ───────────────────────────────────────────

class ProgressAssessment(models.Model):
    """
    A saved Scan-to-BIM progress assessment: compares a BIM version against an
    aligned Point Cloud and records per-element completion, so construction
    progress can be tracked over time.
    """
    project = models.ForeignKey(
        'projects.Project', on_delete=models.CASCADE, related_name='assessments'
    )
    bim = models.ForeignKey(
        BIMData, on_delete=models.SET_NULL, null=True, blank=True
    )
    pointcloud = models.ForeignKey(
        PointCloudData, on_delete=models.SET_NULL, null=True, blank=True
    )
    bim_date = models.DateField(null=True, blank=True)
    pointcloud_date = models.DateField(null=True, blank=True)

    total_elements = models.IntegerField(default=0)
    completed_elements = models.IntegerField(default=0)
    in_progress_elements = models.IntegerField(default=0)
    not_started_elements = models.IntegerField(default=0)
    overall_completion = models.FloatField(default=0.0)  # 0..100

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Assessment #{self.id} — {self.overall_completion:.0f}%'


class ProgressElement(models.Model):
    """One BIM element's completion within a ProgressAssessment."""
    STATUS_CHOICES = [
        ('not_started', 'Not Started'),
        ('in_progress', 'In Progress'),
        ('completed',   'Completed'),
    ]

    assessment = models.ForeignKey(
        ProgressAssessment, on_delete=models.CASCADE, related_name='elements'
    )
    element_id = models.CharField(max_length=120)   # IFC GlobalId
    element_type = models.CharField(max_length=80)  # e.g. IFCDOOR
    category = models.CharField(max_length=40, blank=True)
    name = models.CharField(max_length=255, blank=True)
    bim_area = models.FloatField(default=0.0)        # m^2
    overlap_area = models.FloatField(default=0.0)    # m^2
    completion = models.FloatField(default=0.0)      # 0..100
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='not_started')

    def __str__(self):
        return f'{self.element_type} {self.element_id} — {self.completion:.0f}%'


# ─── Alignment Pair (BIM ↔ Point Cloud registration record) ────────────────────

class AlignmentPair(models.Model):
    """
    Records that a specific BIM and Point Cloud were geometrically registered
    together (Kabsch / ICP / manual). The per-model `transform` fields still
    drive rendering; this table makes the *pairing* explicit so downstream tools
    (Progress Assessment, reporting) can pick a known-aligned pair directly and
    see the registration quality.
    """
    METHOD_CHOICES = [
        ("kabsch", "Kabsch (point pairs)"),
        ("icp", "ICP refine"),
        ("manual", "Manual / saved"),
    ]

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="alignment_pairs"
    )
    bim = models.ForeignKey(BIMData, on_delete=models.CASCADE)
    pointcloud = models.ForeignKey(PointCloudData, on_delete=models.CASCADE)
    # Snapshot each file's date at registration time (BIM version date + scan
    # date) so a pair carries its own dates for reporting.
    bim_date = models.DateField(null=True, blank=True)
    pointcloud_date = models.DateField(null=True, blank=True)
    method = models.CharField(max_length=20, choices=METHOD_CHOICES, default="manual")
    fitness = models.FloatField(null=True, blank=True)   # ICP overlap 0..1
    rmse = models.FloatField(null=True, blank=True)
    relative_transform = models.JSONField(null=True, blank=True)  # optional 4x4
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        # One registration record per BIM↔PointCloud pair (upsert on re-align).
        unique_together = ("bim", "pointcloud")

    def __str__(self):
        return f"Pair BIM#{self.bim_id} ↔ PC#{self.pointcloud_id} ({self.method})"
