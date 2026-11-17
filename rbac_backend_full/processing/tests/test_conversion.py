"""Unit tests for processing/conversion.py (IFC -> GLB -> FBX pipeline).

trimesh and Blender are not installed, so trimesh is a mock module and the
Blender subprocess is mocked. The ifcopenshell part runs on a real IFC.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from processing import conversion as C
from processing.tests.test_progress import _build_ifc


def fake_trimesh(write_bytes=b"glb"):
    """Stand-in trimesh module recording what the pipeline adds."""
    tm = types.ModuleType("trimesh")
    tm.added = []

    class Trimesh:
        def __init__(self, vertices, faces, process):
            self.vertices, self.faces = vertices, faces
            self.visual = types.SimpleNamespace(face_colors=None)

    class Scene:
        def __init__(self):
            self.transform = None

        def add_geometry(self, mesh, node_name):
            tm.added.append((node_name, mesh))

        def apply_transform(self, m):
            self.transform = m

        def export(self, path):
            with open(path, "wb") as f:
                f.write(write_bytes)

    tm.Trimesh, tm.Scene = Trimesh, Scene
    tm.transformations = types.SimpleNamespace(rotation_matrix=lambda a, axis: ("rot", a, tuple(axis)))
    return tm


class TmpMixin:
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.converted = os.path.join(self.tmp, "converted")
        p = mock.patch.object(C, "CONVERTED_DIR", self.converted)
        p.start()
        self.addCleanup(p.stop)


class FindBlenderTests(SimpleTestCase):
    def test_on_path(self):
        with mock.patch("processing.conversion.shutil.which", return_value="/usr/bin/blender"):
            self.assertEqual(C.find_blender(), "/usr/bin/blender")

    def test_known_candidate(self):
        target = C.BLENDER_CANDIDATES[1]
        with mock.patch("processing.conversion.shutil.which", return_value=None), \
                mock.patch("processing.conversion.os.path.exists", side_effect=lambda p: p == target):
            self.assertEqual(C.find_blender(), target)

    def test_scans_versioned_folders_newest_first(self):
        base = r"C:\Program Files\Blender Foundation"
        want = os.path.join(base, "Blender 3.6", "blender.exe")
        with mock.patch("processing.conversion.shutil.which", return_value=None), \
                mock.patch("processing.conversion.os.path.isdir", return_value=True), \
                mock.patch("processing.conversion.os.listdir", return_value=["Blender 3.1", "Blender 3.6", "junk"]), \
                mock.patch("processing.conversion.os.path.exists",
                           side_effect=lambda p: p in (want, os.path.join(base, "Blender 3.1", "blender.exe"))):
            self.assertEqual(C.find_blender(), want)

    def test_not_found(self):
        with mock.patch("processing.conversion.shutil.which", return_value=None), \
                mock.patch("processing.conversion.os.path.exists", return_value=False), \
                mock.patch("processing.conversion.os.path.isdir", return_value=False):
            self.assertIsNone(C.find_blender())


class GeomSettingsTests(SimpleTestCase):
    def test_string_keys(self):
        s = C._make_geom_settings()
        self.assertTrue(s.get("use-world-coords"))

    def test_legacy_enum_api(self):
        import ifcopenshell.geom
        s = mock.MagicMock()
        s.set.side_effect = [TypeError, None, None]
        with mock.patch.object(ifcopenshell.geom, "settings", return_value=s):
            self.assertIs(C._make_geom_settings(), s)
        s.set.assert_any_call(s.USE_WORLD_COORDS, True)
        s.set.assert_any_call(s.WELD_VERTICES, True)


class IfcToGlbTests(TmpMixin, SimpleTestCase):
    def test_extracts_elements_and_bakes_y_up(self):
        ifc = _build_ifc(os.path.join(self.tmp, "w.ifc"))
        tm = fake_trimesh()
        logs = []
        with mock.patch.dict(sys.modules, {"trimesh": tm}):
            n = C.ifc_to_glb(ifc, os.path.join(self.tmp, "o.glb"), logs.append)
        self.assertEqual(n, 1)
        node, mesh = tm.added[0]
        self.assertTrue(node.endswith("_0"))
        self.assertEqual(mesh.vertices.shape[1], 3)
        self.assertEqual(logs[0], "Opening IFC file...")
        self.assertIn("Extracted 1 elements", logs[-1])

    def test_material_colour_and_bad_shape(self):
        shapes = []
        good = mock.MagicMock()
        good.geometry.verts = [0, 0, 0, 1, 0, 0, 0, 1, 0]
        good.geometry.faces = [0, 1, 2]
        good.geometry.materials = [types.SimpleNamespace(diffuse=(2.0, 0.5, -1.0))]
        good.name = None
        good.id = 7
        bad = mock.MagicMock()
        bad.geometry.verts = [1, 2]  # not divisible by 3 -> reshape error, skipped
        broken_mat = mock.MagicMock()
        broken_mat.geometry.verts = [0, 0, 0, 1, 0, 0, 0, 1, 0]
        broken_mat.geometry.faces = [0, 1, 2]
        type(broken_mat.geometry).materials = mock.PropertyMock(side_effect=RuntimeError)
        broken_mat.name = "Named"
        shapes = [good, bad, broken_mat]
        it = mock.MagicMock()
        it.initialize.return_value = True
        it.get.side_effect = shapes
        it.next.side_effect = [True, True, False]
        tm = fake_trimesh()
        import ifcopenshell, ifcopenshell.geom
        with mock.patch.dict(sys.modules, {"trimesh": tm}), \
                mock.patch.object(ifcopenshell, "open"), \
                mock.patch.object(ifcopenshell.geom, "iterator", return_value=it):
            n = C.ifc_to_glb("x.ifc", os.path.join(self.tmp, "o.glb"), lambda m: None)
        self.assertEqual(n, 2)
        self.assertEqual(tm.added[0][0], "element_7_0")
        self.assertEqual(tm.added[0][1].visual.face_colors, [255, 127, 0, 255])
        self.assertEqual(tm.added[1][0], "Named_1")

    def _run_with_iterator(self, it, tm=None):
        import ifcopenshell, ifcopenshell.geom
        with mock.patch.dict(sys.modules, {"trimesh": tm or fake_trimesh()}), \
                mock.patch.object(ifcopenshell, "open"), \
                mock.patch.object(ifcopenshell.geom, "iterator", return_value=it):
            return C.ifc_to_glb("x.ifc", os.path.join(self.tmp, "o.glb"), lambda m: None)

    def test_no_geometry(self):
        it = mock.MagicMock()
        it.initialize.return_value = False
        with self.assertRaisesRegex(C.ConversionError, "No 3D geometry"):
            self._run_with_iterator(it)

    def test_no_usable_shapes(self):
        empty = mock.MagicMock()
        empty.geometry.verts = []
        empty.geometry.faces = []
        it = mock.MagicMock()
        it.initialize.return_value = True
        it.get.return_value = empty
        it.next.return_value = False
        with self.assertRaisesRegex(C.ConversionError, "Could not extract any geometry"):
            self._run_with_iterator(it)

    def test_empty_glb_written(self):
        ifc = _build_ifc(os.path.join(self.tmp, "w.ifc"))
        with mock.patch.dict(sys.modules, {"trimesh": fake_trimesh(write_bytes=b"")}):
            with self.assertRaisesRegex(C.ConversionError, "Failed to write intermediate"):
                C.ifc_to_glb(ifc, os.path.join(self.tmp, "o.glb"), lambda m: None)


class GlbToFbxTests(TmpMixin, SimpleTestCase):
    def setUp(self):
        super().setUp()
        self.fbx = os.path.join(self.tmp, "o.fbx")
        p = mock.patch("processing.conversion.find_blender", return_value="blender")
        p.start()
        self.addCleanup(p.stop)

    def _scripts_left(self, run):
        return os.path.exists(run.call_args[0][0][4])

    def test_success_and_script_removed(self):
        def run(cmd, **kw):
            with open(cmd[-1], "wb") as f:
                f.write(b"fbx")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with mock.patch("processing.conversion.subprocess.run", side_effect=run) as r:
            C.glb_to_fbx("in.glb", self.fbx, lambda m: None)
        cmd = r.call_args[0][0]
        self.assertEqual(cmd[:4], ["blender", "--background", "--factory-startup", "--python"])
        self.assertEqual(cmd[-3:], ["--", "in.glb", self.fbx])
        self.assertEqual(r.call_args[1]["timeout"], 600)
        self.assertFalse(self._scripts_left(r))

    def test_blender_failure_reports_stderr_tail(self):
        res = subprocess.CompletedProcess([], 1, "out", "x" * 600 + "Error: bad glb")
        with mock.patch("processing.conversion.subprocess.run", return_value=res) as r:
            with self.assertRaises(C.ConversionError) as cm:
                C.glb_to_fbx("in.glb", self.fbx, lambda m: None)
        self.assertTrue(str(cm.exception).endswith("Error: bad glb"))
        self.assertLess(len(str(cm.exception)), 540)
        self.assertFalse(self._scripts_left(r))

    def test_zero_exit_but_no_output(self):
        res = subprocess.CompletedProcess([], 0, "only stdout", None)
        with mock.patch("processing.conversion.subprocess.run", return_value=res):
            with self.assertRaisesRegex(C.ConversionError, "only stdout"):
                C.glb_to_fbx("in.glb", self.fbx, lambda m: None)

    def test_timeout(self):
        with mock.patch("processing.conversion.subprocess.run",
                        side_effect=subprocess.TimeoutExpired("blender", 600)):
            with self.assertRaisesRegex(C.ConversionError, "timed out"):
                C.glb_to_fbx("in.glb", self.fbx, lambda m: None)

    def test_blender_missing(self):
        with mock.patch("processing.conversion.find_blender", return_value=None):
            with self.assertRaisesRegex(C.ConversionError, "Blender is required"):
                C.glb_to_fbx("in.glb", self.fbx, lambda m: None)


class PipelineTests(TmpMixin, SimpleTestCase):
    def test_cleanup_stale(self):
        C.cleanup_stale_conversions()  # dir missing -> no-op
        old, new = os.path.join(self.converted, "old"), os.path.join(self.converted, "new")
        os.makedirs(old)
        os.makedirs(new)
        past = time.time() - C.MAX_FILE_AGE_SECONDS - 10
        os.utime(old, (past, past))
        C.cleanup_stale_conversions()
        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.exists(new))
        with mock.patch("processing.conversion.os.path.getmtime", side_effect=OSError):
            C.cleanup_stale_conversions()
        self.assertTrue(os.path.exists(new))

    def test_convert_success(self):
        def glb(inp, out, log):
            with open(inp, "rb") as f:
                self.assertEqual(f.read(), b"ISO-10303-21;")
            self.work_dir = os.path.dirname(inp)
            return 4

        def fbx(g, out, log):
            with open(out, "wb") as f:
                f.write(b"fbx")

        logs = []
        with mock.patch.object(C, "ifc_to_glb", side_effect=glb), mock.patch.object(C, "glb_to_fbx", side_effect=fbx):
            fid, name, count = C.convert_ifc_to_fbx(SimpleUploadedFile("My Model.ifc", b"ISO-10303-21;"), logs.append)
        self.assertEqual((name, count), ("My Model.fbx", 4))
        self.assertEqual(logs, ["Conversion complete."])
        self.assertFalse(os.path.exists(self.work_dir))  # temp work dir removed
        path = C.get_converted_file(fid)
        self.assertEqual(path, os.path.join(self.converted, fid, "My Model.fbx"))
        C.delete_converted_file(fid)
        self.assertFalse(os.path.exists(os.path.join(self.converted, fid)))

    def test_convert_failure_removes_output_dir(self):
        with mock.patch.object(C, "ifc_to_glb", side_effect=C.ConversionError("nope")):
            with self.assertRaisesRegex(C.ConversionError, "nope"):
                C.convert_ifc_to_fbx(SimpleUploadedFile("m.ifc", b"x"), lambda m: None)
        self.assertEqual(os.listdir(self.converted), [])

    def test_get_and_delete_reject_traversal(self):
        for bad in (None, "", "../etc", "a/b", "a.b"):
            self.assertIsNone(C.get_converted_file(bad))
            C.delete_converted_file(bad)  # no-op, no error
        self.assertIsNone(C.get_converted_file("abc123"))  # no such dir
        os.makedirs(os.path.join(self.converted, "abc123"))
        with open(os.path.join(self.converted, "abc123", "x.glb"), "w"):
            pass
        self.assertIsNone(C.get_converted_file("abc123"))  # no .fbx inside
