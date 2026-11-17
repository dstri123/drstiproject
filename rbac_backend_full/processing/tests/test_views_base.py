"""Shared fixtures for the processing view tests (no tests in this module)."""
import datetime
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import User
from projects.models import BIMData, PointCloudData, Project

PW = "Passw0rd!"
API = "/api/v1/processing/"


class ProcessingViewTestBase(APITestCase):
    """Users, a project, one IFC + one PLY on disk (in a temp MEDIA_ROOT)."""

    @classmethod
    def setUpClass(cls):
        cls._media = tempfile.mkdtemp(prefix="procviews_")
        cls._media_override = override_settings(MEDIA_ROOT=cls._media)
        cls._media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._media_override.disable()
        shutil.rmtree(cls._media, ignore_errors=True)

    def setUp(self):
        self.admin = User.objects.create_user("boss", "boss@x.com", PW, role="admin")
        self.viewer = User.objects.create_user(
            "viewer", "viewer@x.com", PW, role="member", sub_role="viewer", created_by=self.admin
        )
        self.project = Project.objects.create(
            project_name="Tower A", description="", start=datetime.date(2026, 1, 1), end=datetime.date(2026, 12, 31)
        )
        self.other_project = Project.objects.create(
            project_name="Other", description="", start=datetime.date(2026, 1, 1), end=datetime.date(2026, 12, 31)
        )
        self.bim = self.make_bim()
        self.pc = self.make_pc()
        self.client.force_authenticate(self.admin)

    def make_bim(self, name="model.ifc", date=datetime.date(2026, 2, 1), project=None, **kw):
        return BIMData.objects.create(
            project=project or self.project, description=f"bim {name}", date=date,
            file=SimpleUploadedFile(name, b"ISO-10303-21;\nEND-ISO-10303-21;"), **kw,
        )

    def make_pc(self, name="scan.ply", date=datetime.date(2026, 3, 1), project=None, **kw):
        return PointCloudData.objects.create(
            project=project or self.project, description=f"pc {name}", date=date,
            file=SimpleUploadedFile(name, b"ply\nformat ascii 1.0\nend_header\n"), **kw,
        )

    def logout(self):
        self.client.force_authenticate(None)

    def post(self, path, data=None, **kw):
        kw.setdefault("format", "json")
        return self.client.post(API + path, data or {}, **kw)

    def get(self, path, params=None):
        return self.client.get(API + path, params or {})
