"""Processing views for file conversions and tools"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.http import FileResponse
import os
import tempfile
from .conversion import convert_ifc_to_fbx, cleanup_temp_file


class ConvertIFCToFBXView(APIView):
    """Convert IFC file to FBX format"""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Handle IFC file upload and conversion"""
        try:
            # Check user role - only data_contributor and above can use tools
            user_role = request.user.role
            allowed_roles = ['data_contributor', 'project_engineer', 'admin', 'superadmin']

            if user_role not in allowed_roles:
                return Response(
                    {"error": "You don't have permission to use this tool"},
                    status=status.HTTP_403_FORBIDDEN
                )

            # Get uploaded file
            if 'file' not in request.FILES:
                return Response(
                    {"error": "No file provided"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            ifc_file = request.FILES['file']

            # Validate file extension
            if not ifc_file.name.lower().endswith('.ifc'):
                return Response(
                    {"error": "Only .ifc files are supported"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Save uploaded file temporarily
            temp_dir = tempfile.gettempdir()
            temp_ifc_path = os.path.join(temp_dir, ifc_file.name)

            with open(temp_ifc_path, 'wb') as f:
                for chunk in ifc_file.chunks():
                    f.write(chunk)

            # Convert IFC to FBX
            success, output_path, message = convert_ifc_to_fbx(temp_ifc_path)

            # Clean up input file
            if os.path.exists(temp_ifc_path):
                os.remove(temp_ifc_path)

            if not success:
                return Response(
                    {"error": message},
                    status=status.HTTP_400_BAD_REQUEST
                )

            return Response({
                "success": True,
                "message": message,
                "output_file": os.path.basename(output_path),
                "file_path": output_path
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {"error": f"Conversion failed: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def get(self, request):
        """Download converted FBX file"""
        try:
            file_path = request.query_params.get('file_path')

            if not file_path or not os.path.exists(file_path):
                return Response(
                    {"error": "File not found"},
                    status=status.HTTP_404_NOT_FOUND
                )

            # Serve file
            response = FileResponse(
                open(file_path, 'rb'),
                content_type='application/octet-stream'
            )
            response['Content-Disposition'] = f'attachment; filename="{os.path.basename(file_path)}"'

            # Schedule cleanup after download
            import threading
            def cleanup():
                import time
                time.sleep(2)  # Wait for download to complete
                cleanup_temp_file(file_path)

            cleanup_thread = threading.Thread(target=cleanup, daemon=True)
            cleanup_thread.start()

            return response

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
