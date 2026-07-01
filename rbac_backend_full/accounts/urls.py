from django.urls import path
from .views import (
    SignupView,
    LoginView,
    CheckAdminExists,
    CreateAdminView,
    CreateMemberView,
    CreateUserView,
    OrganizationListView,
    DeleteOrganizationView,
    UpdateOrganizationView,
    ProfileView,
    ProfileUpdateView,
    CheckUsernameView,
    CheckEmailView,
    OrganizationAdminsView,
    AdminDetailView,
)

urlpatterns = [
    path('signup/', SignupView.as_view()),
    path('custom-login/', LoginView.as_view()),
    path('check-admin/', CheckAdminExists.as_view()),
    path('check-username/', CheckUsernameView.as_view()),
    path('check-email/', CheckEmailView.as_view()),
    path("organizations/", OrganizationListView.as_view()),
    path("organizations/<int:id>/", DeleteOrganizationView.as_view()),
    path("organizations/<int:id>/update/", UpdateOrganizationView.as_view()),
    path("organizations/<int:id>/admins/", OrganizationAdminsView.as_view()),

    # ADMIN MANAGEMENT
    path('admins/<int:id>/', AdminDetailView.as_view()),

    # ROLE BASED CREATION
    path('create-admin/', CreateAdminView.as_view()),
    path('create-member/', CreateMemberView.as_view()),
    path('create-user/', CreateUserView.as_view()),
    path("profile/", ProfileView.as_view()),
    path("profile/update/", ProfileUpdateView.as_view()),
]