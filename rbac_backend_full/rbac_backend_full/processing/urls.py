from django.urls import path
from .views import ConvertIFCToFBXView

urlpatterns = [
    path('tools/convert-ifc/', ConvertIFCToFBXView.as_view(), name='convert-ifc-fbx'),
]
