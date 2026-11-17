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
