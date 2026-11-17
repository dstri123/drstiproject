"""Views: progress analyze/save/history/pair/timeline/schedule, alignment pairs, snapshots."""
import datetime
from unittest import mock

from projects.models import ProjectSchedule

from processing.models import AlignmentPair, AuditLog, ProgressAssessment, ProgressElement

from .test_views_base import ProcessingViewTestBase

D = datetime.date


def element(eid="G1", status="completed", category="Doors", **kw):
    row = {"element_id": eid, "element_type": "IFCDOOR", "category": category, "level": "L1",
           "level_elevation": 0.0, "name": eid, "bim_volume": 1.0, "bim_points": 100,
           "overlap_points": 80, "completion": 80.0, "status": status, "built_by": "coverage",
           "sam_built_ratio": None}
    row.update(kw)
    return row


class ProgressTestBase(ProcessingViewTestBase):
    def assessment(self, pair=None, pc_date=None, elements=(), **kw):
        a = ProgressAssessment.objects.create(
            project=self.project, alignment_pair=pair, pointcloud_date=pc_date,
            total_elements=len(elements),
            completed_elements=sum(1 for e in elements if e["status"] == "completed"), **kw)
        ProgressElement.objects.bulk_create([ProgressElement(assessment=a, **e) for e in elements])
        return a


# ─── Analyze ──────────────────────────────────────────────────────────────────
ANALYSIS = {"elements": [element()], "point_count": 10, "summary": {"overall_completion": 50.0}}


@mock.patch("traceback.print_exc")
class ProgressAnalyzeViewTests(ProgressTestBase):
    def body(self, **kw):
        return {"bim_id": self.bim.id, "pointcloud_id": self.pc.id, **kw}

    def test_requires_ids(self, _tb):
        r = self.post("progress/analyze/", {"bim_id": self.bim.id})
        self.assertEqual((r.status_code, r.data["error"]), (400, "bim_id and pointcloud_id are required"))

    def test_not_found(self, _tb):
        r = self.post("progress/analyze/", self.body(pointcloud_id=99999))
        self.assertEqual((r.status_code, r.data["error"]), (404, "BIM or Point Cloud not found"))

    def test_file_type_checks(self, _tb):
        r = self.post("progress/analyze/", self.body(bim_id=self.make_bim("m.rvt").id))
        self.assertEqual((r.status_code, r.data["error"]), (400, "Element analysis needs an IFC BIM file."))
        r = self.post("progress/analyze/", self.body(pointcloud_id=self.make_pc("s.e57").id))
        self.assertEqual(r.status_code, 400)
        self.assertIn(".ply, .las", r.data["error"])

    def test_non_numeric_threshold_is_400(self, _tb):
        r = self.post("progress/analyze/", self.body(threshold="wide"))
        self.assertEqual(r.status_code, 400)
        r = self.post("progress/analyze/", self.body(built_coverage="x"))
        self.assertEqual(r.status_code, 400)

    @mock.patch("processing.progress.analyze", return_value=dict(ANALYSIS))
    def test_server_side_analysis_with_defaults(self, analyze, _tb):
        self.bim.transform = {"position": [0, 0, 0]}
        self.bim.save()
        self.pc.transform = {"position": [1, 0, 0]}
        self.pc.save()
        r = self.post("progress/analyze/", self.body())
        self.assertEqual(r.status_code, 200)
        args, kw = analyze.call_args
        self.assertEqual(args, (self.bim.file.path, self.pc.file.path, {"position": [0, 0, 0]},
                                {"position": [1, 0, 0]}))
        self.assertEqual((kw["threshold"], kw["overlap_snapshot"], kw["semantic_snapshot"]), (0.15, None, None))
        from processing.progress import BUILT_COVERAGE
        self.assertEqual(kw["built_coverage"], BUILT_COVERAGE)
        self.assertEqual(r.data["warnings"], [])
        self.assertEqual(r.data["bim"], {"id": self.bim.id, "date": D(2026, 2, 1), "description": "bim model.ifc"})
        self.assertEqual(r.data["pointcloud"]["id"], self.pc.id)
        self.assertEqual(r.data["elements"], ANALYSIS["elements"])

    @mock.patch("processing.progress.analyze", return_value={"point_count": 0, "summary": {}})
    def test_missing_transform_and_empty_cloud_warnings(self, analyze, _tb):
        r = self.post("progress/analyze/", self.body(threshold="0.3", built_coverage="0.4"))
        self.assertEqual((analyze.call_args[1]["threshold"], analyze.call_args[1]["built_coverage"]), (0.3, 0.4))
        self.assertEqual(len(r.data["warnings"]), 2)
        self.assertIn("no saved alignment transform", r.data["warnings"][0])
        self.assertIn("Point cloud appears empty", r.data["warnings"][1])

    @mock.patch("processing.progress.analyze",
                return_value={"point_count": 5, "summary": {"overall_completion": 0}})
    def test_no_overlap_warning(self, _a, _tb):
        self.bim.transform = self.pc.transform = {"p": 1}
        self.bim.save()
        self.pc.save()
        r = self.post("progress/analyze/", self.body())
        self.assertEqual(len(r.data["warnings"]), 1)
        self.assertIn("No overlap detected", r.data["warnings"][0])

    @mock.patch("processing.progress.analyze",
                return_value={"point_count": 5, "summary": {"overall_completion": "n/a"}})
    def test_unparseable_overall_counts_as_zero(self, _a, _tb):
        self.bim.transform = self.pc.transform = {"p": 1}
        self.bim.save()
        self.pc.save()
        self.assertIn("No overlap detected", self.post("progress/analyze/", self.body()).data["warnings"][0])

    @mock.patch("processing.progress.analyze", return_value=dict(ANALYSIS))
    def test_uses_overlap_snapshot_and_consumes_sam_labels(self, analyze, _tb):
        pair = AlignmentPair.objects.create(
            project=self.project, bim=self.bim, pointcloud=self.pc, overlap_element_count=None,
            overlap_snapshot={"7": 3, "8": 1}, semantic_snapshot={"7": {"built": 3}},
            semantic_snapshot_at=datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc))
        r = self.post("progress/analyze/", self.body())
        kw = analyze.call_args[1]
        self.assertEqual((kw["overlap_snapshot"], kw["semantic_snapshot"]), ({"7": 3, "8": 1}, {"7": {"built": 3}}))
        self.assertIn("overlap data sent from the viewer (2 elements)", r.data["warnings"][1])
        self.assertIn("SAM photo labels for 1 elements", r.data["warnings"][2])
        pair.refresh_from_db()
        self.assertIsNone(pair.semantic_snapshot)
        self.assertIsNone(pair.semantic_snapshot_at)
        self.assertEqual(pair.overlap_snapshot, {"7": 3, "8": 1})
        self.post("progress/analyze/", self.body())
        self.assertIsNone(analyze.call_args[1]["semantic_snapshot"])

    @mock.patch("processing.progress.analyze", return_value=dict(ANALYSIS))
    def test_sam_labels_ignored_without_overlap_snapshot(self, analyze, _tb):
        AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc,
                                     semantic_snapshot={"7": {"built": 3}})
        self.post("progress/analyze/", self.body())
        self.assertIsNone(analyze.call_args[1]["semantic_snapshot"])
        self.assertIsNotNone(AlignmentPair.objects.get().semantic_snapshot)

    @mock.patch("processing.progress.analyze", side_effect=RuntimeError("ifcopenshell exploded"))
    def test_analysis_failure_is_500_and_keeps_labels(self, _a, _tb):
        AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc,
                                     overlap_snapshot={"1": 1}, semantic_snapshot={"1": {"built": 1}})
        r = self.post("progress/analyze/", self.body())
        self.assertEqual((r.status_code, r.data["error"]), (500, "Analysis failed: ifcopenshell exploded"))
        self.assertIsNotNone(AlignmentPair.objects.get().semantic_snapshot)


# ─── Save ─────────────────────────────────────────────────────────────────────
class ProgressSaveViewTests(ProgressTestBase):
    SUMMARY = {"total": 2, "completed": 1, "in_progress": 1, "not_started": 0, "overall_completion": 50.0}

    def body(self, **kw):
        return {"project_id": self.project.id, "bim_id": self.bim.id, "pointcloud_id": self.pc.id,
                "summary": self.SUMMARY, "elements": [element("A"), element("B", status="in_progress")], **kw}

    def test_validation_and_not_found(self):
        self.assertEqual(self.post("progress/save/", {}).data, {"error": "project_id required"})
        self.assertEqual(self.post("progress/save/", {"project_id": 99999}).status_code, 404)

    def test_saves_and_auto_registers_pair(self):
        r = self.post("progress/save/", self.body(pair_id=None))
        self.assertEqual(r.status_code, 200)
        pair = AlignmentPair.objects.get()
        self.assertEqual(r.data, {"message": "Assessment saved", "assessment_id": r.data["assessment_id"],
                                  "pair_id": pair.id})
        self.assertEqual((pair.bim_date, pair.pointcloud_date, pair.project), (D(2026, 2, 1), D(2026, 3, 1), self.project))
        a = ProgressAssessment.objects.get(id=r.data["assessment_id"])
        self.assertEqual((a.alignment_pair, a.bim_date, a.pointcloud_date, a.total_elements, a.completed_elements,
                          a.in_progress_elements, a.overall_completion),
                         (pair, D(2026, 2, 1), D(2026, 3, 1), 2, 1, 1, 50.0))
        rows = {e.element_id: e for e in a.elements.all()}
        self.assertEqual(rows["B"].status, "in_progress")
        self.assertEqual(rows["A"].built_by, "coverage")
        # Re-saving reuses the same pair.
        r2 = self.post("progress/save/", self.body())
        self.assertEqual(r2.data["pair_id"], pair.id)
        self.assertEqual(AlignmentPair.objects.count(), 1)

    def test_explicit_pair_id_wins(self):
        other_pc = self.make_pc("later.ply", date=D(2026, 4, 1))
        explicit = AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=other_pc)
        r = self.post("progress/save/", self.body(pair_id=str(explicit.id)))
        self.assertEqual(r.data["pair_id"], explicit.id)
        self.assertFalse(AlignmentPair.objects.filter(pointcloud=self.pc).exists())

    def test_pair_from_other_project_or_garbage_falls_back(self):
        foreign = AlignmentPair.objects.create(project=self.other_project, bim=self.make_bim("f.ifc"),
                                               pointcloud=self.pc)
        r = self.post("progress/save/", self.body(pair_id=foreign.id))
        self.assertNotEqual(r.data["pair_id"], foreign.id)
        r = self.post("progress/save/", self.body(pair_id="latest"))
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(r.data["pair_id"])

    def test_defaults_and_truncation(self):
        r = self.post("progress/save/", {"project_id": self.project.id,
                                         "elements": [{"level": "L" * 300, "built_by": "x" * 30}]})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["pair_id"])
        a = ProgressAssessment.objects.get()
        self.assertEqual((a.bim, a.pointcloud, a.bim_date, a.total_elements, a.overall_completion),
                         (None, None, None, 0, 0.0))
        e = a.elements.get()
        self.assertEqual((len(e.level), len(e.built_by), e.status), (255, 20, "not_started"))

    def test_overlong_text_fields_from_ifc_are_truncated(self):
        """IFC names/types/categories can exceed the column widths; MySQL
        rejects those rows, so the whole save used to fail with a 500."""
        long = element("C" * 200, element_type="IFC" + "X" * 100, category="Y" * 60, name="N" * 300)
        r = self.post("progress/save/", self.body(elements=[long]))
        self.assertEqual(r.status_code, 200)
        e = ProgressElement.objects.get()
        self.assertEqual((len(e.element_id), len(e.element_type), len(e.category), len(e.name)),
                         (120, 80, 40, 255))


# ─── History / pair latest ────────────────────────────────────────────────────
class ProgressHistoryAndPairTests(ProgressTestBase):
    def setUp(self):
        super().setUp()
        self.pair = AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc)
        self.a1 = self.assessment(self.pair, elements=[element("A"), element("B", status="not_started")],
                                  overall_completion=99.0)
        self.a2 = self.assessment(None, elements=[element("C")])

    def test_history_recomputes_completion_and_filters_by_pair(self):
        rows = self.client.get(f"/api/v1/processing/progress/history/{self.project.id}/").data
        self.assertEqual(len(rows), 2)
        row = next(r for r in rows if r["id"] == self.a1.id)
        self.assertEqual(row["overall_completion"], 50.0)
        self.assertEqual(row["alignment_pair_id"], self.pair.id)
        rows = self.get(f"progress/history/{self.project.id}/", {"pair_id": self.pair.id}).data
        self.assertEqual([r["id"] for r in rows], [self.a1.id])
        self.assertEqual(self.get(f"progress/history/{self.other_project.id}/").data, [])

    def test_pair_latest_shape(self):
        r = self.get(f"progress/pair/{self.pair.id}/latest/")
        self.assertEqual(r.data["assessment_id"], self.a1.id)
        self.assertEqual(r.data["summary"], {"total": 2, "completed": 1, "in_progress": 0,
                                             "not_started": 0, "overall_completion": 50.0})
        self.assertEqual(sorted(e["element_id"] for e in r.data["elements"]), ["A", "B"])
        self.assertEqual(set(r.data["elements"][0]), set(element()))
        self.assertEqual(r.data["categories"][0]["category"], "Doors")
        self.assertEqual(r.data["categories"][0]["count"], 2)
        self.assertIn("levels", r.data)
        self.assertIn("trades", r.data)
        self.assertEqual(r.data["warnings"], [])

    def test_pair_latest_picks_newest(self):
        newer = self.assessment(self.pair, elements=[element("Z")])
        self.assertEqual(self.get(f"progress/pair/{self.pair.id}/latest/").data["assessment_id"], newer.id)

    def test_pair_without_assessment(self):
        self.assertEqual(self.get("progress/pair/99999/latest/").data,
                         {"elements": [], "summary": None, "categories": []})


# ─── Alignment pair upsert + list ────────────────────────────────────────────
class AlignmentPairViewTests(ProgressTestBase):
    def body(self, **kw):
        return {"project_id": self.project.id, "bim_id": self.bim.id, "pointcloud_id": self.pc.id, **kw}

    def test_not_found(self):
        for key in ("project_id", "bim_id", "pointcloud_id"):
            r = self.post("alignment/pair/", self.body(**{key: 99999}))
            self.assertEqual((r.status_code, r.data["error"]), (404, "project/bim/pointcloud not found"), key)
        self.assertEqual(self.post("alignment/pair/", {}).status_code, 404)

    def test_create_then_update(self):
        r = self.post("alignment/pair/", self.body(method="manual"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["created"], r.data["bim_date"], r.data["pointcloud_date"]),
                         (True, D(2026, 2, 1), D(2026, 3, 1)))
        r2 = self.post("alignment/pair/", self.body(method="icp", fitness=0.9, rmse=0.02,
                                                    relative_transform=[[1, 0], [0, 1]]))
        self.assertEqual((r2.data["created"], r2.data["pair_id"]), (False, r.data["pair_id"]))
        p = AlignmentPair.objects.get()
        self.assertEqual((p.method, p.fitness, p.rmse, p.relative_transform), ("icp", 0.9, 0.02, [[1, 0], [0, 1]]))

    def test_list_shape(self):
        self.bim.is_latest = True
        self.bim.save()
        p = AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc,
                                         overlap_snapshot={"1": 2}, overlap_element_count=1)
        AlignmentPair.objects.create(project=self.other_project, bim=self.bim, pointcloud=self.make_pc("o.ply"))
        rows = self.get(f"alignment/pairs/{self.project.id}/").data
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["id"], row["bim_id"], row["pointcloud_id"]), (p.id, self.bim.id, self.pc.id))
        # Dates fall back to the files' dates when the pair has none.
        self.assertEqual((row["bim_date"], row["pointcloud_date"]), (D(2026, 2, 1), D(2026, 3, 1)))
        self.assertEqual((row["bim_is_latest"], row["pointcloud_is_latest"]), (True, False))
        self.assertEqual((row["has_overlap_snapshot"], row["overlap_element_count"]), (True, 1))
        self.assertEqual(row["bim_description"], "bim model.ifc")


# ─── Snapshots ────────────────────────────────────────────────────────────────
class OverlapSnapshotSaveViewTests(ProgressTestBase):
    def body(self, **kw):
        return {"project_id": self.project.id, "bim_id": self.bim.id, "pointcloud_id": self.pc.id,
                "bim_element_count": 10, "overlap_element_count": 2,
                "overlap_points_by_express_id": {"11": "5", 12: 3}, **kw}

    def test_not_found(self):
        self.assertEqual(self.post("progress/overlap-snapshot/", self.body(bim_id=99999)).status_code, 404)

    def test_saves_snapshot_and_clears_sam_labels(self):
        AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=self.pc,
                                     semantic_snapshot={"1": {}})
        r = self.post("progress/overlap-snapshot/", self.body())
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["created"], r.data["elements_with_overlap"], r.data["message"]),
                         (False, 2, "Overlap snapshot saved"))
        p = AlignmentPair.objects.get()
        self.assertEqual(p.overlap_snapshot, {"11": 5, "12": 3})
        self.assertEqual((p.bim_element_count, p.overlap_element_count), (10, 2))
        self.assertIsNotNone(p.overlap_snapshot_at)
        self.assertIsNone(p.semantic_snapshot)

    def test_empty_map(self):
        r = self.post("progress/overlap-snapshot/", self.body(overlap_points_by_express_id=None))
        self.assertEqual((r.data["created"], r.data["elements_with_overlap"]), (True, 0))

    def test_bad_counts_are_400(self):
        r = self.post("progress/overlap-snapshot/", self.body(overlap_points_by_express_id={"1": "many"}))
        self.assertEqual(r.status_code, 400)
        self.assertFalse(AlignmentPair.objects.exists())

    def test_non_dict_map_is_400_not_500(self):
        r = self.post("progress/overlap-snapshot/", self.body(overlap_points_by_express_id=[1, 2]))
        self.assertEqual(r.status_code, 400)
        self.assertIn("must map expressID", r.data["error"])


class SemanticSnapshotSaveViewTests(ProgressTestBase):
    def body(self, **kw):
        return {"project_id": self.project.id, "bim_id": self.bim.id, "pointcloud_id": self.pc.id,
                "bim_element_count": 9, "cameras_used": 4,
                "elements": {"5": {"points": 10, "built": 7, "partial": 1, "clutter": 2},
                             "6": {"points": 4},
                             "7": {"points": 0, "built": 3}}, **kw}

    def test_files_must_belong_to_project(self):
        foreign = self.make_pc("f.ply", project=self.other_project)
        r = self.post("progress/sam-snapshot/", self.body(pointcloud_id=foreign.id))
        self.assertEqual(r.status_code, 404)

    def test_saves_overlap_and_labels_and_audits(self):
        r = self.post("progress/sam-snapshot/", self.body())
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["created"], r.data["elements_with_overlap"], r.data["elements_with_labels"]),
                         (True, 2, 1))
        p = AlignmentPair.objects.get()
        self.assertEqual(p.overlap_snapshot, {"5": 10, "6": 4})
        self.assertEqual(p.semantic_snapshot, {"5": {"built": 7, "partial": 1, "clutter": 2},
                                               "6": {"built": 0, "partial": 0, "clutter": 0}})
        self.assertEqual((p.overlap_element_count, p.bim_element_count), (2, 9))
        self.assertEqual(p.overlap_snapshot_at, p.semantic_snapshot_at)
        log = AuditLog.objects.get()
        self.assertEqual((log.action, log.description, log.bim_data, log.point_data),
                         ("process_done", "SAM built detection: 2 elements, 4 photos", self.bim, self.pc))

    def test_validation(self):
        for elements in ([1, 2], {"5": "x"}, {"5": {"points": "lots"}}):
            r = self.post("progress/sam-snapshot/", self.body(elements=elements))
            self.assertEqual(r.status_code, 400, elements)
            self.assertIn("elements must map", r.data["error"])
        r = self.post("progress/sam-snapshot/", self.body(elements={"5": {"points": 0}}))
        self.assertEqual((r.status_code, r.data["error"]), (400, "No overlapping elements in the detection result."))
        self.assertEqual(self.post("progress/sam-snapshot/", self.body(elements=None)).status_code, 400)
        self.assertFalse(AlignmentPair.objects.exists())


# ─── Timeline ────────────────────────────────────────────────────────────────
class ProgressTimelineViewTests(ProgressTestBase):
    def test_entries_sorted_by_scan_date_with_category_rollups(self):
        late_pc = self.make_pc("late.ply", date=D(2026, 5, 1))
        early_pc = self.make_pc("early.ply", date=D(2026, 1, 1))
        late = AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=late_pc)
        early = AlignmentPair.objects.create(project=self.project, bim=self.bim, pointcloud=early_pc,
                                             pointcloud_date=D(2025, 12, 31))
        self.assessment(late, elements=[element("old")])  # superseded by the next one
        newest = self.assessment(late, elements=[
            element("A"), element("B", status="in_progress", overlap_points=500),
            element("C", status="not_started", category="", bim_points=0, overlap_points=7)])
        r = self.get(f"progress/timeline/{self.project.id}/")
        dates = r.data["dates"]
        self.assertEqual([d["pair_id"] for d in dates], [early.id, late.id])
        self.assertEqual(dates[0]["pointcloud_date"], D(2025, 12, 31))
        self.assertEqual((dates[0]["assessment_id"], dates[0]["summary"], dates[0]["categories"]), (None, None, []))
        entry = dates[1]
        self.assertEqual((entry["assessment_id"], entry["pointcloud_date"], entry["pointcloud_description"]),
                         (newest.id, D(2026, 5, 1), "pc late.ply"))
        self.assertEqual(entry["summary"]["overall_completion"], round(1 / 3 * 100, 2))
        cats = {c["category"]: c for c in entry["categories"]}
        self.assertEqual(set(cats), {"Doors", "Uncategorized"})
        doors = cats["Doors"]
        self.assertEqual((doors["count"], doors["completed"], doors["in_progress"], doors["completion"]),
                         (2, 1, 1, 50.0))
        # Overlap is capped at bim_points per element: (80 + 100) / 200.
        self.assertEqual(doors["points_coverage"], 90.0)
        self.assertEqual(cats["Uncategorized"]["points_coverage"], 0.0)

    def test_empty_project(self):
        self.assertEqual(self.get(f"progress/timeline/{self.other_project.id}/").data, {"dates": []})


# ─── Schedule status / 4D ────────────────────────────────────────────────────
class ScheduleProgressViewTests(ProgressTestBase):
    def test_without_schedule_or_scans(self):
        r = self.get(f"progress/schedule-status/{self.project.id}/")
        self.assertEqual(r.data, {"has_schedule": False, "scan_dates": [], "latest_scan_date": None,
                                  "latest_has_levels": False, "ifc_levels": [], "level_map": {},
                                  "activities": {}})

    @mock.patch("processing.schedule_progress.compute", return_value={"A1": {"actual": 50}})
    def test_latest_assessment_per_scan_date(self, compute):
        ProjectSchedule.objects.create(project=self.project, activities=[{"id": "A1"}],
                                       meta={"level_map": {"L1": "Level 1"}})
        self.assessment(pc_date=D(2026, 3, 1), elements=[element("old", level="")])
        self.assessment(pc_date=D(2026, 3, 1), elements=[element("new", level="L2")])
        self.assessment(pc_date=D(2026, 4, 1), elements=[element("x", level="L1"), element("y", level="")])
        r = self.get(f"progress/schedule-status/{self.project.id}/")
        self.assertEqual((r.data["has_schedule"], r.data["scan_dates"], r.data["latest_scan_date"]),
                         (True, ["2026-03-01", "2026-04-01"], "2026-04-01"))
        self.assertEqual((r.data["ifc_levels"], r.data["latest_has_levels"]), (["L1"], True))
        self.assertEqual(r.data["level_map"], {"L1": "Level 1"})
        self.assertEqual(r.data["activities"], {"A1": {"actual": 50}})
        activities, meta, scans = compute.call_args[0]
        self.assertEqual((activities, meta), ([{"id": "A1"}], {"level_map": {"L1": "Level 1"}}))
        self.assertEqual([[row["element_id"] for row in rows] for _, rows in scans], [["new"], ["x", "y"]])

    def test_assessment_without_scan_date_uses_created_date(self):
        a = self.assessment(elements=[element()])
        r = self.get(f"progress/schedule-status/{self.project.id}/")
        self.assertEqual(r.data["scan_dates"], [a.created_at.date().isoformat()])


class Schedule4DViewTests(ProgressTestBase):
    ELEMENTS = [{"express_id": 11, "element_id": "G1"}, {"express_id": 12, "element_id": "G2"}]

    def url(self):
        return f"progress/schedule-4d/{self.project.id}/"

    def test_no_schedule(self):
        r = self.get(self.url())
        self.assertEqual((r.status_code, r.data["error"]), (404, "This project has no schedule."))

    def test_no_ifc_model(self):
        ProjectSchedule.objects.create(project=self.project, activities=[])
        rvt = self.make_bim("only.rvt")
        r = self.get(self.url(), {"bim": rvt.id})
        self.assertEqual((r.status_code, r.data["error"]), (404, "No IFC model found for this project."))

    @mock.patch("processing.schedule_progress.link_elements", return_value={"11": "A1"})
    @mock.patch("processing.schedule_progress.element_index")
    def test_links_and_actual_status(self, index, link, ):
        index.return_value = self.ELEMENTS
        ProjectSchedule.objects.create(project=self.project, activities=[{"id": "A1"}], meta={"m": 1})
        latest_bim = self.make_bim("v2.ifc", date=D(2026, 6, 1), is_latest=True)
        self.assessment(pc_date=D(2026, 3, 1), elements=[element("G1", status="not_started")])
        self.assessment(pc_date=D(2026, 4, 1), elements=[element("G1"), element("GX")])
        r = self.get(self.url())
        self.assertEqual(r.status_code, 200)
        index.assert_called_once_with(latest_bim.file.path)
        link.assert_called_once_with([{"id": "A1"}], {"m": 1}, self.ELEMENTS)
        self.assertEqual(r.data["bim"]["id"], latest_bim.id)
        self.assertEqual((r.data["element_count"], r.data["linked_count"], r.data["elements"]), (2, 1, {"11": "A1"}))
        self.assertEqual((r.data["actual"], r.data["scan_date"]), ({11: "completed"}, "2026-04-01"))

    @mock.patch("processing.schedule_progress.link_elements", return_value={})
    @mock.patch("processing.schedule_progress.element_index", return_value=[])
    def test_explicit_bim_and_no_assessment(self, index, _link):
        ProjectSchedule.objects.create(project=self.project, activities=[])
        self.make_bim("v2.ifc", is_latest=True)
        r = self.get(self.url(), {"bim": self.bim.id})
        self.assertEqual(r.data["bim"]["id"], self.bim.id)
        self.assertEqual((r.data["actual"], r.data["scan_date"]), ({}, None))

    @mock.patch("processing.schedule_progress.element_index", side_effect=OSError("corrupt"))
    def test_unreadable_ifc_is_500(self, _index):
        ProjectSchedule.objects.create(project=self.project, activities=[])
        r = self.get(self.url())
        self.assertEqual((r.status_code, r.data["error"]), (500, "Couldn't read the IFC model: corrupt"))
