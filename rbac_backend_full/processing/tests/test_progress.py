"""Unit tests for processing/progress.py (scan-to-BIM progress maths).

A real one-wall IFC (2 x 0.5 x 1 m box, volume 1 m^3, area 7 m^2) is built
with ifcopenshell.api so extract_elements/analyze run end to end.
"""
import os
import shutil
import struct
import sys
import tempfile
from unittest import mock

import numpy as np
from django.test import SimpleTestCase

from processing import progress as P


def _build_ifc(path, with_wall=True, ifc_class="IfcWall"):
    import ifcopenshell
    import ifcopenshell.api as api

    model = ifcopenshell.file(schema="IFC4")
    proj = api.run("root.create_entity", model, ifc_class="IfcProject", name="P")
    api.run("unit.assign_unit", model)
    ctx = api.run("context.add_context", model, context_type="Model")
    body = api.run("context.add_context", model, context_type="Model", context_identifier="Body",
                   target_view="MODEL_VIEW", parent=ctx)
    site = api.run("root.create_entity", model, ifc_class="IfcSite", name="S")
    bld = api.run("root.create_entity", model, ifc_class="IfcBuilding", name="B")
    storey = api.run("root.create_entity", model, ifc_class="IfcBuildingStorey", name="L1")
    storey.Elevation = 0.0
    api.run("aggregate.assign_object", model, relating_object=proj, products=[site])
    api.run("aggregate.assign_object", model, relating_object=site, products=[bld])
    api.run("aggregate.assign_object", model, relating_object=bld, products=[storey])
    if with_wall:
        wall = api.run("root.create_entity", model, ifc_class=ifc_class, name="W1")
        rep = api.run("geometry.add_wall_representation", model, context=body, length=2, height=1, thickness=0.5)
        api.run("geometry.assign_representation", model, product=wall, representation=rep)
        api.run("geometry.edit_object_placement", model, product=wall)
        api.run("spatial.assign_container", model, relating_structure=storey, products=[wall])
    model.write(path)
    return path


def _write_xyz(path, pts):
    with open(path, "w") as f:
        f.write("# x y z\n")
        for p in pts:
            f.write("%f %f %f 255 0 0\n" % tuple(p))
    return path


def _face_grid(spacing=0.05):
    """Points on the wall's y=0 face (x in [0,2], z in [0,1])."""
    xs = np.arange(0.0, 2.0 + 1e-9, spacing)
    zs = np.arange(0.0, 1.0 + 1e-9, spacing)
    X, Z = np.meshgrid(xs, zs)
    return np.c_[X.ravel(), np.zeros(X.size), Z.ravel()]


def _cube_mesh(size=1.0):
    v = np.array([[x, y, z] for x in (0, size) for y in (0, size) for z in (0, size)], dtype=float)
    # outward-oriented triangles of the unit cube (indices by bit pattern x*4+y*2+z)
    f = np.array([
        [0, 1, 3], [0, 3, 2],  # x=0
        [4, 6, 7], [4, 7, 5],  # x=1
        [0, 4, 5], [0, 5, 1],  # y=0
        [2, 3, 7], [2, 7, 6],  # y=1
        [0, 2, 6], [0, 6, 4],  # z=0
        [1, 5, 7], [1, 7, 3],  # z=1
    ])
    return v, f


class TmpDirMixin:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        super().tearDownClass()

    def p(self, name):
        return os.path.join(self.tmp, name)


# ─── Seeds ──────────────────────────────────────────────────────────────────
class SeedTests(TmpDirMixin, SimpleTestCase):
    def test_stable_seed_deterministic_and_input_sensitive(self):
        self.assertEqual(P._stable_seed("a", 1), P._stable_seed("a", 1))
        self.assertNotEqual(P._stable_seed("a", 1), P._stable_seed("a", 2))
        self.assertLess(P._stable_seed("x"), 2 ** 32)

    def test_file_content_seed_depends_on_bytes_not_path_and_is_cached(self):
        a, b, c = self.p("a.bin"), self.p("b.bin"), self.p("c.bin")
        for path, data in ((a, b"same"), (b, b"same"), (c, b"diff")):
            with open(path, "wb") as f:
                f.write(data)
        self.assertEqual(P._file_content_seed(a), P._file_content_seed(b))
        self.assertNotEqual(P._file_content_seed(a), P._file_content_seed(c))
        st = os.stat(a)
        self.assertIn((a, st.st_mtime, st.st_size), P._FILE_CONTENT_SEED_CACHE)
        with mock.patch("builtins.open", side_effect=AssertionError("re-read")):
            P._file_content_seed(a)  # cache hit, no re-read

    def test_file_content_seed_stat_failure_still_hashes(self):
        a = self.p("s.bin")
        with open(a, "wb") as f:
            f.write(b"x")
        with mock.patch("processing.progress.os.stat", side_effect=OSError):
            s1 = P._file_content_seed(a)
        self.assertEqual(s1, P._file_content_seed(a))

    def test_content_subsample_seed(self):
        pts = np.arange(9, dtype=float).reshape(3, 3)
        self.assertEqual(P._content_subsample_seed(pts, 5), P._content_subsample_seed(pts.copy(), 5))
        self.assertNotEqual(P._content_subsample_seed(pts, 5), P._content_subsample_seed(pts, 6))


# ─── Transforms ─────────────────────────────────────────────────────────────
class TransformTests(SimpleTestCase):
    def test_quat_identity_and_zero(self):
        np.testing.assert_allclose(P._quat_to_matrix([0, 0, 0, 1]), np.eye(3))
        np.testing.assert_allclose(P._quat_to_matrix([0, 0, 0, 0]), np.eye(3))

    def test_quat_90deg_about_z(self):
        s = np.sqrt(0.5)
        R = P._quat_to_matrix([0, 0, s, s])  # xyzw
        np.testing.assert_allclose(R @ [1, 0, 0], [0, 1, 0], atol=1e-12)

    def test_unnormalised_quat_is_normalised(self):
        np.testing.assert_allclose(P._quat_to_matrix([0, 0, 2, 2]), P._quat_to_matrix([0, 0, 1, 1]))

    def test_compose_matrix(self):
        np.testing.assert_allclose(P.compose_matrix(None), np.eye(4))
        np.testing.assert_allclose(P.compose_matrix({}), np.eye(4))
        s = np.sqrt(0.5)
        M = P.compose_matrix({"position": [1, 2, 3], "quaternion": [0, 0, s, s], "scale": [2, 2, 2]})
        np.testing.assert_allclose(M @ [1, 0, 0, 1], [1, 4, 3, 1], atol=1e-12)
        M2 = P.compose_matrix({"position": None, "quaternion": None, "scale": None})
        np.testing.assert_allclose(M2, np.eye(4))


# ─── Readers ────────────────────────────────────────────────────────────────
class ReaderTests(TmpDirMixin, SimpleTestCase):
    def _ply_ascii(self, name, pts):
        path = self.p(name)
        with open(path, "w") as f:
            f.write("ply\nformat ascii 1.0\ncomment c\nelement vertex %d\n" % len(pts))
            f.write("property uchar red\nproperty float x\nproperty float y\nproperty float z\n")
            f.write("element face 0\nproperty list uchar int vertex_indices\n\nend_header\n")
            for p in pts:
                f.write("7 %f %f %f\n" % tuple(p))
        return path

    def _ply_binary(self, name, pts, order="little"):
        path = self.p(name)
        fmt = "<" if order == "little" else ">"
        with open(path, "wb") as f:
            f.write(("ply\nformat binary_%s_endian 1.0\nelement vertex %d\n" % (order, len(pts))).encode())
            f.write(b"property double x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n")
            for p in pts:
                f.write(struct.pack(fmt + "dffB", p[0], p[1], p[2], 9))
        return path

    def test_ascii_ply(self):
        pts = [[1, 2, 3], [4, 5, 6]]
        out = P.read_ply_points(self._ply_ascii("a.ply", pts))
        np.testing.assert_allclose(out, pts)

    def test_binary_ply_little_and_big_endian(self):
        pts = [[1.5, 2, 3], [-4, 5, 6.25]]
        np.testing.assert_allclose(P.read_ply_points(self._ply_binary("b.ply", pts)), pts)
        np.testing.assert_allclose(P.read_ply_points(self._ply_binary("bb.ply", pts, "big")), pts)

    def test_ply_subsampled_deterministically(self):
        pts = np.arange(30, dtype=float).reshape(10, 3)
        path = self._ply_binary("s.ply", pts)
        a = P.read_ply_points(path, max_points=4)
        self.assertEqual(a.shape, (4, 3))
        np.testing.assert_array_equal(a, P.read_ply_points(path, max_points=4))
        # every sampled row is one of the originals
        for row in a:
            self.assertTrue((pts == row).all(axis=1).any())

    def test_ply_errors(self):
        bad = self.p("bad.ply")
        with open(bad, "wb") as f:
            f.write(b"notply\n")
        with self.assertRaisesRegex(ValueError, "Not a PLY"):
            P.read_ply_points(bad)
        eof = self.p("eof.ply")
        with open(eof, "wb") as f:
            f.write(b"ply\nformat ascii 1.0\nelement vertex 1\n")
        with self.assertRaisesRegex(ValueError, "Unexpected EOF"):
            P.read_ply_points(eof)

    def test_ascii_points(self):
        path = self.p("c.xyz")
        with open(path, "w") as f:
            f.write("# header\n\n1 2 3 255 255 255\nbad row here\n1 2\n4 5 6\n")
        np.testing.assert_allclose(P.read_ascii_points(path), [[1, 2, 3], [4, 5, 6]])
        sub = P.read_ascii_points(path, max_points=1)
        self.assertEqual(sub.shape, (1, 3))

    def test_ascii_points_empty_file_is_n_by_3(self):
        """Regression: a .xyz with no valid rows returned shape (0,), which
        crashed analyze() in np.hstack. It must be an empty (0, 3) array."""
        path = self.p("empty.xyz")
        with open(path, "w") as f:
            f.write("# nothing\n")
        self.assertEqual(P.read_ascii_points(path).shape, (0, 3))

    def test_las_points(self):
        import laspy
        path = self.p("d.las")
        las = laspy.create(point_format=0, file_version="1.2")
        las.header.scales = [0.001] * 3
        las.x = [1.0, 2.0, 3.0]
        las.y = [4.0, 5.0, 6.0]
        las.z = [7.0, 8.0, 9.0]
        las.write(path)
        np.testing.assert_allclose(P.read_las_points(path), [[1, 4, 7], [2, 5, 8], [3, 6, 9]])
        self.assertEqual(P.read_las_points(path, max_points=2).shape, (2, 3))
        np.testing.assert_allclose(P.read_pointcloud_points(path), P.read_las_points(path))

    def test_las_without_laspy(self):
        with mock.patch.dict(sys.modules, {"laspy": None}):
            with self.assertRaisesRegex(ImportError, "laspy is required"):
                P.read_las_points(self.p("x.las"))

    def test_dispatcher(self):
        ply = self._ply_ascii("e.PLY", [[1, 1, 1]])
        np.testing.assert_allclose(P.read_pointcloud_points(ply), [[1, 1, 1]])
        pts = self.p("e.pts")
        with open(pts, "w") as f:
            f.write("1 2 3\n")
        np.testing.assert_allclose(P.read_pointcloud_points(pts), [[1, 2, 3]])
        with self.assertRaisesRegex(ValueError, "Unsupported point cloud format '.e57'"):
            P.read_pointcloud_points("scan.e57")


# ─── Mesh maths ─────────────────────────────────────────────────────────────
class MeshMathTests(SimpleTestCase):
    def test_cube_volume_and_area(self):
        v, f = _cube_mesh(2.0)
        self.assertAlmostEqual(P._signed_volume_sum(v, f), 8.0)
        self.assertAlmostEqual(P._element_volume(v, f), 8.0)
        self.assertAlmostEqual(P._triangle_area_sum(v, f), 24.0)
        # reversed winding still gives a positive volume
        self.assertAlmostEqual(P._signed_volume_sum(v, f[:, ::-1]), 8.0)

    def test_empty_faces(self):
        v, _ = _cube_mesh()
        empty = np.zeros((0, 3), dtype=int)
        self.assertEqual(P._signed_volume_sum(v, empty), 0.0)
        self.assertEqual(P._triangle_area_sum(v, empty), 0.0)
        self.assertEqual(P._bbox_volume(np.zeros((0, 3))), 0.0)

    def test_open_shell_falls_back_to_bbox(self):
        # single flat quad: closed-mesh volume 0, bbox clamps thickness to 1e-4
        v = np.array([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]], dtype=float)
        f = np.array([[0, 1, 2], [0, 2, 3]])
        self.assertAlmostEqual(P._element_volume(v, f), 2 * 3 * 1e-4)

    def test_assignment_sample_count(self):
        self.assertEqual(P._assignment_sample_count(0, 0.1), P.MIN_ASSIGN_SAMPLES)
        self.assertEqual(P._assignment_sample_count(1, 0), P.MIN_ASSIGN_SAMPLES)
        self.assertEqual(P._assignment_sample_count(1.0, 0.1), 100)
        self.assertEqual(P._assignment_sample_count(0.01, 0.1), P.MIN_ASSIGN_SAMPLES)
        self.assertEqual(P._assignment_sample_count(1e6, 0.1), P.MAX_ASSIGN_SAMPLES)

    def test_sample_surface_on_mesh(self):
        v, f = _cube_mesh()
        s = P.sample_surface(v, f, 500, np.random.default_rng(0))
        self.assertEqual(s.shape, (500, 3))
        # every sample lies on a face of the unit cube
        on_face = np.isclose(s, 0).any(axis=1) | np.isclose(s, 1).any(axis=1)
        self.assertTrue(on_face.all())
        self.assertTrue(((s >= -1e-12) & (s <= 1 + 1e-12)).all())
        np.testing.assert_array_equal(s, P.sample_surface(v, f, 500, np.random.default_rng(0)))

    def test_sample_surface_edge_cases(self):
        v = np.arange(12, dtype=float).reshape(4, 3)
        np.testing.assert_array_equal(P.sample_surface(v, None, 2, None), v[:2])
        empty = np.zeros((0, 3))
        self.assertEqual(len(P.sample_surface(empty, np.zeros((0, 3), int), 5, None)), 0)
        degenerate = np.array([[0, 1, 2]])
        line = np.array([[0, 0, 0], [1, 0, 0], [2, 0, 0]], dtype=float)
        np.testing.assert_array_equal(P.sample_surface(line, degenerate, 5, None), line)

    def test_ransac_plane(self):
        rng = np.random.default_rng(1)
        plane = np.c_[rng.random((200, 2)), np.zeros(200)]
        ratio, n = P.ransac_plane(plane, np.random.default_rng(2))
        self.assertEqual(ratio, 1.0)
        np.testing.assert_allclose(np.abs(n), [0, 0, 1], atol=1e-9)
        cloud = rng.random((200, 3)) * 10
        ratio2, _ = P.ransac_plane(cloud, np.random.default_rng(3), thresh=0.01)
        self.assertLess(ratio2, 0.2)
        self.assertEqual(P.ransac_plane(plane[:2], rng), (0.0, None))
        collinear = np.c_[np.arange(5.0), np.zeros(5), np.zeros(5)]
        self.assertEqual(P.ransac_plane(collinear, rng, iters=5), (0.0, None))


# ─── Density / assignment ───────────────────────────────────────────────────
class DensityTests(SimpleTestCase):
    def setUp(self):
        from scipy.spatial import cKDTree
        g = np.arange(0, 1.0001, 0.1)
        X, Y, Z = np.meshgrid(g, g, g)
        self.grid = np.c_[X.ravel(), Y.ravel(), Z.ravel()]  # 0.1 m lattice
        self.tree = cKDTree(self.grid)

    def test_probe_density_exact_on_lattice(self):
        # cube of side 0.3 (half-width 0.15) around an interior lattice point holds 3x3x3 pts
        probes = np.tile([0.5, 0.5, 0.5], (5, 1))
        d = P._probe_density(self.tree, probes, 0.3)
        self.assertAlmostEqual(d, 27 / 0.027)
        d_self = P._probe_density(self.tree, probes, 0.3, exclude_self=True)
        self.assertAlmostEqual(d_self, 26 / 0.027)

    def test_probe_density_none_cases(self):
        self.assertIsNone(P._probe_density(None, np.zeros((5, 3)), 0.3))
        self.assertIsNone(P._probe_density(self.tree, np.zeros((0, 3)), 0.3))
        self.assertIsNone(P._probe_density(self.tree, np.zeros((5, 3)), 0.0))
        far = np.full((10, 3), 100.0)
        self.assertIsNone(P._probe_density(self.tree, far, 0.3))  # too few hits

    def test_intrinsic_density(self):
        rng = np.random.default_rng(0)
        self.assertEqual(P._intrinsic_density(np.zeros((1, 3)), 0.3, rng), 0.0)
        d = P._intrinsic_density(self.grid, 0.3, rng, cap=200)
        self.assertGreater(d, 0)

    def test_element_and_global_density_fallbacks(self):
        rng = np.random.default_rng(0)
        v, f = _cube_mesh(1.0)
        self.assertEqual(P._element_density(None, v, f, 0.3, 42.0, rng), 42.0)
        self.assertEqual(P._element_density(self.tree, np.zeros((0, 3)), f, 0.3, 42.0, rng), 42.0)
        far = v + 100
        self.assertEqual(P._element_density(self.tree, far, f, 0.3, 42.0, rng), 42.0)
        self.assertGreater(P._element_density(self.tree, v, f, 0.3, 42.0, rng), 0)
        self.assertEqual(P._global_probe_density(None, [], 0.3, rng), 0.0)
        self.assertEqual(P._global_probe_density(self.tree, [{"verts": np.zeros((0, 3))}], 0.3, rng), 0.0)
        self.assertGreater(P._global_probe_density(self.tree, [{"verts": v, "faces": f}], 0.3, rng), 0)
        self.assertEqual(P._global_probe_density(self.tree, [{"verts": far, "faces": f}], 0.3, rng), 0.0)

    def test_assign_points_to_nearest_element_without_double_counting(self):
        rng = np.random.default_rng(0)
        v, f = _cube_mesh(1.0)
        a = {"verts": v, "faces": f, "area": 6.0}
        b = {"verts": v + [5, 0, 0], "faces": f, "area": 6.0}
        empty = {"verts": np.zeros((0, 3)), "faces": None}
        pts = np.array([[0.5, 0.5, 1.0], [5.5, 0.5, 0.0], [3.0, 3.0, 3.0]])
        owner = P._assign_points_to_elements([empty, a, b], pts, 0.1, rng)
        np.testing.assert_array_equal(owner, [1, 2, -1])
        self.assertEqual(len(P._assign_points_to_elements([a], np.zeros((0, 3)), 0.1, rng)), 0)
        np.testing.assert_array_equal(P._assign_points_to_elements([empty], pts, 0.1, rng), [-1, -1, -1])


# ─── Built detection / rollups ──────────────────────────────────────────────
class ClassificationTests(SimpleTestCase):
    def test_sam_evidence(self):
        self.assertEqual(P.sam_evidence(None), (None, None))
        self.assertEqual(P.sam_evidence({"built": 5}), (None, None))
        self.assertEqual(P.sam_evidence({"built": 30, "partial": 0, "clutter": 10}), (0.75, 0.25))
        self.assertEqual(P.sam_evidence({"built": None, "clutter": 20}), (0.0, 1.0))

    def test_detect_built(self):
        self.assertEqual(P.detect_built(5, 100, None, None), "")
        self.assertEqual(P.detect_built(50, 59.9, None, None), "")
        self.assertEqual(P.detect_built(50, 60, 0.6, False), "sam")
        self.assertEqual(P.detect_built(50, 60, 0.4, True), "")
        self.assertEqual(P.detect_built(50, 60, None, True), "plane")
        self.assertEqual(P.detect_built(50, 60, None, False), "")
        self.assertEqual(P.detect_built(50, 60, None, None), "coverage")
        self.assertEqual(P.detect_built(50, 40, None, None, built_coverage=30), "coverage")

    def test_status(self):
        self.assertEqual(P._status(0, "coverage"), "completed")
        self.assertEqual(P._status(0, ""), "not_started")
        self.assertEqual(P._status(3, ""), "in_progress")

    def test_count_completion_and_points_coverage(self):
        self.assertEqual(P.count_completion(18, 35), 51.43)
        self.assertEqual(P.count_completion(1, 0), 0.0)
        self.assertEqual(P.points_coverage(50, 200), 25.0)
        self.assertEqual(P.points_coverage(500, 200), 100.0)
        self.assertEqual(P.points_coverage(5, 0), 0.0)

    def _rows(self):
        return [
            {"category": "Walls", "status": "completed", "bim_volume": 3.0, "bim_points": 100,
             "overlap_points": 80, "level": "L1", "level_elevation": 0.0, "built_by": "plane"},
            {"category": "Walls", "status": "in_progress", "bim_volume": 1.0, "bim_points": 100,
             "overlap_points": 20, "level": "L2", "level_elevation": 3.0, "built_by": ""},
            {"category": "Doors", "status": "not_started", "bim_volume": 0.5, "bim_points": 0,
             "overlap_points": 0, "level": "", "level_elevation": None, "built_by": ""},
            {"category": "Spaces", "status": "completed", "bim_volume": 50.0, "bim_points": 10,
             "overlap_points": 10, "level": "L1", "level_elevation": 0.0, "built_by": "coverage"},
            {"category": "Weird", "status": None, "bim_volume": None, "bim_points": 0,
             "overlap_points": 0, "level": "L0", "level_elevation": -3.0, "built_by": "sam"},
        ]

    def test_summarize(self):
        s = P._summarize(self._rows())
        self.assertEqual(s, {"total": 5, "completed": 2, "in_progress": 1, "not_started": 2,
                             "overall_completion": 40.0, "points_coverage": 52.4})
        self.assertEqual(P._empty_summary()["total"], 0)

    def test_by_category(self):
        cats = {c["category"]: c for c in P._by_category(self._rows()[:3])}
        self.assertEqual(list(cats), ["Doors", "Walls"])  # sorted
        w = cats["Walls"]
        self.assertEqual((w["count"], w["completed"], w["in_progress"]), (2, 1, 1))
        self.assertEqual(w["completion"], 50.0)
        self.assertEqual(w["points_coverage"], 50.0)
        self.assertEqual(w["overlap_volume"], 2.0)
        self.assertEqual(cats["Doors"]["points_coverage"], 0.0)

    def test_by_level_orders_by_elevation_and_skips_non_buildable(self):
        levels = P.by_level(self._rows())
        self.assertEqual([lv["level"] for lv in levels], ["L0", "L1", "L2", "Unassigned"])
        l1 = levels[1]
        self.assertEqual(l1["total"], 1)  # the Space is excluded
        self.assertEqual(l1["completion"], 100.0)
        self.assertEqual(l1["volume_completion"], 100.0)
        self.assertEqual(l1["built_by"], {"sam": 0, "plane": 1, "coverage": 0})
        l0 = levels[0]
        self.assertEqual(l0["not_started"], 1)  # None status -> not_started
        self.assertEqual(l0["volume_completion"], 0.0)
        self.assertEqual(l0["built_by"]["sam"], 1)
        self.assertIsNone(levels[3]["elevation"])

    def test_by_level_uses_lowest_elevation_seen(self):
        rows = [{"category": "Walls", "status": "completed", "bim_volume": 1, "level": "A", "level_elevation": 5.0},
                {"category": "Walls", "status": "completed", "bim_volume": 1, "level": "A", "level_elevation": 2.0},
                {"category": "Walls", "status": "completed", "bim_volume": 1, "level": "B", "level_elevation": 3.0}]
        self.assertEqual([(lv["level"], lv["elevation"]) for lv in P.by_level(rows)], [("A", 2.0), ("B", 3.0)])

    def test_by_trade_in_build_order(self):
        trades = P.by_trade(self._rows())
        self.assertEqual([t["trade"] for t in trades], ["Walls & Partitions", "Doors & Windows", "Other"])
        walls = trades[0]
        self.assertEqual(walls["volume_completion"], 75.0)
        self.assertEqual(walls["completion"], 50.0)

    def test_sanitize_result(self):
        class Bad:
            def tolist(self):
                raise RuntimeError

        bad = Bad()
        out = P.sanitize_result({
            "a": np.int64(3), "b": np.float32(1.5), "c": np.array([1, 2]), "d": (np.bool_(True), None),
            "e": "s", "f": 2, "g": bad,
        })
        self.assertEqual(out["a"], 3)
        self.assertIs(type(out["a"]), int)
        self.assertEqual(out["b"], 1.5)
        self.assertEqual(out["c"], [1, 2])
        self.assertEqual(out["d"], [True, None])
        self.assertIs(out["g"], bad)
        self.assertIsNone(P.sanitize_result(None))


# ─── IFC extraction + full analysis ─────────────────────────────────────────
class ExtractAndAnalyzeTests(TmpDirMixin, SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ifc = _build_ifc(os.path.join(cls.tmp, "wall.ifc"))
        cls.empty_ifc = _build_ifc(os.path.join(cls.tmp, "empty.ifc"), with_wall=False)
        cls.face = _face_grid(0.05)
        cls.cloud = _write_xyz(os.path.join(cls.tmp, "face.xyz"), cls.face)

    def test_extract_elements_real_ifc(self):
        els = P.extract_elements(self.ifc)
        self.assertEqual(len(els), 1)
        e = els[0]
        self.assertEqual((e["ifc_type"], e["category"], e["name"], e["level"]), ("IFCWALL", "Walls", "W1", "L1"))
        self.assertEqual(e["level_elevation"], 0.0)
        self.assertAlmostEqual(e["volume"], 1.0, places=6)
        self.assertAlmostEqual(e["area"], 7.0, places=6)
        self.assertEqual(len(e["global_id"]), 22)
        self.assertIsInstance(e["express_id"], int)
        np.testing.assert_allclose(e["verts"].min(axis=0), [0, 0, 0], atol=1e-9)
        np.testing.assert_allclose(e["verts"].max(axis=0), [2, 0.5, 1], atol=1e-9)
        # cached by (path, mtime)
        self.assertIs(P.extract_elements(self.ifc), els)

    def test_extract_elements_empty_model_not_cached(self):
        self.assertEqual(P.extract_elements(self.empty_ifc), [])
        self.assertFalse(any(k[0] == self.empty_ifc for k in P._ELEMENT_CACHE))

    def test_extract_elements_fallbacks(self):
        path = _build_ifc(self.p("fb.ifc"))
        import ifcopenshell.geom as geom
        real_iter = geom.iterator
        calls = []

        def iterator(*args):
            calls.append(len(args))
            if len(args) == 3:
                raise TypeError("no threads arg")
            return real_iter(*args)

        with mock.patch.object(geom, "iterator", side_effect=iterator), \
                mock.patch("processing.progress._storey_of", side_effect=RuntimeError):
            els = P.extract_elements(path)
        self.assertEqual(calls, [3, 2])
        self.assertEqual(els[0]["level"], "")
        self.assertIsNone(els[0]["level_elevation"])

    def test_extract_elements_skips_broken_element_and_handles_missing_mtime(self):
        path = _build_ifc(self.p("broken.ifc"))
        with mock.patch("processing.progress._element_volume", side_effect=ValueError), \
                mock.patch("processing.progress.os.path.getmtime", side_effect=OSError):
            self.assertEqual(P.extract_elements(path), [])

    def test_settings_world_coords_fallbacks(self):
        import ifcopenshell.geom as geom
        s = mock.MagicMock()
        s.set.side_effect = [Exception, None]
        with mock.patch.object(geom, "settings", return_value=s):
            self.assertIs(P._settings_world_coords(), s)
        s2 = mock.MagicMock()
        s2.set.side_effect = Exception
        with mock.patch.object(geom, "settings", return_value=s2):
            self.assertIs(P._settings_world_coords(), s2)
        self.assertEqual(s2.set.call_count, 2)

    def test_storey_of(self):
        storey = mock.MagicMock(Name="L3", Elevation=6.0)
        storey.is_a.side_effect = lambda t: t == "IfcBuildingStorey"
        part = mock.MagicMock()
        part.is_a.return_value = False
        util = mock.MagicMock()
        util.get_container.return_value = None
        util.get_aggregate.return_value = storey
        self.assertEqual(P._storey_of(part, util), ("L3", 6.0))
        util.get_aggregate.return_value = None
        self.assertEqual(P._storey_of(part, util), ("", None))
        util.get_container.return_value = part  # cycle -> guarded
        self.assertEqual(P._storey_of(part, util), ("", None))

    def test_analyze_server_alignment(self):
        res = P.analyze(self.ifc, self.cloud, None, None, threshold=0.15)
        self.assertEqual(res["point_count"], len(self.face))
        self.assertEqual(res["overlap_source"], "server_alignment")
        self.assertFalse(res["sam_labels"])
        (el,) = res["elements"]
        # every scan point lies on the wall's face. Assignment uses random
        # surface samples at ~1/threshold^2 per m^2, so a few % of on-surface
        # points find no sample within threshold (Poisson: exp(-pi) ~ 4.3%).
        self.assertGreaterEqual(el["overlap_points"], 0.9 * len(self.face))
        self.assertLessEqual(el["overlap_points"], len(self.face))
        self.assertEqual(el["bim_volume"], 1.0)
        self.assertGreaterEqual(el["bim_points"], el["overlap_points"])
        self.assertTrue(0 < el["completion"] <= 100)
        # a single flat face forms a perfect plane
        self.assertEqual(el["plane_inlier"], 1.0)
        self.assertTrue(el["verified"])
        self.assertEqual(el["status"], "completed" if el["completion"] >= 60 else "in_progress")
        self.assertEqual(res["summary"]["total"], 1)
        self.assertEqual(res["levels"][0]["level"], "L1")
        self.assertEqual(res["trades"][0]["trade"], "Walls & Partitions")
        self.assertEqual(res["categories"][0]["category"], "Walls")
        # deterministic: repeated analysis gives identical output
        self.assertEqual(P.analyze(self.ifc, self.cloud, None, None, threshold=0.15), res)

    def test_analyze_applies_saved_transforms(self):
        shifted = _write_xyz(self.p("shifted.xyz"), self.face - [10, 0, 0])
        untransformed = P.analyze(self.ifc, shifted, None, None)
        self.assertEqual(untransformed["elements"][0]["overlap_points"], 0)
        # inv(T_bim) . T_pc = +10 m in x brings the cloud back onto the wall
        res = P.analyze(self.ifc, shifted, {"position": [5, 0, 0]}, {"position": [15, 0, 0]})
        self.assertGreaterEqual(res["elements"][0]["overlap_points"], 0.9 * len(self.face))

    def test_analyze_misaligned_cloud_uses_intrinsic_density(self):
        far = _write_xyz(self.p("far.xyz"), self.face + [100, 0, 0])
        with mock.patch("processing.progress._intrinsic_density", wraps=P._intrinsic_density) as intr:
            res = P.analyze(self.ifc, far, None, None)
        intr.assert_called_once()
        el = res["elements"][0]
        self.assertEqual((el["overlap_points"], el["status"], el["completion"]), (0, "not_started", 0.0))
        self.assertGreater(el["bim_points"], 0)
        self.assertIsNone(el["verified"])

    def test_analyze_overlap_snapshot_and_sam(self):
        els = P.extract_elements(self.ifc)
        eid = str(els[0]["express_id"])
        res = P.analyze(self.ifc, self.cloud, None, None, overlap_snapshot={eid: 10 ** 7})
        el = res["elements"][0]
        self.assertEqual(res["overlap_source"], "viewer_snapshot")
        self.assertEqual((el["overlap_points"], el["bim_points"], el["completion"]), (10 ** 7, 10 ** 7, 100.0))
        self.assertEqual((el["status"], el["built_by"]), ("completed", "coverage"))
        self.assertIsNone(el["plane_inlier"])

        sam = {eid: {"built": 60, "partial": 20, "clutter": 20}}
        res2 = P.analyze(self.ifc, self.cloud, None, None, overlap_snapshot={eid: 1000}, semantic_snapshot=sam)
        el2 = res2["elements"][0]
        self.assertEqual(el2["overlap_points"], 800)  # 20% clutter removed
        self.assertEqual(el2["sam_built_ratio"], 0.6)
        self.assertTrue(res2["sam_labels"])
        missing = P.analyze(self.ifc, self.cloud, None, None, overlap_snapshot={})
        self.assertEqual(missing["elements"][0]["status"], "not_started")

    def test_analyze_empty_ifc_and_empty_cloud(self):
        res = P.analyze(self.empty_ifc, self.cloud, None, None, threshold=0.2)
        self.assertEqual(res, {"elements": [], "summary": P._empty_summary(), "categories": [],
                               "point_count": 0, "threshold": 0.2})
        empty = self.p("none.xyz")
        with open(empty, "w") as f:
            f.write("# no points\n")
        res2 = P.analyze(self.ifc, empty, None, None)
        self.assertEqual(res2["point_count"], 0)
        el = res2["elements"][0]
        self.assertEqual((el["overlap_points"], el["bim_points"], el["status"]), (0, 0, "not_started"))

    def test_analyze_large_planar_overlap_is_subsampled_for_ransac(self):
        dense = _write_xyz(self.p("dense.xyz"), _face_grid(0.03))  # ~2300 points > 1500
        res = P.analyze(self.ifc, dense, None, None)
        self.assertGreater(res["elements"][0]["overlap_points"], 1500)
        self.assertTrue(res["elements"][0]["verified"])
