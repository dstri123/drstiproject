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
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
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

            # Only the Super Admin may change their email address.
            new_email = request.data.get("email")
            if new_email is not None:
                new_email = new_email.strip()
                if new_email.lower() != (user.email or "").lower():
                    if (user.sub_role or user.role) != "superadmin":
                        return Response(
                            {"error": "Only the Super Admin can change the email address."},
                            status=status.HTTP_403_FORBIDDEN,
                        )
                    try:
                        validate_email(new_email)
                    except DjangoValidationError:
                        return Response(
                            {"error": "Enter a valid email address."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                        return Response(
                            {"error": "This email is already used by another account."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    user.email = new_email

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
                "email": user.email,
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

# ─── Password reset (email code) ──────────────────────────────────────────────
# Only superadmin / admin accounts can reset their own password with a 6-digit
# code emailed to them. Everyone else is shown their admin's contact details,
# because admins manage passwords for Managers, Data Contributors, etc.
# Codes and reset sessions live in the Django cache, so no extra tables are needed.
import re
import secrets
import hashlib

from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
import logging

logger = logging.getLogger(__name__)

SELF_RESET_ROLES = {"superadmin", "admin"}
RESET_CODE_TTL = 10 * 60          # seconds a code stays valid
RESET_SESSION_TTL = 15 * 60       # seconds to set a new password after verifying
RESET_MAX_ATTEMPTS = 3
RESET_RESEND_COOLDOWN = 30


def _effective_role(user):
    # Contributor accounts are stored as role="member" with the real role in sub_role.
    return (user.sub_role or user.role or "").lower()


def _admin_contact_for(user):
    """The admin who manages this user's password: an admin of the user's
    organization if one is set, otherwise the first active admin."""
    admins = User.objects.filter(role="admin", is_active=True).select_related("organization")
    if user.organization_id:
        org_admins = admins.filter(organization_id=user.organization_id)
        if org_admins.exists():
            admins = org_admins
    admin = admins.order_by("id").first()
    if not admin:
        return None
    return {
        "name": (admin.get_full_name() or admin.username).strip(),
        "email": admin.email or "",
        "organization": admin.organization.name.strip() if admin.organization else "",
    }


def _find_reset_user(value):
    value = (value or "").strip()
    if not value:
        return None
    return (
        User.objects.filter(email__iexact=value).first()
        or User.objects.filter(username__iexact=value).first()
    )


def _hash_code(code):
    return hashlib.sha256(code.encode()).hexdigest()


def _mask_email(email):
    name, _, domain = email.partition("@")
    return f"{name[:2]}{'*' * max(len(name) - 2, 1)}@{domain}"


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        user = _find_reset_user(request.data.get("email"))
        if not user or not user.is_active:
            return Response({"error": "No account found with that email."}, status=404)

        role = _effective_role(user)
        if role not in SELF_RESET_ROLES:
            return Response(
                {
                    "error": "Your password is reset by your admin, not by email.",
                    "role": role,
                    "admin": _admin_contact_for(user),
                },
                status=403,
            )

        if not user.email:
            return Response({"error": "This account has no email address. Contact your administrator."}, status=400)

        cooldown_key = f"pwreset:cooldown:{user.pk}"
        if cache.get(cooldown_key):
            return Response({"error": "Please wait a few seconds before requesting another code."}, status=429)

        code = f"{secrets.randbelow(1_000_000):06d}"
        cache.set(f"pwreset:code:{user.pk}", {"hash": _hash_code(code), "attempts": RESET_MAX_ATTEMPTS}, RESET_CODE_TTL)
        cache.set(cooldown_key, True, RESET_RESEND_COOLDOWN)

        try:
            send_mail(
                "Your C Twin password reset code",
                f"Your password reset code is {code}. It expires in {RESET_CODE_TTL // 60} minutes.\n\n"
                "If you didn't request this, you can ignore this email.",
                settings.DEFAULT_FROM_EMAIL,
                [user.email],
                fail_silently=False,
            )
        except Exception:
            logger.exception("Password reset email to %s failed", user.email)
            cache.delete(f"pwreset:code:{user.pk}")
            cache.delete(cooldown_key)
            return Response(
                {"error": "We couldn't send the email right now. Please try again later or contact your administrator."},
                status=502,
            )

        return Response({
            "detail": "Code sent.",
            "email": _mask_email(user.email),
            "resend_in": RESET_RESEND_COOLDOWN,
        })


class PasswordResetVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        user = _find_reset_user(request.data.get("email"))
        code = str(request.data.get("code", "")).strip()
        key = f"pwreset:code:{user.pk}" if user else None
        entry = cache.get(key) if key else None

        if not entry:
            return Response({"error": "This code has expired. Please request a new one.", "tries_left": 0}, status=400)

        if not secrets.compare_digest(entry["hash"], _hash_code(code)):
            entry["attempts"] -= 1
            if entry["attempts"] <= 0:
                cache.delete(key)
                return Response({"error": "Too many incorrect attempts. Please request a new code.", "tries_left": 0}, status=400)
            cache.set(key, entry, RESET_CODE_TTL)
            left = entry["attempts"]
            return Response(
                {"error": f"That code isn't right. You have {left} {'try' if left == 1 else 'tries'} left.", "tries_left": left},
                status=400,
            )

        cache.delete(key)
        reset_token = secrets.token_urlsafe(32)
        cache.set(f"pwreset:session:{reset_token}", user.pk, RESET_SESSION_TTL)
        return Response({"reset_token": reset_token})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        token = request.data.get("reset_token") or ""
        password = request.data.get("new_password") or ""
        user_pk = cache.get(f"pwreset:session:{token}") if token else None
        user = User.objects.filter(pk=user_pk).first() if user_pk else None

        if not user:
            return Response({"error": "Your reset session has expired. Please start again."}, status=400)

        if (
            len(password) < 8
            or not re.search(r"[A-Za-z]", password)
            or not re.search(r"\d", password)
            or not re.search(r"[^A-Za-z0-9]", password)
        ):
            return Response(
                {"error": "Password must be at least 8 characters and include letters, numbers and a symbol."},
                status=400,
            )

        if user.check_password(password):
            return Response({"error": "New password must be different from your current password."}, status=400)

        user.set_password(password)
        user.save(update_fields=["password"])
        cache.delete(f"pwreset:session:{token}")
        return Response({"detail": "Password changed."})
