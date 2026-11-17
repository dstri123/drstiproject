"""Unit tests for processing/validators.py (upload diagnostics)."""
import io
import zipfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from processing import validators as V


def checks(diags):
    return [(d.level, d.check_name) for d in diags]


class DiagnosticTests(SimpleTestCase):
    def test_to_dict(self):
        d = V.Diagnostic("info", "T", "D", check_name="c")
        self.assertEqual(d.to_dict(), {"level": "info", "title": "T", "detail": "D", "check_name": "c"})
        self.assertEqual(V.Diagnostic("error", "x").to_dict()["detail"], "")


class BimValidationTests(SimpleTestCase):
    def test_bad_extension_stops_early(self):
        d = V.validate_bim_upload(SimpleUploadedFile("m.obj", b"x"))
        self.assertEqual(checks(d), [("error", "extension")])
        self.assertIn('".obj"', d[0].detail)
        self.assertIn(".ifc", d[0].detail)

    def test_ifc_header(self):
        ok = V.validate_bim_upload(SimpleUploadedFile("M.IFC", b"ISO-10303-21;\nHEADER;"))
        self.assertEqual(checks(ok), [("info", "ifc_header")])
        self.assertEqual(ok[0].title, "IFC STEP header detected")
        bad = V.validate_bim_upload(SimpleUploadedFile("m.ifc", b"garbage"))
        self.assertEqual(checks(bad), [("warning", "ifc_header")])

    def test_fbx_header(self):
        binary = V.validate_bim_upload(SimpleUploadedFile("m.fbx", b"Kaydara FBX Binary  \x00\x1a\x00"))
        self.assertEqual(binary[0].title, "Binary FBX detected")
        ascii_ = V.validate_bim_upload(SimpleUploadedFile("m.fbx", b"; FBX 7.4 project file"))
        self.assertEqual(ascii_[0].title, "ASCII or non-standard FBX")

    def test_other_bim_ext_passes(self):
        d = V.validate_bim_upload(SimpleUploadedFile("m.rvt", b"x"))
        self.assertEqual(checks(d), [("info", "overall")])
        self.assertIn("m.rvt (0.0 MB) passed", d[0].detail)

    def test_large_file_warning(self):
        f = SimpleUploadedFile("m.rvt", b"x")
        f.size = (V.BIM_WARN_SIZE_MB + 1) * 1024 * 1024
        d = V.validate_bim_upload(f)
        self.assertEqual(checks(d), [("warning", "file_size")])
        self.assertIn("201.0 MB", d[0].detail)

    def test_header_read_errors(self):
        for name, check in (("m.ifc", "ifc_header"), ("m.fbx", "fbx_header")):
            f = mock.MagicMock(size=1)
            f.name = name
            f.read.side_effect = IOError("boom")
            d = V.validate_bim_upload(f)
            self.assertEqual(checks(d), [("warning", check)])
            self.assertEqual(d[0].detail, "boom")

    def test_header_check_rewinds(self):
        f = SimpleUploadedFile("m.ifc", b"ISO-10303-21;")
        V.validate_bim_upload(f)
        self.assertEqual(f.tell(), 0)


class PointCloudValidationTests(SimpleTestCase):
    def test_bad_extension(self):
        d = V.validate_pointcloud_upload(SimpleUploadedFile("s.obj", b"x"))
        self.assertEqual(checks(d), [("error", "extension")])

    def test_ply(self):
        self.assertEqual(checks(V.validate_pointcloud_upload(SimpleUploadedFile("s.ply", b"ply\n"))),
                         [("info", "ply_header")])
        self.assertEqual(checks(V.validate_pointcloud_upload(SimpleUploadedFile("s.ply", b"xyz"))),
                         [("error", "ply_header")])

    def test_las_laz(self):
        for name in ("s.las", "s.LAZ"):
            self.assertEqual(checks(V.validate_pointcloud_upload(SimpleUploadedFile(name, b"LASF..."))),
                             [("info", "las_header")])
        self.assertEqual(checks(V.validate_pointcloud_upload(SimpleUploadedFile("s.las", b"NOPE"))),
                         [("error", "las_header")])

    def test_other_ext_passes_and_size_warning(self):
        self.assertEqual(checks(V.validate_pointcloud_upload(SimpleUploadedFile("s.e57", b"x"))),
                         [("info", "overall")])
        f = SimpleUploadedFile("s.xyz", b"x")
        f.size = (V.PC_WARN_SIZE_MB + 1) * 1024 * 1024
        self.assertEqual(checks(V.validate_pointcloud_upload(f)), [("warning", "file_size")])

    def test_header_read_errors(self):
        for name, check in (("s.ply", "ply_header"), ("s.las", "las_header")):
            f = mock.MagicMock(size=1)
            f.name = name
            f.read.side_effect = IOError("boom")
            self.assertEqual(checks(V.validate_pointcloud_upload(f)), [("error", check)])


class ImageZipTests(SimpleTestCase):
    def _zip(self, names):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for n in names:
                if n.endswith("/"):
                    zf.writestr(zipfile.ZipInfo(n), "")
                else:
                    zf.writestr(n, b"data")
        buf.seek(0)
        return buf

    def test_not_a_zip(self):
        names, d = V.validate_image_zip(io.BytesIO(b"not a zip"))
        self.assertEqual(names, [])
        self.assertEqual(checks(d), [("error", "zip")])

    def test_mixed_contents(self):
        f = self._zip(["imgs/", "imgs/a.JPG", "b.png", "notes.txt"])
        names, d = V.validate_image_zip(f)
        self.assertEqual(names, ["imgs/a.JPG", "b.png"])
        self.assertEqual(checks(d), [("warning", "zip_contents"), ("info", "zip_contents")])
        self.assertEqual(d[-1].title, "2 image(s) ready for import")
        self.assertEqual(f.tell(), 0)

    def test_no_images(self):
        names, d = V.validate_image_zip(self._zip(["a.txt"]))
        self.assertEqual(names, [])
        self.assertEqual(d[-1].level, "error")
        self.assertIn("contains 1 files", d[-1].detail)
