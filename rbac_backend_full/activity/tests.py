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


# ── Added coverage: recorder helpers, middleware branches, view edge cases ───
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, TestCase
from rest_framework.request import Request
from rest_framework.response import Response

from .middleware import ActivityLogMiddleware, _response_name, _short
from .permissions import visible_logs
from .recorder import client_ip, describe, display_name, get_project, owner_admin_for


class RecorderHelperTests(TestCase):
    def test_client_ip_prefers_forwarded_for(self):
        rf = RequestFactory()
        self.assertEqual(client_ip(rf.get("/", HTTP_X_FORWARDED_FOR="10.0.0.1, 10.0.0.2")), "10.0.0.1")
        self.assertEqual(client_ip(rf.get("/", HTTP_X_FORWARDED_FOR=" ,x")), None)
        self.assertEqual(client_ip(rf.get("/", REMOTE_ADDR="1.2.3.4")), "1.2.3.4")
        self.assertIsNone(client_ip(rf.get("/", REMOTE_ADDR="")))

    def test_display_name_fallbacks(self):
        self.assertEqual(display_name(SimpleNamespace(project_name="P", username="u")), "P")
        self.assertEqual(display_name(SimpleNamespace(name="x" * 300)), "x" * 255)
        f = SimpleNamespace(name="dir/sub/file.ply")
        self.assertEqual(display_name(SimpleNamespace(file=f)), "file.ply")
        self.assertEqual(display_name(SimpleNamespace(file=None, image=SimpleNamespace(name="a/b.jpg"))), "b.jpg")
        self.assertEqual(display_name(SimpleNamespace(date=datetime.date(2026, 1, 2))), "2026-01-02")
        self.assertEqual(display_name(SimpleNamespace()), "")

    def test_get_project(self):
        p = Project.objects.create(project_name="P", description="", start=datetime.date(2026, 1, 1),
                                   end=datetime.date(2026, 2, 1))
        self.assertEqual(get_project(str(p.id)), p)
        for bad in (None, "", "abc", 999999):
            self.assertIsNone(get_project(bad))

    def test_owner_admin_for(self):
        admin = User.objects.create_user("a", "a@x.com", "p", role="admin")
        sub_admin = User.objects.create_user("a2", "a2@x.com", "p", role="member", sub_role="admin")
        su = User.objects.create_user("s", "s@x.com", "p", role="superadmin")
        mine = User.objects.create_user("m", "m@x.com", "p", role="member", sub_role="viewer", created_by=admin)
        by_su = User.objects.create_user("n", "n@x.com", "p", role="member", sub_role="viewer", created_by=su)
        self.assertIsNone(owner_admin_for(None))
        self.assertEqual(owner_admin_for(admin), admin)
        self.assertEqual(owner_admin_for(sub_admin), sub_admin)
        self.assertEqual(owner_admin_for(mine), admin)
        self.assertIsNone(owner_admin_for(by_su))
        self.assertIsNone(owner_admin_for(su))

    def test_describe(self):
        self.assertEqual(describe("upload", "BIM file", "a.ifc", "Tower"), 'Uploaded BIM file "a.ifc" in project "Tower"')
        self.assertEqual(describe("delete", "project", "Tower", "Tower"), 'Deleted project "Tower"')
        self.assertEqual(describe("weird", "thing"), "Changed thing")
        self.assertEqual(len(describe("create", "x", "n" * 600)), 500)

    def test_record_truncates_and_takes_project_name(self):
        p = Project.objects.create(project_name="Proj", description="", start=datetime.date(2026, 1, 1),
                                   end=datetime.date(2026, 2, 1))
        rf = RequestFactory()
        req = rf.post("/api/v1/x/", REMOTE_ADDR="9.9.9.9")
        log = record(action="other", description="d" * 600, request=req, project=p,
                     target_type="t" * 60, target_id="1" * 70, target_name="n" * 300, username="u" * 200)
        self.assertEqual(log.project_name, "Proj")
        self.assertEqual((len(log.description), len(log.target_type), len(log.target_id), len(log.target_name)),
                         (500, 50, 64, 255))
        self.assertEqual(len(log.username), 150)
        self.assertEqual((log.method, log.path, log.ip_address), ("POST", "/api/v1/x/", "9.9.9.9"))
        self.assertEqual(log.details, {})
        self.assertIn(": " + "d" * 10, str(log))

    def test_record_drops_anonymous_user(self):
        from django.contrib.auth.models import AnonymousUser
        log = record(action="other", description="d", user=AnonymousUser(), username="anon")
        self.assertIsNone(log.user)
        self.assertEqual((log.username, log.user_role), ("anon", ""))


class MiddlewareUnitTests(TestCase):
    """Drives ActivityLogMiddleware with a fake view so each branch is reached."""

    def setUp(self):
        self.rf = RequestFactory()
        self.admin = User.objects.create_user("boss", "boss@x.com", "p", role="admin")
        self.user = User.objects.create_user("eng", "eng@x.com", "p", role="member",
                                             sub_role="project_engineer", created_by=self.admin)
        self.project = Project.objects.create(project_name="Tower", description="",
                                              start=datetime.date(2026, 1, 1), end=datetime.date(2026, 2, 1))

    def _call(self, method, path, data=None, resp_data=None, status=200, user=None, query=""):
        req = getattr(self.rf, method.lower())(path + query)
        drf = Request(req)
        drf._full_data = data if data is not None else {}
        drf._user = user or self.user
        drf._request.user = user or self.user

        def view(_request):
            r = Response(resp_data, status=status)
            r.renderer_context = {"request": drf}
            return r

        return ActivityLogMiddleware(view)(req)

    def test_unknown_route_is_logged_generically(self):
        self._call("POST", "/api/v1/something-new/")
        log = ActivityLog.objects.get()
        self.assertEqual((log.action, log.description), ("other", "POST /api/v1/something-new/"))

    def test_unknown_route_without_user_is_not_logged(self):
        from django.contrib.auth.models import AnonymousUser
        self._call("POST", "/api/v1/something-new/", user=AnonymousUser())
        self.assertFalse(ActivityLog.objects.exists())

    def test_reads_non_api_and_skipped_paths_are_ignored(self):
        self._call("GET", "/api/v1/create-project/")
        self._call("POST", "/admin/whatever/")
        self._call("POST", "/api/v1/auth/check-username/")
        self._call("POST", "/api/v1/activity/bulk-delete/")
        self.assertFalse(ActivityLog.objects.exists())

    def test_twin_signup_route_is_normalized(self):
        self._call("POST", "/api/v1/auth/signup/create-member/", data={"username": "zed"})
        log = ActivityLog.objects.get()
        self.assertEqual((log.target_type, log.target_name), ("user", "zed"))

    def test_photo_batch_delete_and_list_count(self):
        self._call("DELETE", f"/api/v1/projects/{self.project.id}/images/", query="?batch_name=Day1",
                   resp_data=[1, 2, 3])
        log = ActivityLog.objects.get()
        self.assertEqual(log.target_name, "Day1")
        self.assertEqual(log.details["count"], 3)
        self.assertEqual(log.project, self.project)

    def test_schedule_activities_count(self):
        self._call("PUT", f"/api/v1/projects/{self.project.id}/schedule/",
                   data={"file_name": "plan.xml", "activities": [{}, {}]})
        log = ActivityLog.objects.get()
        self.assertEqual(log.details["activities"], 2)
        self.assertEqual(log.target_name, "plan.xml")

    def test_assign_and_remove_user_names(self):
        self._call("POST", "/api/v1/assign-user/",
                   data={"project_id": self.project.id, "user_ids": [self.user.id, self.admin.id]})
        self._call("POST", "/api/v1/remove-user/", data={"project_id": self.project.id, "user_id": self.user.id})
        assign = ActivityLog.objects.get(action="assign")
        self.assertEqual(set(assign.target_name.split(", ")), {"eng", "boss"})
        self.assertEqual(assign.project, self.project)
        remove = ActivityLog.objects.get(action="unassign")
        self.assertEqual((remove.target_name, remove.details["user_id"]), ("eng", self.user.id))

    def test_name_from_response(self):
        self._call("POST", f"/api/v1/projects/{self.project.id}/bim/",
                   resp_data={"file": "/media/bim/model.ifc", "id": 7})
        log = ActivityLog.objects.get()
        self.assertEqual((log.target_name, log.target_id), ("model.ifc", "7"))

    def test_response_name_helper(self):
        self.assertEqual(_response_name([1]), "")
        self.assertEqual(_response_name({"description": "D", "file": "x/y"}), "D")
        self.assertEqual(_response_name({"file": "x/y.las"}), "y.las")
        self.assertEqual(_response_name({}), "")

    def test_short_helper(self):
        self.assertEqual(_short(None), "—")
        self.assertEqual(_short(""), "—")
        self.assertEqual(_short("a" * 50), "a" * 37 + "...")

    def test_snapshot_failure_does_not_break_request(self):
        with mock.patch.object(ActivityLogMiddleware, "_snapshot", side_effect=RuntimeError("x")), \
                self.assertLogs("activity.middleware", "ERROR"):
            resp = self._call("DELETE", f"/api/v1/projects/{self.project.id}/delete/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ActivityLog.objects.get().action, "delete")

    def test_log_failure_does_not_break_request(self):
        with mock.patch("activity.middleware.record", side_effect=RuntimeError("db down")), \
                self.assertLogs("activity.middleware", "ERROR"):
            resp = self._call("POST", "/api/v1/create-project/", data={"project_name": "X"})
        self.assertEqual(resp.status_code, 200)

    def test_snapshot_of_missing_object(self):
        self._call("DELETE", "/api/v1/bim/999999/delete/")
        log = ActivityLog.objects.get()
        self.assertEqual((log.target_name, log.target_id), ("", "999999"))

    def test_update_without_changes_has_no_change_details(self):
        self._call("PUT", f"/api/v1/projects/{self.project.id}/")
        log = ActivityLog.objects.get()
        self.assertNotIn("changes", log.details)
        self.assertEqual(log.description, 'Updated project "Tower"')

    def test_login_for_vanished_user_is_skipped(self):
        self._call("POST", "/api/v1/auth/login/", resp_data={"user": {"id": 999999}})
        self.assertFalse(ActivityLog.objects.exists())

    def test_failed_login_without_username(self):
        self._call("POST", "/api/v1/auth/custom-login/", status=400, resp_data={"error": "x"})
        log = ActivityLog.objects.get()
        self.assertEqual((log.action, log.description), ("login_failed", "Failed login attempt"))

    def test_login_500_is_not_logged(self):
        self._call("POST", "/api/v1/auth/login/", status=500, data={"username": "x"})
        self.assertFalse(ActivityLog.objects.exists())


class ActivityViewEdgeTests(APITestCase):
    # Reuse the fixtures without re-running ActivityLogTests' own tests.
    setUp = ActivityLogTests.setUp
    _log = ActivityLogTests._log

    def test_list_requires_login(self):
        self.assertEqual(self.client.get("/api/v1/activity/").status_code, 401)

    def test_visible_logs_for_non_viewer_is_empty(self):
        self._log(self.engineer)
        self.assertFalse(visible_logs(self.engineer).exists())

    def test_more_filters(self):
        record(action="upload", description="a", user=self.data_user, project=self.project, target_type="BIM file")
        record(action="upload", description="b", user=self.data_user, target_type="photo")
        self.client.force_authenticate(self.superadmin)

        def count(**p):
            return self.client.get("/api/v1/activity/", p).data["count"]

        self.assertEqual(count(target_type="BIM file"), 1)
        self.assertEqual(count(project=self.project.id), 1)
        self.assertEqual(count(date_from="2000-01-01T00:00:00Z"), 2)
        self.assertEqual(count(date_to="2000-01-01T00:00:00Z"), 0)
        self.assertEqual(count(date_from="not-a-date"), 2)
        self.assertEqual(count(owner_admin="x"), 2)  # unparsable -> ignored

    def test_pagination_clamps(self):
        for i in range(5):
            self._log(self.data_user, f"e{i}")
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/v1/activity/", {"page_size": 2, "page": 99}).data
        self.assertEqual((r["page"], r["page_size"], r["total_pages"], len(r["results"])), (3, 2, 3, 1))
        r = self.client.get("/api/v1/activity/", {"page_size": 0, "page": "x"}).data
        self.assertEqual((r["page"], r["page_size"]), (1, 1))
        r = self.client.get("/api/v1/activity/", {"page_size": 10000}).data
        self.assertEqual(r["page_size"], 200)
        self.assertTrue(r["can_edit"])

    def test_detail_get_and_delete(self):
        log = self._log(self.engineer, "visible")
        self.client.force_authenticate(self.admin)
        r = self.client.get(f"/api/v1/activity/{log.id}/")
        self.assertEqual((r.status_code, r.data["description"]), (200, "visible"))
        self.assertEqual(self.client.get("/api/v1/activity/999999/").status_code, 404)
        r = self.client.delete(f"/api/v1/activity/{log.id}/")
        self.assertEqual(r.data, {"deleted": 1})
        self.assertFalse(ActivityLog.objects.filter(pk=log.id).exists())
        trace = ActivityLog.objects.get(target_type="activity log")
        self.assertEqual((trace.description, trace.target_name), ("Deleted 1 activity log entry", "visible"))

    def test_bulk_delete_validation(self):
        self.client.force_authenticate(self.superadmin)
        for body in ({}, {"ids": []}, {"ids": "1,2"}):
            r = self.client.post("/api/v1/activity/bulk-delete/", body, format="json")
            self.assertEqual((r.status_code, r.data["error"]), (400, "ids must be a non-empty list"))
        r = self.client.post("/api/v1/activity/bulk-delete/", {"ids": ["abc", 999999]}, format="json")
        self.assertEqual(r.data, {"deleted": 0})

    def test_patch_validation_and_superadmin_edit(self):
        log = self._log(self.admin)
        self.client.force_authenticate(self.superadmin)
        r = self.client.patch(f"/api/v1/activity/{log.id}/", {"description": ""}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("description", r.data)
        r = self.client.patch(f"/api/v1/activity/{log.id}/", {"description": "fixed"}, format="json")
        self.assertEqual((r.data["description"], r.data["edited_by_username"]), ("fixed", "root"))

    def test_export_shape(self):
        log = self._log(self.data_user, "x")
        log.edited_by = self.admin
        log.edited_at = log.created_at
        log.ip_address = "1.1.1.1"
        log.save()
        self.client.force_authenticate(self.admin)
        res = self.client.get("/api/v1/activity/export/")
        self.assertEqual(res["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("attachment; filename=\"activity_log_", res["Content-Disposition"])
        lines = res.content.decode("utf-8-sig").splitlines()
        self.assertTrue(lines[0].startswith("ID,Date & time (UTC),User"))
        self.assertTrue(lines[1].endswith(",1.1.1.1," + log.created_at.strftime("%Y-%m-%d %H:%M:%S") + ",boss"))

    def test_filters_view_shape(self):
        record(action="upload", description="a", user=self.data_user, project=self.project, target_type="BIM file")
        self.client.force_authenticate(self.superadmin)
        r = self.client.get("/api/v1/activity/filters/").data
        self.assertEqual(r["users"], [{"id": self.data_user.id, "username": "dc"}])
        self.assertEqual(r["projects"], [{"id": self.project.id, "name": "Tower A"}])
        self.assertEqual(r["target_types"], ["BIM file"])
        self.assertIn({"value": "login_failed", "label": "Failed login"}, r["actions"])

    def test_admins_view_last_activity(self):
        self._log(self.data_user)
        self.client.force_authenticate(self.superadmin)
        data = self.client.get("/api/v1/activity/admins/").data
        boss = next(a for a in data["admins"] if a["username"] == "boss")
        self.assertIsNotNone(boss["last_activity"])
        boss2 = next(a for a in data["admins"] if a["username"] == "boss2")
        self.assertIsNone(boss2["last_activity"])
        dc = next(u for u in boss["users"] if u["username"] == "dc")
        self.assertEqual((dc["log_count"], dc["role"]), (1, "data_contributor"))
