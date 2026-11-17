"""Tests for processing/diagnostics.py (model quality checks)."""
import datetime
import shutil
import tempfile
from types import SimpleNamespace
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from projects.models import BIMData, PointCloudData, Project
from processing import diagnostics as D

MEDIA = tempfile.mkdtemp()


def names(results):
    return [(r["level"], r["check_name"]) for r in results]


@override_settings(MEDIA_ROOT=MEDIA)
class DiagnosticsTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.project = Project.objects.create(project_name="P", description="",
                                              start=datetime.date(2026, 1, 1), end=datetime.date(2026, 12, 31))

    def _bim(self, content=b"ISO-10303-21;" * 200, **kw):
        defaults = dict(project=self.project, description="Main model", date=datetime.date(2026, 2, 1),
                        transform={"position": [0, 0, 0]})
        defaults.update(kw)
        return BIMData.objects.create(file=SimpleUploadedFile("m.ifc", content), **defaults)

    def _pc(self, **kw):
        defaults = dict(project=self.project, description="Scan", date=datetime.date(2026, 2, 1),
                        transform={"position": [0, 0, 0]})
        defaults.update(kw)
        return PointCloudData.objects.create(file=SimpleUploadedFile("s.las", b"LASF" * 10), **defaults)

    def test_bim_all_good(self):
        res = D.run_bim_checks(self._bim())
        self.assertEqual(names(res), [("info", "bim_file")])
        self.assertTrue(res[0]["title"].startswith("BIM file OK ("))

    def test_bim_tiny_file_warns_empty(self):
        res = D.run_bim_checks(self._bim(content=b"x"))
        self.assertEqual(names(res), [("warning", "bim_file")])
        self.assertIn("0.0 KB", res[0]["detail"])

    def test_bim_missing_on_disk_and_metadata_gaps(self):
        bim = self._bim(description=" a ", transform=None)
        bim.file.storage.delete(bim.file.name)
        res = D.run_bim_checks(bim)
        self.assertEqual(names(res), [("error", "bim_file"), ("info", "bim_transform"), ("info", "bim_description")])
        self.assertIn(bim.file.name, res[0]["detail"])

    def test_bim_no_file_no_date(self):
        bim = SimpleNamespace(file=None, transform={"a": 1}, date=None, description=None)
        self.assertEqual(names(D.run_bim_checks(bim)),
                         [("error", "bim_file"), ("warning", "bim_date"), ("info", "bim_description")])

    def test_bim_path_error_treated_as_missing(self):
        file = mock.MagicMock()
        type(file).path = mock.PropertyMock(side_effect=NotImplementedError)
        file.name = "remote.ifc"
        bim = SimpleNamespace(file=file, transform={"a": 1}, date=1, description="desc")
        self.assertEqual(names(D.run_bim_checks(bim)), [("error", "bim_file")])

    def test_pc_checks(self):
        res = D.run_pointcloud_checks(self._pc())
        self.assertEqual(names(res), [("info", "pc_file")])
        self.assertEqual(res[0]["title"], "Point cloud file OK (0 MB)")
        pc = self._pc(transform=None)
        pc.file.storage.delete(pc.file.name)
        self.assertEqual(names(D.run_pointcloud_checks(pc)), [("error", "pc_file"), ("info", "pc_transform")])
        self.assertEqual(names(D.run_pointcloud_checks(SimpleNamespace(file=None, transform=1, date=None))),
                         [("error", "pc_file"), ("warning", "pc_date")])
        file = mock.MagicMock()
        type(file).path = mock.PropertyMock(side_effect=NotImplementedError)
        self.assertEqual(names(D.run_pointcloud_checks(SimpleNamespace(file=file, transform=1, date=1))),
                         [("error", "pc_file")])

    def test_project_checks(self):
        self.assertEqual(names(D.run_project_checks(self.project)),
                         [("warning", "project_bim"), ("info", "project_pc")])
        self._bim()
        self.assertEqual(names(D.run_project_checks(self.project)), [("info", "project_pc")])
        self._pc()
        self.assertEqual(names(D.run_project_checks(self.project)), [("info", "project_complete")])
        self.project.end = datetime.date(2025, 1, 1)
        self.assertEqual(names(D.run_project_checks(self.project))[-1], ("error", "project_dates"))

    def test_diag_helper(self):
        self.assertEqual(D._diag("info", "t"), {"level": "info", "title": "t", "detail": "", "check_name": ""})
