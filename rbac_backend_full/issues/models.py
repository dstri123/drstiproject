"""
Issues pinned to a spot in the 3D viewer, exportable as BCF 2.1.

Positions and viewpoints are stored in IFC model coordinates (metres, Z-up)
— the frame BCF uses — so the export needs no conversion and an issue stays
on the right spot if the model is moved in the viewer. The viewer converts
to/from its own Y-up scene frame (see useIssuePins.js).
"""
import uuid

from django.db import models
from accounts.models import User
from projects.models import Project, BIMData


class Issue(models.Model):
    STATUS_CHOICES = [
        ('open',        'Open'),
        ('in_progress', 'In Progress'),
        ('resolved',    'Resolved'),
        ('closed',      'Closed'),
    ]
    PRIORITY_CHOICES = [
        ('low',      'Low'),
        ('normal',   'Normal'),
        ('high',     'High'),
        ('critical', 'Critical'),
    ]

    # BCF Topic Guid — stable across exports so re-importing updates the
    # same topic in Revit/Navisworks instead of duplicating it.
    guid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='issues')
    bim = models.ForeignKey(BIMData, on_delete=models.SET_NULL, null=True, blank=True,
                            related_name='issues')
    number = models.PositiveIntegerField()  # per-project #1, #2, … (BCF Index)

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='normal')
    assignee = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name='assigned_issues')
    due_date = models.DateField(null=True, blank=True)

    # Pinned BIM element, if the click landed on one.
    element_express_id = models.IntegerField(null=True, blank=True)
    element_global_id = models.CharField(max_length=64, blank=True)
    element_type = models.CharField(max_length=80, blank=True)

    position = models.JSONField()                          # [x, y, z]
    # {position: [x,y,z], direction: [x,y,z], up: [x,y,z], fov: degrees}
    viewpoint = models.JSONField(null=True, blank=True)

    photo = models.ImageField(upload_to='issue_photos/', null=True, blank=True)
    snapshot = models.ImageField(upload_to='issue_snapshots/', null=True, blank=True)

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True,
                                   related_name='created_issues')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+')

    class Meta:
        ordering = ['-number']
        unique_together = ('project', 'number')

    def __str__(self):
        return f'#{self.number} {self.title}'
