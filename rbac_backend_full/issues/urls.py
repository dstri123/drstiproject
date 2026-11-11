from django.urls import path

from .views import IssueAssigneesView, IssueBCFExportView, IssueDetailView, IssueListView

urlpatterns = [
    path("project/<int:project_id>/", IssueListView.as_view(), name="issue-list"),
    path("project/<int:project_id>/assignees/", IssueAssigneesView.as_view(),
         name="issue-assignees"),
    path("project/<int:project_id>/bcf/", IssueBCFExportView.as_view(), name="issue-bcf"),
    path("<int:pk>/", IssueDetailView.as_view(), name="issue-detail"),
]
