import datetime

from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from accounts.models import User
from projects.models import BIMData, Project

from .models import ActivityLog
from .recorder import record


class ActivityLogTests(APITestCase):
    def setUp(self):
        self.superadmin = User.objects.create_user("root", "root@x.com", "Passw0rd!", role="superadmin")
        self.admin = User.objects.create_user("boss", "boss@x.com", "Passw0rd!", role="admin")
        self.admin2 = User.objects.create_user("boss2", "boss2@x.com", "Passw0rd!", role="admin")
        self.data_user = User.objects.create_user(
            "dc", "dc@x.com", "Passw0rd!", role="member", sub_role="data_contributor", created_by=self.admin
        )
        self.engineer = User.objects.create_user(
            "eng", "eng@x.com", "Passw0rd!", role="member", sub_role="project_engineer", created_by=self.admin
        )
        self.other_team = User.objects.create_user(
            "pm2", "pm2@x.com", "Passw0rd!", role="member", sub_role="project_manager", created_by=self.admin2
        )
        self.orphan = User.objects.create_user(
            "old", "old@x.com", "Passw0rd!", role="member", sub_role="project_engineer"
        )
        self.project = Project.objects.create(
            project_name="Tower A", description="", start=datetime.date(2026, 1, 1), end=datetime.date(2026, 12, 31)
        )

    def _bim(self, name="a.ifc"):
        return BIMData.objects.create(
            project=self.project, description=name, date=datetime.date(2026, 1, 1),
            file=SimpleUploadedFile(name, b"ISO-10303-21;"),
        )

    # ── recording ────────────────────────────────────────────────────────────
    def test_create_project_is_logged_with_project_link(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post("/api/v1/create-project/", {
            "project_name": "Bridge", "description": "d", "start": "2026-01-01", "end": "2026-02-01",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        log = ActivityLog.objects.get(action="create")
        self.assertEqual(log.username, "boss")
        self.assertEqual(log.user_role, "admin")
        self.assertEqual(log.project.project_name, "Bridge")
        self.assertEqual(log.description, 'Created project "Bridge"')

    def test_role_change_records_old_and_new_value(self):
        self.client.force_authenticate(self.admin)
        res = self.client.put(f"/api/v1/update-user-role/{self.engineer.id}/",
                              {"sub_role": "project_manager"}, format="json")
        self.assertEqual(res.status_code, 200)
        log = ActivityLog.objects.get(target_type="user role")
        self.assertEqual(log.details["changes"]["sub_role"], ["project_engineer", "project_manager"])
        self.assertIn("project_engineer → project_manager", log.description)

    def test_delete_still_names_deleted_file_and_project(self):
        self._bim("keep.ifc")
        doomed = self._bim("old.ifc")
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f"/api/v1/bim/{doomed.id}/delete/")
        self.assertEqual(res.status_code, 200, res.data)
        log = ActivityLog.objects.get(action="delete")
        self.assertEqual(log.target_name, "old.ifc")
        self.assertEqual(log.project, self.project)
        self.assertEqual(log.description, 'Deleted BIM file "old.ifc" in project "Tower A"')

    def test_deleting_project_keeps_its_name(self):
        self.client.force_authenticate(self.admin)
        self.client.delete(f"/api/v1/projects/{self.project.id}/delete/")
        log = ActivityLog.objects.get(action="delete")
        self.assertIsNone(log.project)
        self.assertEqual(log.project_name, "Tower A")

    def test_failed_requests_and_reads_are_not_logged(self):
        self.client.force_authenticate(self.admin)
        self.client.get("/api/v1/projects/")
        self.client.post("/api/v1/create-project/", {"project_name": ""}, format="json")  # 400
        self.assertFalse(ActivityLog.objects.exists())

    def test_login_success_and_failure(self):
        self.client.post("/api/v1/auth/login/", {"username": "boss", "password": "Passw0rd!"}, format="json")
        self.client.post("/api/v1/auth/login/", {"username": "boss", "password": "wrong"}, format="json")
        ok = ActivityLog.objects.get(action="login")
        bad = ActivityLog.objects.get(action="login_failed")
        self.assertEqual(ok.user, self.admin)
        self.assertIsNone(bad.user)
        self.assertEqual(bad.username, "boss")
        self.assertNotIn("wrong", str(bad.details) + bad.description)

    # ── permissions ──────────────────────────────────────────────────────────
    def _log(self, user, description="d"):
        return record(action="other", description=description, user=user)

    def test_new_users_record_their_creator(self):
        self.client.force_authenticate(self.admin2)
        self.client.post("/api/v1/create-user-assign/", {
            "username": "new", "password": "Passw0rd!", "sub_role": "data_contributor",
        }, format="json")
        self.assertEqual(User.objects.get(username="new").created_by, self.admin2)

    def test_sub_roles_have_no_access(self):
        log = self._log(self.engineer)
        for user in (self.data_user, self.engineer):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get("/api/v1/activity/").status_code, 403)
            self.assertEqual(self.client.get("/api/v1/activity/filters/").status_code, 403)
            self.assertEqual(self.client.get("/api/v1/activity/export/").status_code, 403)
            self.assertEqual(self.client.get("/api/v1/activity/admins/").status_code, 403)
            self.assertEqual(self.client.patch(f"/api/v1/activity/{log.id}/", {"note": "n"}, format="json").status_code, 403)
            self.assertEqual(self.client.delete(f"/api/v1/activity/{log.id}/").status_code, 403)

    def test_admin_sees_only_their_own_users_activity(self):
        self._log(self.data_user, "my dc")
        self._log(self.engineer, "my eng")
        self._log(self.other_team, "other team")
        self._log(self.orphan, "orphan")
        self._log(self.admin, "admin did it")
        self._log(self.admin2, "admin2 did it")
        self._log(self.superadmin, "root did it")
        self._log(None, "unknown failed login")
        self.client.force_authenticate(self.admin)
        res = self.client.get("/api/v1/activity/")
        self.assertEqual({r["description"] for r in res.data["results"]}, {"my dc", "my eng"})
        body = self.client.get("/api/v1/activity/export/").content.decode("utf-8-sig")
        self.assertNotIn("other team", body)
        self.assertEqual(self.client.get("/api/v1/activity/admins/").status_code, 403)

    def test_entries_stay_with_admin_after_user_deleted(self):
        self._log(self.engineer, "before delete")
        self.engineer.delete()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/v1/activity/").data["count"], 1)

    def test_superadmin_sees_everything(self):
        for user in (self.data_user, self.admin, self.superadmin, None):
            self._log(user)
        self.client.force_authenticate(self.superadmin)
        self.assertEqual(self.client.get("/api/v1/activity/").data["count"], 4)

    def test_superadmin_per_admin_scopes(self):
        self._log(self.data_user, "my dc")
        self._log(self.other_team, "other team")
        self._log(self.orphan, "orphan")
        self._log(self.admin, "admin did it")
        self.client.force_authenticate(self.superadmin)

        def descs(**params):
            return {r["description"] for r in self.client.get("/api/v1/activity/", params).data["results"]}

        self.assertEqual(descs(owner_admin=self.admin.id), {"my dc"})
        self.assertEqual(descs(owner_admin=self.admin2.id), {"other team"})
        self.assertEqual(descs(user=self.admin.id), {"admin did it"})
        self.assertEqual(descs(unlinked=1), {"orphan"})

        res = self.client.get("/api/v1/activity/admins/").data
        by_name = {a["username"]: a for a in res["admins"]}
        self.assertEqual({u["username"] for u in by_name["boss"]["users"]}, {"dc", "eng"})
        self.assertEqual(by_name["boss"]["own_log_count"], 1)
        self.assertEqual(by_name["boss"]["users_log_count"], 1)
        self.assertEqual({u["username"] for u in res["unlinked"]["users"]}, {"old"})
        self.assertEqual(res["unlinked"]["log_count"], 1)

        filters = self.client.get("/api/v1/activity/filters/", {"owner_admin": self.admin.id}).data
        self.assertEqual({u["username"] for u in filters["users"]}, {"dc"})

    def test_admin_can_edit_and_delete_own_users_logs_only(self):
        mine = self._log(self.engineer)
        theirs = self._log(self.other_team)
        own = self._log(self.admin)
        self.client.force_authenticate(self.admin)

        res = self.client.patch(f"/api/v1/activity/{mine.id}/", {"note": "checked", "action": "delete"}, format="json")
        self.assertEqual(res.status_code, 200)
        mine.refresh_from_db()
        self.assertEqual(mine.note, "checked")
        self.assertEqual(mine.action, "other")  # core fields stay read-only
        self.assertEqual(mine.edited_by, self.admin)

        for log in (theirs, own):
            self.assertEqual(self.client.patch(f"/api/v1/activity/{log.id}/", {"note": "x"}, format="json").status_code, 404)
            self.assertEqual(self.client.delete(f"/api/v1/activity/{log.id}/").status_code, 404)
        res = self.client.post("/api/v1/activity/bulk-delete/", {"ids": [theirs.id, own.id]}, format="json")
        self.assertEqual(res.data["deleted"], 0)

    def test_admin_deletion_trace_is_visible_to_superadmin_only(self):
        a = self._log(self.data_user, "one")
        b = self._log(self.engineer, "two")
        self.client.force_authenticate(self.admin)
        res = self.client.post("/api/v1/activity/bulk-delete/", {"ids": [a.id, b.id]}, format="json")
        self.assertEqual(res.data["deleted"], 2)
        self.assertEqual(self.client.get("/api/v1/activity/").data["count"], 0)

        self.client.force_authenticate(self.superadmin)
        trace = self.client.get("/api/v1/activity/").data["results"][0]
        self.assertEqual(trace["target_type"], "activity log")
        self.assertEqual(trace["username"], "boss")
        self.assertEqual({d["description"] for d in trace["details"]["deleted"]}, {"one", "two"})

    def test_filters_and_export(self):
        record(action="upload", description="Uploaded BIM", user=self.data_user)
        record(action="delete", description="Deleted photo", user=self.engineer)
        self.client.force_authenticate(self.admin)
        res = self.client.get("/api/v1/activity/", {"action": "upload"})
        self.assertEqual(res.data["count"], 1)
        res = self.client.get("/api/v1/activity/", {"search": "photo"})
        self.assertEqual(res.data["results"][0]["username"], "eng")
        csv_res = self.client.get("/api/v1/activity/export/")
        body = csv_res.content.decode("utf-8-sig")
        self.assertIn("Uploaded BIM", body)
        self.assertIn("Deleted photo", body)
