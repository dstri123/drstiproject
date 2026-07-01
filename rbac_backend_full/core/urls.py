from django.contrib import admin
from django.urls import path, include
from accounts.views import CheckAdminExists, ProfileView, ProfileUpdateView, LoginView
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path('admin/', admin.site.urls),

    # 📚 Swagger Documentation
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),

    # 🔐 Authentication
    path('api/v1/auth/signup/', include('accounts.urls')),
    path('api/v1/auth/login/', LoginView.as_view(), name='token_obtain_pair'),
    path('api/v1/auth/', include('accounts.urls')),

    # 👤 User Profile
    path('api/v1/profile/', ProfileView.as_view(), name='profile'),
    path('api/v1/profile/update/', ProfileUpdateView.as_view(), name='profile_update'),

    # ✅ Admin Check
    path('api/v1/check-admin/', CheckAdminExists.as_view(), name='check_admin'),

    # 📊 Projects & Data
    path('api/v1/', include('projects.urls')),

    # ⚙️ Processing
    path('api/v1/processing/', include('processing.urls')),
]

urlpatterns += static(
    settings.MEDIA_URL,
    document_root=settings.MEDIA_ROOT
)