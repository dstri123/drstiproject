"""Viewer point-cloud export: section-box crop of the original upload → PLY."""
import os
import shutil
import tempfile

from unittest import mock

import numpy as np
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.signals import request_finished
from django.db import close_old_connections
from django.test import SimpleTestCase

from accounts.models import User
from processing import pointcloud_export as pe
from processing.models import PointCloudMerge
from projects.models import PointCloudData

from .test_views_base import PW, ProcessingViewTestBase

IDENTITY = list(np.eye(4).T.ravel())  # Three.js column-major


def ascii_ply(points, colors=None, color_type="uchar"):
    head = ["ply", "format ascii 1.0", f"element vertex {len(points)}",
            "property double x", "property double y", "property double z"]
    if colors is not None:
        head += [f"property {color_type} red", f"property {color_type} green",
                 f"property {color_type} blue"]
    head.append("end_header")
    rows = []
    for i, p in enumerate(points):
        row = [repr(float(v)) for v in p]
        if colors is not None:
            row += [str(int(v)) for v in colors[i]]
        rows.append(" ".join(row))
    return ("\n".join(head + rows) + "\n").encode()


def read_ply(blob):
    head, _, body = blob.partition(b"end_header\n")
    head = head.decode()
    count = int(head.split("element vertex ")[1].split("\n")[0])
    fields = [("x", "<f8"), ("y", "<f8"), ("z", "<f8")]
    has_color = "property uchar red" in head
    if has_color:
        fields += [("r", "u1"), ("g", "u1"), ("b", "u1")]
    arr = np.frombuffer(body, dtype=np.dtype(fields), count=count)
    xyz = np.column_stack([arr["x"], arr["y"], arr["z"]])
    rgb = np.column_stack([arr["r"], arr["g"], arr["b"]]) if has_color else None
    return head, xyz, rgb


def three_elements(M):
    return list(np.asarray(M, dtype=np.float64).T.ravel())


# ─── Engine ───────────────────────────────────────────────────────────────────
class ExportEngineTests(SimpleTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pcexport_test_")
        self.out = os.path.join(self.dir, "out.ply")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def src(self, blob, name="in.ply"):
        path = os.path.join(self.dir, name)
        with open(path, "wb") as f:
            f.write(blob)
        return path

    def export(self, path, **kw):
        kw.setdefault("raw_to_world", np.eye(4))
        result = pe.export_cropped_ply(path, os.path.splitext(path)[1], self.out, **kw)
        with open(self.out, "rb") as f:
            return result, read_ply(f.read())

    def test_crop_keeps_inside_points_with_raw_coordinates_and_colour(self):
        pts = [[0, 0, 0], [1, 1, 1], [5, 5, 5], [0.5, 0.2, 0.9]]
        cols = [[10, 20, 30], [40, 50, 60], [70, 80, 90], [1, 2, 3]]
        path = self.src(ascii_ply(pts, cols))
        result, (_, xyz, rgb) = self.export(path, box=(np.zeros(3), np.ones(3)))
        self.assertEqual(result["point_count"], 3)
        self.assertEqual(result["input_point_count"], 4)
        np.testing.assert_allclose(xyz, [[0, 0, 0], [1, 1, 1], [0.5, 0.2, 0.9]])
        np.testing.assert_array_equal(rgb, [[10, 20, 30], [40, 50, 60], [1, 2, 3]])

    def test_box_is_tested_in_world_space_but_original_frame_keeps_raw(self):
        # The viewer moved the cloud +100 in x: only raw x≈0 lands in [99, 101].
        M = np.eye(4)
        M[0, 3] = 100
        path = self.src(ascii_ply([[0, 0, 0], [50, 0, 0]]))
        _, (_, xyz, rgb) = self.export(
            path, raw_to_world=M, box=(np.array([99, -1, -1.0]), np.array([101, 1, 1.0])))
        np.testing.assert_allclose(xyz, [[0, 0, 0]])
        self.assertIsNone(rgb)

    def test_aligned_frame_applies_placement_and_converts_y_up_to_z_up(self):
        M = np.eye(4)
        M[:3, 3] = [10, 20, 30]
        path = self.src(ascii_ply([[1, 2, 3]]))
        _, (_, xyz, _) = self.export(path, raw_to_world=M, frame="aligned")
        # world (11, 22, 33) Y-up -> Z-up (x, -z, y)
        np.testing.assert_allclose(xyz, [[11, -33, 22]])

    def test_georeferenced_coordinates_keep_double_precision(self):
        p = [512345.678, 4123456.789, 101.234]
        path = self.src(ascii_ply([p]))
        _, (_, xyz, _) = self.export(path)
        np.testing.assert_allclose(xyz[0], p, rtol=0, atol=1e-6)

    def test_sixteen_bit_colour_is_scaled_to_eight_bit(self):
        path = self.src(ascii_ply([[0, 0, 0], [1, 1, 1]],
                                  [[65535, 0, 32768], [256, 256, 256]], "ushort"))
        _, (_, _, rgb) = self.export(path)
        np.testing.assert_array_equal(rgb, [[255, 0, 128], [1, 1, 1]])

    def test_original_offset_is_added_in_original_frame(self):
        path = self.src(ascii_ply([[1, 1, 1]]))
        _, (_, xyz, _) = self.export(path, original_offset=[100, 200, 300])
        np.testing.assert_allclose(xyz, [[101, 201, 301]])

    def test_xyz_ascii_source(self):
        path = self.src(b"0 0 0 255 0 0\n9 9 9 0 255 0\n", name="in.xyz")
        _, (_, xyz, rgb) = self.export(path, box=(np.full(3, -1.0), np.full(3, 1.0)))
        np.testing.assert_allclose(xyz, [[0, 0, 0]])
        np.testing.assert_array_equal(rgb, [[255, 0, 0]])

    def test_las_source(self):
        try:
            import laspy
        except ImportError:  # pragma: no cover
            self.skipTest("laspy not installed")
        header = laspy.LasHeader(point_format=2, version="1.2")
        header.scales = [0.001, 0.001, 0.001]
        header.offsets = [500000, 4000000, 0]
        las = laspy.LasData(header)
        las.x = np.array([500001.0, 500100.0])
        las.y = np.array([4000001.0, 4000100.0])
        las.z = np.array([1.0, 1.0])
        las.red = np.array([65535, 0])
        las.green = np.array([0, 0])
        las.blue = np.array([0, 65535])
        path = os.path.join(self.dir, "in.las")
        las.write(path)
        _, (_, xyz, rgb) = self.export(
            path, box=(np.array([500000, 4000000, 0.0]), np.array([500010, 4000010, 5.0])))
        np.testing.assert_allclose(xyz, [[500001.0, 4000001.0, 1.0]], atol=1e-6)
        np.testing.assert_array_equal(rgb, [[255, 0, 0]])

    def test_empty_crop_raises(self):
        path = self.src(ascii_ply([[5, 5, 5]]))
        with self.assertRaisesRegex(pe.ExportError, "No points are inside"):
            self.export(path, box=(np.zeros(3), np.ones(3)))

    def test_unsupported_extension_and_frame(self):
        path = self.src(b"x", name="in.e57")
        with self.assertRaises(pe.ExportError):
            self.export(path)
        with self.assertRaisesRegex(pe.ExportError, "frame"):
            self.export(self.src(ascii_ply([[0, 0, 0]])), frame="sideways")

    def test_payload_validation(self):
        np.testing.assert_allclose(pe.matrix_from_elements(IDENTITY), np.eye(4))
        M = np.eye(4)
        M[0, 3] = 7
        np.testing.assert_allclose(pe.matrix_from_elements(three_elements(M)), M)
        for bad in (None, [1] * 15, ["a"] * 16, [0] * 16, [float("nan")] * 16):
            with self.assertRaises(pe.ExportError):
                pe.matrix_from_elements(bad)
        self.assertIsNone(pe.box_from_payload(None))
        for bad in ("x", {"min": [0, 0], "max": [1, 1, 1]}, {"min": [2, 0, 0], "max": [1, 1, 1]}):
            with self.assertRaises(pe.ExportError):
                pe.box_from_payload(bad)


# ─── View ─────────────────────────────────────────────────────────────────────
class ExportViewTests(ProcessingViewTestBase):
    URL = "tools/pointcloud-export/"

    def setUp(self):
        super().setUp()
        self.cloud = PointCloudData.objects.create(
            project=self.project, description="scan", date=self.pc.date,
            file=SimpleUploadedFile("site scan.ply",
                                    ascii_ply([[0, 0, 0], [1, 1, 1], [9, 9, 9]],
                                              [[1, 2, 3], [4, 5, 6], [7, 8, 9]])),
        )

    def body(self, **kw):
        data = {"pointcloud_id": self.cloud.id, "raw_to_world": IDENTITY,
                "box": {"min": [-0.5, -0.5, -0.5], "max": [1.5, 1.5, 1.5]}}
        data.update(kw)
        return data

    def export(self, body):
        """POST and remember the server's temp export directory."""
        created, real = [], tempfile.mkdtemp

        def spy(*a, **kw):
            created.append(real(*a, **kw))
            return created[-1]

        with mock.patch("processing.views.tempfile.mkdtemp", side_effect=spy):
            res = self.post(self.URL, body)
        res.work_dirs = created
        return res

    def download(self, res):
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        blob = b"".join(res.streaming_content)
        self.assertEqual(len(res.work_dirs), 1)
        work_dir = res.work_dirs[0]
        # Closing a response sends request_finished, whose close_old_connections
        # handler would break the test transaction; the server closes it the same
        # way, which is what removes the temp directory.
        request_finished.disconnect(close_old_connections)
        try:
            res.close()
        finally:
            request_finished.connect(close_old_connections)
        self.assertFalse(os.path.exists(work_dir), "temp export dir was not removed")
        return read_ply(blob)

    def test_exports_cropped_ply_attachment(self):
        res = self.export(self.body())
        self.assertRegex(res["Content-Disposition"],
                         r'filename="site_scan\w*_cropped_original\.ply"')
        self.assertEqual(res["X-Point-Count"], "2")
        _, xyz, rgb = self.download(res)
        np.testing.assert_allclose(xyz, [[0, 0, 0], [1, 1, 1]])
        np.testing.assert_array_equal(rgb, [[1, 2, 3], [4, 5, 6]])

    def test_no_box_exports_everything_aligned(self):
        res = self.export(self.body(box=None, frame="aligned"))
        self.assertRegex(res["Content-Disposition"], r"site_scan\w*_export_aligned\.ply")
        _, xyz, _ = self.download(res)
        np.testing.assert_allclose(xyz, [[0, 0, 0], [1, -1, 1], [9, -9, 9]])

    def test_merged_cloud_original_frame_adds_origin_offset(self):
        merge = PointCloudMerge.objects.create(
            project=self.project, year=2026, month=3, source_fingerprint="x",
            status="completed", origin_offset=[1000, 0, 0],
            file=SimpleUploadedFile("merged.ply", ascii_ply([[0, 0, 0]])),
        )
        res = self.export({"merge_id": merge.id, "raw_to_world": IDENTITY, "box": None})
        _, xyz, _ = self.download(res)
        np.testing.assert_allclose(xyz, [[1000, 0, 0]])

    def test_validation_errors(self):
        self.assertEqual(self.post(self.URL, self.body(raw_to_world=[1, 2])).status_code, 400)
        self.assertEqual(self.post(self.URL, self.body(merge_id=5)).status_code, 400)
        self.assertEqual(self.post(self.URL, self.body(frame="up")).status_code, 400)
        res = self.export(self.body(box={"min": [5, 5, 5], "max": [6, 6, 6]}))
        self.assertEqual(res.status_code, 400)
        self.assertIn("No points", res.data["error"])
        self.assertFalse(os.path.exists(res.work_dirs[0]), "temp dir leaked on error")
        self.assertEqual(self.post(self.URL, self.body(pointcloud_id=999999)).status_code, 404)
        self.assertEqual(self.post(self.URL, {"merge_id": 999999, "raw_to_world": IDENTITY}).status_code, 404)

    def test_requires_project_membership(self):
        outsider = User.objects.create_user("outsider", "o@x.com", PW, role="member")
        self.client.force_authenticate(outsider)
        self.assertEqual(self.post(self.URL, self.body()).status_code, 403)
        self.logout()
        self.assertIn(self.post(self.URL, self.body()).status_code, (401, 403))
