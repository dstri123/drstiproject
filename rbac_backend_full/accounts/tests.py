import re
import unittest

from django.core import mail
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Organization, User

PW = "Passw0rd!"


class AccountsTestBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.org = Organization.objects.create(name="Acme")
        self.superadmin = User.objects.create_user("root", "root@x.com", PW, role="superadmin")
        self.admin = User.objects.create_user(
            "boss", "boss@x.com", PW, role="admin", organization=self.org, first_name="Bo", last_name="Ss"
        )
        self.engineer = User.objects.create_user(
            "eng", "eng@x.com", PW, role="member", sub_role="project_engineer",
            organization=self.org, created_by=self.admin,
        )

    def login(self, user):
        self.client.force_authenticate(user)


# ── Login / signup ───────────────────────────────────────────────────────────
class LoginTests(AccountsTestBase):
    URL = "/api/v1/auth/login/"

    def test_login_by_username_returns_tokens_and_role(self):
        r = self.client.post(self.URL, {"username": "eng", "password": PW})
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertIn("refresh", r.data)
        self.assertEqual(r.data["user"]["role"], "member")
        self.assertEqual(r.data["user"]["sub_role"], "project_engineer")

    def test_login_by_email_is_case_insensitive(self):
        r = self.client.post(self.URL, {"username": "ENG@X.com", "password": PW})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["username"], "eng")

    def test_wrong_password_and_unknown_user_are_rejected(self):
        for creds in ({"username": "eng", "password": "nope"}, {"username": "ghost", "password": PW}, {}):
            r = self.client.post(self.URL, creds)
            self.assertEqual(r.status_code, 400, creds)
            self.assertNotIn("access", r.data)

    def test_inactive_user_cannot_log_in(self):
        self.engineer.is_active = False
        self.engineer.save()
        r = self.client.post(self.URL, {"username": "eng", "password": PW})
        self.assertEqual(r.status_code, 400)

    def test_access_token_authenticates_protected_endpoint(self):
        token = self.client.post(self.URL, {"username": "eng", "password": PW}).data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        r = self.client.get("/api/v1/profile/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["username"], "eng")


class SignupAndAvailabilityTests(AccountsTestBase):
    def test_signup_creates_superadmin(self):
        r = self.client.post("/api/v1/auth/signup/", {"username": "new", "email": "new@x.com", "password": PW})
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(username="new")
        self.assertEqual(user.role, "superadmin")
        self.assertTrue(user.check_password(PW))

    def test_signup_rejects_duplicate_username_and_email(self):
        r = self.client.post("/api/v1/auth/signup/", {"username": "root", "email": "other@x.com", "password": PW})
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/v1/auth/signup/", {"username": "other", "email": "root@x.com", "password": PW})
        self.assertEqual(r.status_code, 400)

    def test_check_username_and_email(self):
        self.assertFalse(self.client.post("/api/v1/auth/check-username/", {"username": "eng"}).data["available"])
        self.assertTrue(self.client.post("/api/v1/auth/check-username/", {"username": "free"}).data["available"])
        self.assertEqual(self.client.post("/api/v1/auth/check-username/", {"username": ""}).status_code, 400)
        self.assertFalse(self.client.post("/api/v1/auth/check-email/", {"email": "eng@x.com"}).data["available"])
        self.assertTrue(self.client.post("/api/v1/auth/check-email/", {"email": "free@x.com"}).data["available"])

    def test_check_admin_exists(self):
        self.assertTrue(self.client.get("/api/v1/check-admin/").data["admin_exists"])
        User.objects.filter(role="admin").delete()
        self.assertFalse(self.client.get("/api/v1/check-admin/").data["admin_exists"])


class CreateAdminTests(AccountsTestBase):
    URL = "/api/v1/auth/create-admin/"

    def test_superadmin_creates_admin_with_organization(self):
        self.login(self.superadmin)
        r = self.client.post(self.URL, {
            "organization_name": "Beta", "username": "beta_admin", "email": "b@x.com", "password": PW,
        })
        self.assertEqual(r.status_code, 200)
        admin = User.objects.get(username="beta_admin")
        self.assertEqual(admin.role, "admin")
        self.assertEqual(admin.organization.name, "Beta")
        self.assertEqual(admin.created_by, self.superadmin)

    def test_validation(self):
        self.login(self.superadmin)
        base = {"organization_name": "Beta", "username": "u", "email": "u@x.com", "password": PW}
        for field in base:
            self.assertEqual(self.client.post(self.URL, {**base, field: ""}).status_code, 400, field)
        self.assertEqual(self.client.post(self.URL, {**base, "email": "not-an-email"}).status_code, 400)
        self.assertEqual(self.client.post(self.URL, {**base, "username": "boss"}).status_code, 400)
        self.assertEqual(self.client.post(self.URL, {**base, "email": "boss@x.com"}).status_code, 400)
        self.assertFalse(Organization.objects.filter(name="Beta").exists())


# ── Profile ──────────────────────────────────────────────────────────────────
class ProfileTests(AccountsTestBase):
    def test_profile_requires_authentication(self):
        self.assertEqual(self.client.get("/api/v1/profile/").status_code, 401)
        self.assertEqual(self.client.put("/api/v1/profile/update/", {}).status_code, 401)

    def test_profile_returns_own_details(self):
        self.login(self.engineer)
        r = self.client.get("/api/v1/profile/")
        self.assertEqual(r.data["username"], "eng")
        self.assertEqual(r.data["sub_role"], "project_engineer")

    def test_update_requires_first_and_last_name(self):
        self.login(self.engineer)
        r = self.client.put("/api/v1/profile/update/", {"first_name": "E", "last_name": ""}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_update_names_and_bio(self):
        self.login(self.engineer)
        r = self.client.put(
            "/api/v1/profile/update/", {"first_name": "En", "last_name": "Gin", "bio": "hi"}, format="json"
        )
        self.assertEqual(r.status_code, 200)
        self.engineer.refresh_from_db()
        self.assertEqual((self.engineer.first_name, self.engineer.last_name, self.engineer.bio), ("En", "Gin", "hi"))

    def test_only_superadmin_can_change_email(self):
        payload = {"first_name": "A", "last_name": "B", "email": "changed@x.com"}
        for user in (self.admin, self.engineer):
            self.login(user)
            r = self.client.put("/api/v1/profile/update/", payload, format="json")
            self.assertEqual(r.status_code, 403, user.username)

        self.login(self.superadmin)
        r = self.client.put("/api/v1/profile/update/", payload, format="json")
        self.assertEqual(r.status_code, 200)
        self.superadmin.refresh_from_db()
        self.assertEqual(self.superadmin.email, "changed@x.com")

    def test_superadmin_email_must_be_valid_and_unused(self):
        self.login(self.superadmin)
        base = {"first_name": "A", "last_name": "B"}
        self.assertEqual(self.client.put("/api/v1/profile/update/", {**base, "email": "bad"}, format="json").status_code, 400)
        self.assertEqual(
            self.client.put("/api/v1/profile/update/", {**base, "email": "ENG@x.com"}, format="json").status_code, 400
        )

    def test_password_change_returns_new_tokens(self):
        self.login(self.engineer)
        r = self.client.put(
            "/api/v1/profile/update/", {"first_name": "A", "last_name": "B", "password": "N3wPass!"}, format="json"
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.engineer.refresh_from_db()
        self.assertTrue(self.engineer.check_password("N3wPass!"))


# ── Password reset by emailed code ───────────────────────────────────────────
class PasswordResetTests(AccountsTestBase):
    REQ, VERIFY, CONFIRM = (
        "/api/v1/auth/password-reset/request/",
        "/api/v1/auth/password-reset/verify/",
        "/api/v1/auth/password-reset/confirm/",
    )

    def _request_code(self, email="boss@x.com"):
        r = self.client.post(self.REQ, {"email": email})
        self.assertEqual(r.status_code, 200, r.data)
        return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)

    def test_unknown_email_is_404(self):
        self.assertEqual(self.client.post(self.REQ, {"email": "ghost@x.com"}).status_code, 404)

    def test_member_roles_are_sent_to_their_admin(self):
        r = self.client.post(self.REQ, {"email": "eng@x.com"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["role"], "project_engineer")
        self.assertEqual(r.data["admin"]["email"], "boss@x.com")
        self.assertEqual(len(mail.outbox), 0)

    def test_full_reset_flow(self):
        code = self._request_code()
        self.assertEqual(mail.outbox[-1].to, ["boss@x.com"])

        token = self.client.post(self.VERIFY, {"email": "boss@x.com", "code": code}).data["reset_token"]
        r = self.client.post(self.CONFIRM, {"reset_token": token, "new_password": "Br4nd-new!"})
        self.assertEqual(r.status_code, 200)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password("Br4nd-new!"))

        # The reset session is single-use.
        r = self.client.post(self.CONFIRM, {"reset_token": token, "new_password": "An0ther-one!"})
        self.assertEqual(r.status_code, 400)

    def test_resend_cooldown(self):
        self._request_code()
        self.assertEqual(self.client.post(self.REQ, {"email": "boss@x.com"}).status_code, 429)

    def test_wrong_code_counts_down_then_expires(self):
        code = self._request_code()
        wrong = "000000" if code != "000000" else "111111"
        tries = [self.client.post(self.VERIFY, {"email": "boss@x.com", "code": wrong}).data["tries_left"]
                 for _ in range(3)]
        self.assertEqual(tries, [2, 1, 0])
        # Even the right code no longer works.
        r = self.client.post(self.VERIFY, {"email": "boss@x.com", "code": code})
        self.assertEqual(r.status_code, 400)

    def test_weak_or_unchanged_password_is_rejected(self):
        code = self._request_code()
        token = self.client.post(self.VERIFY, {"email": "boss@x.com", "code": code}).data["reset_token"]
        for weak in ("short1!", "nodigits!!", "n0symbols1", PW):
            r = self.client.post(self.CONFIRM, {"reset_token": token, "new_password": weak})
            self.assertEqual(r.status_code, 400, weak)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password(PW))


# ── Organizations / admin management ─────────────────────────────────────────
class OrganizationTests(AccountsTestBase):
    def test_superadmin_lists_updates_and_deletes_organizations(self):
        self.login(self.superadmin)
        rows = self.client.get("/api/v1/auth/organizations/").data
        self.assertEqual([(o["organization_name"], o["username"]) for o in rows], [("Acme", "boss")])

        r = self.client.put(f"/api/v1/auth/organizations/{self.org.id}/update/", {"organization_name": "Acme 2"})
        self.assertEqual(r.status_code, 200)
        self.org.refresh_from_db()
        self.assertEqual(self.org.name, "Acme 2")

        self.assertEqual(self.client.delete(f"/api/v1/auth/organizations/{self.org.id}/").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/v1/auth/organizations/{self.org.id}/").status_code, 404)

    def test_organization_endpoints_require_login(self):
        self.assertEqual(self.client.get("/api/v1/auth/organizations/").status_code, 401)
        self.assertEqual(self.client.delete(f"/api/v1/auth/organizations/{self.org.id}/").status_code, 401)

    def test_superadmin_edits_admin(self):
        self.login(self.superadmin)
        r = self.client.put(f"/api/v1/auth/admins/{self.admin.id}/", {"first_name": "New"})
        self.assertEqual(r.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.first_name, "New")
        r = self.client.put(f"/api/v1/auth/admins/{self.admin.id}/", {"email": "eng@x.com"})
        self.assertEqual(r.status_code, 400)


class KnownPermissionGapTests(AccountsTestBase):
    """Each test states the behaviour we WANT. They are marked expectedFailure
    because the views don't enforce it yet (any logged-in user is allowed).
    When a view is fixed the test shows up as an "unexpected success":
    remove the decorator then."""

    @unittest.expectedFailure
    def test_member_cannot_delete_organization(self):
        self.login(self.engineer)
        self.assertEqual(self.client.delete(f"/api/v1/auth/organizations/{self.org.id}/").status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_rename_organization(self):
        self.login(self.engineer)
        r = self.client.put(f"/api/v1/auth/organizations/{self.org.id}/update/", {"organization_name": "x"})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_reset_admin_password(self):
        self.login(self.engineer)
        r = self.client.put(f"/api/v1/auth/admins/{self.admin.id}/", {"password": "Hijack3d!"})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_delete_admin(self):
        self.login(self.engineer)
        self.assertEqual(self.client.delete(f"/api/v1/auth/admins/{self.admin.id}/").status_code, 403)


# ── Added coverage: role-based creation, admin management, edge cases ────────
import io
import shutil
import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError
from django.test import TestCase, override_settings
from PIL import Image

from accounts.serializers import SignupSerializer
from activity.models import ActivityLog

AVATAR_MEDIA = tempfile.mkdtemp()


def _png(name="a.png"):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


class ModelAndSerializerTests(AccountsTestBase):
    def test_str(self):
        self.assertEqual(str(self.org), "Acme")
        self.assertEqual(str(self.admin), "boss (admin)")

    def test_signup_serializer_rejects_duplicates_and_hashes_password(self):
        s = SignupSerializer(data={"username": "eng", "email": "free@x.com", "password": PW})
        self.assertFalse(s.is_valid())
        self.assertIn("username", s.errors)
        s = SignupSerializer(data={"username": "fresh", "email": "eng@x.com", "password": PW})
        self.assertFalse(s.is_valid())
        self.assertEqual(s.errors["email"][0], "Email already exists.")
        s = SignupSerializer(data={"username": "fresh", "email": "fresh@x.com", "password": PW})
        self.assertTrue(s.is_valid(), s.errors)
        user = s.save()
        self.assertEqual(user.role, "superadmin")
        self.assertTrue(user.check_password(PW))

    def test_signup_missing_fields_returns_error_dict(self):
        r = self.client.post("/api/v1/auth/signup/", {"username": "x"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.data["error"])

    def test_signup_twin_route_also_works(self):
        # accounts.urls is mounted under both auth/ and auth/signup/.
        r = self.client.post("/api/v1/auth/signup/signup/", {"username": "tw", "email": "tw@x.com", "password": PW})
        self.assertEqual(r.status_code, 201)


class CreateMemberAndUserTests(AccountsTestBase):
    def test_requires_login(self):
        for url in ("/api/v1/auth/create-member/", "/api/v1/auth/create-user/"):
            self.assertEqual(self.client.post(url, {"username": "a", "password": PW}).status_code, 401)

    def test_create_member_sets_role_and_creator(self):
        self.login(self.admin)
        r = self.client.post("/api/v1/auth/create-member/", {"username": "m1", "password": PW})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, {"msg": "Member created"})
        u = User.objects.get(username="m1")
        self.assertEqual((u.role, u.created_by), ("member", self.admin))
        self.assertTrue(u.check_password(PW))
        log = ActivityLog.objects.get(target_type="user", action="create")
        self.assertEqual(log.target_name, "m1")

    def test_create_user_sets_role_user(self):
        self.login(self.engineer)
        r = self.client.post("/api/v1/auth/create-user/", {"username": "u1", "password": PW})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(User.objects.get(username="u1").role, "user")

    def test_missing_or_duplicate_username_is_400_not_500(self):
        """Regression: create_user(username=None) raised ValueError and a
        duplicate username an IntegrityError; both surfaced as 500."""
        self.login(self.admin)
        for url in ("/api/v1/auth/create-member/", "/api/v1/auth/create-user/"):
            r = self.client.post(url, {"password": PW})
            self.assertEqual(r.status_code, 400, url)
            self.assertEqual(r.data["error"], "Username and password are required")
            self.assertEqual(self.client.post(url, {"username": "x"}).status_code, 400)
            r = self.client.post(url, {"username": "eng", "password": PW})
            self.assertEqual(r.status_code, 400, url)
            self.assertEqual(r.data["error"], "Username already exists")


class CreateAdminErrorTests(AccountsTestBase):
    URL = "/api/v1/auth/create-admin/"
    BODY = {"organization_name": "Beta", "username": "ba", "email": "ba@x.com", "password": PW}

    def test_error_messages(self):
        self.login(self.superadmin)
        self.assertEqual(self.client.post(self.URL, {}).data["error"], "All fields are required")
        self.assertEqual(self.client.post(self.URL, {**self.BODY, "email": "x@y"}).data["error"], "Invalid email address")
        self.assertEqual(self.client.post(self.URL, {**self.BODY, "username": "boss"}).data["error"], "Username already exists")
        self.assertEqual(self.client.post(self.URL, {**self.BODY, "email": "boss@x.com"}).data["error"], "Email already exists")

    def test_integrity_error_is_400(self):
        self.login(self.superadmin)
        with mock.patch.object(Organization.objects, "create", side_effect=IntegrityError("dup")):
            r = self.client.post(self.URL, self.BODY)
        self.assertEqual((r.status_code, r.data["error"]), (400, "Database error"))

    def test_unexpected_error_is_500(self):
        self.login(self.superadmin)
        with mock.patch.object(Organization.objects, "create", side_effect=RuntimeError("boom")):
            r = self.client.post(self.URL, self.BODY)
        self.assertEqual((r.status_code, r.data["error"]), (500, "boom"))

    def test_anonymous_creation_has_no_creator(self):
        r = self.client.post(self.URL, self.BODY)
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(User.objects.get(username="ba").created_by)


class OrganizationEdgeTests(AccountsTestBase):
    def test_list_org_without_admin(self):
        Organization.objects.create(name="Empty")
        self.login(self.superadmin)
        rows = {o["organization_name"]: o for o in self.client.get("/api/v1/auth/organizations/").data}
        self.assertEqual(rows["Empty"]["username"], "-")
        self.assertIsNone(rows["Empty"]["created_at"])
        self.assertIsNotNone(rows["Acme"]["created_at"])

    def test_update_missing_org_is_404(self):
        self.login(self.superadmin)
        r = self.client.put("/api/v1/auth/organizations/999999/update/", {"organization_name": "x"})
        self.assertEqual(r.status_code, 404)

    def test_delete_org_keeps_users_with_null_org(self):
        self.login(self.superadmin)
        self.client.delete(f"/api/v1/auth/organizations/{self.org.id}/")
        self.admin.refresh_from_db()
        self.assertIsNone(self.admin.organization)
        log = ActivityLog.objects.get(target_type="organization", action="delete")
        self.assertEqual(log.target_name, "Acme")

    def test_rename_logs_old_and_new(self):
        self.login(self.superadmin)
        self.client.put(f"/api/v1/auth/organizations/{self.org.id}/update/", {"organization_name": "Acme 2"})
        log = ActivityLog.objects.get(target_type="organization")
        self.assertEqual(log.details["changes"]["name"], ["Acme", "Acme 2"])


class OrganizationAdminsTests(AccountsTestBase):
    def url(self, org_id):
        return f"/api/v1/auth/organizations/{org_id}/admins/"

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.url(self.org.id)).status_code, 401)

    def test_lists_admins_with_counts(self):
        self.login(self.superadmin)
        rows = self.client.get(self.url(self.org.id)).data
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["username"], "boss")
        self.assertEqual((row["first_name"], row["last_name"]), ("Bo", "Ss"))
        self.assertEqual(row["projects_count"], 0)
        self.assertEqual(row["users_count"], 1)  # the engineer
        self.assertTrue(row["has_dependencies"])

    def test_admin_without_users_has_no_dependencies(self):
        self.engineer.delete()
        self.login(self.superadmin)
        self.assertFalse(self.client.get(self.url(self.org.id)).data[0]["has_dependencies"])

    def test_not_found_and_error(self):
        self.login(self.superadmin)
        self.assertEqual(self.client.get(self.url(999999)).status_code, 404)
        with mock.patch("accounts.views.User.objects.filter", side_effect=RuntimeError("db")):
            r = self.client.get(self.url(self.org.id))
        self.assertEqual((r.status_code, r.data["error"]), (500, "db"))


class AdminDetailTests(AccountsTestBase):
    def url(self, uid):
        return f"/api/v1/auth/admins/{uid}/"

    def test_requires_login(self):
        self.assertEqual(self.client.put(self.url(self.admin.id), {}).status_code, 401)
        self.assertEqual(self.client.delete(self.url(self.admin.id)).status_code, 401)

    def test_update_all_fields(self):
        self.login(self.superadmin)
        r = self.client.put(self.url(self.admin.id), {
            "email": "new@x.com", "first_name": "F", "last_name": "L", "password": "N3w-pass!",
        })
        self.assertEqual(r.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual((self.admin.email, self.admin.first_name, self.admin.last_name), ("new@x.com", "F", "L"))
        self.assertTrue(self.admin.check_password("N3w-pass!"))

    def test_blank_fields_are_left_unchanged(self):
        self.login(self.superadmin)
        r = self.client.put(self.url(self.admin.id), {"email": "", "first_name": ""})
        self.assertEqual(r.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual((self.admin.email, self.admin.first_name), ("boss@x.com", "Bo"))
        self.assertTrue(self.admin.check_password(PW))

    def test_non_admin_target_and_missing_are_404(self):
        self.login(self.superadmin)
        for uid in (self.engineer.id, 999999):
            self.assertEqual(self.client.put(self.url(uid), {"first_name": "x"}).status_code, 404)
            self.assertEqual(self.client.delete(self.url(uid)).status_code, 404)
        self.assertTrue(User.objects.filter(pk=self.engineer.pk).exists())

    def test_delete_admin(self):
        self.login(self.superadmin)
        r = self.client.delete(self.url(self.admin.id))
        self.assertEqual((r.status_code, r.data["message"]), (200, "Admin deleted successfully"))
        self.assertFalse(User.objects.filter(pk=self.admin.pk).exists())
        self.engineer.refresh_from_db()
        self.assertIsNone(self.engineer.created_by)
        self.assertEqual(ActivityLog.objects.get(target_type="admin").target_name, "boss")

    def test_unexpected_errors_are_500(self):
        self.login(self.superadmin)
        with mock.patch.object(User, "save", side_effect=RuntimeError("x")):
            self.assertEqual(self.client.put(self.url(self.admin.id), {"first_name": "y"}).status_code, 500)
        with mock.patch.object(User, "delete", side_effect=RuntimeError("x")):
            self.assertEqual(self.client.delete(self.url(self.admin.id)).status_code, 500)


@override_settings(MEDIA_ROOT=AVATAR_MEDIA)
class AvatarAndProfileEdgeTests(AccountsTestBase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(AVATAR_MEDIA, ignore_errors=True)

    def test_upload_avatar_then_profile_returns_url(self):
        self.login(self.engineer)
        r = self.client.put("/api/v1/profile/update/",
                            {"first_name": "A", "last_name": "B", "avatar": _png()}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["avatar_url"].startswith("http://testserver/"))
        self.assertNotIn("access", r.data)
        r = self.client.get("/api/v1/profile/")
        self.assertIn("profile_avatars/", r.data["avatar_url"])

    def test_non_image_avatar_is_400(self):
        self.login(self.engineer)
        bad = SimpleUploadedFile("x.txt", b"hi", content_type="text/plain")
        r = self.client.put("/api/v1/profile/update/",
                            {"first_name": "A", "last_name": "B", "avatar": bad}, format="multipart")
        self.assertEqual((r.status_code, r.data["error"]), (400, "Avatar must be an image file."))
        self.engineer.refresh_from_db()
        self.assertFalse(self.engineer.avatar)

    def test_same_email_from_non_superadmin_is_allowed(self):
        self.login(self.engineer)
        r = self.client.put("/api/v1/profile/update/",
                            {"first_name": "A", "last_name": "B", "email": "ENG@x.com"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_save_error_is_500(self):
        self.login(self.engineer)
        with mock.patch.object(User, "save", side_effect=RuntimeError("disk")):
            r = self.client.put("/api/v1/profile/update/", {"first_name": "A", "last_name": "B"}, format="json")
        self.assertEqual((r.status_code, r.data["error"]), (500, "disk"))

    def test_check_email_requires_value(self):
        r = self.client.post("/api/v1/auth/check-email/", {"email": " "})
        self.assertEqual((r.status_code, r.data["message"]), (400, "Email is required"))

    def test_profile_update_is_logged_as_own_profile(self):
        self.login(self.engineer)
        self.client.put("/api/v1/profile/update/", {"first_name": "A", "last_name": "B"}, format="json")
        self.assertEqual(ActivityLog.objects.get(target_type="own profile").target_name, "eng")


class PasswordResetEdgeTests(AccountsTestBase):
    REQ = "/api/v1/auth/password-reset/request/"

    def test_lookup_by_username_and_blank(self):
        r = self.client.post(self.REQ, {"email": "BOSS"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["email"], "bo**@x.com")
        self.assertEqual(self.client.post(self.REQ, {"email": ""}).status_code, 404)

    def test_inactive_admin_is_404(self):
        self.admin.is_active = False
        self.admin.save()
        self.assertEqual(self.client.post(self.REQ, {"email": "boss@x.com"}).status_code, 404)

    def test_admin_without_email_is_400(self):
        User.objects.create_user("noemail", "", PW, role="admin")
        r = self.client.post(self.REQ, {"email": "noemail"})
        self.assertEqual(r.status_code, 400)

    def test_member_without_any_admin_gets_null_contact(self):
        User.objects.filter(role="admin").delete()
        r = self.client.post(self.REQ, {"email": "eng@x.com"})
        self.assertEqual(r.status_code, 403)
        self.assertIsNone(r.data["admin"])

    def test_member_of_org_without_admin_falls_back_to_any_admin(self):
        other = Organization.objects.create(name="Lonely")
        User.objects.create_user("lone", "lone@x.com", PW, role="member", sub_role="viewer", organization=other)
        r = self.client.post(self.REQ, {"email": "lone@x.com"})
        self.assertEqual(r.data["admin"], {"name": "Bo Ss", "email": "boss@x.com", "organization": "Acme"})

    def test_mail_failure_is_502_and_clears_cooldown(self):
        with mock.patch("accounts.views.send_mail", side_effect=OSError("smtp down")),                 self.assertLogs("accounts.views", "ERROR"):
            r = self.client.post(self.REQ, {"email": "boss@x.com"})
        self.assertEqual(r.status_code, 502)
        self.assertIsNone(cache.get(f"pwreset:cooldown:{self.admin.pk}"))
        self.assertIsNone(cache.get(f"pwreset:code:{self.admin.pk}"))
        # Can retry immediately.
        self.assertEqual(self.client.post(self.REQ, {"email": "boss@x.com"}).status_code, 200)

    def test_verify_unknown_user_and_confirm_without_token(self):
        r = self.client.post("/api/v1/auth/password-reset/verify/", {"email": "ghost@x.com", "code": "1"})
        self.assertEqual((r.status_code, r.data["tries_left"]), (400, 0))
        r = self.client.post("/api/v1/auth/password-reset/confirm/", {"new_password": "Abcdef1!"})
        self.assertEqual(r.status_code, 400)

    def test_confirm_records_activity(self):
        self.client.post(self.REQ, {"email": "boss@x.com"})
        code = re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)
        token = self.client.post("/api/v1/auth/password-reset/verify/",
                                 {"email": "boss@x.com", "code": code}).data["reset_token"]
        self.client.post("/api/v1/auth/password-reset/confirm/", {"reset_token": token, "new_password": "Zz9!zzzz"})
        log = ActivityLog.objects.get(action="password_reset")
        self.assertEqual((log.user, log.owner_admin), (self.admin, self.admin))


class SeedDataCommandTests(TestCase):
    def _run(self):
        out = io.StringIO()
        call_command("seed_data", stdout=out)
        return out.getvalue()

    def test_seed_creates_orgs_users_and_projects(self):
        from projects.models import BIMData, PointCloudData, Project, ProjectUser

        out = self._run()
        self.assertIn("Successfully seeded 5 organizations with 24 total users", out)
        # The printed summary claims 13 non-admin users, but the data has 12.
        self.assertIn("13 Users with different roles", out)
        self.assertEqual(Organization.objects.count(), 5)
        su = User.objects.get(username="superadmin")
        self.assertTrue(su.is_superuser and su.check_password("SuperAdmin@123"))
        self.assertEqual(su.role, "superadmin")
        self.assertEqual(User.objects.filter(role="admin").count(), 12)
        self.assertEqual(User.objects.exclude(role__in=["admin", "superadmin"]).count(), 12)
        admin = User.objects.get(username="acme_admin1")
        self.assertEqual(admin.organization.name, "Acme Corporation")
        self.assertTrue(admin.check_password("AcmeAdmin@123"))
        self.assertEqual(Project.objects.count(), 7)
        self.assertEqual(BIMData.objects.count(), 5)
        self.assertEqual(PointCloudData.objects.count(), 4)
        tower = Project.objects.get(project_name="Tech Park Infrastructure")
        self.assertEqual(set(ProjectUser.objects.filter(project=tower).values_list("user__username", flat=True)),
                         {"tech_admin1", "tech_engineer1"})
        # NOTE: seeded contributors keep the sub-role in `role` (sub_role is None),
        # unlike users created through the app (role="member", sub_role=...).
        pm = User.objects.get(username="acme_pm1")
        self.assertEqual((pm.role, pm.sub_role), ("project_manager", None))

    def test_running_twice_is_safe(self):
        self._run()
        counts = (Organization.objects.count(), User.objects.count())
        out = self._run()
        self.assertIn("Super Admin already exists", out)
        self.assertIn("Database already seeded", out)
        self.assertEqual((Organization.objects.count(), User.objects.count()), counts)

    def test_existing_organization_skips_seeding(self):
        Organization.objects.create(name="Pre-existing")
        out = self._run()
        self.assertIn("Database already seeded", out)
        self.assertEqual(User.objects.count(), 1)  # only the superadmin

    def test_project_failure_is_reported_not_raised(self):
        from projects.models import Project
        with mock.patch.object(Project.objects, "create", side_effect=RuntimeError("nope")):
            out = self._run()
        self.assertIn("[ERROR] Failed to create project ABC Building Renovation: nope", out)
        self.assertIn("Created 0 projects", out)

    def test_org_failure_is_reported(self):
        with mock.patch.object(Organization.objects, "create", side_effect=RuntimeError("bad")):
            with mock.patch.object(Organization.objects, "all", return_value=[]):
                out = self._run()
        self.assertIn("[ERROR] Failed to create Acme Corporation: bad", out)

    def test_outer_project_failure_is_reported(self):
        with mock.patch.object(Organization.objects, "all", side_effect=RuntimeError("q")):
            out = self._run()
        self.assertIn("[ERROR] Failed to seed projects: q", out)


class MoreKnownPermissionGapTests(AccountsTestBase):
    """Same convention as KnownPermissionGapTests."""

    @unittest.expectedFailure
    def test_anonymous_cannot_create_admin_and_organization(self):
        """create-admin is AllowAny: anyone can create an org + admin."""
        r = self.client.post("/api/v1/auth/create-admin/", {
            "organization_name": "Evil", "username": "evil", "email": "e@x.com", "password": PW})
        self.assertIn(r.status_code, (401, 403))

    @unittest.expectedFailure
    def test_member_cannot_create_members(self):
        self.login(self.engineer)
        r = self.client.post("/api/v1/auth/create-member/", {"username": "m9", "password": PW})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_list_organizations(self):
        self.login(self.engineer)
        self.assertEqual(self.client.get("/api/v1/auth/organizations/").status_code, 403)

    @unittest.expectedFailure
    def test_admin_cannot_view_other_org_admins(self):
        other = Organization.objects.create(name="Other")
        self.login(self.admin)
        self.assertEqual(self.client.get(f"/api/v1/auth/organizations/{other.id}/admins/").status_code, 403)
