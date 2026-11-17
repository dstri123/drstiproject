import datetime
import io
import json
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from accounts.models import User
from projects.models import BIMData, Project, ProjectUser

from .models import Issue

MEDIA = tempfile.mkdtemp()


def _image(fmt="PNG", name="snap.png"):
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), (200, 30, 30)).save(buf, format=fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=f"image/{fmt.lower()}")


@override_settings(MEDIA_ROOT=MEDIA)
class IssueTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.member = User.objects.create_user("eng", "eng@x.com", "Passw0rd!", role="member",
                                               first_name="Ena")
        self.mate = User.objects.create_user("pm", "pm@x.com", "Passw0rd!", role="member")
        self.outsider = User.objects.create_user("out", "out@x.com", "Passw0rd!", role="member")
        self.project = Project.objects.create(
            project_name="Tower A", description="", start=datetime.date(2026, 1, 1),
            end=datetime.date(2026, 12, 31))
        ProjectUser.objects.create(user=self.member, project=self.project)
        ProjectUser.objects.create(user=self.mate, project=self.project)
        self.bim = BIMData.objects.create(
            project=self.project, description="model", date=datetime.date(2026, 3, 1),
            file=SimpleUploadedFile("tower.ifc", b"ISO-10303-21;"))
        self.url = f"/api/v1/issues/project/{self.project.id}/"

    def _create(self, **extra):
        data = {
            "title": "Missing fire stopping",
            "description": "Penetration through slab not sealed",
            "status": "open", "priority": "high",
            "assignee": self.mate.id, "due_date": "2026-11-20",
            "bim": self.bim.id,
            "element_express_id": 1234, "element_global_id": "2O2Fr$t4X7Zf8NOew3FLOH",
            "element_type": "IFCSLAB",
            "position": json.dumps([1.5, 2.0, 3.25]),
            "viewpoint": json.dumps({"position": [10, 10, 5], "direction": [-0.7, -0.7, 0],
                                     "up": [0, 0, 1], "fov": 50}),
            "snapshot": _image(),
            "photo": _image("JPEG", "site.jpg"),
            **extra,
        }
        return self.client.post(self.url, data, format="multipart")

    def test_create_numbers_per_project_and_lists(self):
        self.client.force_authenticate(self.member)
        first = self._create()
        self.assertEqual(first.status_code, 201, first.data)
        second = self._create(title="Second")
        self.assertEqual((first.data["number"], second.data["number"]), (1, 2))
        self.assertEqual(first.data["position"], [1.5, 2.0, 3.25])
        self.assertEqual(first.data["assignee_name"], "pm")
        self.assertTrue(first.data["photo"].startswith("http"))

        listed = self.client.get(self.url + "?status=open").data
        self.assertEqual([i["number"] for i in listed], [2, 1])

    def test_outsiders_and_bad_input_are_rejected(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, 403)

        self.client.force_authenticate(self.member)
        res = self._create(assignee=self.outsider.id)
        self.assertEqual(res.status_code, 400)
        self.assertIn("assignee", res.data)
        res = self._create(position=json.dumps([1, 2]))
        self.assertIn("position", res.data)

    def test_update_status_and_delete_rules(self):
        self.client.force_authenticate(self.member)
        issue_id = self._create().data["id"]
        res = self.client.patch(f"/api/v1/issues/{issue_id}/",
                                {"status": "resolved", "clear_photo": True}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["status_label"], "Resolved")
        self.assertIsNone(res.data["photo"])

        self.client.force_authenticate(self.mate)
        self.assertEqual(self.client.delete(f"/api/v1/issues/{issue_id}/").status_code, 403)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.delete(f"/api/v1/issues/{issue_id}/").status_code, 204)
        self.assertFalse(Issue.objects.exists())

    def test_assignees_are_project_members(self):
        self.client.force_authenticate(self.member)
        names = {u["name"] for u in self.client.get(self.url + "assignees/").data}
        self.assertEqual(names, {"Ena", "pm"})

    def test_bcf_export(self):
        self.client.force_authenticate(self.member)
        issue = self._create().data
        res = self.client.get(self.url + "bcf/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("tower-a-issues.bcfzip", res["Content-Disposition"])

        z = zipfile.ZipFile(io.BytesIO(res.content))
        guid = issue["guid"]
        self.assertEqual(set(z.namelist()), {
            "bcf.version", "project.bcfp", "extensions.xsd",
            f"{guid}/markup.bcf", f"{guid}/viewpoint.bcfv", f"{guid}/snapshot.png",
            f"{guid}/photo.bcfv", f"{guid}/photo.jpg",
        })
        version = ET.fromstring(z.read("bcf.version"))
        self.assertEqual(version.get("VersionId"), "2.1")

        topic = ET.fromstring(z.read(f"{guid}/markup.bcf")).find("Topic")
        self.assertEqual(topic.get("Guid"), guid)
        self.assertEqual(topic.get("TopicStatus"), "Open")
        self.assertEqual(topic.findtext("Title"), "Missing fire stopping")
        self.assertEqual(topic.findtext("Priority"), "High")
        self.assertEqual(topic.findtext("AssignedTo"), "pm@x.com")
        self.assertEqual(topic.findtext("DueDate"), "2026-11-20T00:00:00")
        # Schema order matters to strict importers.
        tags = [c.tag for c in topic]
        self.assertLess(tags.index("Title"), tags.index("CreationDate"))
        self.assertLess(tags.index("AssignedTo"), tags.index("Description"))

        vp = ET.fromstring(z.read(f"{guid}/viewpoint.bcfv"))
        self.assertEqual(vp.find("Components/Selection/Component").get("IfcGuid"),
                         "2O2Fr$t4X7Zf8NOew3FLOH")
        cam = vp.find("PerspectiveCamera")
        self.assertEqual(float(cam.findtext("CameraViewPoint/Z")), 5.0)
        self.assertEqual(float(cam.findtext("FieldOfView")), 50.0)

        # Re-export keeps the same viewpoint GUIDs (importers update, not duplicate).
        again = zipfile.ZipFile(io.BytesIO(self.client.get(self.url + "bcf/").content))
        self.assertEqual(z.read(f"{guid}/viewpoint.bcfv"), again.read(f"{guid}/viewpoint.bcfv"))


# ── Added coverage: filters, permissions, validation, BCF edge cases ─────────
import os
from types import SimpleNamespace
from unittest import mock

from django.db import IntegrityError
from rest_framework.test import APIRequestFactory

from . import bcf
from .serializers import IssueSerializer, JSONInputField, _user_label
from .views import _resolve_global_ids


@override_settings(MEDIA_ROOT=MEDIA)
class IssueEdgeTests(APITestCase):
    setUp = IssueTests.setUp
    _create = IssueTests._create

    def _quick(self, **kw):
        data = {"project": self.project, "number": Issue.objects.filter(project=self.project).count() + 1,
                "title": "t", "position": [0, 0, 0], "created_by": self.member, **kw}
        return Issue.objects.create(**data)

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/issues/1/").status_code, 401)

    def test_missing_project_and_issue_are_404(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get("/api/v1/issues/project/999999/").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/issues/999999/").status_code, 404)

    def test_outsider_is_denied_everywhere(self):
        issue = self._quick()
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.post(self.url, {"title": "x", "position": [1, 2, 3]}, format="json").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v1/issues/{issue.id}/").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/v1/issues/{issue.id}/", {"title": "y"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/v1/issues/{issue.id}/").status_code, 403)
        self.assertEqual(self.client.get(self.url + "assignees/").status_code, 403)
        self.assertEqual(self.client.get(self.url + "bcf/").status_code, 403)
        self.assertTrue(Issue.objects.filter(pk=issue.pk).exists())

    def test_admin_without_assignment_has_access_and_can_delete(self):
        issue = self._quick()
        admin = User.objects.create_user("adm", "adm@x.com", "Passw0rd!", role="admin")
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.get(f"/api/v1/issues/{issue.id}/").data["title"], "t")
        self.assertEqual(self.client.delete(f"/api/v1/issues/{issue.id}/").status_code, 204)

    def test_json_create_minimal_defaults(self):
        self.client.force_authenticate(self.member)
        r = self.client.post(self.url, {"title": "Crack", "position": [1, 2, 3]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["status"], r.data["priority"], r.data["number"]), ("open", "normal", 1))
        self.assertEqual(r.data["created_by_name"], "Ena")
        self.assertIsNone(r.data["assignee_name"])
        self.assertIsNone(r.data["viewpoint"])
        issue = Issue.objects.get()
        self.assertEqual((issue.created_by, issue.updated_by), (self.member, self.member))
        self.assertEqual(str(issue), "#1 Crack")

    def test_create_validation_errors(self):
        self.client.force_authenticate(self.member)
        cases = [
            ({"position": [1, 2, 3]}, "title"),
            ({"title": "x"}, "position"),
            ({"title": "x", "position": "not json"}, "position"),
            ({"title": "x", "position": [1, "a", 3]}, "position"),
            ({"title": "x", "position": [1, 2, 3], "viewpoint": [1]}, "viewpoint"),
            ({"title": "x", "position": [1, 2, 3], "viewpoint": {"position": [1, 2, 3]}}, "viewpoint"),
            ({"title": "x", "position": [1, 2, 3],
              "viewpoint": {"position": [1, 2, 3], "direction": [0, 0, 1], "fov": 0}}, "viewpoint"),
            ({"title": "x", "position": [1, 2, 3],
              "viewpoint": {"position": [1, 2, 3], "direction": [0, 0, 1], "fov": "wide"}}, "viewpoint"),
            ({"title": "x", "position": [1, 2, 3], "status": "nope"}, "status"),
        ]
        for body, field in cases:
            r = self.client.post(self.url, body, format="json")
            self.assertEqual(r.status_code, 400, body)
            self.assertIn(field, r.data, body)
        self.assertFalse(Issue.objects.exists())

    def test_viewpoint_defaults_up_and_fov(self):
        self.client.force_authenticate(self.member)
        r = self.client.post(self.url, {"title": "x", "position": [1, 2, 3],
                                        "viewpoint": {"position": [1, 2, 3], "direction": [0, 1, 0]}}, format="json")
        self.assertEqual(r.data["viewpoint"], {"position": [1.0, 2.0, 3.0], "direction": [0.0, 1.0, 0.0],
                                               "up": [0.0, 0.0, 1.0], "fov": 60.0})
        r = self.client.post(self.url, {"title": "y", "position": [1, 2, 3], "viewpoint": None}, format="json")
        self.assertEqual(r.status_code, 201)

    def test_bim_from_other_project_is_rejected(self):
        other = Project.objects.create(project_name="B", description="", start=datetime.date(2026, 1, 1),
                                       end=datetime.date(2026, 2, 1))
        foreign = BIMData.objects.create(project=other, description="m", date=datetime.date(2026, 1, 1),
                                         file=SimpleUploadedFile("b.ifc", b"x"))
        self.client.force_authenticate(self.member)
        r = self.client.post(self.url, {"title": "x", "position": [1, 2, 3], "bim": foreign.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(str(r.data["bim"][0]), "BIM file belongs to another project.")

    def test_numbering_retries_and_gives_up_with_409(self):
        self.client.force_authenticate(self.member)
        with mock.patch.object(IssueSerializer, "save", side_effect=IntegrityError("dup")) as save:
            r = self.client.post(self.url, {"title": "x", "position": [1, 2, 3]}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(save.call_count, 3)

    def test_numbering_succeeds_after_one_collision(self):
        self.client.force_authenticate(self.member)
        real = IssueSerializer.save
        calls = []

        def flaky(ser, **kw):
            calls.append(1)
            if len(calls) == 1:
                raise IntegrityError("dup")
            return real(ser, **kw)

        with mock.patch.object(IssueSerializer, "save", flaky):
            r = self.client.post(self.url, {"title": "x", "position": [1, 2, 3]}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(calls), 2)

    def test_filters(self):
        a = self._quick(assignee=self.member, status="open")
        b = self._quick(assignee=self.mate, status="resolved", bim=self.bim)
        self.client.force_authenticate(self.member)

        def ids(q):
            return {i["id"] for i in self.client.get(self.url + q).data}

        self.assertEqual(ids("?assignee=me"), {a.id})
        self.assertEqual(ids(f"?assignee={self.mate.id}"), {b.id})
        self.assertEqual(ids(f"?bim={self.bim.id}"), {b.id})
        self.assertEqual(ids(f"?ids={a.id},x,{b.id}"), {a.id, b.id})  # non-numeric ids are dropped
        self.assertEqual(ids("?ids=x"), set())
        self.assertEqual(ids(f"?ids={a.id},{b.id}"), {a.id, b.id})
        self.assertEqual(ids("?status=open,resolved"), {a.id, b.id})
        self.assertEqual(ids("?status=closed"), set())

    def test_patch_validation_and_updated_by(self):
        issue = self._quick()
        self.client.force_authenticate(self.mate)
        r = self.client.patch(f"/api/v1/issues/{issue.id}/", {"position": [1]}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"/api/v1/issues/{issue.id}/", {"assignee": self.outsider.id}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"/api/v1/issues/{issue.id}/", {"title": "new", "number": 99}, format="json")
        self.assertEqual(r.status_code, 200)
        issue.refresh_from_db()
        self.assertEqual((issue.title, issue.number, issue.updated_by), ("new", 1, self.mate))

    def test_org_admin_is_an_assignee(self):
        from accounts.models import Organization
        org = Organization.objects.create(name="O")
        self.member.organization = org
        self.member.save()
        boss = User.objects.create_user("boss", "b@x.com", "p", role="admin", organization=org)
        User.objects.create_user("idle", "i@x.com", "p", role="admin")  # other org: not listed
        self.client.force_authenticate(self.member)
        rows = self.client.get(self.url + "assignees/").data
        self.assertEqual({r["name"] for r in rows}, {"Ena", "pm", "boss"})
        self.assertEqual(next(r for r in rows if r["name"] == "boss"), {"id": boss.id, "name": "boss",
                                                                       "email": "b@x.com", "role": "admin"})

    def test_delete_removes_files(self):
        self.client.force_authenticate(self.member)
        issue_id = self._create().data["id"]
        issue = Issue.objects.get(pk=issue_id)
        paths = [issue.photo.path, issue.snapshot.path]
        self.assertTrue(all(os.path.exists(p) for p in paths))
        self.client.delete(f"/api/v1/issues/{issue_id}/")
        self.assertFalse(any(os.path.exists(p) for p in paths))

    def test_clear_photo_deletes_file_and_create_ignores_it(self):
        self.client.force_authenticate(self.member)
        issue_id = self._create(clear_photo=True).data["id"]
        issue = Issue.objects.get(pk=issue_id)
        self.assertTrue(issue.photo)  # clear_photo is meaningless on create
        path = issue.photo.path
        self.client.patch(f"/api/v1/issues/{issue_id}/", {"clear_photo": True}, format="json")
        self.assertFalse(os.path.exists(path))

    def test_replacing_photo_removes_old_file(self):
        """Regression: uploading a new photo/snapshot left the old file on disk."""
        self.client.force_authenticate(self.member)
        issue_id = self._create().data["id"]
        issue = Issue.objects.get(pk=issue_id)
        old_photo, old_snap = issue.photo.path, issue.snapshot.path
        r = self.client.patch(f"/api/v1/issues/{issue_id}/",
                              {"photo": _image("JPEG", "new.jpg"), "snapshot": _image()}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        issue.refresh_from_db()
        self.assertTrue(os.path.exists(issue.photo.path))
        self.assertTrue(os.path.exists(issue.snapshot.path))
        self.assertFalse(os.path.exists(old_photo))
        self.assertFalse(os.path.exists(old_snap))

    def test_bcf_no_issues_is_404(self):
        self.client.force_authenticate(self.member)
        r = self.client.get(self.url + "bcf/")
        self.assertEqual((r.status_code, r.data["error"]), (404, "No issues to export."))

    def test_bcf_minimal_issue(self):
        issue = self._quick(created_by=None)
        self.client.force_authenticate(self.member)
        z = zipfile.ZipFile(io.BytesIO(self.client.get(self.url + "bcf/").content))
        g = str(issue.guid)
        self.assertEqual(set(z.namelist()), {"bcf.version", "project.bcfp", "extensions.xsd",
                                             f"{g}/markup.bcf", f"{g}/viewpoint.bcfv"})
        markup = ET.fromstring(z.read(f"{g}/markup.bcf"))
        self.assertIsNone(markup.find("Header"))
        self.assertIsNone(markup.find("Comment"))
        self.assertEqual(markup.find("Topic").findtext("CreationAuthor"), "unknown")
        self.assertIsNone(ET.fromstring(z.read(f"{g}/viewpoint.bcfv")).find("PerspectiveCamera"))
        xsd = z.read("extensions.xsd").decode()
        self.assertNotIn("UserIdType", xsd)

    def test_bcf_slug_falls_back_to_project_id(self):
        self.project.project_name = "!!!"
        self.project.save()
        self._quick()
        self.client.force_authenticate(self.member)
        r = self.client.get(self.url + "bcf/")
        self.assertIn(f"project-{self.project.id}-issues.bcfzip", r["Content-Disposition"])

    def test_bcf_resolves_global_id_from_ifc(self):
        issue = self._quick(bim=self.bim, element_express_id=42, element_type="IFCWALL")
        self.client.force_authenticate(self.member)
        with mock.patch("processing.schedule_progress.element_index",
                        return_value=[{"express_id": 42, "element_id": "GUID42"}]) as idx:
            z = zipfile.ZipFile(io.BytesIO(self.client.get(self.url + "bcf/").content))
        idx.assert_called_once_with(self.bim.file.path)
        vp = ET.fromstring(z.read(f"{issue.guid}/viewpoint.bcfv"))
        self.assertEqual(vp.find("Components/Selection/Component").get("IfcGuid"), "GUID42")
        desc = ET.fromstring(z.read(f"{issue.guid}/markup.bcf")).find("Topic").findtext("Description")
        self.assertEqual(desc, "Element: IFCWALL GUID42")

    def test_resolve_global_ids_skips_and_survives_errors(self):
        a = self._quick(bim=self.bim, element_express_id=1)
        b = self._quick(bim=self.bim, element_express_id=2)
        self._quick(bim=self.bim, element_express_id=3, element_global_id="known")
        self._quick(element_express_id=4)  # no BIM
        with mock.patch("processing.schedule_progress.element_index",
                        return_value=[{"express_id": 1, "element_id": "G1"}]):
            self.assertEqual(_resolve_global_ids(list(Issue.objects.all())), {a.pk: "G1"})
        with mock.patch("processing.schedule_progress.element_index", side_effect=ValueError("bad ifc")), \
                self.assertLogs("issues.views", "WARNING"):
            self.assertEqual(_resolve_global_ids([a, b]), {})
        not_ifc = BIMData.objects.create(project=self.project, description="m", date=datetime.date(2026, 1, 1),
                                         file=SimpleUploadedFile("m.glb", b"x"))
        c = self._quick(bim=not_ifc, element_express_id=1)
        with mock.patch("processing.schedule_progress.element_index") as idx:
            self.assertEqual(_resolve_global_ids([c]), {})
        idx.assert_not_called()


class SerializerAndBCFUnitTests(APITestCase):
    def test_json_input_field(self):
        f = JSONInputField()
        self.assertEqual(f.to_internal_value("[1, 2]"), [1, 2])
        self.assertEqual(f.to_internal_value({"a": 1}), {"a": 1})
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            f.to_internal_value("{bad")

    def test_user_label(self):
        self.assertIsNone(_user_label(None))
        self.assertEqual(_user_label(SimpleNamespace(get_full_name=lambda: "", username="u")), "u")

    def test_author_and_read_helpers(self):
        self.assertEqual(bcf._author(None), "unknown")
        self.assertEqual(bcf._author(SimpleNamespace(email="", username="u")), "u")
        self.assertIsNone(bcf._read(None))

        class Broken:
            def __bool__(self):
                return True

            def open(self, mode):
                raise OSError("gone")

        self.assertIsNone(bcf._read(Broken()))

    def test_snapshot_and_photo_entries(self):
        jpg = SimpleNamespace(name="a/snap.JPG")

        class F:
            def __init__(self, data, name):
                self.data, self.name = data, name

            def __bool__(self):
                return True

            def open(self, mode):
                pass

            def read(self):
                return self.data

            def close(self):
                pass

        buf = io.BytesIO()
        Image.new("RGB", (4000, 1000)).save(buf, format="PNG")
        issue = SimpleNamespace(snapshot=F(b"jpgdata", "a/snap.JPG"), photo=F(buf.getvalue(), "p.png"))
        self.assertEqual(bcf._snapshot_entry(issue), ("snapshot.jpg", b"jpgdata"))
        name, data = bcf._photo_entry(issue)
        self.assertEqual(name, "photo.jpg")
        self.assertEqual(Image.open(io.BytesIO(data)).size, (2048, 512))  # longest edge capped
        bad = SimpleNamespace(photo=F(b"not an image", "p.heic"), snapshot=None)
        self.assertEqual(bcf._photo_entry(bad), (None, None))
        self.assertEqual(bcf._snapshot_entry(bad), (None, None))
        del jpg

    def test_xyz_and_viewpoint_up_default(self):
        issue = SimpleNamespace(viewpoint={"position": [1, 2, 3], "direction": [0, 1, 0], "fov": None})
        root = ET.fromstring(bcf._viewpoint_xml(issue, "g", ""))
        cam = root.find("PerspectiveCamera")
        self.assertEqual(float(cam.findtext("CameraUpVector/Z")), 1.0)
        self.assertEqual(float(cam.findtext("FieldOfView")), 60.0)
        self.assertIsNone(root.find("Components/Selection"))
