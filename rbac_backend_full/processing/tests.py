import numpy as np
from django.test import SimpleTestCase

from .auto_registration import auto_register
from .registration import _best_fit_transform


def _sample_box_surfaces(rng, lo, hi, n):
    """n points on the six faces of an axis-aligned box, area-weighted."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    size = hi - lo
    faces = []
    for axis in range(3):
        a, b = [i for i in range(3) if i != axis]
        area = size[a] * size[b]
        faces += [(axis, lo[axis], area), (axis, hi[axis], area)]
    areas = np.array([f[2] for f in faces])
    which = rng.choice(len(faces), n, p=areas / areas.sum())
    pts = lo + rng.random((n, 3)) * size
    for i, (axis, value, _) in enumerate(faces):
        pts[which == i, axis] = value
    return pts


def _synthetic_building(rng, n=60_000):
    """Y-up, asymmetric L-shaped 6-storey block with slabs and a side tower."""
    parts = [
        ((0, 0, 0), (40, 18, 15)),       # main wing
        ((0, 0, 15), (12, 18, 35)),      # perpendicular wing
        ((28, 18, 0), (40, 30, 10)),     # stair tower on one corner only
        ((-6, 0, 4), (0, 3, 9)),         # entrance canopy
    ]
    parts += [((0, y - 0.2, 0), (40, y, 15)) for y in (3, 6, 9, 12, 15)]
    volumes = np.array([np.prod(np.subtract(h, l)) ** (2 / 3) for l, h in parts])
    counts = np.maximum((volumes / volumes.sum() * n).astype(int), 200)
    return np.vstack([_sample_box_surfaces(rng, l, h, c) for (l, h), c in zip(parts, counts)])


def _transform(points, T):
    return points @ T[:3, :3].T + T[:3, 3]


def _pose(yaw_deg, tilt_deg, scale, t):
    yaw, tilt = np.radians(yaw_deg), np.radians(tilt_deg)
    Ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(tilt), -np.sin(tilt)], [0, np.sin(tilt), np.cos(tilt)]])
    T = np.eye(4)
    T[:3, :3] = scale * (Rx @ Ry)
    T[:3, 3] = t
    return T


class AutoRegistrationTests(SimpleTestCase):
    def _scan(self, rng, bim, pose):
        # Built so far: only the lower floors, plus measurement noise and clutter.
        built = bim[bim[:, 1] < 10]
        built = built[rng.choice(built.shape[0], 25_000, replace=False)]
        built = built + rng.normal(scale=0.05, size=built.shape)
        clutter = rng.uniform((-10, 0, -10), (50, 2, 25), size=(1_500, 3))
        truth = np.vstack([built, clutter])
        return _transform(truth, np.linalg.inv(pose)), built

    def _assert_recovers(self, result, scan, pose, tolerance):
        T = np.asarray(result['transform'])
        recovered = _transform(scan, T)
        expected = _transform(scan, pose)
        err = np.linalg.norm(recovered - expected, axis=1)
        self.assertLess(np.median(err), tolerance, result)

    def test_metric_scan_rigid_pose(self):
        rng = np.random.default_rng(1)
        bim = _synthetic_building(rng)
        pose = _pose(yaw_deg=137, tilt_deg=3, scale=1.0, t=(55, -4, 20))
        scan, _ = self._scan(rng, bim, pose)
        result = auto_register(scan, bim)
        # Tilt comes from levelling, fine pose from point-to-plane ICP.
        self._assert_recovers(result, scan, pose, tolerance=0.1)
        self.assertGreater(result['fitness'], 0.6)
        self.assertEqual(result['method'], 'levelled')
        # Clutter is left out of the building fit; noise is 5 cm.
        self.assertGreater(result['building_fit'], result['fitness'])
        self.assertGreater(result['building_fit'], 0.9)
        self.assertLess(result['error'], 0.1)

    def test_unscaled_photogrammetry_scan(self):
        rng = np.random.default_rng(2)
        bim = _synthetic_building(rng)
        # Cloud is ~0.13x the BIM size, as with COLMAP output.
        pose = _pose(yaw_deg=-62, tilt_deg=0, scale=7.7, t=(3, 1, -8))
        scan, _ = self._scan(rng, bim, pose)
        result = auto_register(scan, bim)
        self._assert_recovers(result, scan, pose, tolerance=0.8)
        self.assertAlmostEqual(result['scale'], 7.7, delta=7.7 * 0.05)

    def test_upside_down_unscaled_scan(self):
        rng = np.random.default_rng(5)
        bim = _synthetic_building(rng)
        # COLMAP-style: Y-down frame (flipped about X), arbitrary heading, ~0.12x.
        flip = np.diag([1.0, -1.0, -1.0, 1.0])
        pose = _pose(yaw_deg=200, tilt_deg=0, scale=8.3, t=(10, 2, 4)) @ flip
        scan, _ = self._scan(rng, bim, pose)
        result = auto_register(scan, bim)
        self._assert_recovers(result, scan, pose, tolerance=0.8)

    def test_picks_with_tilt_are_levelled(self):
        rng = np.random.default_rng(6)
        bim = _synthetic_building(rng)
        pose = _pose(yaw_deg=75, tilt_deg=0, scale=6.0, t=(4, 0, -3))
        scan, _ = self._scan(rng, bim, pose)
        # Hand-picked pairs: right scale/position, but 4 degrees of tilt.
        rough = _pose(yaw_deg=73, tilt_deg=4, scale=6.2, t=(4.5, 0.6, -2.5))
        result = auto_register(scan, bim, init_transform=rough)
        self._assert_recovers(result, scan, pose, tolerance=0.3)

    def test_refines_from_initial_guess(self):
        rng = np.random.default_rng(3)
        bim = _synthetic_building(rng)
        pose = _pose(yaw_deg=20, tilt_deg=0, scale=1.0, t=(5, 0, 5))
        scan, _ = self._scan(rng, bim, pose)
        rough = _pose(yaw_deg=24, tilt_deg=0, scale=1.0, t=(5.8, 0.3, 4.4))
        result = auto_register(scan, bim, init_transform=rough)
        self._assert_recovers(result, scan, pose, tolerance=0.3)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            auto_register([[0, 0, 0]] * 10, [[1, 1, 1]] * 500)


class BestFitTransformTests(SimpleTestCase):
    def test_similarity_scale(self):
        rng = np.random.default_rng(4)
        src = rng.random((500, 3))
        pose = _pose(yaw_deg=30, tilt_deg=10, scale=2.5, t=(1, 2, 3))
        T = _best_fit_transform(src, _transform(src, pose), with_scale=True)
        np.testing.assert_allclose(T, pose, atol=1e-8)