from django.urls import path

from .views import (
    ActivityAdminsView,
    ActivityLogBulkDeleteView,
    ActivityLogDetailView,
    ActivityLogExportView,
    ActivityLogFiltersView,
    ActivityLogListView,
)

urlpatterns = [
    path("", ActivityLogListView.as_view()),
    path("filters/", ActivityLogFiltersView.as_view()),
    path("admins/", ActivityAdminsView.as_view()),
    path("export/", ActivityLogExportView.as_view()),
    path("bulk-delete/", ActivityLogBulkDeleteView.as_view()),
    path("<int:pk>/", ActivityLogDetailView.as_view()),
]
