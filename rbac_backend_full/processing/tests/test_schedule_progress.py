"""Unit tests for processing/schedule_progress.py (schedule vs. scan matching)."""
import os
import shutil
import tempfile
from unittest import mock

from django.test import SimpleTestCase

from processing import schedule_progress as S
from processing.tests.test_progress import _build_ifc


def el(gid, etype, level, status, completion=0, express_id=None, name=""):
    return {"element_id": gid, "element_type": etype, "level": level, "status": status,
            "completion": completion, "express_id": express_id or gid, "name": name, "category": "c"}


class HelperTests(SimpleTestCase):
    def test_split_types(self):
        self.assertEqual(S._split_types("IfcWall, IfcSlab;ifcbeam / IfcColumn|IfcDoor  IfcRoof"),
                         ["IFCWALL", "IFCSLAB", "IFCBEAM", "IFCCOLUMN", "IFCDOOR", "IFCROOF"])
        self.assertEqual(S._split_types(None), [])
        self.assertEqual(S._split_types(""), [])

    def test_norm(self):
        self.assertEqual(S._norm("  Level 1 "), "level 1")
        self.assertEqual(S._norm(None), "")

    def test_is_a_swallows_unknown_class(self):
        good = mock.MagicMock()
        good.is_a.return_value = True
        self.assertTrue(S._is_a(good, "IfcWall"))
        bad = mock.MagicMock()
        bad.is_a.side_effect = RuntimeError("not in schema")
        self.assertFalse(S._is_a(bad, "IfcSpatialElement"))


class MatcherTests(SimpleTestCase):
    def test_build_matchers_kinds(self):
        acts = [
            {"id": 1, "ifcTypes": "IfcWall"},                       # explicit mapping wins
            {"id": 2, "ifcTypes": "IfcWall", "level": "Ground"},   # level_map applied
            {"id": 3, "ifcTypes": "IfcSlab", "level": "Ungrouped"},
            {"id": 4, "ifcTypes": "", "level": "L1"},
            {"id": 5, "ifcTypes": "IfcBeam", "level": "L2"},
        ]
        meta = {"element_mapping": {"1": ["G1"]}, "level_map": {"Ground": "Level 0", "Empty": ""}}
        m = S.build_matchers(acts, meta)
        self.assertEqual({k: v[0] for k, v in m.items()},
                         {"1": "elements", "2": "type_level", "3": "type", "4": "none", "5": "type_level"})
        self.assertIsNone(m["4"][1])
        self.assertTrue(m["1"][1]({"element_id": "G1"}))
        self.assertFalse(m["1"][1]({"element_id": "G2"}))
        wall_l0 = {"element_type": "IFCWALLSTANDARDCASE", "level_norm": "level 0"}
        self.assertTrue(m["2"][1](wall_l0))
        self.assertFalse(m["2"][1]({"element_type": "IFCWALL", "level_norm": "ground"}))
        self.assertTrue(m["3"][1]({"element_type": "ifcslab", "level_norm": "anything"}))
        self.assertTrue(m["5"][1]({"element_type": "IFCBEAM", "level_norm": "l2"}))

    def test_build_matchers_no_meta(self):
        m = S.build_matchers([{"ifcTypes": "IfcWall"}], None)
        self.assertEqual(m[""][0], "type")

    def test_link_elements_priority(self):
        acts = [
            {"id": "broad", "ifcTypes": "IfcWall"},
            {"id": "lvl", "ifcTypes": "IfcWall", "level": "L1"},
            {"id": "exact", "ifcTypes": "IfcDoor"},
            {"id": "none"},
        ]
        meta = {"element_mapping": {"exact": ["W9"]}}
        elements = [el("W1", "IFCWALL", "L1", None, express_id=1),
                    el("W2", "IFCWALL", "L2", None, express_id=2),
                    el("W9", "IFCWALL", "L1", None, express_id=9),
                    el("D1", "IFCDOOR", "L1", None, express_id=4),
                    el("S1", "IFCSLAB", "L1", None, express_id=5)]
        self.assertEqual(S.link_elements(acts, meta, elements), {1: "lvl", 2: "broad", 9: "exact"})


class ComputeTests(SimpleTestCase):
    def test_compute_progress_over_scans(self):
        acts = [{"id": "A", "ifcTypes": "IfcWall", "level": "L1"},
                {"id": "B", "ifcTypes": "IfcColumn"},
                {"id": "C"}]
        scans = [
            ("2026-01-01", [el("W1", "IFCWALL", "L1", "not_started"), el("W2", "IFCWALL", "L1", "not_started")]),
            ("2026-02-01", [el("W1", "IFCWALL", "L1", "in_progress", 30), el("W2", "IFCWALL", "L1", "not_started")]),
            ("2026-03-01", [el("W1", "IFCWALL", "L1", "completed", 90), el("W2", "IFCWALL", "L1", "completed", 80)]),
            ("2026-04-01", [el("W1", "IFCWALL", "L1", "completed", 95), el("W2", "IFCWALL", "L1", "in_progress", 50),
                            el("X", "IFCSLAB", "L1", "completed")]),
        ]
        out = S.compute(acts, None, scans)
        a = out["A"]
        self.assertEqual(a["match"], "type_level")
        self.assertEqual(a["actual_start"], "2026-02-01")
        self.assertIsNone(a["actual_finish"])  # regression in the latest scan clears finish
        self.assertEqual((a["matched"], a["completed"], a["in_progress"], a["not_started"]), (2, 1, 1, 0))
        self.assertEqual(a["actual_pct"], 50.0)
        self.assertEqual(a["scan_date"], "2026-04-01")
        self.assertEqual(a["missing_total"], 1)
        self.assertEqual(a["missing"], [{"element_id": "W2", "name": "", "element_type": "IFCWALL", "level": "L1",
                                         "category": "c", "status": "in_progress", "completion": 50}])
        b = out["B"]
        self.assertEqual((b["match"], b["matched"], b["actual_pct"], b["scan_date"]), ("type", 0, None, None))
        self.assertEqual(out["C"]["match"], "none")

    def test_compute_finished_and_missing_order_and_limit(self):
        acts = [{"id": "A", "ifcTypes": "IfcWall"}]
        done = [("d1", [el("W1", "IFCWALL", "", "completed")]), ("d2", [el("W1", "IFCWALL", "", "completed")])]
        a = S.compute(acts, {}, done)["A"]
        self.assertEqual((a["actual_start"], a["actual_finish"], a["actual_pct"]), ("d1", "d1", 100.0))

        many = [el(f"W{i}", "IFCWALL", "", "in_progress", completion=i % 7) for i in range(S.MISSING_LIMIT + 5)]
        many.append(el("N", "IFCWALL", "", "not_started", completion=None))
        a2 = S.compute(acts, {}, [("d", many)])["A"]
        self.assertEqual(a2["missing_total"], S.MISSING_LIMIT + 6)
        self.assertEqual(len(a2["missing"]), S.MISSING_LIMIT)
        self.assertEqual(a2["missing"][0]["element_id"], "N")  # not_started first
        comps = [m["completion"] for m in a2["missing"][1:]]
        self.assertEqual(comps, sorted(comps))

    def test_compute_without_scans(self):
        out = S.compute([{"id": 7, "ifcTypes": "IfcWall"}], {}, [])
        self.assertEqual(out["7"]["matched"], 0)
        self.assertIsNone(out["7"]["actual_pct"])


class ElementIndexTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.mkdtemp()
        cls.ifc = _build_ifc(os.path.join(cls.tmp, "w.ifc"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        super().tearDownClass()

    def test_element_index_lists_built_elements_only(self):
        S._INDEX_CACHE.clear()
        out = S.element_index(self.ifc)
        self.assertEqual(len(out), 1)  # site/building/storey have no representation or are spatial
        self.assertEqual((out[0]["element_type"], out[0]["level"]), ("IFCWALL", "L1"))
        self.assertEqual(len(out[0]["element_id"]), 22)
        self.assertIs(S.element_index(self.ifc), out)  # cache hit

    def test_element_index_storey_failure_and_no_mtime(self):
        S._INDEX_CACHE.clear()
        with mock.patch("processing.progress._storey_of", side_effect=RuntimeError), \
                mock.patch("processing.schedule_progress.os.path.getmtime", side_effect=OSError):
            out = S.element_index(self.ifc)
        self.assertEqual(out[0]["level"], "")
        self.assertEqual(S._INDEX_CACHE, {})

    def test_spatial_elements_with_representation_are_skipped(self):
        import ifcopenshell
        path = os.path.join(self.tmp, "sp.ifc")
        model = ifcopenshell.open(self.ifc)
        space = model.createIfcSpace(ifcopenshell.guid.new(), None, "Room")
        space.Representation = model.by_type("IfcWall")[0].Representation
        model.write(path)
        types = [e["element_type"] for e in S.element_index(path)]
        self.assertEqual(types, ["IFCWALL"])
