from django.urls import path
from .views import *
from .views import CreateProjectUserView, ProjectListView, UserDetailView


urlpatterns = [
    path("projects/", ProjectListView.as_view()),
    path("projects/<int:pk>/", UpdateProjectView.as_view()),
    path("projects/<int:pk>/delete/", DeleteProjectView.as_view()),
    path("create-project-user/", CreateProjectUserView.as_view()),
    path("create-project/", CreateProjectView.as_view()),
    path("users/", UserListView.as_view()),
    path("users/<int:id>/", UserDetailView.as_view()),
    path("assign-user/", AssignUserToProjectView.as_view()),
    path("remove-user/", RemoveUserFromProjectView.as_view()),
    path("create-user-assign/", CreateUserAssignProjectView.as_view()),
    path("update-user-role/<int:user_id>/", UpdateUserRoleView.as_view()),
    path("projects/<int:project_id>/bim/", BIMDataView.as_view()),
    path("bim/<int:pk>/delete/", BIMDeleteView.as_view()),
    path("projects/<int:project_id>/pointcloud/", PointCloudDataView.as_view()),
    path("pointcloud/<int:pk>/delete/", PointCloudDeleteView.as_view()),
    path("projects/<int:project_id>/images/", ProjectImageView.as_view()),
    path("images/<int:pk>/delete/", ProjectImageDeleteView.as_view()),
    path("bim/<int:pk>/update/", BIMUpdateView.as_view()),
    path("pointcloud/<int:pk>/update/", PointCloudUpdateView.as_view()),
    path("projects/<int:project_id>/camera/", CameraFileView.as_view()),
    path("camera/<int:pk>/delete/", CameraDeleteView.as_view()),
    path("camera/<int:pk>/update/", CameraUpdateView.as_view()),
    path("projects/<int:project_id>/matrix/", MatrixFileView.as_view()),
    path("matrix/<int:pk>/delete/", MatrixDeleteView.as_view()),
    path("matrix/<int:pk>/update/", MatrixUpdateView.as_view()),
]