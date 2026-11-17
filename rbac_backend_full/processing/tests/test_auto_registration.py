"""Unit tests for the helpers in processing/auto_registration.py.

End-to-end recovery on a synthetic building is covered by
test_existing_registration.py; here each stage is checked on small inputs
with a known answer, plus the FPFH/RANSAC fallback and refine paths.
"""
from unittest import mock

import numpy as np
from scipy.spatial import cKDTree
from django.test import SimpleTestCase

from processing import auto_registration as A
from processing.tests.test_registration import apply, asym_cloud, make_T, rot


def plane_grid(n=20, step=0.1, y=0.0):
    g = np.arange(n) * step
    X, Z = np.meshgrid(g, g)
    return np.c_[X.ravel(), np.full(X.size, y), Z.ravel()]


def box_surface(rng, lo, hi, n):
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    size = hi - lo
    pts = lo + rng.random((n, 3)) * size
    faces = rng.integers(0, 6, n)
    for f in range(6):
        axis, side = divmod(f, 2)
        pts[faces == f, axis] = hi[axis] if side else lo[axis]
    return pts


class InputTests(SimpleTestCase):
    def test_as_points_validation(self):
        rng = np.random.default_rng(0)
        with self.assertRaisesRegex(ValueError, '"src" must be a list of \\[x, y, z\\] points.'):
            A._as_points([[1, 2]], "src", rng)
        with self.assertRaisesRegex(ValueError, "at least 100 valid points"):
            A._as_points([[np.nan, 0, 0]] * 200, "src", rng)
        pts = np.vstack([np.ones((120, 3)), [[np.inf, 0, 0]]])
        self.assertEqual(A._as_points(pts, "src", rng).shape, (120, 3))
        with mock.patch.object(A, "MAX_INPUT_POINTS", 110):
            self.assertEqual(A._as_points(pts, "src", rng).shape, (110, 3))

    def test_voxel_downsample_centroids(self):
        pts = np.array([[0.1, 0.1, 0.1], [0.3, 0.3, 0.3], [1.5, 0.0, 0.0]])
        out = A.voxel_downsample(pts, 1.0)
        np.testing.assert_allclose(sorted(out.tolist()), [[0.2, 0.2, 0.2], [1.5, 0.0, 0.0]])

    def test_choose_voxel_grows_until_small_enough(self):
        rng = np.random.default_rng(0)
        pts = rng.random((20000, 3))
        diag = np.linalg.norm(pts.max(0) - pts.min(0))
        with mock.patch.object(A, "TARGET_DOWNSAMPLED", 1000):
            v = A._choose_voxel(pts)
        self.assertGreater(v, diag / 60)
        self.assertLessEqual(A.voxel_downsample(pts, v).shape[0], 1300)
        small = rng.random((200, 3))
        self.assertAlmostEqual(A._choose_voxel(small), np.linalg.norm(np.ptp(small, axis=0)) / 60)

    def test_estimate_normals_plane_and_orientation(self):
        p = plane_grid()
        n = A.estimate_normals(p, cKDTree(p), k=8)
        np.testing.assert_allclose(np.abs(n[:, 1]), 1.0, atol=1e-9)
        rng = np.random.default_rng(1)
        s = rng.normal(size=(500, 3))
        s /= np.linalg.norm(s, axis=1, keepdims=True)
        ns = A.estimate_normals(s, cKDTree(s), k=12)
        self.assertTrue((np.einsum("ij,ij->i", ns, s) > 0).all())  # outward
        self.assertEqual(A.estimate_normals(s[:5], cKDTree(s[:5]), k=16).shape, (5, 3))


class FeatureTests(SimpleTestCase):
    def test_pair_features_known_geometry(self):
        p1, p2 = np.array([0.0, 0, 0]), np.array([1.0, 0, 0])
        n = np.array([0.0, 1, 0])
        f1, f2, f3 = A._pair_features(p1, n, p2, n)
        self.assertAlmostEqual(float(f1), 0.0)
        self.assertAlmostEqual(float(f2), 0.0)
        self.assertAlmostEqual(float(f3), 0.0)
        # swap branch: second normal closer to the connecting line
        f1, f2, f3 = A._pair_features(p1, n, p2, np.array([1.0, 0, 0]))
        self.assertAlmostEqual(float(f3), -1.0)
        # coincident points don't divide by zero
        out = A._pair_features(p1, n, p1, n)
        self.assertTrue(all(np.isfinite(v) for v in out))

    def test_fpfh_blocks_normalised_and_rotation_invariant(self):
        rng = np.random.default_rng(0)
        p = box_surface(rng, (0, 0, 0), (3, 2, 1), 600)
        tree = cKDTree(p)
        f = A.compute_fpfh(p, A.estimate_normals(p, tree), tree, 0.5)
        self.assertEqual(f.shape, (600, 33))
        sums = f.reshape(600, 3, 11).sum(axis=2)
        self.assertTrue(np.allclose(sums[sums > 0], 100.0))
        R = rot("y", 37)
        q = p @ R.T
        qt = cKDTree(q)
        g = A.compute_fpfh(q, A.estimate_normals(q, qt), qt, 0.5)
        # box faces put many angles exactly on bin edges, where float rounding
        # can tip a pair into the neighbouring bin; on average they agree
        self.assertLess(np.abs(f - g).mean(), 0.5)

    def test_match_features(self):
        rng = np.random.default_rng(0)
        fs = rng.random((50, 33))
        perm = rng.permutation(50)
        si, ti = A.match_features(fs, fs[perm])
        np.testing.assert_array_equal(perm[ti], si)  # mutual NN maps back to itself
        si2, ti2 = A.match_features(fs[:5], fs[:5])  # too few mutual -> all source NN
        self.assertEqual(len(si2), 5)


class RansacTests(SimpleTestCase):
    def test_batched_kabsch(self):
        rng = np.random.default_rng(0)
        a = rng.random((4, 3, 3))
        Rm = rot("z", 50) @ rot("x", -30)
        b = a @ Rm.T + [1, 2, 3]
        Rs, ts = A._batched_kabsch(a, b)
        for i in range(4):
            np.testing.assert_allclose(Rs[i], Rm, atol=1e-9)
            np.testing.assert_allclose(ts[i], [1, 2, 3], atol=1e-9)

    def test_ransac_recovers_transform_with_outliers(self):
        rng = np.random.default_rng(0)
        P = rng.random((60, 3)) * 10
        T = make_T(rot("y", 120), [5, -1, 2])
        Q = apply(T, P)
        Q[:15] = rng.random((15, 3)) * 10  # 25% wrong correspondences
        hyps = A.ransac_correspondences(P, Q, 0.1, rng, iterations=1024)
        self.assertTrue(hyps)
        count, best = hyps[0]
        self.assertGreaterEqual(count, 45)
        np.testing.assert_allclose(best, T, atol=1e-8)

    def test_ransac_edge_cases(self):
        rng = np.random.default_rng(0)
        self.assertEqual(A.ransac_correspondences(np.zeros((2, 3)), np.zeros((2, 3)), 0.1, rng), [])
        same = np.zeros((10, 3))  # all edges zero -> no valid triplet
        self.assertEqual(A.ransac_correspondences(same, same, 0.1, rng, iterations=256), [])


class PoseScoringTests(SimpleTestCase):
    def test_rotation_angle_and_scale(self):
        self.assertAlmostEqual(A._rotation_angle_deg(rot("z", 30), np.eye(3)), 30.0)
        self.assertAlmostEqual(A._uniform_scale(make_T(rot("x", 10), [0, 0, 0], s=2)), 2.0)

    def test_same_pose_and_dedupe(self):
        c = np.zeros(3)
        T1 = make_T(np.eye(3), [0, 0, 0])
        self.assertTrue(A._same_pose(T1, make_T(rot("y", 5), [0.1, 0, 0]), c, 1.0))
        self.assertFalse(A._same_pose(T1, make_T(np.eye(3), [0, 0, 0], s=1.5), c, 1.0))
        self.assertFalse(A._same_pose(T1, make_T(rot("y", 30), [0, 0, 0]), c, 1.0))
        self.assertFalse(A._same_pose(T1, make_T(np.eye(3), [5, 0, 0]), c, 1.0))
        scored = [(0.5, T1, "a"), (0.9, make_T(np.eye(3), [0.1, 0, 0]), "b"),
                  (0.7, make_T(np.eye(3), [9, 0, 0]), "c"), (0.1, make_T(np.eye(3), [20, 0, 0]), "d")]
        self.assertEqual([s[2] for s in A._dedupe(scored, c, 1.0, 10)], ["b", "c", "d"])
        self.assertEqual([s[2] for s in A._dedupe(scored, c, 1.0, 2)], ["b", "c"])

    def test_evaluate(self):
        rng = np.random.default_rng(0)
        tgt = box_surface(rng, (0, 0, 0), (2, 2, 2), 2000)
        tree = cKDTree(tgt)
        perfect = A._evaluate(np.eye(4), tgt, tgt, tree, 0.05)
        self.assertEqual((perfect["fitness"], perfect["coverage"], perfect["rmse"], perfect["score"]),
                         (1.0, 1.0, 0.0, 1.0))
        far = A._evaluate(make_T(np.eye(3), [100, 0, 0]), tgt, tgt, tree, 0.05)
        self.assertEqual((far["fitness"], far["coverage"], far["rmse"]), (0.0, 0.0, 0.05))

    def test_plan_cells_and_footprint_iou(self):
        pts = np.array([[0.5, 0, 0.5]] * 3 + [[1.5, 0, 0.5]] * 2)
        cells = A._plan_cells(pts, 1.0, 3)
        np.testing.assert_array_equal(cells, [0])
        self.assertEqual(A.footprint_iou(pts, cells, 1.0), 1.0)
        other = A._plan_cells(np.array([[5.5, 0, 0.5]] * 3), 1.0, 3)
        self.assertEqual(A.footprint_iou(pts, other, 1.0), 0.0)
        self.assertEqual(A.footprint_iou(np.zeros((0, 3)), np.array([], dtype=np.int64), 1.0), 0.0)

    def test_flat_points(self):
        rng = np.random.default_rng(0)
        p = plane_grid()
        self.assertTrue(A.flat_points(p, p, cKDTree(p)).all())
        blob = rng.random((400, 3))
        self.assertLess(A.flat_points(blob, blob, cKDTree(blob)).mean(), 0.05)

    def test_building_fit(self):
        rng = np.random.default_rng(0)
        bim = box_surface(rng, (0, 0, 0), (4, 3, 4), 4000)
        tree = cKDTree(bim)
        normals = A.estimate_normals(bim, tree)
        cells = A._plan_cells(bim, 0.5, 3)
        flat = np.ones(len(bim), bool)
        res = A.building_fit(bim, flat, bim, normals, tree, cells, 0.5, 0.1)
        self.assertEqual(res["building_share"], 1.0)
        self.assertEqual(res["building_fit"], 1.0)
        self.assertAlmostEqual(res["error"], 0.0)
        none = A.building_fit(bim + [100, 0, 0], flat, bim, normals, tree, cells, 0.5, 0.1)
        self.assertEqual(none, {"building_share": 0.0, "building_fit": 0.0, "error": None})
        # inside the footprint but just off the surface (beyond threshold) -> no error figure
        lifted = bim[:50] * [1, 0, 1] + [0, 0.5, 0]
        lifted[:, 0] = lifted[:, 2] = 2.0
        off = A.building_fit(lifted, np.ones(50, bool), bim, normals, tree, cells, 0.5, 0.01)
        self.assertEqual(off["building_fit"], 0.0)
        self.assertIsNone(off["error"])

    def test_site_score(self):
        self.assertAlmostEqual(A._site_score(0.6, 0.8), 0.8 + 0.06)
        self.assertAlmostEqual(A._site_score(0.3, 0.8), 0.4 + 0.03)

    def test_scale_helpers(self):
        np.testing.assert_allclose(A._scale_matrix(3)[:3, :3], 3 * np.eye(3))
        rng = np.random.default_rng(0)
        p = rng.random((1000, 3)) * [10, 5, 2]
        np.testing.assert_allclose(A._robust_extents(p), [9.6, 4.8, 1.92], rtol=0.05)
        self.assertEqual(A.scale_candidates(p, p * 1.2), [1.0])
        cands = A.scale_candidates(p, p * 3)
        self.assertTrue(all(abs(c - 3) < 0.05 for c in cands))
        self.assertEqual(len(cands), 1)  # near-duplicates collapsed
        stretched = p * [3, 1, 1]
        self.assertGreater(len(A.scale_candidates(p, stretched)), 1)


class LevellingTests(SimpleTestCase):
    def test_hemisphere_directions(self):
        d = A._hemisphere_directions(100)
        np.testing.assert_allclose(np.linalg.norm(d, axis=1), 1.0)
        self.assertTrue((d[:, 1] >= 0).all())

    def test_dominant_direction(self):
        normals = np.vstack([np.tile([0, -1.0, 0], (70, 1)), np.tile([1.0, 0, 0], (30, 1))])
        u, share = A.dominant_direction(normals)
        np.testing.assert_allclose(np.abs(u), [0, 1, 0], atol=1e-9)
        self.assertAlmostEqual(share, 0.7)

    def test_rotation_between(self):
        a = np.array([1.0, 0, 0])
        for b in ([0, 1.0, 0], [1.0, 0, 0], [0, 0, -1.0]):
            Rm = A.rotation_between(a, np.array(b))
            np.testing.assert_allclose(Rm @ a, b, atol=1e-12)
            self.assertAlmostEqual(np.linalg.det(Rm), 1.0)

    def test_rotation_between_antiparallel(self):
        """Regression: for a = -b the old code returned diag(1,-1,-1), which
        maps ±X onto itself instead of flipping it."""
        u = np.array([1.0, 2.0, 2.0]) / 3.0
        for a in ([1.0, 0, 0], [0, -1.0, 0], [0, 0, 1.0], u):
            a = np.asarray(a)
            Rm = A.rotation_between(a, -a)
            np.testing.assert_allclose(Rm @ a, -a, atol=1e-12)
            np.testing.assert_allclose(Rm @ Rm.T, np.eye(3), atol=1e-12)
            self.assertAlmostEqual(np.linalg.det(Rm), 1.0)
        # the levelling case (-Y onto +Y) keeps its previous exact result
        np.testing.assert_array_equal(A.rotation_between(np.array([0, -1.0, 0]), A.UP), np.diag([1.0, -1, -1]))

    def test_share_above_floor(self):
        self.assertEqual(A._share_above_floor(np.zeros((5, 3)), np.tile([1.0, 0, 0], (5, 1))), 0.5)
        floor = plane_grid(10)
        walls = np.c_[np.zeros(100), np.linspace(0.1, 3, 100), np.zeros(100)]
        pts = np.vstack([floor, walls])
        normals = np.vstack([np.tile([0, 1.0, 0], (100, 1)), np.tile([1.0, 0, 0], (100, 1))])
        self.assertAlmostEqual(A._share_above_floor(pts, normals), 0.5)

    def _site(self):
        floor = plane_grid(30, 0.2)
        rng = np.random.default_rng(0)
        above = np.c_[rng.random(300) * 6, 0.5 + rng.random(300) * 3, rng.random(300) * 6]
        pts = np.vstack([floor, above])
        normals = np.vstack([np.tile([0, 1.0, 0], (900, 1)), np.tile([1.0, 0, 0], (300, 1))])
        return pts, normals

    def test_cloud_level_rotations_upright_and_upside_down(self):
        pts, normals = self._site()
        (Rm,) = A.cloud_level_rotations(pts, normals)
        np.testing.assert_allclose(Rm, np.eye(3), atol=1e-9)
        flip = np.diag([1.0, -1, -1])
        (Rf,) = A.cloud_level_rotations(pts @ flip.T, normals @ flip.T)
        lifted = (pts @ flip.T) @ Rf.T
        self.assertGreater((lifted[:, 1] > 1e-6).mean(), 0.2)  # points back above the floor

    def test_cloud_level_rotations_ambiguous_and_none(self):
        floor = plane_grid(10)
        normals = np.tile([0, 1.0, 0], (100, 1))
        self.assertEqual(len(A.cloud_level_rotations(floor, normals)), 2)  # nothing above or below
        rng = np.random.default_rng(0)
        rnd = rng.normal(size=(2000, 3))
        rnd /= np.linalg.norm(rnd, axis=1, keepdims=True)
        self.assertEqual(A.cloud_level_rotations(rnd, rnd), [])

    def test_bim_level_rotation(self):
        tilt = rot("x", 5)
        n = np.tile(tilt @ [0, 1.0, 0], (100, 1))
        Rm = A.bim_level_rotation(-n)  # sign-free
        np.testing.assert_allclose(Rm @ (tilt @ [0, 1.0, 0]), [0, 1, 0], atol=1e-9)
        steep = np.tile(rot("x", 40) @ [0, 1.0, 0], (100, 1))
        np.testing.assert_allclose(A.bim_level_rotation(steep), np.eye(3))

    def test_tilt_change_and_level_picked_pose(self):
        T0 = np.eye(4)
        self.assertAlmostEqual(A._tilt_change_deg(T0, make_T(rot("x", 7), [0, 0, 0]), A.UP), 7.0)
        self.assertAlmostEqual(A._tilt_change_deg(T0, make_T(rot("y", 50), [0, 0, 0]), A.UP), 0.0)
        # picks with a 5 deg tilt get levelled; centre stays put
        Tp = make_T(rot("x", 5), [1, 2, 3], s=2.0)
        out = A._level_picked_pose(Tp, np.eye(3), [np.eye(3)], np.zeros(3))
        T_work, Rc = out
        np.testing.assert_allclose(T_work[:3, :3] @ [0, 1, 0] / 2.0, [0, 1, 0], atol=1e-9)
        np.testing.assert_allclose(T_work[:3, 3], [1, 2, 3], atol=1e-9)
        self.assertIsNone(A._level_picked_pose(make_T(rot("x", 60), [0, 0, 0]), np.eye(3), [np.eye(3)], np.zeros(3)))
        self.assertIsNone(A._level_picked_pose(T0, np.eye(3), [], np.zeros(3)))


class HeadingAndSearchTests(SimpleTestCase):
    def test_yaw_matrix(self):
        np.testing.assert_allclose(A.yaw_matrix(np.pi / 2) @ [1, 0, 0], [0, 0, -1], atol=1e-12)

    def test_azimuth_histogram_ignores_floors(self):
        n = np.vstack([np.tile([1.0, 0, 0], (10, 1)), np.tile([0, 1.0, 0], (50, 1))])
        h = A._azimuth_histogram(n)
        self.assertEqual(h.shape, (180,))
        self.assertEqual(h.sum(), 10 * 9)  # kernel sums to 9, floors excluded

    def test_heading_candidates_recover_yaw(self):
        walls = np.array([[1.0, 0, 0]] * 50 + [[0, 0, 1.0]] * 20)
        cloud = walls @ A.yaw_matrix(np.radians(-25)).T
        cands = np.degrees(A.heading_candidates(cloud, walls))
        self.assertIn(25, np.round(cands) % 360)
        self.assertEqual(len(cands) % 2, 0)  # each comes with its 180 deg twin

    def test_levelled_scales(self):
        p = np.random.default_rng(0).random((500, 3)) * [10, 3, 10]
        self.assertEqual(A.levelled_scales(p, p * 1.1), [1.0])
        s = A.levelled_scales(p, p * 2)
        self.assertEqual(len(s), 9)
        self.assertAlmostEqual(s[0], 2 * 0.75, places=1)

    def test_translation_peaks_find_offset(self):
        rng = np.random.default_rng(0)
        bim = box_surface(rng, (0, 0, 0), (4, 2, 3), 3000)
        bn = A.estimate_normals(bim, cKDTree(bim))
        cell = 0.25
        cloud = bim - [1.0, 0, 0.5]  # cloud must move by (+1, 0, +0.5)
        reach = 20
        shape = tuple(int(n) for n in np.ceil(np.ptp(bim, axis=0) / cell).astype(int) + 1 + reach)
        origin = bim.min(axis=0)
        ffts = [np.fft.rfftn(g) for g in A._surface_grids(bim, bn, origin, cell, shape)]
        peaks = A.translation_peaks(ffts, origin, shape, reach, cloud, bn, cell, n_peaks=2)
        self.assertEqual(len(peaks), 2)
        np.testing.assert_allclose(peaks[0], [1.0, 0, 0.5], atol=cell)

    def test_levelled_search_returns_similarity_poses(self):
        rng = np.random.default_rng(0)
        bim = box_surface(rng, (0, 0, 0), (6, 2, 3), 3000)
        bn = A.estimate_normals(bim, cKDTree(bim))
        poses = A.levelled_search(bim, bn, bim, bn, 0.3)
        self.assertTrue(poses)
        for T, s in poses:
            self.assertEqual(s, 1.0)
            self.assertAlmostEqual(T[1, 1], 1.0)  # rotation about +Y only


class RefinementTests(SimpleTestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.bim = box_surface(rng, (0, 0, 0), (4, 3, 2), 4000) @ rot("y", 10).T  # no axis-aligned symmetry
        self.tree = cKDTree(self.bim)
        self.normals = A.estimate_normals(self.bim, self.tree)

    def test_axis_angle_matrix(self):
        np.testing.assert_allclose(A._axis_angle_matrix(np.zeros(3)), np.eye(3))
        np.testing.assert_allclose(A._axis_angle_matrix(np.array([0, 0, np.pi / 2])), rot("z", 90), atol=1e-12)

    def test_point_to_plane_recovers_small_offset(self):
        T_true = make_T(rot("y", 2), [0.05, -0.03, 0.04])
        src = apply(np.linalg.inv(T_true), self.bim)
        T = A.point_to_plane_icp(np.eye(4), src, self.bim, self.normals, self.tree, [0.3, 0.1, 0.02])
        np.testing.assert_allclose(T, T_true, atol=2e-3)
        Ty = A.point_to_plane_icp(np.eye(4), src, self.bim, self.normals, self.tree, [0.3, 0.1],
                                  yaw_only=True, with_scale=True)
        self.assertAlmostEqual(Ty[1, 1], 1.0, places=2)

    def test_point_to_plane_stops_without_matches(self):
        T0 = make_T(np.eye(3), [100, 0, 0])
        np.testing.assert_allclose(
            A.point_to_plane_icp(T0, self.bim, self.bim, self.normals, self.tree, [0.1]), T0)

    def test_coarse_and_fine_refine(self):
        T_true = make_T(rot("y", 3), [0.1, 0, -0.1])
        src = apply(np.linalg.inv(T_true), self.bim)
        T = A._coarse_refine(np.eye(4), src, self.bim, self.tree, 0.1, yaw_only=True)
        np.testing.assert_allclose(T, T_true, atol=5e-3)
        Tf = A._fine_refine(T, src, self.bim, self.tree, 0.1, allow_scale=True, base_scale=1.0)
        np.testing.assert_allclose(Tf, T_true, atol=5e-3)
        # scale change beyond the limit is rejected
        Tr = A._fine_refine(T, src, self.bim, self.tree, 0.1, allow_scale=True, base_scale=3.0)
        self.assertAlmostEqual(A._uniform_scale(Tr), 1.0, places=2)


class FeaturePathTests(SimpleTestCase):
    def test_feature_search_proposes_true_pose(self):
        rng = np.random.default_rng(0)
        tgt = box_surface(rng, (0, 0, 0), (4, 2, 1.5), 4000)
        tgt_ds = A.voxel_downsample(tgt, 0.2)
        T_true = make_T(rot("z", 70) @ rot("x", 30), [2, 1, -1])
        src = apply(np.linalg.inv(T_true), tgt)
        found = []

        def consider(T, base_scale, allow_scale, Rc, yaw_only):
            found.append((T, base_scale, allow_scale, yaw_only))

        real = A.ransac_correspondences
        with mock.patch.object(A, "ransac_correspondences",
                               side_effect=lambda P, Q, th, r: real(P, Q, th, r, iterations=4096)):
            A._feature_search(src, tgt_ds, cKDTree(tgt_ds), 0.2, rng, consider)
        self.assertTrue(found)
        self.assertTrue(all(f[1] == 1.0 and f[2] is False and f[3] is False for f in found))
        best = min(found, key=lambda f: np.abs(f[0][:3, :3] - T_true[:3, :3]).max())
        self.assertLess(A._rotation_angle_deg(best[0][:3, :3], T_true[:3, :3]), 10)

    def test_feature_search_skips_tiny_downsample(self):
        consider = mock.MagicMock()
        tgt = np.random.default_rng(0).random((200, 3))
        with mock.patch.object(A, "scale_candidates", return_value=[0.001]):
            A._feature_search(tgt, tgt, cKDTree(tgt), 0.2, np.random.default_rng(0), consider)
        consider.assert_not_called()


class AutoRegisterPathTests(SimpleTestCase):
    """Entry-point branches not covered by the end-to-end building tests."""

    def _blob(self):
        rng = np.random.default_rng(3)
        return box_surface(rng, (0, 0, 0), (4, 2, 1.5), 3000)

    def test_features_fallback_when_no_level_plane(self):
        tgt = self._blob()
        T_true = make_T(rot("z", 60) @ rot("x", 35), [1, 2, 0])
        src = apply(np.linalg.inv(T_true), tgt)
        real = A.ransac_correspondences
        with mock.patch.object(A, "cloud_level_rotations", return_value=[]), \
                mock.patch.object(A, "ransac_correspondences",
                                  side_effect=lambda P, Q, th, r: real(P, Q, th, r, iterations=2048)):
            res = A.auto_register(src, tgt)
        self.assertEqual(res["method"], "features")
        self.assertIsNone(res["footprint_iou"])
        self.assertGreater(res["fitness"], 0.9)
        self.assertIn(res["confidence"], ("high", "medium"))
        np.testing.assert_allclose(apply(np.array(res["transform"]), src), tgt, atol=0.05)

    def test_no_alignment_found(self):
        tgt = self._blob()
        with mock.patch.object(A, "cloud_level_rotations", return_value=[]), \
                mock.patch.object(A, "_feature_search"):
            with self.assertRaisesRegex(ValueError, "Could not find any alignment"):
                A.auto_register(tgt, tgt)

    def test_refine_with_untrusted_picks(self):
        tgt = self._blob()
        T_true = make_T(rot("z", 20), [0.05, 0, 0])
        src = apply(np.linalg.inv(T_true), tgt)
        with mock.patch.object(A, "_level_picked_pose", return_value=None):
            res = A.auto_register(src, tgt, init_transform=T_true.tolist())
        self.assertEqual(res["method"], "refine")
        np.testing.assert_allclose(apply(np.array(res["transform"]), src), tgt, atol=0.05)

    def test_invalid_init_transform(self):
        tgt = self._blob()
        with self.assertRaisesRegex(ValueError, "4x4 matrix"):
            A.auto_register(tgt, tgt, init_transform=np.eye(3))
        bad = np.eye(4)
        bad[0, 3] = np.nan
        with self.assertRaisesRegex(ValueError, "4x4 matrix"):
            A.auto_register(tgt, tgt, init_transform=bad)

    def test_confidence_levels(self):
        tgt = self._blob()

        def fake_evaluate(fitness):
            return lambda *a, **k: {"fitness": fitness, "coverage": 0.5, "rmse": 0.1, "score": fitness}

        for fitness, expected in ((0.4, "medium"), (0.1, "low")):
            with mock.patch.object(A, "_level_picked_pose", return_value=None), \
                    mock.patch.object(A, "_evaluate", side_effect=fake_evaluate(fitness)):
                res = A.auto_register(tgt, tgt, init_transform=np.eye(4))
            self.assertEqual(res["confidence"], expected)
            self.assertFalse(res["ambiguous"])
