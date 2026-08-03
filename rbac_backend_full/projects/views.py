from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.shortcuts import get_object_or_404

from accounts.permissions import RolePermission
from accounts.models import User

from .models import Project, ProjectUser
from .models import CameraFile, MatrixFile
from .serializers import CameraFileSerializer, MatrixFileSerializer



# 🚀 CREATE PROJECT + USER
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from accounts.permissions import RolePermission
from accounts.models import User
from .models import Project, ProjectUser

from rest_framework.parsers import MultiPartParser, FormParser,JSONParser
from rest_framework.viewsets import ModelViewSet
from .serializers import ProjectSerializer
from .models import BIMData, PointCloudData, ProjectImage
from .serializers import BIMDataSerializer, PointCloudDataSerializer, ProjectImageSerializer
from django.core.files.base import ContentFile
from django.utils.text import get_valid_filename
import zipfile
import os


def as_bool(value):
    return str(value).lower() in ("true", "1", "yes", "on")


def user_can_upload_to_project(user, project):
    if user.role in ("admin", "superadmin"):
        return True
    return ProjectUser.objects.filter(project=project, user=user).exists()


class CreateProjectUserView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            username = request.data.get("username")
            password = request.data.get("password")
            sub_role = request.data.get("sub_role")

            if not username or not password or not sub_role:
                return Response({"error": "Missing required fields"}, status=400)

            # 🔥 FIX HERE
            user = User.objects.create_user(
                username=username,
                password=password
            )
            
            user.role = "member"       # ✅ required field
            user.sub_role = sub_role   # ✅ correct field
            user.is_active = True  
            user.save()                # 🔥 MUST

            return Response({
                "message": "User created ✅",
                "username": user.username,
                "role": sub_role
            })

        except Exception as e:
            return Response({"error": str(e)}, status=500)
        



class CreateUserAssignProjectView(APIView):
    permission_classes = [IsAuthenticated, RolePermission]
    allowed_roles = ["admin", "superadmin"]

    def post(self, request):
        try:
            username = request.data.get("username", "").strip()
            email = request.data.get("email", "").strip()
            password = request.data.get("password")
            first_name = request.data.get("first_name", "").strip()
            last_name = request.data.get("last_name", "").strip()
            sub_role = request.data.get("sub_role")

            if not username or not password or not sub_role:
                return Response({"error": "Missing required fields: username, password, and sub_role are required"}, status=400)

            # Check if username already exists
            if User.objects.filter(username=username).exists():
                return Response({"error": "Username already exists"}, status=400)

            # Check if email already exists
            if email and User.objects.filter(email=email).exists():
                return Response({"error": "Email already exists"}, status=400)

            user = User.objects.create_user(
                username=username,
                password=password,
                email=email or "",
                first_name=first_name,
                last_name=last_name
            )

            # "admin" is a real base role (grants admin permissions); every
            # other sub_role rides on the generic "member" base role.
            user.role = "admin" if sub_role == "admin" else "member"
            user.sub_role = sub_role
            user.is_active = True
            user.save()

            return Response({
                "message": "User created successfully",
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "sub_role": user.sub_role
            }, status=201)

        except Exception as e:
            return Response({"error": str(e)}, status=500)

# 🚀 CREATE PROJECT ONLY
class CreateProjectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            project_name = request.data.get("project_name")
            description = request.data.get("description")
            # Accept both field names for compatibility
            start = request.data.get("start") or request.data.get("start_date")
            end = request.data.get("end") or request.data.get("end_date")
            latitude = request.data.get("latitude")
            longitude = request.data.get("longitude")
            footprint_area = request.data.get("footprint_area")

            if not project_name:
                return Response({"error": "Project name required"}, status=400)
            if not start or not end:
                return Response({"error": "Start date and End date are required"}, status=400)

            project = Project.objects.create(
                 project_name=project_name,
                 description=description,
                 start=start,
                 end=end,
                 latitude=latitude,
                 longitude=longitude,
                 footprint_area=footprint_area,
                 )

            return Response({
                "message": "Project created ✅",
                "project_id": project.id
            })

        except Exception as e:
            return Response({"error": str(e)}, status=500)



# 📊 LIST PROJECTS (FIXED FOR MULTIPLE USERS)
class ProjectListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = []

        projects = Project.objects.all().order_by("-id")

        for p in projects:
            project_users = ProjectUser.objects.filter(project=p)

            data.append({
    "id": p.id,
    "slug": p.slug,
    "project_name": p.project_name,
    "description": p.description,
    "start": p.start,
    "end": p.end,
    "latitude": str(p.latitude) if p.latitude else None,
    "longitude": str(p.longitude) if p.longitude else None,
    "altitude": p.altitude,
    "scale": p.scale,
    "zoom": p.zoom,
    "footprint_area": p.footprint_area,
    "image": request.build_absolute_uri(p.image.url)
        if p.image and hasattr(p.image, "url")
        else None,



                # 🔥 SEND ALL USERS
                "users": [
                    {
                        "id": pu.user.id,
                        "username": pu.user.username
                    }
                    for pu in project_users
                ],

                "joined": None,

                # Used by the dashboard to show BIM/Cloud/Images badges and x/3 count
                "bimdata_set": list(p.bimdata_set.values_list("id", flat=True)),
                "pointclouddata_set": list(p.pointclouddata_set.values_list("id", flat=True)),
                "images_set": list(p.projectimage_set.values_list("id", flat=True)),
            })

        return Response(data)

# ✏️ UPDATE PROJECT
class UpdateProjectView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def put(self, request, pk=None):
        return self.update_project(request, pk)

    def patch(self, request, pk=None):
        return self.update_project(request, pk)

    def update_project(self, request, pk):
        try:
            # Try to get by slug first, then by ID
            try:
                project = Project.objects.get(slug=pk)
            except Project.DoesNotExist:
                project = get_object_or_404(Project, id=pk)

            new_project_name = request.data.get("project_name")
            if new_project_name:
                project.project_name = new_project_name
                project.slug = None  # Reset slug to auto-generate from new name

            project.description = request.data.get(
                 "description",
                  project.description
                  )
            project.start = request.data.get(
                 "start",
                 request.data.get("start_date", project.start)
                 )
            project.end = request.data.get(
                 "end",
                 request.data.get("end_date", project.end)
                 )

            latitude = request.data.get("latitude")
            longitude = request.data.get("longitude")
            if latitude is not None:
                project.latitude = latitude
            if longitude is not None:
                project.longitude = longitude

            altitude = request.data.get("altitude")
            scale = request.data.get("scale")
            zoom = request.data.get("zoom")
            footprint_area = request.data.get("footprint_area")
            if altitude is not None:
                project.altitude = altitude
            if scale is not None:
                project.scale = scale
            if zoom is not None:
                project.zoom = zoom
            if footprint_area is not None:
                project.footprint_area = footprint_area

            if request.FILES.get("image"):
                project.image = request.FILES["image"]

            project.save()

            image_url = None
            if project.image and hasattr(project.image, 'url'):
                image_url = request.build_absolute_uri(project.image.url)

            return Response({
                "message": "Project updated successfully",
                "slug": project.slug,
                "image": image_url,
                "id": project.id,
                "project_name": project.project_name,
                "description": project.description,
                "start": project.start,
                "end": project.end,
                "latitude": str(project.latitude) if project.latitude else None,
                "longitude": str(project.longitude) if project.longitude else None,
                "altitude": project.altitude,
                "scale": project.scale,
                "zoom": project.zoom,
                "footprint_area": project.footprint_area,
            })

        except Exception as e:
            return Response({"error": str(e)}, status=500)
# 👥 LIST USERS
class UserListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            users = User.objects.exclude(role="superadmin").values("id", "username", "email", "first_name", "last_name", "sub_role", "role", "description")
            return Response(users)
        except Exception as e:
            return Response({"error": str(e)}, status=500)


# 👤 USER DETAIL (GET/PUT/DELETE)
class UserDetailView(APIView):
    permission_classes = [IsAuthenticated, RolePermission]
    allowed_roles = ["admin", "superadmin"]

    def get(self, request, id):
        try:
            user = User.objects.get(id=id)
            return Response({
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "sub_role": user.sub_role,
                "role": user.role,
                "description": user.description or "",
            })
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    def put(self, request, id):
        try:
            user = User.objects.get(id=id)

            # Update fields
            user.email = request.data.get("email", user.email)
            user.first_name = request.data.get("first_name", user.first_name)
            user.last_name = request.data.get("last_name", user.last_name)
            user.sub_role = request.data.get("sub_role", user.sub_role)
            user.description = request.data.get("description", user.description or "")

            user.save()

            return Response({
                "message": "User updated successfully",
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "sub_role": user.sub_role,
                "role": user.role,
                "description": user.description or "",
            })
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    def delete(self, request, id):
        try:
            user = User.objects.get(id=id)

            if user.role == "superadmin":
                return Response({"error": "Cannot delete a Super Admin"}, status=400)

            if user.id == request.user.id:
                return Response({"error": "You cannot delete your own account"}, status=400)

            user.delete()
            return Response({"message": "Contributor deleted successfully"})
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)



# ➕ ASSIGN MULTIPLE USERS TO PROJECT
class AssignUserToProjectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            project_id = request.data.get("project_id")
            user_ids = request.data.get("user_ids", [])

            if not project_id or not user_ids:
                return Response({"error": "Missing data"}, status=400)

            project = get_object_or_404(Project, id=project_id)

            for uid in user_ids:
                user = get_object_or_404(User, id=uid)

                # 🔥 avoid duplicate
                ProjectUser.objects.get_or_create(
                    project=project,
                    user=user
                )

            return Response({"message": "Users assigned ✅"})

        except Exception as e:
            return Response({"error": str(e)}, status=500)
        

# ❌ REMOVE USER FROM PROJECT
class RemoveUserFromProjectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            project_id = request.data.get("project_id")
            user_id = request.data.get("user_id")

            if not project_id or not user_id:
                return Response({"error": "Missing data"}, status=400)

            pu = get_object_or_404(
                ProjectUser,
                project_id=project_id,
                user_id=user_id
            )

            pu.delete()

            return Response({"message": "User removed ✅"})

        except Exception as e:
            return Response({"error": str(e)}, status=500)


# 🗑 DELETE FULL PROJECT
class DeleteProjectView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            project = get_object_or_404(Project, id=pk)

            # 🔥 delete all relations
            ProjectUser.objects.filter(project=project).delete()

            # 🔥 delete project
            project.delete()

            return Response({"message": "Project deleted ✅"})

        except Exception as e:
            return Response({"error": str(e)}, status=500)
        

# 🔥 UPDATE USER ROLE
class UpdateUserRoleView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, user_id):
        try:
            user = get_object_or_404(User, id=user_id)

            sub_role = request.data.get("sub_role")

            if not sub_role:
                return Response({"error": "Role required"}, status=400)

            if sub_role not in ["project_manager", "project_engineer", "data_contributor"]:
                return Response({"error": "Invalid role"}, status=400)

            user.sub_role = sub_role
            user.save()

            return Response({
                "message": "Role updated ✅",
                "username": user.username,
                "new_role": sub_role
            })

        except Exception as e:
            return Response({"error": str(e)}, status=500)
        

        
#ithu full ah datacontributor ..
class ProjectViewSet(ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    parser_classes = [MultiPartParser, FormParser]


class ProjectImageView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, project_id):
        data = ProjectImage.objects.filter(project_id=project_id)
        batch_name = request.query_params.get("batch_name")
        if batch_name:
            data = data.filter(batch_name=batch_name)
        serializer = ProjectImageSerializer(data, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request, project_id):
        project = get_object_or_404(Project, id=project_id)
        if not user_can_upload_to_project(request.user, project):
            return Response({"error": "You are not assigned to this project"}, status=403)

        zip_file = request.FILES.get("zip_file")
        upload_date = request.data.get("date")
        requested_batch_name = request.data.get("batch_name")

        if not zip_file:
            return Response({"zip_file": "This field is required."}, status=400)

        if not zipfile.is_zipfile(zip_file):
            return Response({"zip_file": "Upload must be a valid ZIP file."}, status=400)

        zip_file.seek(0)
        created_images = []
        allowed_extensions = [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"]
        if requested_batch_name:
            batch_name = get_valid_filename(requested_batch_name)
        else:
            batch_name = os.path.splitext(get_valid_filename(zip_file.name or ""))[0]

        with zipfile.ZipFile(zip_file) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue

                relative_path = info.filename.replace("\\", "/").strip("/")
                filename = os.path.basename(relative_path)
                if not filename:
                    continue

                ext = os.path.splitext(filename)[1].lower()
                if ext not in allowed_extensions:
                    continue

                content = zf.read(info)
                safe_path = "/".join(
                    [get_valid_filename(part) for part in relative_path.split("/") if part]
                )
                save_name = f"{batch_name}/{safe_path}" if batch_name else safe_path
                content_file = ContentFile(content, name=get_valid_filename(filename))

                image_record = ProjectImage(
                    project=project,
                    batch_name=batch_name,
                    original_name=filename,
                    original_path=relative_path,
                    date=upload_date if upload_date else None,
                )
                image_record.image.save(save_name, content_file, save=True)
                created_images.append(image_record)

        if not created_images:
            return Response({"zip_file": "ZIP archive did not contain any supported image files."}, status=400)

        serializer = ProjectImageSerializer(
            created_images,
            many=True,
            context={"request": request},
        )
        return Response(serializer.data)

    def delete(self, request, project_id):
        batch_name = request.query_params.get("batch_name")
        if not batch_name:
            return Response(
                {"batch_name": "This field is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        images = ProjectImage.objects.filter(
            project_id=project_id,
            batch_name=batch_name,
        )
        if not images.exists():
            return Response(
                {"error": "No images found for that folder."},
                status=status.HTTP_404_NOT_FOUND,
            )

        for image in images:
            if image.image:
                image.image.delete(save=False)
        images.delete()

        return Response({"message": "Deleted"})


class CameraFileView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, project_id):
        data = CameraFile.objects.filter(project_id=project_id)
        batch_name = request.query_params.get("batch_name")
        if batch_name:
            data = data.filter(batch_name=batch_name)
        data = data.order_by("-is_latest", "-date", "-id")
        serializer = CameraFileSerializer(data, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request, project_id):
        project = get_object_or_404(Project, id=project_id)
        if not user_can_upload_to_project(request.user, project):
            return Response({"error": "You are not assigned to this project"}, status=403)

        batch_name = request.data.get("batch_name")
        if not batch_name:
            return Response({"batch_name": "This field is required."}, status=400)

        is_latest = as_bool(request.data.get("is_latest"))
        serializer = CameraFileSerializer(data=request.data, context={"request": request})

        if serializer.is_valid():
            if is_latest:
                CameraFile.objects.filter(project=project, batch_name=batch_name).update(is_latest=False)
            serializer.save(project=project)
            return Response(serializer.data)

        return Response(serializer.errors, status=400)


class CameraDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            obj = CameraFile.objects.get(id=pk)
        except CameraFile.DoesNotExist:
            return Response({"error": "Camera file not found"}, status=404)

        was_latest = obj.is_latest
        if obj.file:
            obj.file.delete(save=False)
        obj.delete()

        promoted_id = None
        if was_latest:
            newest = CameraFile.objects.filter(
                project=obj.project, batch_name=obj.batch_name
            ).order_by("-date", "-id").first()
            if newest:
                newest.is_latest = True
                newest.save(update_fields=["is_latest"])
                promoted_id = newest.id

        return Response({"message": "Deleted", "promoted_latest_id": promoted_id})


class CameraUpdateView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def put(self, request, pk):
        cam = CameraFile.objects.get(id=pk)
        serializer = CameraFileSerializer(cam, data=request.data, partial=True)
        is_latest = as_bool(request.data.get("is_latest"))

        if serializer.is_valid():
            if is_latest:
                CameraFile.objects.filter(
                    project=cam.project, batch_name=cam.batch_name
                ).exclude(id=cam.id).update(is_latest=False)
            serializer.save()
            return Response(serializer.data)

        return Response(serializer.errors, status=400)


class MatrixFileView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, project_id):
        data = MatrixFile.objects.filter(project_id=project_id)
        batch_name = request.query_params.get("batch_name")
        if batch_name:
            data = data.filter(batch_name=batch_name)
        data = data.order_by("-is_latest", "-date", "-id")
        serializer = MatrixFileSerializer(data, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request, project_id):
        project = get_object_or_404(Project, id=project_id)
        if not user_can_upload_to_project(request.user, project):
            return Response({"error": "You are not assigned to this project"}, status=403)

        batch_name = request.data.get("batch_name")
        if not batch_name:
            return Response({"batch_name": "This field is required."}, status=400)

        is_latest = as_bool(request.data.get("is_latest"))
        serializer = MatrixFileSerializer(data=request.data, context={"request": request})

        if serializer.is_valid():
            if is_latest:
                MatrixFile.objects.filter(project=project, batch_name=batch_name).update(is_latest=False)
            serializer.save(project=project)
            return Response(serializer.data)

        return Response(serializer.errors, status=400)


class MatrixDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            obj = MatrixFile.objects.get(id=pk)
        except MatrixFile.DoesNotExist:
            return Response({"error": "Matrix file not found"}, status=404)

        was_latest = obj.is_latest
        if obj.file:
            obj.file.delete(save=False)
        obj.delete()

        promoted_id = None
        if was_latest:
            newest = MatrixFile.objects.filter(
                project=obj.project, batch_name=obj.batch_name
            ).order_by("-date", "-id").first()
            if newest:
                newest.is_latest = True
                newest.save(update_fields=["is_latest"])
                promoted_id = newest.id

        return Response({"message": "Deleted", "promoted_latest_id": promoted_id})


class MatrixUpdateView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def put(self, request, pk):
        mat = MatrixFile.objects.get(id=pk)
        serializer = MatrixFileSerializer(mat, data=request.data, partial=True)
        is_latest = as_bool(request.data.get("is_latest"))

        if serializer.is_valid():
            if is_latest:
                MatrixFile.objects.filter(
                    project=mat.project, batch_name=mat.batch_name
                ).exclude(id=mat.id).update(is_latest=False)
            serializer.save()
            return Response(serializer.data)

        return Response(serializer.errors, status=400)


class BIMDataView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, project_id):
        data = BIMData.objects.filter(project_id=project_id).order_by("-is_latest", "-date", "-id")
        serializer = BIMDataSerializer(data, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request, project_id):
        project = get_object_or_404(Project, id=project_id)
        if not user_can_upload_to_project(request.user, project):
            return Response({"error": "You are not assigned to this project"}, status=403)

        is_latest = as_bool(request.data.get("is_latest"))

        serializer = BIMDataSerializer(data=request.data, context={"request": request})

        if serializer.is_valid():
            if is_latest:
                BIMData.objects.filter(project=project).update(is_latest=False)
            serializer.save(project=project)
            return Response(serializer.data)

        return Response(serializer.errors, status=400)


class BIMDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            obj = BIMData.objects.get(id=pk)
        except BIMData.DoesNotExist:
            return Response({"error": "BIM file not found"}, status=404)

        siblings = BIMData.objects.filter(project=obj.project).exclude(id=obj.id)
        # Don't let the project be left with zero BIM files — steer to Edit.
        if not siblings.exists():
            return Response(
                {"error": "Cannot delete the only BIM file for this project. "
                          "Use Edit to replace it instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        was_latest = obj.is_latest
        if obj.file:
            obj.file.delete(save=False)  # remove the physical file too
        obj.delete()

        # If we removed the latest version, promote the newest remaining one.
        promoted_id = None
        if was_latest:
            newest = siblings.order_by("-date", "-id").first()
            if newest:
                BIMData.objects.filter(project=obj.project).update(is_latest=False)
                newest.is_latest = True
                newest.save(update_fields=["is_latest"])
                promoted_id = newest.id

        return Response({"message": "Deleted", "promoted_latest_id": promoted_id})


class PointCloudDataView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, project_id):
        data = PointCloudData.objects.filter(project_id=project_id).order_by("-is_latest", "-date", "-id")
        serializer = PointCloudDataSerializer(data, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request, project_id):
        project = get_object_or_404(Project, id=project_id)
        if not user_can_upload_to_project(request.user, project):
            return Response({"error": "You are not assigned to this project"}, status=403)

        is_latest = as_bool(request.data.get("is_latest"))

        serializer = PointCloudDataSerializer(data=request.data, context={"request": request})

        if serializer.is_valid():
            if is_latest:
                PointCloudData.objects.filter(project=project).update(is_latest=False)
            serializer.save(project=project)
            return Response(serializer.data)

        return Response(serializer.errors, status=400)


class PointCloudDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            obj = PointCloudData.objects.get(id=pk)
        except PointCloudData.DoesNotExist:
            return Response({"error": "Point cloud not found"}, status=404)

        siblings = PointCloudData.objects.filter(project=obj.project).exclude(id=obj.id)
        if not siblings.exists():
            return Response(
                {"error": "Cannot delete the only point cloud for this project. "
                          "Use Edit to replace it instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        was_latest = obj.is_latest
        if obj.file:
            obj.file.delete(save=False)
        obj.delete()

        promoted_id = None
        if was_latest:
            newest = siblings.order_by("-date", "-id").first()
            if newest:
                PointCloudData.objects.filter(project=obj.project).update(is_latest=False)
                newest.is_latest = True
                newest.save(update_fields=["is_latest"])
                promoted_id = newest.id

        return Response({"message": "Deleted", "promoted_latest_id": promoted_id})


class ProjectImageDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            obj = ProjectImage.objects.get(id=pk)
        except ProjectImage.DoesNotExist:
            return Response({"error": "Image not found"}, status=404)
        if obj.image:
            obj.image.delete(save=False)
        obj.delete()
        return Response({"message": "Deleted"})
    
class BIMUpdateView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def put(self, request, pk):
        bim = BIMData.objects.get(id=pk)
        serializer = BIMDataSerializer(bim, data=request.data, partial=True)
        is_latest = as_bool(request.data.get("is_latest"))

        if serializer.is_valid():
            if is_latest:
                BIMData.objects.filter(project=bim.project).exclude(id=bim.id).update(is_latest=False)
            serializer.save()
            return Response(serializer.data)

        return Response(serializer.errors, status=400)
    

class PointCloudUpdateView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def put(self, request, pk):
        pc = PointCloudData.objects.get(id=pk)
        serializer = PointCloudDataSerializer(pc, data=request.data, partial=True)
        is_latest = as_bool(request.data.get("is_latest"))

        if serializer.is_valid():
            if is_latest:
                PointCloudData.objects.filter(project=pc.project).exclude(id=pc.id).update(is_latest=False)
            serializer.save()
            return Response(serializer.data)

        return Response(serializer.errors, status=400)