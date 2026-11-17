"""Views: pointcloud-to-ply (+ PLY helpers), ICP/auto align, OSM tile proxy, gaussian training."""
import io
import os
import struct
import sys
import types
import urllib.error
from unittest import mock

import numpy as np
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

from processing import views
from processing.views import _file_to_ply_bytes, _xyz_to_ply_bytes

from .test_views_base import API, ProcessingViewTestBase


def _split_ply(blob):
    head, _, body = blob.partition(b"end_header\n")
    return head.decode(), body


# ─── PLY helpers ──────────────────────────────────────────────────────────────
class PlyHelperTests(ProcessingViewTestBase):
    def write(self, name, text):
        path = os.path.join(self._media, name)
        with open(path, "w") as f:
            f.write(text)
        return path

    def test_xyz_to_ply_without_colour(self):
        pts = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
        head, body = _split_ply(_xyz_to_ply_bytes(pts))
        self.assertIn("element vertex 2", head)
        self.assertNotIn("red", head)
        self.assertEqual(struct.unpack("<6f", body), (1, 2, 3, 4, 5, 6))

    def test_xyz_to_ply_with_colour_interleaves(self):
        pts = np.array([[1.0, 2.0, 3.0]])
        head, body = _split_ply(_xyz_to_ply_bytes(pts, np.array([[10, 20, 30]], dtype=np.uint8)))
        self.assertIn("property uchar red", head)
        self.assertEqual(struct.unpack("<3f3B", body), (1, 2, 3, 10, 20, 30))

    def test_colour_length_mismatch_is_dropped(self):
        head, body = _split_ply(_xyz_to_ply_bytes(np.zeros((2, 3)), np.zeros((1, 3), dtype=np.uint8)))
        self.assertNotIn("red", head)
        self.assertEqual(len(body), 24)

    def test_xyz_ascii_with_rgb(self):
        path = self.write("a.xyz", "# comment\n\n0 0 0 255 0 0\n1 1 1 0 255 0\nbad line here\n1 2\n")
        head, body = _split_ply(_file_to_ply_bytes(path, ".xyz"))
        self.assertIn("element vertex 2", head)
        self.assertEqual(struct.unpack("<3f3B3f3B", body), (0, 0, 0, 255, 0, 0, 1, 1, 1, 0, 255, 0))

    def test_pts_with_intensity_column(self):
        path = self.write("a.pts", "2\n0 0 0 5 1 2 3\n")
        # The count line "2" has < 3 columns and is skipped.
        head, body = _split_ply(_file_to_ply_bytes(path, ".pts"))
        self.assertEqual(struct.unpack("<3f3B", body), (0, 0, 0, 1, 2, 3))

    def test_partial_colour_rows_drop_colour(self):
        path = self.write("b.xyz", "0 0 0 1 2 3\n1 1 1\n")
        head, _ = _split_ply(_file_to_ply_bytes(path, ".xyz"))
        self.assertIn("element vertex 2", head)
        self.assertNotIn("red", head)

    def test_empty_file_raises_value_error(self):
        with self.assertRaisesRegex(ValueError, "no readable points"):
            _file_to_ply_bytes(self.write("e.xyz", "# nothing\n"), ".xyz")

    def test_subsampling_is_deterministic_and_keeps_colour_rows(self):
        rows = "".join(f"{i} {i} {i} {i % 256} 0 0\n" for i in range(50))
        path = self.write("big.xyz", rows)
        a = _file_to_ply_bytes(path, ".xyz", max_points=10)
        b = _file_to_ply_bytes(path, ".xyz", max_points=10)
        self.assertEqual(a, b)
        head, body = _split_ply(a)
        self.assertIn("element vertex 10", head)
        for i in range(10):
            x, _, _, r, _, _ = struct.unpack_from("<3f3B", body, i * 15)
            self.assertEqual(int(x) % 256, r)

    def _fake_laspy(self, red_peak):
        las = types.SimpleNamespace(
            x=[0.0, 1.0], y=[0.0, 2.0], z=[0.0, 3.0],
            red=[red_peak, 0], green=[0, 0], blue=[0, 0],
        )
        return types.SimpleNamespace(read=lambda path: las)

    def test_las_16bit_colour_is_scaled(self):
        with mock.patch.dict(sys.modules, {"laspy": self._fake_laspy(65535)}):
            _, body = _split_ply(_file_to_ply_bytes("x.las", ".las"))
        self.assertEqual(struct.unpack_from("<3f3B", body, 0)[3], 255)

    def test_las_8bit_colour_in_16bit_fields_is_kept(self):
        with mock.patch.dict(sys.modules, {"laspy": self._fake_laspy(200)}):
            _, body = _split_ply(_file_to_ply_bytes("x.laz", ".laz"))
        self.assertEqual(struct.unpack_from("<3f3B", body, 0)[3], 200)

    def test_las_without_colour(self):
        las = types.SimpleNamespace(x=[0.0], y=[0.0], z=[0.0])
        with mock.patch.dict(sys.modules, {"laspy": types.SimpleNamespace(read=lambda p: las)}):
            head, _ = _split_ply(_file_to_ply_bytes("x.las", ".las"))
        self.assertNotIn("red", head)

    def test_las_broken_colour_is_ignored(self):
        las = types.SimpleNamespace(x=[0.0], y=[0.0], z=[0.0], red=[1], green=[], blue=[1])
        with mock.patch.dict(sys.modules, {"laspy": types.SimpleNamespace(read=lambda p: las)}):
            head, _ = _split_ply(_file_to_ply_bytes("x.las", ".las"))
        self.assertNotIn("red", head)

    def test_las_without_laspy_raises_import_error(self):
        with mock.patch.dict(sys.modules, {"laspy": None}):
            with self.assertRaisesRegex(ImportError, "laspy is required"):
                _file_to_ply_bytes("x.las", ".las")

    @mock.patch("processing.progress.read_pointcloud_points", return_value=np.ones((3, 3)))
    def test_other_extensions_use_progress_reader(self, reader):
        head, _ = _split_ply(_file_to_ply_bytes("x.e57", ".e57", max_points=7))
        self.assertIn("element vertex 3", head)
        reader.assert_called_once_with("x.e57", max_points=7)


class PointCloudToPLYViewTests(ProcessingViewTestBase):
    URL = "tools/pointcloud-to-ply/"

    def upload(self, name, content=b"", url=None):
        return self.client.post(API + (url or self.URL), {"file": SimpleUploadedFile(name, content)},
                                format="multipart")

    def test_no_file(self):
        r = self.client.post(API + self.URL, {}, format="multipart")
        self.assertEqual((r.status_code, r.data), (400, {"error": "No file provided"}))

    def test_unsupported_extension(self):
        r = self.upload("scan.plz", b"x")
        self.assertEqual(r.status_code, 400)
        self.assertIn("'.plz' cannot be converted", r.data["error"])

    def test_ply_passes_through(self):
        r = self.upload("scan.PLY", b"ply-bytes")
        self.assertEqual((r.status_code, r.content), (200, b"ply-bytes"))
        self.assertEqual(r["Content-Disposition"], 'attachment; filename="scan.PLY"')

    def test_xyz_converted_and_temp_dir_removed(self):
        created = []
        real = views.shutil.rmtree

        def spy(path, **kw):
            created.append(path)
            return real(path, **kw)
        with mock.patch("processing.views.shutil.rmtree", side_effect=spy):
            r = self.upload("site.xyz", b"0 0 0\n1 1 1\n", url="tools/pointcloud-to-play/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Disposition"], 'attachment; filename="site.ply"')
        self.assertTrue(r.content.startswith(b"ply\n"))
        self.assertEqual(len(created), 1)
        self.assertFalse(os.path.exists(created[0]))

    def test_error_mapping(self):
        for exc, code in ((ImportError("need laspy"), 501), (ValueError("empty"), 400),
                          (RuntimeError("bad"), 500)):
            with mock.patch("processing.views._file_to_ply_bytes", side_effect=exc), \
                    mock.patch("traceback.print_exc"):
                r = self.upload("scan.las", b"LASF")
            self.assertEqual(r.status_code, code, exc)
        self.assertEqual(r.data["error"], "Conversion failed: bad")

    def test_empty_xyz_is_400(self):
        r = self.upload("empty.xyz", b"# none\n")
        self.assertEqual(r.status_code, 400)
        self.assertIn("no readable points", r.data["error"])


# ─── Alignment ───────────────────────────────────────────────────────────────
PTS = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]


class ICPAlignViewTests(ProcessingViewTestBase):
    def test_requires_both_point_sets(self):
        for body in ({}, {"source": PTS}, {"target": PTS}, {"source": [], "target": PTS}):
            r = self.post("align/icp/", body)
            self.assertEqual(r.status_code, 400, body)

    @mock.patch("processing.registration.run_icp_auto", return_value={"transform": "T", "fitness": 1.0})
    def test_passes_options_and_returns_result(self, icp):
        r = self.post("align/icp/", {"source": PTS, "target": PTS, "init_transform": [[1]],
                                     "max_iterations": "20", "threshold": 0.5, "with_scale": 1})
        self.assertEqual(r.data, {"transform": "T", "fitness": 1.0})
        icp.assert_called_once_with(PTS, PTS, init_transform=[[1]], max_iterations=20,
                                    threshold=0.5, with_scale=True)

    @mock.patch("processing.registration.run_icp_auto", return_value={})
    def test_defaults(self, icp):
        self.post("align/icp/", {"source": PTS, "target": PTS})
        icp.assert_called_once_with(PTS, PTS, init_transform=None, max_iterations=50,
                                    threshold=None, with_scale=False)

    def test_bad_max_iterations_is_400(self):
        r = self.post("align/icp/", {"source": PTS, "target": PTS, "max_iterations": "lots"})
        self.assertEqual(r.status_code, 400)

    def test_errors(self):
        with mock.patch("processing.registration.run_icp_auto", side_effect=ValueError("too few")):
            r = self.post("align/icp/", {"source": PTS, "target": PTS})
        self.assertEqual((r.status_code, r.data["error"]), (400, "too few"))
        with mock.patch("processing.registration.run_icp_auto", side_effect=RuntimeError("x")), \
                mock.patch("traceback.print_exc"):
            r = self.post("align/icp/", {"source": PTS, "target": PTS})
        self.assertEqual((r.status_code, r.data["error"]), (500, "ICP failed: x"))


class AutoAlignViewTests(ProcessingViewTestBase):
    def test_requires_both_point_sets(self):
        self.assertEqual(self.post("align/auto/", {"source": PTS}).status_code, 400)

    @mock.patch("processing.auto_registration.auto_register", return_value={"transform": "T"})
    def test_success(self, reg):
        r = self.post("align/auto/", {"source": PTS, "target": PTS, "init_transform": [[2]]})
        self.assertEqual(r.data, {"transform": "T"})
        reg.assert_called_once_with(PTS, PTS, init_transform=[[2]])

    def test_errors(self):
        with mock.patch("processing.auto_registration.auto_register", side_effect=ValueError("few")):
            self.assertEqual(self.post("align/auto/", {"source": PTS, "target": PTS}).status_code, 400)
        with mock.patch("processing.auto_registration.auto_register", side_effect=MemoryError()), \
                mock.patch("traceback.print_exc"):
            r = self.post("align/auto/", {"source": PTS, "target": PTS})
        self.assertEqual(r.status_code, 500)
        self.assertTrue(r.data["error"].startswith("Auto alignment failed"))


# ─── OSM tile proxy ──────────────────────────────────────────────────────────
class _Upstream(io.BytesIO):
    def __init__(self, data, ctype="image/png"):
        super().__init__(data)
        self.headers = mock.Mock(get_content_type=mock.Mock(return_value=ctype))


class OSMTileProxyViewTests(ProcessingViewTestBase):
    def tile(self, z, x, y):
        return self.client.get(API + f"osm-tile/{z}/{x}/{y}.png")

    def test_public_and_validates_coordinates(self):
        self.logout()
        for z, x, y in ((20, 0, 0), (1, 2, 0), (1, 0, 2), (0, 1, 0)):
            self.assertEqual(self.tile(z, x, y).status_code, 400, (z, x, y))

    def test_fetches_caches_and_serves_from_cache(self):
        self.logout()
        with mock.patch("urllib.request.urlopen", return_value=_Upstream(b"PNGDATA", "image/jpeg")) as up:
            r = self.tile(2, 1, 3)
        self.assertEqual((r.status_code, r.content, r["Content-Type"]), (200, b"PNGDATA", "image/jpeg"))
        self.assertEqual(r["Cross-Origin-Resource-Policy"], "cross-origin")
        self.assertEqual(r["Access-Control-Allow-Origin"], "*")
        req = up.call_args[0][0]
        self.assertEqual(req.full_url, "https://tile.openstreetmap.org/2/1/3.png")
        self.assertIn("DstriViewer", req.get_header("User-agent"))
        cached = os.path.join(settings.MEDIA_ROOT, "tile_cache", "2", "1", "3.png")
        self.assertTrue(os.path.exists(cached))
        self.assertFalse(os.path.exists(cached + ".tmp"))
        with mock.patch("urllib.request.urlopen") as up2:
            r = self.tile(2, 1, 3)
        up2.assert_not_called()
        self.assertEqual((r.content, r["Content-Type"]), (b"PNGDATA", "image/png"))

    def test_upstream_failure_is_502(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")), \
                mock.patch("builtins.print"):
            self.assertEqual(self.tile(3, 0, 0).status_code, 502)

    def test_cache_write_failure_still_serves_tile(self):
        with mock.patch("urllib.request.urlopen", return_value=_Upstream(b"T")), \
                mock.patch("processing.views.os.makedirs", side_effect=OSError("ro")), \
                mock.patch("builtins.print"):
            r = self.tile(4, 0, 0)
        self.assertEqual((r.status_code, r.content), (200, b"T"))

    def test_non_integer_coordinates_rejected(self):
        view = views.OSMTileProxyView()
        self.assertEqual(view.get(None, "a", 0, 0).status_code, 400)


# ─── Gaussian splat training ─────────────────────────────────────────────────
class GaussianSplatTrainingViewTests(ProcessingViewTestBase):
    def files(self, **extra):
        return {"cameras": SimpleUploadedFile("cameras.txt", b"cams"),
                "images_txt": SimpleUploadedFile("images.txt", b"imgs"),
                "points": SimpleUploadedFile("points3D.txt", b"pts"),
                "images": SimpleUploadedFile("images.zip", b"PK"), **extra}

    def send(self, data):
        return self.client.post(API + "gaussian/train/", data, format="multipart")

    def test_requires_all_files(self):
        data = self.files()
        del data["points"]
        r = self.send(data)
        self.assertEqual((r.status_code, r.data["error"]),
                         (400, "cameras, images_txt, points, and images are required"))

    def test_success_returns_url_and_result(self):
        def fake(cams, imgs, pts, zip_file, out, iterations):
            self.assertEqual((cams, imgs, pts, iterations), ("cams", "imgs", "pts", "30"))
            with open(out, "wb") as f:
                f.write(b"ply")
            return {"gaussians": 5}
        with mock.patch("processing.views.train_colmap_gaussians", side_effect=fake) as train:
            r = self.send(self.files(iterations="30"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["gaussians"], 5)
        self.assertRegex(r.data["url"], r"^http://testserver/media/gaussian_models/[0-9a-f]{32}\.ply$")
        out = train.call_args[0][4]
        self.assertTrue(os.path.exists(out))

    def test_default_iterations(self):
        with mock.patch("processing.views.train_colmap_gaussians", return_value={}) as train:
            self.send(self.files())
        self.assertEqual(train.call_args[0][5], 120)

    def test_failure_removes_partial_output_and_returns_422(self):
        def boom(*args):
            with open(args[4], "wb") as f:
                f.write(b"partial")
            raise RuntimeError("diverged")
        with mock.patch("processing.views.train_colmap_gaussians", side_effect=boom) as train, \
                mock.patch("traceback.print_exc"):
            r = self.send(self.files())
        self.assertEqual((r.status_code, r.data), (422, {"error": "diverged"}))
        self.assertFalse(os.path.exists(train.call_args[0][4]))

    def test_blocked_torch_is_503(self):
        with mock.patch("processing.views.train_colmap_gaussians",
                        side_effect=OSError("[WinError 4551] c10.dll blocked")), \
                mock.patch("traceback.print_exc"):
            r = self.send(self.files())
        self.assertEqual((r.status_code, r.data["code"]), (503, "TORCH_RUNTIME_BLOCKED"))
