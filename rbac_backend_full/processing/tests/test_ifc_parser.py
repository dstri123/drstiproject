"""Unit tests for processing/ifc_parser.py (IFC metadata extraction)."""
import os
import shutil
import sys
import tempfile
from unittest import mock

from django.test import SimpleTestCase

from processing import ifc_parser as I
from processing.tests.test_progress import _build_ifc

REGEX_IFC = """ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCWALL('0abc',#2,'W',$,$,$,$,$);
#2 = IfcDoor ( '0def',#3,'D',$);
#3=IFCOWNERHISTORY($,$,$,$,$,$,$,0);
#4=IFCCARTESIANPOINT((0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
"""


class ParserTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.mkdtemp()
        cls.ifc = _build_ifc(os.path.join(cls.tmp, "w.ifc"))
        cls.text_ifc = os.path.join(cls.tmp, "r.ifc")
        with open(cls.text_ifc, "w") as f:
            f.write(REGEX_IFC)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        super().tearDownClass()

    def test_ifcopenshell_parser(self):
        res = I.parse_ifc_metadata(self.ifc)
        types = sorted(e["ifc_type"] for e in res["elements"])
        self.assertEqual(types, ["IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSITE", "IFCWALL"])
        wall = next(e for e in res["elements"] if e["ifc_type"] == "IFCWALL")
        self.assertEqual((wall["name"], wall["category"], wall["fds_role"], wall["convertible"]),
                         ("W1", "structure", "OBST", True))
        self.assertIsNone(res["bounds"])
        self.assertEqual(res["diagnostics"][0]["title"], "IFC schema: IFC4")
        summary = {s["ifc_type"]: s for s in res["summary"]}
        self.assertEqual(summary["IFCWALL"]["convertible_count"], 1)
        self.assertEqual(summary["IFCSITE"]["category"], "other")

    def test_ifcopenshell_no_products_warns(self):
        path = os.path.join(self.tmp, "none.ifc")
        import ifcopenshell
        m = ifcopenshell.file(schema="IFC4")
        m.createIfcProject(ifcopenshell.guid.new())
        m.write(path)
        res = I._parse_with_ifcopenshell(path)
        self.assertEqual(res["elements"], [])
        self.assertEqual(res["diagnostics"][-1]["level"], "warning")

    def test_ifcopenshell_open_failure(self):
        res = I._parse_with_ifcopenshell(os.path.join(self.tmp, "missing.ifc"))
        self.assertEqual(res["elements"], [])
        self.assertEqual(res["diagnostics"][0]["level"], "error")

    def test_falls_back_to_regex_on_parse_exception(self):
        with mock.patch("processing.ifc_parser._parse_with_ifcopenshell", side_effect=RuntimeError):
            res = I.parse_ifc_metadata(self.text_ifc)
        self.assertEqual(res["diagnostics"][0]["title"], "Using fast regex parser")

    def test_falls_back_to_regex_without_ifcopenshell(self):
        with mock.patch.dict(sys.modules, {"ifcopenshell": None}):
            res = I.parse_ifc_metadata(self.text_ifc)
        self.assertEqual(res["diagnostics"][0]["title"], "Using fast regex parser")

    def test_regex_parser(self):
        res = I._parse_with_regex(self.text_ifc)
        self.assertEqual(res["diagnostics"][1]["title"], "IFC schema: IFC2X3")
        els = [(e["step_id"], e["ifc_type"], e["global_id"], e["fds_role"]) for e in res["elements"]]
        # every IFC* entity with a leading quoted string matches (owner history has none)
        self.assertEqual(els, [("1", "IFCWALL", "0abc", "OBST"), ("2", "IFCDOOR", "0def", "HOLE")])
        self.assertIsNone(res["bounds"])

    def test_regex_parser_empty_and_unreadable(self):
        empty = os.path.join(self.tmp, "e.ifc")
        with open(empty, "w") as f:
            f.write("nothing")
        res = I._parse_with_regex(empty)
        self.assertEqual(len(res["diagnostics"]), 2)  # no schema line, plus warning
        self.assertEqual(res["diagnostics"][-1]["level"], "warning")
        bad = I._parse_with_regex(os.path.join(self.tmp, "nope.ifc"))
        self.assertEqual(bad["diagnostics"][0]["title"], "Cannot read IFC file")

    def test_helpers(self):
        self.assertEqual(I._fds_role_for_type("IFCPLATE"), "GEOM")
        self.assertEqual(I._fds_role_for_type("IFCWINDOW"), "HOLE")
        self.assertEqual(I._fds_role_for_type("IFCSPACE"), "")
        self.assertTrue(I._is_product_type("IFCWALL"))
        self.assertTrue(I._is_product_type("IFCANYTHING"))
        self.assertFalse(I._is_product_type("FOO"))
        self.assertIsNone(I._compute_bounds_from_elements([{"bounds": None}]))
        b = I._compute_bounds_from_elements([
            {"bounds": {"xmin": 0, "xmax": 1, "ymin": 0, "ymax": 2, "zmin": -1, "zmax": 0}},
            {"bounds": {"xmin": -5, "xmax": 0, "ymin": 1, "ymax": 3, "zmin": 0, "zmax": 4}},
            {},
        ])
        self.assertEqual(b, {"xmin": -5, "xmax": 1, "ymin": 0, "ymax": 3, "zmin": -1, "zmax": 4})
