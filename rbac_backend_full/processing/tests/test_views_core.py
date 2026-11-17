"""Views: validate, bounds, ifc-metadata, jobs, diagnostics, audit (+ models/serializers)."""
import datetime
import unittest
from unittest import mock

from processing.models import (
    AlignmentPair, AuditLog, DiagnosticReport, ElementMetadata, ModelBounds,
    ProcessingJob, ProgressAssessment, ProgressElement,
)
from processing.serializers import BoundsRequestSerializer, ValidationRequestSerializer
from processing.validators import Diagnostic

from .test_views_base import API, ProcessingViewTestBase


class AuthRequiredTests(ProcessingViewTestBase):
    def test_every_authenticated_endpoint_returns_401_when_logged_out(self):
        self.logout()
        gets = ["bounds/?bim_data_id=1", "ifc-metadata/?bim_data_id=1", "jobs/", "jobs/1/",
                "diagnostics/?bim_data_id=1", "audit/", "progress/history/1/",
                "progress/pair/1/latest/", "progress/schedule-status/1/", "progress/schedule-4d/1/",
                "progress/timeline/1/", "alignment/pairs/1/"]
        posts = ["validate/", "bounds/", "ifc-metadata/", "jobs/", "tools/pointcloud-to-ply/",
                 "tools/pointcloud-to-play/", "align/icp/", "align/auto/", "progress/analyze/",
                 "progress/save/", "alignment/pair/", "progress/overlap-snapshot/",
                 "progress/sam-snapshot/", "gaussian/train/"]
        for p in gets:
            self.assertEqual(self.client.get(API + p).status_code, 401, p)
        for p in posts:
            self.assertEqual(self.client.post(API + p, {}).status_code, 401, p)
        self.assertEqual(self.client.patch(API + "jobs/1/", {}).status_code, 401)


# ─── Validation ───────────────────────────────────────────────────────────────
class ValidationViewTests(ProcessingViewTestBase):
    def test_requires_one_id(self):
        r = self.post("validate/", {})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Provide either bim_data_id or point_data_id.", str(r.data))
        self.assertEqual(self.post("validate/", {"bim_data_id": "abc"}).status_code, 400)

    def test_not_found(self):
        r = self.post("validate/", {"bim_data_id": 99999})
        self.assertEqual((r.status_code, r.data), (404, {"error": "BIM file not found"}))
        r = self.post("validate/", {"point_data_id": 99999})
        self.assertEqual((r.status_code, r.data), (404, {"error": "Point cloud not found"}))

    @mock.patch("processing.views.validate_bim_upload")
    def test_bim_validation_persists_reports_and_audits(self, validate):
        DiagnosticReport.objects.create(bim_data=self.bim, level="info", title="stale")
        seen = {}

        def fake(f):
            seen["name"], seen["size"] = f.name, f.size
            return [Diagnostic("error", "Bad header", "x", "header"), Diagnostic("info", "ok")]
        validate.side_effect = fake

        r = self.post("validate/", {"bim_data_id": self.bim.id}, REMOTE_ADDR="10.0.0.5")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["has_errors"])
        self.assertFalse(r.data["has_warnings"])
        self.assertEqual(r.data["diagnostics"][0],
                         {"level": "error", "title": "Bad header", "detail": "x", "check_name": "header"})
        self.assertTrue(seen["name"].endswith(".ifc"))
        self.assertGreater(seen["size"], 0)
        self.assertEqual(sorted(DiagnosticReport.objects.filter(bim_data=self.bim).values_list("title", flat=True)),
                         ["Bad header", "ok"])
        log = AuditLog.objects.get()
        self.assertEqual((log.action, log.user, log.bim_data, log.ip_address),
                         ("validate", self.admin, self.bim, "10.0.0.5"))

    def test_real_validators_run_on_stored_files(self):
        """Regression: the view set .name/.size on a raw open() handle, which
        is read-only, so every validate call crashed with a 500."""
        r = self.post("validate/", {"bim_data_id": self.bim.id})
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.data["diagnostics"], list)
        r = self.post("validate/", {"point_data_id": self.pc.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(AuditLog.objects.filter(action="validate").count(), 2)

    @mock.patch("processing.views.validate_pointcloud_upload")
    def test_pointcloud_validation(self, validate):
        validate.return_value = [Diagnostic("warning", "Sparse")]
        r = self.post("validate/", {"point_data_id": self.pc.id}, HTTP_X_FORWARDED_FOR="1.2.3.4, 5.6.7.8")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["has_errors"])
        self.assertTrue(r.data["has_warnings"])
        self.assertEqual(DiagnosticReport.objects.get().point_data, self.pc)
        log = AuditLog.objects.get()
        self.assertEqual((log.point_data, log.ip_address), (self.pc, "1.2.3.4"))


# ─── Bounds ───────────────────────────────────────────────────────────────────
BOX = {"xmin": -1, "xmax": 3, "ymin": 0, "ymax": 2, "zmin": 10, "zmax": 11}


class ModelBoundsViewTests(ProcessingViewTestBase):
    def test_get_requires_an_id(self):
        r = self.get("bounds/")
        self.assertEqual((r.status_code, r.data["error"]), (400, "Provide bim_data_id or point_data_id"))

    def test_get_missing_returns_null(self):
        self.assertEqual(self.get("bounds/", {"bim_data_id": self.bim.id}).data, {"bounds": None})

    def test_post_computes_center_and_span_then_get_returns_it(self):
        r = self.post("bounds/", {**BOX, "bim_data_id": self.bim.id, "triangle_count": 12})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["center_x"], r.data["center_y"], r.data["center_z"], r.data["span"]),
                         (1.0, 1.0, 10.5, 4.0))
        self.assertEqual((r.data["bim_data"], r.data["triangle_count"]), (self.bim.id, 12))
        b = self.get("bounds/", {"bim_data_id": self.bim.id}).data["bounds"]
        self.assertEqual(b["center"], {"x": 1.0, "y": 1.0, "z": 10.5})
        self.assertEqual(b["span"], 4.0)

    def test_post_upserts_for_point_cloud(self):
        self.post("bounds/", {**BOX, "point_data_id": self.pc.id, "point_count": 5})
        self.post("bounds/", {**BOX, "xmax": 9, "point_data_id": self.pc.id})
        self.assertEqual(ModelBounds.objects.count(), 1)
        b = self.get("bounds/", {"point_data_id": self.pc.id}).data["bounds"]
        self.assertEqual((b["xmax"], b["span"]), (9.0, 10.0))

    def test_post_validation(self):
        r = self.post("bounds/", {"xmin": 0, "bim_data_id": self.bim.id})
        self.assertEqual((r.status_code, r.data["error"]), (400, "Missing field: xmax"))
        r = self.post("bounds/", BOX)
        self.assertEqual((r.status_code, r.data["error"]), (400, "Provide bim_data_id or point_data_id"))

    def test_post_non_numeric_bound_is_400_not_500(self):
        r = self.post("bounds/", {**BOX, "xmin": "abc", "bim_data_id": self.bim.id})
        self.assertEqual(r.status_code, 400)
        self.assertIn("numbers", r.data["error"])


# ─── IFC metadata ────────────────────────────────────────────────────────────
class IFCMetadataViewTests(ProcessingViewTestBase):
    def test_get_requires_id_and_handles_unparsed(self):
        self.assertEqual(self.get("ifc-metadata/").status_code, 400)
        self.assertEqual(self.get("ifc-metadata/", {"bim_data_id": self.bim.id}).data,
                         {"summary": [], "element_count": 0, "parsed": False})

    def test_get_groups_by_type(self):
        for i, (t, conv) in enumerate([("IFCWALL", True), ("IFCWALL", False), ("IFCDOOR", True)]):
            ElementMetadata.objects.create(bim_data=self.bim, step_id=str(i), ifc_type=t,
                                           category="structure", convertible=conv, fds_role="OBST")
        r = self.get("ifc-metadata/", {"bim_data_id": self.bim.id})
        self.assertEqual(r.data["element_count"], 3)
        self.assertTrue(r.data["parsed"])
        self.assertEqual(r.data["summary"], [
            {"ifc_type": "IFCDOOR", "count": 1, "convertible_count": 1, "category": "structure", "fds_role": "OBST"},
            {"ifc_type": "IFCWALL", "count": 2, "convertible_count": 1, "category": "structure", "fds_role": "OBST"},
        ])

    def test_post_validation_and_not_found(self):
        self.assertEqual(self.post("ifc-metadata/", {}).data["error"], "Provide bim_data_id")
        self.assertEqual(self.post("ifc-metadata/", {"bim_data_id": 99999}).status_code, 404)
        rvt = self.make_bim("model.rvt")
        r = self.post("ifc-metadata/", {"bim_data_id": rvt.id})
        self.assertEqual((r.status_code, r.data["file_type"]), (400, ".rvt"))

    @mock.patch("processing.views.parse_ifc_metadata")
    def test_post_persists_elements_bounds_and_audit(self, parse):
        ElementMetadata.objects.create(bim_data=self.bim, step_id="old", ifc_type="IFCSLAB")
        parse.return_value = {
            "elements": [{"step_id": "1", "ifc_type": "IFCWALL", "name": "W1", "category": "structure"},
                         {"step_id": "2", "ifc_type": "IFCDOOR"}],
            "bounds": {"xmin": 0, "xmax": 4, "ymin": 0, "ymax": 2, "zmin": 0, "zmax": 6},
            "summary": [{"ifc_type": "IFCWALL"}],
            "diagnostics": [{"level": "info"}],
        }
        r = self.post("ifc-metadata/", {"bim_data_id": self.bim.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["element_count"], 2)
        self.assertEqual(r.data["summary"], [{"ifc_type": "IFCWALL"}])
        self.assertEqual(r.data["diagnostics"], [{"level": "info"}])
        parse.assert_called_once_with(self.bim.file.path)
        self.assertEqual(sorted(ElementMetadata.objects.values_list("step_id", flat=True)), ["1", "2"])
        door = ElementMetadata.objects.get(step_id="2")
        self.assertEqual((door.category, door.convertible, door.name), ("other", True, ""))
        b = ModelBounds.objects.get(bim_data=self.bim)
        self.assertEqual((b.span, b.center_z), (6.0, 3.0))
        log = AuditLog.objects.get()
        self.assertEqual((log.action, log.metadata), ("process_done", {"element_count": 2}))

    @mock.patch("processing.views.parse_ifc_metadata", return_value={})
    def test_post_without_bounds_stores_none(self, _parse):
        r = self.post("ifc-metadata/", {"bim_data_id": self.bim.id})
        self.assertEqual(r.data, {"summary": [], "element_count": 0, "bounds": None, "diagnostics": []})
        self.assertFalse(ModelBounds.objects.exists())


# ─── Jobs ─────────────────────────────────────────────────────────────────────
class ProcessingJobViewTests(ProcessingViewTestBase):
    def test_create_requires_job_type(self):
        r = self.post("jobs/", {})
        self.assertEqual((r.status_code, r.data), (400, {"error": "job_type is required"}))

    def test_create_and_list(self):
        r = self.post("jobs/", {"job_type": "bim_parse", "bim_data_id": self.bim.id})
        self.assertEqual(r.status_code, 201)
        self.assertEqual((r.data["status"], r.data["progress"], r.data["bim_data"], r.data["created_by"]),
                         ("queued", 0.0, self.bim.id, self.admin.id))
        self.assertIsNone(r.data["duration_seconds"])
        self.assertEqual(AuditLog.objects.get().action, "process_start")
        self.post("jobs/", {"job_type": "pc_subsample", "point_data_id": self.pc.id})
        self.assertEqual(len(self.get("jobs/").data), 2)
        self.assertEqual([j["job_type"] for j in self.get("jobs/", {"bim_data_id": self.bim.id}).data], ["bim_parse"])
        self.assertEqual([j["job_type"] for j in self.get("jobs/", {"point_data_id": self.pc.id}).data],
                         ["pc_subsample"])

    def test_detail_and_404(self):
        job = ProcessingJob.objects.create(job_type="thumbnail", created_by=self.admin)
        self.assertEqual(self.get(f"jobs/{job.id}/").data["id"], job.id)
        self.assertEqual(self.get("jobs/99999/").status_code, 404)
        self.assertEqual(self.client.patch(API + "jobs/99999/", {}, format="json").status_code, 404)

    def test_patch_lifecycle_sets_timestamps_and_duration(self):
        job = ProcessingJob.objects.create(job_type="thumbnail", created_by=self.admin)
        r = self.client.patch(API + f"jobs/{job.id}/", {"status": "running", "progress": 0.5,
                                                         "stage_label": "Parsing", "ignored": 1}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["status"], r.data["progress"], r.data["stage_label"]), ("running", 0.5, "Parsing"))
        self.assertIsNotNone(r.data["started_at"])
        self.assertIsNone(r.data["completed_at"])
        # Second PATCH loads started_at back from the DB (timezone-aware).
        r = self.client.patch(API + f"jobs/{job.id}/", {"status": "completed", "result": {"ok": True}}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["result"], {"ok": True})
        self.assertIsNotNone(r.data["completed_at"])
        self.assertGreaterEqual(r.data["duration_seconds"], 0)
        job.refresh_from_db()
        self.assertEqual(job.status, "completed")

    def test_patch_running_again_keeps_started_at(self):
        job = ProcessingJob.objects.create(job_type="thumbnail", created_by=self.admin)
        first = self.client.patch(API + f"jobs/{job.id}/", {"status": "running"}, format="json").data["started_at"]
        again = self.client.patch(API + f"jobs/{job.id}/", {"status": "running"}, format="json").data["started_at"]
        self.assertEqual(first, again)


# ─── Diagnostics ─────────────────────────────────────────────────────────────
class DiagnosticsViewTests(ProcessingViewTestBase):
    def test_requires_a_target(self):
        r = self.get("diagnostics/")
        self.assertEqual(r.status_code, 400)

    def test_not_found(self):
        for key in ("bim_data_id", "point_data_id", "project_id"):
            self.assertEqual(self.get("diagnostics/", {key: 99999}).status_code, 404, key)

    @mock.patch("processing.views.run_bim_checks", return_value=[{"level": "error"}, {"level": "info"}])
    def test_bim(self, checks):
        r = self.get("diagnostics/", {"bim_data_id": self.bim.id})
        self.assertEqual(r.data, {"diagnostics": [{"level": "error"}, {"level": "info"}],
                                  "has_errors": True, "has_warnings": False, "count": 2})
        checks.assert_called_once_with(self.bim)

    @mock.patch("processing.views.run_pointcloud_checks", return_value=[{"level": "warning"}])
    def test_pointcloud(self, checks):
        r = self.get("diagnostics/", {"point_data_id": self.pc.id})
        self.assertEqual((r.data["has_warnings"], r.data["count"]), (True, 1))

    @mock.patch("processing.views.run_project_checks", return_value=[])
    def test_project(self, checks):
        r = self.get("diagnostics/", {"project_id": self.project.id})
        self.assertEqual(r.data["count"], 0)
        checks.assert_called_once_with(self.project)

    @mock.patch("processing.views.run_project_checks", side_effect=RuntimeError("boom"))
    def test_project_check_crash_is_not_reported_as_missing_project(self, _checks):
        with self.assertRaises(RuntimeError):
            self.get("diagnostics/", {"project_id": self.project.id})


# ─── Audit log ────────────────────────────────────────────────────────────────
class AuditLogViewTests(ProcessingViewTestBase):
    def setUp(self):
        super().setUp()
        other_bim = self.make_bim("other.ifc", project=self.other_project)
        AuditLog.objects.create(user=self.admin, action="upload", description="b", bim_data=self.bim)
        AuditLog.objects.create(user=self.admin, action="upload", description="p", point_data=self.pc)
        AuditLog.objects.create(user=None, action="delete", description="o", bim_data=other_bim)

    def test_filters(self):
        self.assertEqual(len(self.get("audit/").data), 3)
        self.assertEqual([a["description"] for a in self.get("audit/", {"bim_data_id": self.bim.id}).data], ["b"])
        self.assertEqual([a["description"] for a in self.get("audit/", {"point_data_id": self.pc.id}).data], ["p"])
        self.assertEqual(sorted(a["description"] for a in self.get("audit/", {"project_id": self.project.id}).data),
                         ["b", "p"])

    def test_shape(self):
        row = self.get("audit/", {"bim_data_id": self.bim.id}).data[0]
        self.assertEqual(row["user_email"], "boss@x.com")
        self.assertEqual(set(row), {"id", "user", "user_name", "user_email", "action", "description",
                                    "metadata", "bim_data", "point_data", "ip_address", "timestamp"})


# ─── Models / serializers ────────────────────────────────────────────────────
class ModelAndSerializerTests(ProcessingViewTestBase):
    def test_str_and_helpers(self):
        job = ProcessingJob.objects.create(job_type="thumbnail")
        self.assertEqual(str(job), f"thumbnail [queued] #{job.id}")
        self.assertIsNone(job.duration_seconds)
        job.started_at = datetime.datetime(2026, 1, 1, 0, 0, 0)
        job.completed_at = datetime.datetime(2026, 1, 1, 0, 0, 30)
        self.assertEqual(job.duration_seconds, 30.0)
        b = ModelBounds.objects.create(bim_data=self.bim, xmin=0, xmax=1, ymin=0, ymax=1, zmin=0, zmax=1)
        self.assertEqual(str(b), "Bounds [0.00,1.00] [0.00,1.00] [0.00,1.00]")
        el = ElementMetadata.objects.create(bim_data=self.bim, step_id="7", ifc_type="IFCWALL", name="W")
        self.assertEqual(str(el), "IFCWALL #7 — W")
        log = AuditLog.objects.create(action="upload", description="x")
        self.assertIn("— upload", str(log))
        self.assertEqual(str(DiagnosticReport(level="warning", title="T")), "[WARNING] T")
        a = ProgressAssessment.objects.create(project=self.project, overall_completion=42.4)
        self.assertEqual(str(a), f"Assessment #{a.id} — 42%")
        e = ProgressElement(assessment=a, element_id="G", element_type="IFCDOOR", completion=7.6)
        self.assertEqual(str(e), "IFCDOOR G — 8%")
        p = AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc)
        self.assertEqual(str(p), f"Pair BIM#{self.bim.id} ↔ PC#{self.pc.id} (manual)")

    def test_request_serializers(self):
        for cls in (ValidationRequestSerializer, BoundsRequestSerializer):
            self.assertFalse(cls(data={}).is_valid())
            self.assertTrue(cls(data={"point_data_id": 3}).is_valid())


class KnownPermissionGapTests(ProcessingViewTestBase):
    """Behaviour we WANT but the processing views don't enforce yet (they only
    check that the user is logged in). Marked expectedFailure; when a view is
    fixed the test reports "unexpected success" — remove the decorator then."""

    @unittest.expectedFailure
    def test_viewer_cannot_create_processing_job(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.post("jobs/", {"job_type": "bim_parse", "bim_data_id": self.bim.id}).status_code, 403)

    @unittest.expectedFailure
    def test_member_cannot_patch_someone_elses_job(self):
        job = ProcessingJob.objects.create(job_type="thumbnail", created_by=self.admin)
        self.client.force_authenticate(self.viewer)
        r = self.client.patch(API + f"jobs/{job.id}/", {"status": "cancelled"}, format="json")
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_read_project_audit_log(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.get("audit/", {"project_id": self.project.id}).status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_save_progress_assessment(self):
        self.client.force_authenticate(self.viewer)
        r = self.post("progress/save/", {"project_id": self.project.id, "bim_id": self.bim.id,
                                         "pointcloud_id": self.pc.id})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_viewer_cannot_register_alignment_pair(self):
        self.client.force_authenticate(self.viewer)
        r = self.post("alignment/pair/", {"project_id": self.project.id, "bim_id": self.bim.id,
                                         "pointcloud_id": self.pc.id})
        self.assertEqual(r.status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_list_alignment_pairs(self):
        AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc)
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.get(f"alignment/pairs/{self.project.id}/").status_code, 403)

    @unittest.expectedFailure
    def test_alignment_pair_rejects_files_from_another_project(self):
        """alignment/pair/ and overlap-snapshot/ don't check that bim/pc belong to
        project_id (sam-snapshot/ does), so a pair can be filed under the wrong project."""
        foreign_pc = self.make_pc("foreign.ply", project=self.other_project)
        r = self.post("alignment/pair/", {"project_id": self.project.id, "bim_id": self.bim.id,
                                         "pointcloud_id": foreign_pc.id})
        self.assertEqual(r.status_code, 404)
