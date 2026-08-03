from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from django.contrib.auth import authenticate
from .models import User
from .serializers import SignupSerializer
from rest_framework import status
from django.db import IntegrityError
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import get_user_model
from .models import Organization


# 👑 SUPERADMIN SIGNUP
class SignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = SignupSerializer(data=request.data)

        if serializer.is_valid():
            serializer.save(role="superadmin")
            return Response(
                {"message": "SuperAdmin created ✅"},
                status=status.HTTP_201_CREATED
            )

        # 🔥 FIX HERE
        return Response(
            {"error": serializer.errors},
            status=status.HTTP_400_BAD_REQUEST
        )


# 🔍 CHECK ADMIN EXISTS (for redirect logic)
class CheckAdminExists(APIView):
    permission_classes = [AllowAny]  # pre-login bootstrap check — must stay public

    def get(self, request):
        exists = User.objects.filter(role='admin').exists()
        return Response({"admin_exists": exists})


# 🔐 LOGIN (ALL ROLES)
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        login_value = request.data.get("username", "").strip()
        user = User.objects.filter(email__iexact=login_value).first() if login_value else None
        user = authenticate(
            username=user.username if user else login_value,
            password=request.data.get("password")
        )

        if user:
            refresh = RefreshToken.for_user(user)

            response_data = {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "first_name": user.first_name,
                    "role": user.role if user.role else "member",
                    "sub_role": user.sub_role
                }
            }

            return Response(response_data)

        return Response({"error": "Invalid credentials"}, status=400)


User = get_user_model()

class CreateAdminView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        org_name = request.data.get("organization_name")
        username = request.data.get("username")
        email = request.data.get("email")
        password = request.data.get("password")

        # 🔥 VALIDATION
        if not org_name or not username or not email or not password:
            return Response(
                {"error": "All fields are required"},
                status=400
            )

        # Validate email format
        if not self._is_valid_email(email):
            return Response(
                {"error": "Invalid email address"},
                status=400
            )

        try:
            # 🔥 CHECK USERNAME EXISTS
            if User.objects.filter(username=username).exists():
                return Response(
                    {"error": "Username already exists"},
                    status=400
                )

            # 🔥 CHECK EMAIL EXISTS
            if User.objects.filter(email=email).exists():
                return Response(
                    {"error": "Email already exists"},
                    status=400
                )

            # 🔥 CREATE ORGANIZATION
            org = Organization.objects.create(name=org_name)

            # 🔥 CREATE USER
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password
            )
            user.role = "admin"
            user.organization = org

            user.save()

            return Response({
                "message": "Admin + Organization Created"
            })

        except IntegrityError as e:
            return Response(
                {"error": "Database error"},
                status=400
            )

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=500
            )

    @staticmethod
    def _is_valid_email(email):
        import re
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return re.match(pattern, email) is not None

# 🧑‍💼 ADMIN → CREATE MEMBER
class CreateMemberView(APIView):
    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")

        user = User.objects.create_user(
            username=username,
            password=password
        )
        user.role = "member"   # 🔥 assign role
        user.save()

        return Response({"msg": "Member created"})


# 👨‍🔧 MEMBER → CREATE USER
class CreateUserView(APIView):
    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")

        user = User.objects.create_user(
            username=username,
            password=password
        )
        user.role = "user"   # 🔥 assign role
        user.save()

        return Response({"msg": "User created"})
    
class OrganizationListView(APIView):
    def get(self, request):
        data = []

        orgs = Organization.objects.all()

        for org in orgs:
            # 🔥 get admin user for THIS organization
            user = User.objects.filter(
                organization=org,
                role="admin"
            ).first()

            data.append({
                "id": org.id,
                "organization_name": org.name,
                "username": user.username if user else "-",
                "created_at": user.date_joined if user else None
            })

        return Response(data)
    
class DeleteOrganizationView(APIView):
    def delete(self, request, id):
        try:
            org = Organization.objects.get(id=id)
            org.delete()
            return Response({"message": "Deleted ✅"})
        except Organization.DoesNotExist:
            return Response({"error": "Not found ❌"}, status=404)
        

class UpdateOrganizationView(APIView):
    def put(self, request, id):
        try:
            org = Organization.objects.get(id=id)
            name = request.data.get("organization_name")

            org.name = name
            org.save()

            return Response({"message": "Updated ✅"})
        except Organization.DoesNotExist:
            return Response({"error": "Not found"}, status=404)


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        avatar_url = ""
        if getattr(user, "avatar", None) and user.avatar:
            avatar_url = request.build_absolute_uri(user.avatar.url)
        return Response(
            {
                "first_name": user.first_name or "",
                "last_name": user.last_name or "",
                "bio": user.bio or "",
                "email": user.email or "",
                "username": user.username or "",
                "role": user.role or "",
                "sub_role": user.sub_role or "",
                "avatar_url": avatar_url,
            }
        )


class CheckUsernameView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username", "").strip()

        if not username:
            return Response(
                {"available": False, "message": "Username is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        exists = User.objects.filter(username=username).exists()
        return Response({
            "available": not exists,
            "message": "Username is already taken" if exists else "Username is available"
        })


class CheckEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email", "").strip()

        if not email:
            return Response(
                {"available": False, "message": "Email is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        exists = User.objects.filter(email=email).exists()
        return Response({
            "available": not exists,
            "message": "Email is already taken" if exists else "Email is available"
        })


class ProfileUpdateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def put(self, request):
        try:
            user = request.user

            first_name = request.data.get("first_name", "").strip()
            last_name = request.data.get("last_name", "").strip()
            bio = request.data.get("bio", "").strip()
            password = request.data.get("password", "")

            if not first_name or not last_name:
                return Response(
                    {"error": "First name and last name are required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user.first_name = first_name
            user.last_name = last_name
            user.bio = bio
            if password:
                user.set_password(password)

            uploaded = request.FILES.get("avatar")
            if uploaded:
                if not uploaded.content_type or not uploaded.content_type.startswith("image/"):
                    return Response(
                        {"error": "Avatar must be an image file."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                user.avatar = uploaded

            user.save()

            avatar_url = ""
            if user.avatar:
                avatar_url = request.build_absolute_uri(user.avatar.url)

            response_data = {
                "message": "Profile updated successfully.",
                "avatar_url": avatar_url,
            }

            if password:
                refresh = RefreshToken.for_user(user)
                response_data["access"] = str(refresh.access_token)
                response_data["refresh"] = str(refresh)

            return Response(response_data)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class OrganizationAdminsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, id):
        try:
            org = Organization.objects.get(id=id)
            admins = User.objects.filter(organization=org, role="admin")

            admin_data = []
            for admin in admins:
                # Count projects created by this admin
                project_count = admin.project_set.count() if hasattr(admin, 'project_set') else 0
                # Count users created by this admin
                user_count = User.objects.filter(organization=org).exclude(id=admin.id).count()

                admin_data.append({
                    "id": admin.id,
                    "username": admin.username,
                    "email": admin.email,
                    "first_name": admin.first_name,
                    "last_name": admin.last_name,
                    "projects_count": project_count,
                    "users_count": user_count,
                    "has_dependencies": project_count > 0 or user_count > 0,
                })

            return Response(admin_data)
        except Organization.DoesNotExist:
            return Response({"error": "Organization not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)


class AdminDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, id):
        try:
            admin = User.objects.get(id=id, role="admin")

            # Check if admin has dependencies
            project_count = admin.project_set.count() if hasattr(admin, 'project_set') else 0
            if project_count > 0:
                return Response(
                    {"error": f"Cannot edit admin who has {project_count} project(s). Delete projects first."},
                    status=400
                )

            email = request.data.get("email", "").strip()
            first_name = request.data.get("first_name", "").strip()
            last_name = request.data.get("last_name", "").strip()
            password = request.data.get("password", "")

            # Check if email is unique (excluding current admin)
            if email and email != admin.email:
                if User.objects.filter(email=email).exclude(id=admin.id).exists():
                    return Response({"error": "Email already in use"}, status=400)

            if email:
                admin.email = email
            if first_name:
                admin.first_name = first_name
            if last_name:
                admin.last_name = last_name
            if password:
                admin.set_password(password)

            admin.save()

            return Response({"message": "Admin updated successfully"})
        except User.DoesNotExist:
            return Response({"error": "Admin not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    def delete(self, request, id):
        try:
            admin = User.objects.get(id=id, role="admin")
            org = admin.organization

            # Check dependencies
            project_count = admin.project_set.count() if hasattr(admin, 'project_set') else 0
            if project_count > 0:
                return Response(
                    {"error": f"Cannot delete admin who has {project_count} project(s)"},
                    status=400
                )

            admin.delete()
            return Response({"message": "Admin deleted successfully"})
        except User.DoesNotExist:
            return Response({"error": "Admin not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)