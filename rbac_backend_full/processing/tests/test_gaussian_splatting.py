"""Unit tests for processing/gaussian_splatting.py.

PyTorch fails to load in this environment (DLL error), so the torch-based
renderer/trainer (_render, _covariance_3d, the optimisation loop) is only run
when torch imports; the COLMAP parsers, image loading and PLY writer are pure
numpy/PIL and are fully tested.
"""
import io
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

import numpy as np
from PIL import Image
from django.test import SimpleTestCase

from processing import gaussian_splatting as G

try:
    import torch  # noqa: F401
    HAS_TORCH = True
except Exception:  # ImportError, or OSError when the DLLs are missing
    HAS_TORCH = False

CAMERAS = """# Camera list
1 PINHOLE 640 480 500 510 320 240
2 SIMPLE_RADIAL 100 50 80 50 25 0.01
3 OPENCV 10 10 1 2 3 4 0 0 0 0
4 SIMPLE_PINHOLE 10 10 9 5 5
bad line
"""
IMAGES = """# Image list
1 1 0 0 0 0.1 0.2 0.3 1 frames\\a.png
2D points line ignored
2 1 0 0 0 0 0 5 2 b image.PNG

short line
"""
POINTS = """# 3D points
1 1.0 2.0 3.0 255 0 0 0.5 1 2
2 4.0 5.0 6.0 0 255 0 0.1
3 1 2
"""


def png_bytes(size=(512, 256), colour=(255, 0, 0)):
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, format="PNG")
    return buf.getvalue()


class ParserTests(SimpleTestCase):
    def test_parse_cameras(self):
        cams = G.parse_cameras(CAMERAS)
        self.assertEqual(cams[1], (640, 480, 500.0, 510.0, 320.0, 240.0))
        self.assertEqual(cams[2], (100, 50, 80.0, 80.0, 50.0, 25.0))
        self.assertEqual(cams[3], (10, 10, 1.0, 2.0, 3.0, 4.0))
        self.assertEqual(cams[4], (10, 10, 9.0, 9.0, 5.0, 5.0))

    def test_parse_cameras_errors(self):
        with self.assertRaisesRegex(ValueError, "Unsupported COLMAP camera model: FOV"):
            G.parse_cameras("1 FOV 1 1 1 1 1 1")
        with self.assertRaisesRegex(ValueError, "no supported cameras"):
            G.parse_cameras("# only comments\n")

    def test_parse_images_skips_point_lines(self):
        imgs = G.parse_images(IMAGES)
        self.assertEqual(len(imgs), 2)
        self.assertEqual(imgs[0], {"name": "frames\\a.png", "camera_id": 1,
                                   "q": [1.0, 0.0, 0.0, 0.0], "t": [0.1, 0.2, 0.3]})
        self.assertEqual(imgs[1]["name"], "b image.PNG")
        with self.assertRaisesRegex(ValueError, "no camera poses"):
            G.parse_images("1 2 3\n")

    def test_parse_points(self):
        pts = G.parse_points(POINTS)
        self.assertEqual(pts.dtype, np.float32)
        np.testing.assert_allclose(pts, [[1, 2, 3, 255, 0, 0, 0.5], [4, 5, 6, 0, 255, 0, 0.1]], rtol=1e-6)
        with self.assertRaisesRegex(ValueError, "no sparse points"):
            G.parse_points("")

    def test_data_lines(self):
        self.assertEqual(G._data_lines("  # c\n\n a b \n"), ["a b"])

    def test_quat_to_matrix_wxyz(self):
        np.testing.assert_allclose(G._quat_to_matrix([1, 0, 0, 0]), np.eye(3))
        s = np.sqrt(0.5)
        R = G._quat_to_matrix([s, 0, 0, s])  # 90 deg about z
        np.testing.assert_allclose(R @ [1, 0, 0], [0, 1, 0], atol=1e-6)
        self.assertEqual(R.dtype, np.float32)


class LoadImagesTests(SimpleTestCase):
    def _zip(self, entries):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for name, data in entries.items():
                zf.writestr(name, data)
        buf.seek(0)
        return buf

    def test_matches_by_path_and_basename_and_scales_camera(self):
        z = self._zip({"frames/a.png": png_bytes((512, 256)), "other/B IMAGE.png": png_bytes((100, 50), (0, 0, 255))})
        cams = G.parse_cameras(CAMERAS)
        poses = G.parse_images(IMAGES) + [{"name": "missing.png", "camera_id": 1, "q": [1, 0, 0, 0], "t": [0, 0, 0]}]
        frames = G._load_images(z, poses, cams)
        self.assertEqual(len(frames), 2)
        pose, cam, pixels = frames[0]
        self.assertEqual(pixels.shape, (128, 256, 3))  # longest side capped at 256
        np.testing.assert_allclose(pixels[0, 0], [1, 0, 0])
        self.assertEqual(cam, (256, 128, 250.0, 255.0, 160.0, 120.0))
        _, cam2, px2 = frames[1]
        self.assertEqual(px2.shape, (50, 100, 3))  # small image not upscaled
        self.assertEqual(cam2[2], 80.0)  # SIMPLE_RADIAL fx, scale 1

    def test_no_match_raises(self):
        z = self._zip({"x.png": png_bytes((4, 4))})
        with self.assertRaisesRegex(ValueError, "No images matched images.txt. Requested: a.png. ZIP contains: x.png."):
            G._load_images(z, [{"name": "a.png", "camera_id": 1}], {})


class WritePlyTests(SimpleTestCase):
    def test_binary_layout(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        path = os.path.join(tmp, "g.ply")
        G._write_ply(path, np.array([[1, 2, 3]], np.float32), np.array([[1.0, 0.5, 0.0]]),
                     np.array([0.25]), np.array([[1.0, np.e, 1.0]]), np.array([[1, 0, 0, 0]]))
        with open(path, "rb") as f:
            data = f.read()
        header, body = data.split(b"end_header\n")
        self.assertIn(b"element vertex 1", header)
        self.assertIn(b"comment drsti activated", header)
        self.assertEqual(header.count(b"property float"), 14)
        vals = struct.unpack("<14f", body)
        np.testing.assert_allclose(vals, [1, 2, 3, 0.5, 0, -0.5, 0.25, 0, 1, 0, 1, 0, 0, 0], atol=1e-6)


class TrainTests(SimpleTestCase):
    def test_missing_torch_gives_install_hint(self):
        with mock.patch.object(G, "torch", None), mock.patch.dict(sys.modules, {"torch": None}):
            with self.assertRaisesRegex(RuntimeError, "PyTorch is required"):
                G.train_colmap_gaussians(CAMERAS, IMAGES, POINTS, None, "out.ply")

    @unittest.skipUnless(HAS_TORCH, "PyTorch cannot be imported in this environment (missing DLLs)")
    def test_train_tiny_scene_writes_ply(self):  # pragma: no cover - needs torch
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.png", png_bytes((32, 32)))
        buf.seek(0)
        out = os.path.join(tmp, "g.ply")
        res = G.train_colmap_gaussians("1 PINHOLE 32 32 30 30 16 16", "1 1 0 0 0 0 0 5 1 a.png\n\n",
                                       "1 0 0 0 255 0 0 0\n2 0.1 0 0 0 255 0 0", buf, out, iterations=2)
        self.assertEqual(res["point_count"], 2)
        self.assertTrue(os.path.getsize(out) > 0)
