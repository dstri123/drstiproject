"""Monthly point-cloud merge: engine (pointcloud_merge) and API views."""
import datetime
import hashlib
import os
import shutil
import tempfile
from datetime import timedelta
from unittest import mock

import laspy
import numpy as np
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from scipy.spatial import cKDTree

from accounts.models import User
from processing import pointcloud_merge as pm
from processing.models import PointCloudMerge
from projects.models import PointCloudData, Project, ProjectUser

PW = "Passw0rd!"
MERGE = "/api/v1/pointcloud/merge/"


# ─── Synthetic data ───────────────────────────────────────────────────────────

def site(n, seed, extra=False):
    """A Z-up 'construction site' in metres: ground, two walls, a block, and
    (on later days) an extra wall. Distinctive enough to register."""
    rng = np.random.default_rng(seed)
    noise = lambda k: rng.normal(0, 0.005, k)  # noqa: E731
    g = rng.uniform([0, 0], [40, 30], (n // 2, 2))
    w1 = rng.uniform([0, 0], [40, 6], (n // 6, 2))
    w2 = rng.uniform([0, 0], [30, 6], (n // 6, 2))
    b = rng.uniform([10, 10, 0], [14, 13, 4], (n // 6, 3))   # block: 4 sides + top
    face = rng.integers(0, 5, len(b))
    for k, (axis, value) in enumerate(((0, 10), (0, 14), (1, 10), (1, 13), (2, 4))):
        b[face == k, axis] = value
    parts = [np.c_[g, noise(len(g))],
             np.c_[w1[:, 0], noise(len(w1)), w1[:, 1]],
             np.c_[noise(len(w2)), w2[:, 0], w2[:, 1]],
             b]
    if extra:
        c = rng.uniform([25, 15, 0], [25, 20, 3], (n // 8, 3))
        parts.append(c)
    return np.vstack(parts)


def rotation(deg_z, deg_x=0.0):
    a, b = np.radians(deg_z), np.radians(deg_x)
    rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    return rz @ rx


def ply_bytes(pts, rgb=(200, 20, 20), double=True):
    t = "double" if double else "float"
    header = (f"ply\nformat binary_little_endian 1.0\nelement vertex {len(pts)}\n"
              f"property {t} x\nproperty {t} y\nproperty {t} z\n"
              "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
    f = "<f8" if double else "<f4"
    arr = np.empty(len(pts), dtype=[("x", f), ("y", f), ("z", f),
                                    ("r", "u1"), ("g", "u1"), ("b", "u1")])
    arr["x"], arr["y"], arr["z"] = pts.T
    arr["r"], arr["g"], arr["b"] = rgb
    return header.encode() + arr.tobytes()


def las_bytes(pts, path):
    h = laspy.LasHeader(point_format=3, version="1.2")
    h.scales = [0.001] * 3
    h.offsets = pts.min(axis=0)
    las = laspy.LasData(h)
    las.x, las.y, las.z = pts.T
    las.red = np.full(len(pts), 65535)
    las.green = np.zeros(len(pts))
    las.blue = np.zeros(len(pts))
    las.write(path)
    with open(path, "rb") as f:
        return f.read()


def xyz_bytes(pts):
    rows = "\n".join(f"{x:.4f} {y:.4f} {z:.4f} 10 20 30" for x, y, z in pts)
    return rows.encode()


def read_merged(path, offset=(0, 0, 0)):
    reader = pm._PlyReader(path)
    chunks = list(reader.chunks(10 ** 7))
    xyz = np.vstack([c[0] for c in chunks]) + np.asarray(offset)
    rgb = np.vstack([c[1] for c in chunks]) if chunks[0][1] is not None else None
    return xyz, rgb


SAVED_UPRIGHT = {  # viewer saved pose: Z-up -> Y-up, moved next to the BIM
    "position": [1.5, -2.0, 3.0],
    "quaternion": [-0.7071067811865476, 0.0, 0.0, 0.7071067811865476],
    "scale": [1, 1, 1],
}


# ─── Engine tests ─────────────────────────────────────────────────────────────

class EngineTests(SimpleTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="mergeengine_")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def put(self, name, data):
        path = os.path.join(self.dir, name)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def src(self, sid, name, data, transform=None, date="2026-11-05"):
        path = data if isinstance(data, str) else self.put(name, data)
        return {"id": sid, "name": name, "path": path, "ext": os.path.splitext(name)[1],
                "date": date, "transform": transform}

    def merge(self, sources, **kw):
        out = os.path.join(self.dir, "out.ply")
        kw.setdefault("chunk_points", 7_000)   # force several chunks per file
        return pm.merge_point_clouds(sources, out, **kw), out

    def test_single_source(self):
        pts = site(20_000, 1) + [500_000, 4_000_000, 10]
        meta, out = self.merge([self.src(1, "a.ply", ply_bytes(pts))])
        self.assertEqual(meta["coordinate_frame"], "source")
        self.assertIsNone(meta["transform"])
        self.assertEqual(meta["input_point_count"], len(pts))
        self.assertTrue(0 < meta["point_count"] <= len(pts))
        xyz, rgb = read_merged(out, meta["origin_offset"])
        # georeferenced coordinates survive (stored relative to origin_offset)
        d, _ = cKDTree(xyz).query(pts[:2000])
        self.assertLess(np.median(d), meta["voxel_size"])
        self.assertTrue((rgb == [200, 20, 20]).all())

    def test_mixed_formats_units_and_registration(self):
        """Day 1 PLY (reference), day 2 LAS in the same site frame, day 3 XYZ
        rotated, shifted and in millimetres: all must land on one frame."""
        offset = np.array([500_000, 4_000_000, 10])
        a = site(24_000, 1) + offset
        b = site(18_000, 2, extra=True) + offset
        c = (site(16_000, 3, extra=True) @ rotation(37, 4).T + [3, -7, 2]) * 1000.0
        sources = [
            self.src(1, "a.ply", ply_bytes(a)),
            self.src(2, "b.las", las_bytes(b, os.path.join(self.dir, "b.las")), date="2026-11-10"),
            self.src(3, "c.xyz", xyz_bytes(c), date="2026-11-15"),
        ]
        meta, out = self.merge(sources)
        reg = {r["id"]: r for r in meta["registration"]}
        self.assertEqual(reg[1]["role"], "reference")
        self.assertEqual(reg[2]["method"], "common_coordinates+icp")
        self.assertEqual(reg[3]["method"], "ransac+icp")
        self.assertAlmostEqual(reg[3]["unit_scale"], 0.001)
        self.assertTrue(all(r["accepted"] for r in reg.values()))
        self.assertGreaterEqual(meta["min_fitness"], pm.MIN_FITNESS)
        self.assertEqual(meta["input_point_count"], len(a) + len(b) + len(c))

        xyz, rgb = read_merged(out, meta["origin_offset"])
        truth = site(10_000, 9, extra=True) + offset
        d, _ = cKDTree(xyz).query(truth)
        self.assertLess(np.median(d), 0.1)            # day-3 wall placed correctly
        self.assertLess(np.percentile(d, 95), 0.3)
        # LAS 16-bit red (65535) is scaled to 8-bit 255 like the viewer converter
        self.assertTrue((rgb[:, 0] == 255).any())

    def test_saved_transforms_define_viewer_world(self):
        a = site(20_000, 1)
        b = site(16_000, 2, extra=True)
        b = b[b[:, 0] < 28]          # partial scan: a different bbox centre
        # The viewer recentres every cloud on its own bbox centre before the
        # saved pose, so b's saved position differs from a's by R(cb - ca)
        # when both were aligned to the same BIM.
        ca, cb = (a.min(0) + a.max(0)) / 2, (b.min(0) + b.max(0)) / 2
        self.assertGreater(np.linalg.norm(cb - ca), 4)
        T = pm.transform_from_saved(SAVED_UPRIGHT)
        b_saved = dict(SAVED_UPRIGHT,
                       position=(T[:3, 3] + T[:3, :3] @ (cb - ca)).tolist())
        sources = [self.src(1, "a.ply", ply_bytes(a), SAVED_UPRIGHT),
                   self.src(2, "b.ply", ply_bytes(b), b_saved, date="2026-11-20")]
        meta, out = self.merge(sources)
        self.assertEqual(meta["coordinate_frame"], "viewer_world")
        reg = {r["id"]: r for r in meta["registration"]}
        self.assertEqual(reg[2]["method"], "saved_transform")   # reused unchanged
        # merged points = T_saved * (raw - bbox_centre), placed via `transform`
        self.assertEqual(meta["transform"]["position"], meta["origin_offset"])
        xyz, _ = read_merged(out, meta["origin_offset"])
        # both scans were aligned to the same world: world = T_a * (raw - ca)
        for pts in (a, b):
            d, _ = cKDTree(xyz).query(pm.apply(T, pts[:2000] - ca))
            self.assertLess(np.median(d), 0.5 * meta["voxel_size"])
        # ...and b's extra wall (x = 25) lands where a's frame says it should
        wall = b[np.isclose(b[:, 0], 25) & (b[:, 1] > 15.5)][:300]
        d, _ = cKDTree(xyz).query(pm.apply(T, wall - ca))
        self.assertLess(np.max(d), meta["voxel_size"])   # within its voxel's centroid

    def test_saved_transform_that_disagrees_is_reported(self):
        a = site(20_000, 1)
        bad = dict(SAVED_UPRIGHT, position=[80.0, 0.0, 0.0])  # 80 m off
        sources = [self.src(1, "a.ply", ply_bytes(a), SAVED_UPRIGHT),
                   self.src(2, "b.ply", ply_bytes(site(16_000, 2)), bad)]
        with self.assertRaises(pm.MergeError) as ctx:
            self.merge(sources)
        self.assertEqual([f["id"] for f in ctx.exception.affected], [2])
        self.assertIn("alignment", ctx.exception.affected[0]["reason"])
        self.assertFalse(os.path.exists(os.path.join(self.dir, "out.ply")))

    def slices(self):
        """One survey cut into three height bands (like 'slice1/2/3.ply'):
        same coordinate system, overlapping only along the cut planes."""
        pts = site(60_000, 7, extra=True)
        cuts = [(-1, 1.5), (1.5, 3.0), (3.0, 99)]
        return [pts[(pts[:, 2] >= lo) & (pts[:, 2] < hi)] for lo, hi in cuts]

    def test_adjoining_slices_of_one_survey_merge_in_place(self):
        parts = self.slices()
        sources = [self.src(i + 1, f"slice{i + 1}.ply", ply_bytes(p), date=f"2026-11-0{i + 1}")
                   for i, p in enumerate(parts)]
        meta, out = self.merge(sources)
        methods = {r["id"]: r["method"] for r in meta["registration"]}
        ref = meta["reference_source_id"]
        self.assertTrue(all(m == "common_coordinates_adjoining"
                            for sid, m in methods.items() if sid != ref), methods)
        xyz, _ = read_merged(out, meta["origin_offset"])
        whole = np.vstack(parts)
        d, _ = cKDTree(xyz).query(whole[::20])
        self.assertLess(np.max(d), meta["voxel_size"])   # nothing moved

    def test_slice_moved_out_of_place_is_rejected_not_slid(self):
        parts = self.slices()
        moved = parts[2] + [0.6, 0.0, 0.0]
        sources = [self.src(1, "slice1.ply", ply_bytes(parts[0])),
                   self.src(2, "slice2.ply", ply_bytes(parts[1])),
                   self.src(3, "slice3.ply", ply_bytes(moved))]
        with self.assertRaises(pm.MergeError) as ctx:
            self.merge(sources)
        self.assertEqual([f["id"] for f in ctx.exception.affected], [3])

    def test_local_optimum_and_boundary_helpers(self):
        ref = site(8_000, 1)
        tree = cKDTree(ref)
        score = lambda T: pm.evaluate(T, ref, tree, 0.1)[0]  # noqa: E731
        self.assertTrue(pm.is_best_nearby(score, np.eye(4), 0.1))
        self.assertFalse(pm.is_best_nearby(score, pm._translate([0.5, 0, 0]), 0.1))
        self.assertFalse(pm.is_best_nearby(score, pm._translate([0, 0.3, 0.3]), 0.1))
        far = pm._translate([100, 0, 0])
        normals = pm.estimate_normals(ref, tree)
        self.assertEqual(pm.boundary_fit(far, ref, ref, tree, normals, 0.3)[2], 0)
        # sliding along a surface keeps point-to-plane overlap; leaving it doesn't
        floor = ref[np.abs(ref[:, 2]) < 0.05][:500]
        self.assertGreater(pm.plane_fit(pm._translate([1.0, 0, 0]), floor, ref, tree, normals, 0.6)[0], 0.9)
        self.assertLess(pm.plane_fit(pm._translate([0, 0, 1.0]), floor, ref, tree, normals, 0.6)[0], 0.1)

    def test_unrelated_scan_fails_alignment(self):
        a = site(20_000, 1)
        rng = np.random.default_rng(4)
        sphere = rng.normal(size=(15_000, 3))
        sphere = sphere / np.linalg.norm(sphere, axis=1, keepdims=True) * 3 + [300, 300, 0]
        sources = [self.src(1, "a.ply", ply_bytes(a)), self.src(2, "s.ply", ply_bytes(sphere))]
        with self.assertRaises(pm.MergeError) as ctx:
            self.merge(sources)
        self.assertEqual(ctx.exception.affected[0]["id"], 2)
        self.assertTrue(ctx.exception.registration)   # metrics still reported

    def test_corrupt_and_missing_files_are_all_reported(self):
        good = ply_bytes(site(5_000, 1))
        truncated = good[: len(good) // 2]
        sources = [self.src(1, "a.ply", good),
                   self.src(2, "t.ply", truncated),
                   self.src(3, "junk.las", b"not a las file at all"),
                   {"id": 4, "name": "gone.ply", "path": os.path.join(self.dir, "nope.ply"),
                    "ext": ".ply", "date": None, "transform": None}]
        with self.assertRaises(pm.MergeError) as ctx:
            self.merge(sources)
        ids = sorted(f["id"] for f in ctx.exception.affected)
        self.assertEqual(ids, [2, 3, 4])
        reasons = {f["id"]: f["reason"] for f in ctx.exception.affected}
        self.assertIn("truncated", reasons[2])
        self.assertIn("missing", reasons[4])

    def test_duplicate_scans_collapse_in_overlap(self):
        pts = site(20_000, 1)
        one, _ = self.merge([self.src(1, "a.ply", ply_bytes(pts))], voxel_size=0.2)
        two, _ = self.merge([self.src(1, "a.ply", ply_bytes(pts)),
                             self.src(2, "b.ply", ply_bytes(pts))], voxel_size=0.2)
        self.assertEqual(two["input_point_count"], 2 * one["input_point_count"])
        self.assertEqual(two["point_count"], one["point_count"])

    def test_voxel_budget_limits_output(self):
        pts = site(30_000, 1)
        meta, _ = self.merge([self.src(1, "a.ply", ply_bytes(pts))], max_output_points=2_000)
        self.assertLess(meta["point_count"], 4_000)

    def test_ascii_ply_and_float_ply(self):
        pts = site(6_000, 1)
        later = site(6_000, 2, extra=True)    # adds a wall the coloured scan lacks
        ascii_ply = ("ply\nformat ascii 1.0\nelement vertex %d\nproperty float x\n"
                     "property float y\nproperty float z\nend_header\n" % len(later)
                     + "\n".join("%f %f %f" % tuple(p) for p in later) + "\n").encode()
        meta, out = self.merge([self.src(1, "a.ply", ply_bytes(pts, double=False)),
                                self.src(2, "b.ply", ascii_ply)])
        _, rgb = read_merged(out)
        self.assertEqual(meta["input_point_count"], len(pts) + len(later))
        self.assertIsNotNone(rgb)       # coloured source present; uncoloured -> white
        self.assertTrue((rgb == 255).all(axis=1).any())

    def test_accumulator_consolidation_matches_single_pass(self):
        rng = np.random.default_rng(0)
        pts = rng.uniform(0, 10, (50_000, 3))
        with mock.patch.object(pm, "CONSOLIDATE_ROWS", 1_000):
            acc = pm.VoxelAccumulator([0, 0, 0], 1.0, [10, 10, 10])
            for chunk in np.array_split(pts, 17):
                acc.add(chunk, None)
            xyz_a, _ = acc.result()
        acc = pm.VoxelAccumulator([0, 0, 0], 1.0, [10, 10, 10])
        acc.add(pts, None)
        xyz_b, _ = acc.result()
        self.assertEqual(len(xyz_a), 1000)
        np.testing.assert_allclose(np.sort(xyz_a, axis=0), np.sort(xyz_b, axis=0))

    def test_transform_from_saved_validation(self):
        self.assertIsNone(pm.transform_from_saved(None))
        self.assertIsNone(pm.transform_from_saved({"position": [1, 2]}))
        self.assertIsNone(pm.transform_from_saved({"quaternion": [0, 0, 0, 0]}))
        self.assertIsNone(pm.transform_from_saved({"scale": [0, 1, 1]}))
        self.assertIsNone(pm.transform_from_saved({"position": ["a", 0, 0]}))
        T = pm.transform_from_saved({"position": [1, 2, 3]})
        np.testing.assert_allclose(T[:3, 3], [1, 2, 3])
        np.testing.assert_allclose(T[:3, :3], np.eye(3))

    def test_unit_detection(self):
        ref = site(5_000, 1)
        self.assertEqual(pm.detect_unit_scale(ref * 1000, ref)[0], 0.001)
        self.assertEqual(pm.detect_unit_scale(ref / 0.3048, ref)[0], 0.3048)
        self.assertEqual(pm.detect_unit_scale(ref * 1.2, ref)[0], 1.0)
        self.assertEqual(pm.detect_unit_scale(ref * 7, ref)[0], 1.0)   # unexplained: no guess


# ─── API tests ────────────────────────────────────────────────────────────────

@override_settings(POINTCLOUD_MERGE_RUN_INLINE=True)
class MergeApiTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        cls._media = tempfile.mkdtemp(prefix="mergeapi_")
        cls._media_override = override_settings(MEDIA_ROOT=cls._media)
        cls._media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._media_override.disable()
        shutil.rmtree(cls._media, ignore_errors=True)

    def setUp(self):
        self.admin = User.objects.create_user("boss", "boss@x.com", PW, role="admin")
        self.member = User.objects.create_user("eng", "eng@x.com", PW, role="member",
                                               sub_role="data_contributor", created_by=self.admin)
        self.viewer = User.objects.create_user("look", "look@x.com", PW, role="member",
                                               sub_role="viewer", created_by=self.admin)
        self.outsider = User.objects.create_user("out", "out@x.com", PW, role="member",
                                                 sub_role="data_contributor", created_by=self.admin)
        self.project = Project.objects.create(project_name="Tower A", description="",
                                              start=datetime.date(2026, 1, 1),
                                              end=datetime.date(2026, 12, 31))
        for u in (self.member, self.viewer):
            ProjectUser.objects.create(user=u, project=self.project)
        self.client.force_authenticate(self.member)

    def pc(self, name, data, date, transform=None, is_latest=False):
        return PointCloudData.objects.create(
            project=self.project, description=name, date=date, is_latest=is_latest,
            transform=transform, file=SimpleUploadedFile(name, data))

    def nov(self, day):
        return datetime.date(2026, 11, day)

    def seed_month(self):
        a = self.pc("scan_01.ply", ply_bytes(site(12_000, 1)), self.nov(5))
        b = self.pc("scan_02.ply", ply_bytes(site(10_000, 2, extra=True)), self.nov(10))
        self.pc("october.ply", ply_bytes(site(5_000, 3)), datetime.date(2026, 10, 30))
        return a, b

    def post(self, **data):
        body = {"project_id": self.project.id, "year": 2026, "month": 11, **data}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(MERGE, body, format="json")

    def preview(self, month=11):
        return self.client.get(MERGE, {"project_id": self.project.id, "year": 2026, "month": month})

    def test_preview_lists_only_that_month(self):
        a, b = self.seed_month()
        self.pc("leica.e57", b"E57 data", self.nov(12))
        res = self.preview()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["eligible_count"], 2)
        self.assertEqual([s["id"] for s in res.data["sources"]], [a.id, b.id])
        self.assertEqual(res.data["excluded_sources"][0]["format"], "E57")
        self.assertEqual(res.data["output_name"], "November_2026_Merged_PointCloud.ply")
        self.assertEqual(res.data["month_label"], "November 2026")
        self.assertTrue(res.data["can_merge"])
        self.assertIsNone(res.data["latest"])

    def test_merge_creates_separate_file_and_keeps_originals(self):
        a, b = self.seed_month()
        before = {pc.id: (hashlib.sha256(pc.file.read()).hexdigest(), pc.transform, pc.file.name)
                  for pc in (a, b)}
        list_before = self.client.get(f"/api/v1/projects/{self.project.id}/pointcloud/").data

        res = self.post()
        self.assertEqual(res.status_code, 202, res.data)
        merge = PointCloudMerge.objects.get(pk=res.data["merge"]["id"])
        self.assertEqual(merge.status, "completed", merge.error_message)
        self.assertEqual(merge.total_source_files, 2)
        self.assertEqual(sorted(merge.sources.values_list("id", flat=True)), [a.id, b.id])
        self.assertTrue(merge.file.name.endswith(".ply"))
        self.assertIn("November_2026_Merged_PointCloud", merge.file.name)
        self.assertTrue(os.path.exists(merge.file.path))
        self.assertGreater(merge.point_count, 0)
        self.assertEqual(merge.input_point_count,
                         len(site(12_000, 1)) + len(site(10_000, 2, extra=True)))

        detail = self.client.get(f"{MERGE}{merge.id}/").data
        self.assertEqual(detail["status"], "completed")
        self.assertFalse(detail["is_stale"])
        self.assertTrue(detail["file_url"].startswith("http"))
        self.assertEqual(detail["source_ids"], [a.id, b.id])
        self.assertEqual(len(detail["registration"]), 2)

        for pc in (a, b):   # originals untouched
            pc.refresh_from_db()
            pc.file.open("rb")
            self.assertEqual((hashlib.sha256(pc.file.read()).hexdigest(), pc.transform,
                              pc.file.name), before[pc.id])
            pc.file.close()
        # merged output is not a date-wise upload
        list_after = self.client.get(f"/api/v1/projects/{self.project.id}/pointcloud/").data
        self.assertEqual(len(list_after), len(list_before))

    def test_second_click_reuses_up_to_date_result(self):
        self.seed_month()
        first = self.post()
        again = self.post()
        self.assertEqual(again.status_code, 200)
        self.assertTrue(again.data["reused"])
        self.assertEqual(again.data["merge"]["id"], first.data["merge"]["id"])
        self.assertEqual(PointCloudMerge.objects.count(), 1)

    def test_running_job_is_returned_instead_of_a_duplicate(self):
        self.seed_month()
        running = PointCloudMerge.objects.create(
            project=self.project, year=2026, month=11, status="running",
            source_fingerprint="x", heartbeat_at=timezone.now())
        with mock.patch.object(pm, "run_merge_job") as run:
            res = self.post(force=True)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["already_running"])
        self.assertEqual(res.data["merge"]["id"], running.id)
        run.assert_not_called()
        self.assertEqual(PointCloudMerge.objects.count(), 1)

    def test_dead_job_is_expired_and_does_not_block(self):
        self.seed_month()
        dead = PointCloudMerge.objects.create(
            project=self.project, year=2026, month=11, status="running", source_fingerprint="x")
        PointCloudMerge.objects.filter(pk=dead.pk).update(
            heartbeat_at=timezone.now() - timedelta(hours=1))
        res = self.post()
        self.assertEqual(res.status_code, 202)
        dead.refresh_from_db()
        self.assertEqual(dead.status, "failed")
        self.assertIn("interrupted", dead.error_message)

    def test_new_upload_marks_result_stale_and_regenerates(self):
        self.seed_month()
        first = self.post().data["merge"]
        self.pc("scan_03.ply", ply_bytes(site(8_000, 4, extra=True)), self.nov(15))
        preview = self.preview().data
        self.assertTrue(preview["latest_completed"]["is_stale"])
        self.assertEqual(preview["eligible_count"], 3)
        res = self.post()
        self.assertEqual(res.status_code, 202)
        second = PointCloudMerge.objects.get(pk=res.data["merge"]["id"])
        self.assertNotEqual(second.id, first["id"])
        self.assertEqual(second.total_source_files, 3)
        self.assertEqual(second.status, "completed", second.error_message)
        self.assertFalse(self.preview().data["latest_completed"]["is_stale"])

    def test_realignment_also_marks_stale(self):
        a, _ = self.seed_month()
        self.post()
        a.transform = SAVED_UPRIGHT
        a.save()
        self.assertTrue(self.preview().data["latest_completed"]["is_stale"])

    def test_force_regenerates(self):
        self.seed_month()
        first = self.post().data["merge"]["id"]
        res = self.post(force=True)
        self.assertEqual(res.status_code, 202)
        self.assertNotEqual(res.data["merge"]["id"], first)

    def test_single_file_month(self):
        self.pc("only.ply", ply_bytes(site(8_000, 1)), self.nov(3))
        res = self.post()
        self.assertEqual(res.status_code, 202)
        merge = PointCloudMerge.objects.get(pk=res.data["merge"]["id"])
        self.assertEqual(merge.status, "completed")
        self.assertEqual(merge.total_source_files, 1)

    def test_corrupted_source_fails_with_affected_file(self):
        self.seed_month()
        bad = self.pc("broken.ply", b"ply\nformat binary_little_endian 1.0\n"
                                    b"element vertex 1000\nproperty float x\n"
                                    b"property float y\nproperty float z\nend_header\nxx",
                      self.nov(20))
        res = self.post()
        merge = PointCloudMerge.objects.get(pk=res.data["merge"]["id"])
        self.assertEqual(merge.status, "failed")
        self.assertFalse(merge.file)
        self.assertEqual([f["id"] for f in merge.failed_sources], [bad.id])
        self.assertIn("unreadable", merge.error_message)

    def test_alignment_failure_creates_no_file(self):
        self.seed_month()
        rng = np.random.default_rng(4)
        blob = rng.normal(size=(6_000, 3)) * 2 + [400, 400, 0]
        far = self.pc("elsewhere.ply", ply_bytes(blob), self.nov(25))
        merge = PointCloudMerge.objects.get(pk=self.post().data["merge"]["id"])
        self.assertEqual(merge.status, "failed")
        self.assertFalse(merge.file)
        self.assertIn(far.id, [f["id"] for f in merge.failed_sources])
        self.assertTrue(merge.registration)

    def test_unexpected_crash_is_recorded(self):
        self.seed_month()
        with mock.patch.object(pm, "merge_point_clouds", side_effect=RuntimeError("boom")):
            res = self.post()
        merge = PointCloudMerge.objects.get(pk=res.data["merge"]["id"])
        self.assertEqual(merge.status, "failed")
        self.assertIn("boom", merge.error_message)

    def test_missing_file_is_rejected_up_front(self):
        a, _ = self.seed_month()
        a.file.storage.delete(a.file.name)
        res = self.post()
        self.assertEqual(res.status_code, 400)
        self.assertEqual([f["id"] for f in res.data["failed_sources"]], [a.id])
        self.assertEqual(PointCloudMerge.objects.count(), 0)

    def test_empty_month_and_unreadable_only(self):
        res = self.post()
        self.assertEqual(res.status_code, 400)
        self.assertIn("No point cloud files", res.data["error"])
        self.pc("leica.e57", b"E57", self.nov(2))
        res = self.post()
        self.assertEqual(res.status_code, 400)
        self.assertIn("format", res.data["error"])

    def test_bad_parameters(self):
        for body in ({"month": 13}, {"year": "x"}, {"voxel_size": -1}):
            with self.subTest(body=body):
                self.assertEqual(self.post(**body).status_code, 400)
        self.assertEqual(self.client.get(MERGE, {"project_id": 1}).status_code, 400)
        res = self.client.post(MERGE, {"project_id": 9999, "year": 2026, "month": 1}, format="json")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.client.get(f"{MERGE}9999/").status_code, 404)

    def test_permissions(self):
        self.seed_month()
        merge_id = self.post().data["merge"]["id"]
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.preview().status_code, 403)
        self.assertEqual(self.post().status_code, 403)
        self.assertEqual(self.client.get(f"{MERGE}{merge_id}/").status_code, 403)
        # read-only viewers can open a merged result but not start one
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.preview().status_code, 200)
        self.assertFalse(self.preview().data["can_merge"])
        self.assertEqual(self.post(force=True).status_code, 403)
        self.assertEqual(self.client.get(f"{MERGE}{merge_id}/").status_code, 200)
        self.client.force_authenticate(None)
        self.assertEqual(self.preview().status_code, 401)

    def test_switching_months_is_independent(self):
        self.seed_month()
        self.post()
        october = self.preview(month=10).data
        self.assertEqual(october["eligible_count"], 1)
        self.assertIsNone(october["latest"])

    def test_background_runner_uses_a_thread(self):
        with mock.patch.object(pm.threading, "Thread") as thread:
            pm.start_merge_job(42)
        thread.assert_called_once()
        self.assertTrue(thread.call_args.kwargs["daemon"])
        thread.return_value.start.assert_called_once()
