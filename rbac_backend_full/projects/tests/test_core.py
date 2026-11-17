import datetime
import shutil
import tempfile
import unittest

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import User

from projects.models import BIMData, PointCloudData, Project, ProjectUser

PW = "Passw0rd!"
MEDIA = tempfile.mkdtemp()


def ifc(name="model.ifc"):
    return SimpleUploadedFile(name, b"ISO-10303-21;")


def las(name="scan.las"):
    return SimpleUploadedFile(name, b"LASF")


@override_settings(MEDIA_ROOT=MEDIA)
class ProjectsTestBase(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.superadmin = User.objects.create_user("root", "root@x.com", PW, role="superadmin")
        self.admin = User.objects.create_user("boss", "boss@x.com", PW, role="admin")
        self.members = {
            sub: User.objects.create_user(sub, f"{sub}@x.com", PW, role="member", sub_role=sub, created_by=self.admin)
            for sub in ("project_manager", "project_engineer", "data_contributor", "site_engineer", "viewer")
        }
        self.dc = self.members["data_contributor"]
        self.project = Project.objects.create(
            project_name="Tower A", description="", start=datetime.date(2026, 1, 1), end=datetime.date(2026, 12, 31)
        )

    def login(self, user):
        self.client.force_authenticate(user)

    def assign(self, user, project=None):
        ProjectUser.objects.create(user=user, project=project or self.project)


# ── Projects CRUD ────────────────────────────────────────────────────────────
class ProjectCrudTests(ProjectsTestBase):
    def test_everything_requires_login(self):
        self.assertEqual(self.client.get("/api/v1/projects/").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/create-project/", {}).status_code, 401)
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/bim/").status_code, 401)

    def test_admin_creates_project_and_slug_is_generated(self):
        self.login(self.admin)
        r = self.client.post("/api/v1/create-project/", {
            "project_name": "Bridge North", "description": "d", "start_date": "2026-02-01", "end_date": "2026-03-01",
            "latitude": "13.0", "longitude": "80.2",
        })
        self.assertEqual(r.status_code, 200, r.data)
        p = Project.objects.get(id=r.data["project_id"])
        self.assertEqual(p.slug, "bridge-north")
        self.assertEqual(str(p.start), "2026-02-01")

    def test_create_project_validation(self):
        self.login(self.admin)
        self.assertEqual(self.client.post("/api/v1/create-project/", {"start": "2026-01-01", "end": "2026-02-01"}).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/create-project/", {"project_name": "x"}).status_code, 400)

    def test_list_includes_users_and_data_ids(self):
        self.assign(self.dc)
        BIMData.objects.create(project=self.project, description="m", date=datetime.date(2026, 1, 1), file=ifc())
        self.login(self.admin)
        row = self.client.get("/api/v1/projects/").data[0]
        self.assertEqual(row["slug"], "tower-a")
        self.assertEqual([u["username"] for u in row["users"]], ["data_contributor"])
        self.assertEqual(len(row["bimdata_set"]), 1)
        self.assertEqual(row["pointclouddata_set"], [])

    def test_rename_regenerates_slug_and_lookup_by_slug_works(self):
        self.login(self.admin)
        r = self.client.patch("/api/v1/projects/tower-a/", {"project_name": "Tower B", "zoom": 15}, format="json")
        # The URL pattern is <int:pk>, so a slug never routes; update by id.
        self.assertEqual(r.status_code, 404)
        r = self.client.patch(f"/api/v1/projects/{self.project.id}/", {"project_name": "Tower B", "zoom": 15}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["slug"], "tower-b")
        self.assertEqual(r.data["zoom"], 15)

    def test_partial_update_keeps_other_fields(self):
        self.login(self.admin)
        self.client.patch(f"/api/v1/projects/{self.project.id}/", {"latitude": "12.5"}, format="json")
        self.project.refresh_from_db()
        self.assertEqual(self.project.project_name, "Tower A")
        self.assertEqual(str(self.project.latitude), "12.500000")

    def test_admin_deletes_project_and_its_assignments(self):
        self.assign(self.dc)
        self.login(self.admin)
        self.assertEqual(self.client.delete(f"/api/v1/projects/{self.project.id}/delete/").status_code, 200)
        self.assertFalse(Project.objects.exists())
        self.assertFalse(ProjectUser.objects.exists())


# ── Users & assignment ───────────────────────────────────────────────────────
class UserManagementTests(ProjectsTestBase):
    def test_admin_creates_member_user(self):
        self.login(self.admin)
        r = self.client.post("/api/v1/create-user-assign/", {
            "username": "newdc", "password": PW, "email": "n@x.com", "sub_role": "data_contributor",
        })
        self.assertEqual(r.status_code, 201, r.data)
        u = User.objects.get(username="newdc")
        self.assertEqual((u.role, u.sub_role, u.created_by), ("member", "data_contributor", self.admin))

    def test_sub_role_admin_becomes_real_admin(self):
        self.login(self.superadmin)
        self.client.post("/api/v1/create-user-assign/", {"username": "a2", "password": PW, "sub_role": "admin"})
        self.assertEqual(User.objects.get(username="a2").role, "admin")

    def test_create_user_rejects_duplicates_and_missing_fields(self):
        self.login(self.admin)
        url = "/api/v1/create-user-assign/"
        self.assertEqual(self.client.post(url, {"username": "x", "password": PW}).status_code, 400)
        self.assertEqual(self.client.post(url, {"username": "viewer", "password": PW, "sub_role": "viewer"}).status_code, 400)
        self.assertEqual(
            self.client.post(url, {"username": "y", "email": "viewer@x.com", "password": PW, "sub_role": "viewer"}).status_code, 400
        )

    def test_members_cannot_create_or_edit_users(self):
        for sub, user in self.members.items():
            self.login(user)
            r = self.client.post("/api/v1/create-user-assign/", {"username": "z", "password": PW, "sub_role": "viewer"})
            self.assertEqual(r.status_code, 403, sub)
            self.assertEqual(self.client.get(f"/api/v1/users/{self.dc.id}/").status_code, 403, sub)
            self.assertEqual(self.client.delete(f"/api/v1/users/{self.dc.id}/").status_code, 403, sub)
        self.assertFalse(User.objects.filter(username="z").exists())

    def test_user_list_hides_superadmin(self):
        self.login(self.admin)
        names = {u["username"] for u in self.client.get("/api/v1/users/").data}
        self.assertNotIn("root", names)
        self.assertIn("boss", names)

    def test_admin_edits_user(self):
        self.login(self.admin)
        r = self.client.put(f"/api/v1/users/{self.dc.id}/", {"first_name": "Dee", "sub_role": "project_manager"})
        self.assertEqual(r.status_code, 200)
        self.dc.refresh_from_db()
        self.assertEqual((self.dc.first_name, self.dc.sub_role), ("Dee", "project_manager"))

    def test_delete_user_rules(self):
        self.login(self.admin)
        self.assertEqual(self.client.delete(f"/api/v1/users/{self.superadmin.id}/").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/v1/users/{self.admin.id}/").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/v1/users/{self.dc.id}/").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/v1/users/{self.dc.id}/").status_code, 404)

    def test_update_user_role_validates_role(self):
        self.login(self.admin)
        url = f"/api/v1/update-user-role/{self.dc.id}/"
        self.assertEqual(self.client.put(url, {}).status_code, 400)
        self.assertEqual(self.client.put(url, {"sub_role": "superadmin"}).status_code, 400)
        self.assertEqual(self.client.put(url, {"sub_role": "project_engineer"}).status_code, 200)
        self.dc.refresh_from_db()
        self.assertEqual(self.dc.sub_role, "project_engineer")

    def test_assign_and_remove_users(self):
        self.login(self.admin)
        eng = self.members["project_engineer"]
        body = {"project_id": self.project.id, "user_ids": [self.dc.id, eng.id]}
        self.assertEqual(self.client.post("/api/v1/assign-user/", body, format="json").status_code, 200)
        # Assigning twice does not duplicate.
        self.client.post("/api/v1/assign-user/", body, format="json")
        self.assertEqual(ProjectUser.objects.filter(project=self.project).count(), 2)

        r = self.client.post("/api/v1/remove-user/", {"project_id": self.project.id, "user_id": eng.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(list(ProjectUser.objects.values_list("user__username", flat=True)), ["data_contributor"])
        self.assertEqual(self.client.post("/api/v1/assign-user/", {"project_id": self.project.id}, format="json").status_code, 400)


# ── BIM / point-cloud uploads ────────────────────────────────────────────────
class DataUploadTests(ProjectsTestBase):
    def bim_url(self):
        return f"/api/v1/projects/{self.project.id}/bim/"

    def upload_bim(self, name="model.ifc", latest=True, date="2026-01-01"):
        return self.client.post(
            self.bim_url(), {"description": name, "date": date, "is_latest": latest, "file": ifc(name)}, format="multipart"
        )

    def test_unassigned_member_cannot_upload(self):
        self.login(self.dc)
        r = self.upload_bim()
        self.assertEqual(r.status_code, 403)
        self.assertFalse(BIMData.objects.exists())

    def test_assigned_member_and_admin_can_upload(self):
        self.assign(self.dc)
        self.login(self.dc)
        self.assertEqual(self.upload_bim("a.ifc").status_code, 200)
        self.login(self.admin)
        self.assertEqual(self.upload_bim("b.ifc").status_code, 200)
        self.assertEqual(BIMData.objects.count(), 2)

    def test_wrong_extension_is_rejected(self):
        self.login(self.admin)
        r = self.upload_bim("notes.txt")
        self.assertEqual(r.status_code, 400)
        self.assertIn("file", r.data)
        r = self.client.post(
            f"/api/v1/projects/{self.project.id}/pointcloud/",
            {"description": "x", "date": "2026-01-01", "file": ifc("scan.ifc")}, format="multipart",
        )
        self.assertEqual(r.status_code, 400)

    def test_new_latest_upload_clears_previous_latest(self):
        self.login(self.admin)
        first = self.upload_bim("a.ifc").data["id"]
        second = self.upload_bim("b.ifc").data["id"]
        self.assertFalse(BIMData.objects.get(id=first).is_latest)
        self.assertTrue(BIMData.objects.get(id=second).is_latest)
        # Latest version is listed first.
        self.assertEqual(self.client.get(self.bim_url()).data[0]["id"], second)

    def test_cannot_delete_only_bim_file(self):
        self.login(self.admin)
        only = self.upload_bim().data["id"]
        self.assertEqual(self.client.delete(f"/api/v1/bim/{only}/delete/").status_code, 400)
        self.assertEqual(self.client.delete("/api/v1/bim/999999/delete/").status_code, 404)

    def test_deleting_latest_promotes_newest_remaining(self):
        self.login(self.admin)
        old = self.upload_bim("old.ifc", latest=False, date="2026-01-01").data["id"]
        newer = self.upload_bim("newer.ifc", latest=False, date="2026-02-01").data["id"]
        latest = self.upload_bim("latest.ifc", latest=True, date="2026-03-01").data["id"]
        r = self.client.delete(f"/api/v1/bim/{latest}/delete/")
        self.assertEqual(r.data["promoted_latest_id"], newer)
        self.assertTrue(BIMData.objects.get(id=newer).is_latest)
        self.assertFalse(BIMData.objects.get(id=old).is_latest)

    def test_point_cloud_upload_and_delete(self):
        self.login(self.admin)
        url = f"/api/v1/projects/{self.project.id}/pointcloud/"
        ids = [
            self.client.post(url, {"description": n, "date": "2026-01-01", "is_latest": True, "file": las(n)},
                             format="multipart").data["id"]
            for n in ("a.las", "b.las")
        ]
        self.assertEqual(PointCloudData.objects.filter(is_latest=True).count(), 1)
        r = self.client.delete(f"/api/v1/pointcloud/{ids[1]}/delete/")
        self.assertEqual(r.data["promoted_latest_id"], ids[0])
        self.assertEqual(self.client.delete(f"/api/v1/pointcloud/{ids[0]}/delete/").status_code, 400)


class KnownPermissionGapTests(ProjectsTestBase):
    """Behaviour we WANT but the views don't enforce yet (they only check that
    the user is logged in). Marked expectedFailure; when a view is fixed the
    test reports "unexpected success" — remove the decorator then."""

    @unittest.expectedFailure
    def test_viewer_cannot_delete_project(self):
        self.login(self.members["viewer"])
        self.assertEqual(self.client.delete(f"/api/v1/projects/{self.project.id}/delete/").status_code, 403)

    @unittest.expectedFailure
    def test_viewer_cannot_rename_project(self):
        self.login(self.members["viewer"])
        r = self.client.patch(f"/api/v1/projects/{self.project.id}/", {"project_name": "x"}, format="json")
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_change_another_users_role(self):
        self.login(self.members["viewer"])
        r = self.client.put(f"/api/v1/update-user-role/{self.dc.id}/", {"sub_role": "project_manager"})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_assign_self_to_project(self):
        viewer = self.members["viewer"]
        self.login(viewer)
        r = self.client.post("/api/v1/assign-user/", {"project_id": self.project.id, "user_ids": [viewer.id]}, format="json")
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_create_accounts(self):
        self.login(self.members["viewer"])
        r = self.client.post("/api/v1/create-project-user/", {"username": "sneaky", "password": PW, "sub_role": "admin"})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_delete_bim(self):
        self.login(self.admin)
        ids = [self.client.post(f"/api/v1/projects/{self.project.id}/bim/",
                                {"description": n, "date": "2026-01-01", "file": ifc(n)}, format="multipart").data["id"]
               for n in ("a.ifc", "b.ifc")]
        self.login(self.members["viewer"])
        self.assertEqual(self.client.delete(f"/api/v1/bim/{ids[0]}/delete/").status_code, 403)
