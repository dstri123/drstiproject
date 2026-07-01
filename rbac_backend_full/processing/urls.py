from django.urls import path
from .views import (
    ValidationView,
    ModelBoundsView,
    IFCMetadataView,
    ProcessingJobListView,
    ProcessingJobDetailView,
    DiagnosticsView,
    AuditLogView,
    ConvertIFCToFBXView,
    IFCToGLBView,
    PointCloudToPLYView,
    ICPAlignView,
    OSMTileProxyView,
    ProgressAnalyzeView,
    ProgressSaveView,
    ProgressHistoryView,
    AlignmentPairView,
    AlignmentPairListView,
)

urlpatterns = [
    # Validate an uploaded file — returns diagnostic list
    path('validate/',        ValidationView.as_view(),          name='processing-validate'),

    # Model bounds — store/retrieve bounding box for clipping panel
    path('bounds/',          ModelBoundsView.as_view(),         name='processing-bounds'),

    # IFC element metadata — parse IFC, return element type mapping
    path('ifc-metadata/',    IFCMetadataView.as_view(),         name='processing-ifc-metadata'),

    # Background processing jobs — list/create and detail/update
    path('jobs/',            ProcessingJobListView.as_view(),   name='processing-jobs'),
    path('jobs/<int:pk>/',   ProcessingJobDetailView.as_view(), name='processing-job-detail'),

    # Diagnostics checks — quality checks on files/projects
    path('diagnostics/',     DiagnosticsView.as_view(),         name='processing-diagnostics'),

    # Audit log — who did what and when
    path('audit/',           AuditLogView.as_view(),            name='processing-audit'),

    # IFC to FBX conversion tool
    path('tools/convert-ifc/',  ConvertIFCToFBXView.as_view(),  name='processing-convert-ifc'),

    # IFC to GLB streaming conversion for the 3D viewer
    path('tools/ifc-to-glb/',   IFCToGLBView.as_view(),         name='processing-ifc-to-glb'),

    # LAS/LAZ/PTS/XYZ → PLY conversion for the 3D viewer
    path('tools/pointcloud-to-ply/', PointCloudToPLYView.as_view(), name='processing-pointcloud-to-ply'),

    # Dense ICP point-cloud alignment (numpy/scipy)
    path('align/icp/',          ICPAlignView.as_view(),         name='processing-align-icp'),

    # OpenStreetMap tile proxy (adds CORP header so tiles load under COEP)
    path('osm-tile/<int:z>/<int:x>/<int:y>.png', OSMTileProxyView.as_view(),
         name='processing-osm-tile'),

    # Scan-to-BIM progress assessment
    path('progress/analyze/', ProgressAnalyzeView.as_view(), name='progress-analyze'),
    path('progress/save/', ProgressSaveView.as_view(), name='progress-save'),
    path('progress/history/<int:project_id>/', ProgressHistoryView.as_view(),
         name='progress-history'),

    # BIM <-> Point Cloud alignment pairs
    path('alignment/pair/', AlignmentPairView.as_view(), name='alignment-pair'),
    path('alignment/pairs/<int:project_id>/', AlignmentPairListView.as_view(),
         name='alignment-pairs'),
]
