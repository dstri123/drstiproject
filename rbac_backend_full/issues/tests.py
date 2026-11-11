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
