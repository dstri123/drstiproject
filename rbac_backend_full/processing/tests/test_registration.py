"""Unit tests for processing/registration.py (Kabsch/Umeyama + ICP)."""
from unittest import mock

import numpy as np
from scipy.spatial import cKDTree
from django.test import SimpleTestCase

from processing import registration as R


def rot(axis, deg):
    t = np.radians(deg)
    c, s = np.cos(t), np.sin(t)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def make_T(Rm, t, s=1.0):
    T = np.eye(4)
    T[:3, :3] = s * Rm
    T[:3, 3] = t
    return T


def apply(T, p):
    return p @ T[:3, :3].T + T[:3, 3]


def asym_cloud(n=400, seed=0):
    """Anisotropic, asymmetric blob (distinct PCA axes, no symmetry)."""
    rng = np.random.default_rng(seed)
    p = rng.normal(size=(n, 3)) * [4.0, 2.0, 1.0]
    p[:, 0] += 0.3 * p[:, 1] ** 2  # bend -> breaks the sign symmetry
    return p


class BestFitTests(SimpleTestCase):
    def test_recovers_rigid_transform_exactly(self):
        src = asym_cloud(50)
        T = make_T(rot("z", 30) @ rot("x", 20), [1, -2, 3])
        np.testing.assert_allclose(R._best_fit_transform(src, apply(T, src)), T, atol=1e-10)

    def test_recovers_similarity_with_scale(self):
        src = asym_cloud(50)
        T = make_T(rot("y", -45), [0.5, 0, 9], s=2.5)
        np.testing.assert_allclose(R._best_fit_transform(src, apply(T, src), with_scale=True), T, atol=1e-10)

    def test_never_returns_reflection(self):
        src = asym_cloud(50)
        mirrored = src * [1, 1, -1]
        T = R._best_fit_transform(src, mirrored)
        self.assertAlmostEqual(np.linalg.det(T[:3, :3]), 1.0)
        # with scale and a reflection, the d=-1 term enters the scale
        Ts = R._best_fit_transform(src, mirrored, with_scale=True)
        self.assertGreater(np.linalg.det(Ts[:3, :3]), 0)

    def test_zero_variance_source_scale_is_one(self):
        src = np.zeros((4, 3))
        T = R._best_fit_transform(src, src + 1, with_scale=True)
        np.testing.assert_allclose(T[:3, 3], [1, 1, 1])

    def test_yaw_only(self):
        src = asym_cloud(50)
        T = make_T(rot("y", 70), [3, 1, -2])
        np.testing.assert_allclose(R._best_fit_transform(src, apply(T, src), yaw_only=True), T, atol=1e-10)
        Ts = make_T(rot("y", -20), [0, 0, 0], s=1.5)
        np.testing.assert_allclose(R._best_fit_transform(src, apply(Ts, src), with_scale=True, yaw_only=True),
                                   Ts, atol=1e-10)
        # a tilt cannot be represented: result still is a pure Y rotation
        Tx = R._best_fit_transform(src, apply(make_T(rot("x", 30), [0, 0, 0]), src), yaw_only=True)
        self.assertEqual(Tx[1, 1], 1.0)
        zero = R._best_fit_yaw(np.zeros((3, 3)), np.zeros((3, 3)), np.zeros(3), np.ones(3), True)
        np.testing.assert_allclose(zero[:3, 3], [1, 1, 1])


class PcaTests(SimpleTestCase):
    def test_frame_is_right_handed_and_sorted(self):
        c, V = R._pca_frame(asym_cloud())
        self.assertAlmostEqual(np.linalg.det(V), 1.0)
        self.assertGreater(abs(V[0, 0]), 0.9)  # largest spread is along x

    def test_frame_flips_left_handed_eigenvectors(self):
        with mock.patch("processing.registration.np.linalg.eigh",
                        return_value=(np.array([1.0, 2.0, 3.0]), np.diag([1.0, 1.0, -1.0]))):
            _, V = R._pca_frame(asym_cloud(10))
        self.assertAlmostEqual(np.linalg.det(V), 1.0)

    def test_candidates_are_proper_and_contain_truth(self):
        src = asym_cloud()
        T = make_T(rot("z", 100) @ rot("y", 40), [10, 5, -3])
        cands = R._pca_candidates(src, apply(T, src))
        self.assertEqual(len(cands), 4)
        for C in cands:
            self.assertAlmostEqual(np.linalg.det(C[:3, :3]), 1.0)
        self.assertTrue(any(np.allclose(C, T, atol=1e-6) for C in cands))

    def test_improper_sign_combo_skipped(self):
        with mock.patch("processing.registration._pca_frame",
                        side_effect=[(np.zeros(3), np.eye(3)), (np.zeros(3), np.diag([1.0, 1.0, -1.0]))]):
            self.assertEqual(R._pca_candidates(None, None), [])


class IcpTests(SimpleTestCase):
    def test_refines_small_offset_to_exact(self):
        tgt = asym_cloud(500)
        T = make_T(rot("z", 3), [0.2, -0.1, 0.05])
        src = apply(np.linalg.inv(T), tgt)  # source must be moved by T onto target
        res = R.run_icp(src, tgt, threshold=2.0, max_iterations=100)
        np.testing.assert_allclose(np.array(res["transform"]), T, atol=1e-5)
        self.assertEqual(res["fitness"], 1.0)
        self.assertLess(res["rmse"], 1e-4)
        self.assertLessEqual(res["iterations"], 100)

    def test_init_transform_and_prebuilt_tree(self):
        tgt = asym_cloud(300)
        T = make_T(rot("x", 60), [5, 5, 5])
        src = apply(np.linalg.inv(T), tgt)
        res = R.run_icp(src, tgt, init_transform=T.tolist(), target_tree=cKDTree(tgt))
        np.testing.assert_allclose(np.array(res["transform"]), T, atol=1e-8)
        self.assertEqual(res["fitness"], 1.0)

    def test_with_scale(self):
        tgt = asym_cloud(300)
        T = make_T(np.eye(3), [0.01, 0, 0], s=1.02)
        src = apply(np.linalg.inv(T), tgt)
        res = R.run_icp(src, tgt, with_scale=True, threshold=1.0, max_iterations=200, tolerance=1e-12)
        np.testing.assert_allclose(np.array(res["transform"]), T, atol=1e-4)

    def test_too_few_points(self):
        with self.assertRaisesRegex(ValueError, "at least 3 points"):
            R.run_icp(np.zeros((2, 3)), np.zeros((5, 3)))
        with self.assertRaisesRegex(ValueError, "at least 3 points"):
            R.run_icp(np.zeros((5, 3)), np.zeros((2, 3)))

    def test_no_correspondences_stops_immediately(self):
        tgt = asym_cloud(50)
        res = R.run_icp(tgt + 1000, tgt)  # default threshold = 3% of diag
        self.assertEqual((res["fitness"], res["iterations"]), (0.0, 1))
        self.assertEqual(res["transform"], np.eye(4).tolist())
        self.assertEqual(res["rmse"], float("inf"))

    def test_degenerate_target_threshold_floor(self):
        tgt = np.zeros((5, 3))
        res = R.run_icp(np.zeros((5, 3)), tgt)
        self.assertEqual(res["fitness"], 1.0)


class IcpAutoTests(SimpleTestCase):
    def test_init_transform_goes_straight_to_icp(self):
        with mock.patch("processing.registration.run_icp", return_value={"x": 1}) as r:
            self.assertEqual(R.run_icp_auto([[0, 0, 0]] * 3, [[0, 0, 0]] * 3, init_transform=np.eye(4), threshold=1),
                             {"x": 1})
        r.assert_called_once()
        self.assertEqual(r.call_args.kwargs["threshold"], 1)

    def test_global_alignment_without_picks(self):
        tgt = asym_cloud(400)
        T = make_T(rot("z", 150) @ rot("x", 80), [20, -10, 4])
        src = apply(np.linalg.inv(T), tgt)
        res = R.run_icp_auto(src, tgt, max_iterations=100)
        self.assertGreater(res["fitness"], 0.99)
        np.testing.assert_allclose(apply(np.array(res["transform"]), src), tgt, atol=1e-4)

    def test_tie_on_fitness_prefers_lower_rmse_and_skips_failures(self):
        results = [ValueError("bad"), {"fitness": 0.5, "rmse": 2.0}, {"fitness": 0.5, "rmse": 1.0},
                   {"fitness": 0.4, "rmse": 0.1}, {"fitness": 0.5, "rmse": 3.0}]
        src = asym_cloud(20)
        with mock.patch("processing.registration.run_icp", side_effect=results):
            self.assertEqual(R.run_icp_auto(src, src), {"fitness": 0.5, "rmse": 1.0})

    def test_all_seeds_fail(self):
        src = asym_cloud(20)
        with mock.patch("processing.registration.run_icp", side_effect=ValueError):
            with self.assertRaisesRegex(ValueError, "Could not find any valid alignment"):
                R.run_icp_auto(src, src)
