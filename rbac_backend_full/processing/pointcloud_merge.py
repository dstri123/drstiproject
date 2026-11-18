"""
Monthly point-cloud merge (calendar "Merge Point Clouds" button).

Merges every readable point cloud a project has for one calendar month into a
single, registered, voxel-downsampled PLY. The original uploads and their
saved alignment transforms are only ever read, never written.

Pipeline
--------
1. Scan pass (streamed, chunk by chunk). For each source: validate it can be
   read, count points, compute its bounding box (the viewer recentres every
   cloud on that box's centre before applying the saved transform), find the
   colour range, and keep a small uniform random sample for registration.
   Unreadable or corrupt files are all collected and reported together.

2. Common frame.
   * If any source has a saved viewer transform (the user aligned it to the
     BIM in the viewer and pressed Save), the output frame is the viewer's
     world frame. A saved cloud maps raw -> world as
     T_saved * translate(-bbox_centre), exactly as useModelLoader does.
   * Otherwise the raw coordinates of the reference scan (the one with the
     most points) are the output frame.

3. Registration, one source at a time, against an accumulated reference
   (reference sample + every source accepted so far):
   * a saved transform is reused as-is when it overlaps the reference
     (fitness / RMSE checked); otherwise ICP refinement is tried starting
     from it; the saved transform itself is never modified;
   * an unsaved source is first tested in its own raw coordinates (many
     scanners export a shared site / georeferenced frame), with a unit check
     (mm / cm / ft / in -> reference units);
   * if that does not overlap, FPFH features + RANSAC give coarse
     hypotheses, each refined by ICP (processing.registration.run_icp).
   A source is accepted only when fitness >= MIN_FITNESS and the RMSE is
   within MAX_RMSE_VOXELS registration voxels. If any source fails, the
   merge fails and lists the affected files, rather than writing a
   misleading model.

4. Merge pass (streamed again). Each chunk is transformed into the output
   frame and accumulated into a voxel grid: points from different scans
   that fall into the same voxel (overlap / duplicates) are collapsed into
   their centroid, with averaged colour. Memory is bounded by the number of
   occupied voxels, i.e. by the output size, not by the input size.

5. The voxel centroids are written as a binary little-endian PLY (float32
   xyz relative to the output centre + uchar rgb) — the same layout the
   viewer's PLYLoader already reads for converted LAS files.

This module has no Django model dependencies in the engine part
(`merge_point_clouds`), so it can be unit-tested with plain files. The job
runner at the bottom glues it to the PointCloudMerge model.
"""
import calendar
import hashlib
import json
import logging
import os
import shutil
import tempfile
import threading
import time
from itertools import islice

import numpy as np
from scipy.spatial import cKDTree

from .auto_registration import (
    _same_pose,
    compute_fpfh,
    estimate_normals,
    match_features,
    ransac_correspondences,
    voxel_downsample,
)
from .registration import run_icp

logger = logging.getLogger(__name__)

# Formats the backend can actually read (same set as the viewer's
# pointcloud-to-ply converter). E57 / PLZ uploads are stored but unreadable.
READABLE_EXTS = {".ply", ".las", ".laz", ".pts", ".xyz"}

CHUNK_POINTS = 1_000_000          # points read per chunk
SAMPLE_POINTS = 60_000            # per-source registration sample
REGISTRATION_POINTS = 25_000      # target size of the voxelised registration clouds
DEFAULT_MAX_OUTPUT_POINTS = 5_000_000
CONSOLIDATE_ROWS = 3_000_000      # pending voxel rows before folding into the master grid

MIN_FITNESS = 0.30                # share of a source's points that must land on the reference
MAX_RMSE_VOXELS = 1.1             # accepted inlier RMSE, in registration voxels
# (inliers are capped at EVAL_THRESHOLD_VOXELS, so randomly scattered inliers
#  give ~1.16; the overlap and best-nearby tests below do the real work)
EVAL_THRESHOLD_VOXELS = 1.5       # inlier distance used for fitness, in registration voxels
ICP_THRESHOLD_VOXELS = 3.0        # ICP correspondence distance, in registration voxels
# Guards against false registrations (calibrated on real slices of one
# survey, where a wrong RANSAC pose reached 34 % overlap):
MIN_FEATURE_FITNESS = 0.50        # RANSAC-only registrations need more overlap
MIN_REVERSE_FITNESS = 0.40        # ...and must explain the reference where it lands
AMBIGUITY_RATIO = 0.90            # a different pose this close to the best = ambiguous
BOUNDARY_MIN_POINTS = 30          # points needed where adjoining extents meet
BOUNDARY_MIN_FITNESS = 0.45       # overlap where adjoining extents meet
LOCAL_OPT_TOLERANCE = 0.97        # a nearby shift may not beat the pose by more than 3 %
SHIFT_TOLERANCE_VOXELS = 2.0      # ...unless it is within this distance (unresolvable)

# Common unit conversions between scans: mm, cm, ft, in <-> m (and inverse).
UNIT_FACTORS = {
    1.0: "same units",
    1000.0: "x1000 (m -> mm)",
    0.001: "x0.001 (mm -> m)",
    100.0: "x100 (m -> cm)",
    0.01: "x0.01 (cm -> m)",
    0.3048: "x0.3048 (ft -> m)",
    1 / 0.3048: "x3.2808 (m -> ft)",
    0.0254: "x0.0254 (in -> m)",
    1 / 0.0254: "x39.37 (m -> in)",
}


class MergeError(Exception):
    """A user-presentable merge failure.

    affected: list of {"id", "name", "reason", ...} for the files at fault.
    registration: per-source metrics gathered before the failure.
    """

    def __init__(self, message, affected=None, registration=None):
        super().__init__(message)
        self.affected = affected or []
        self.registration = registration or []


# ─── Chunked readers ──────────────────────────────────────────────────────────

_PLY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
    "short": "i2", "int16": "i2", "ushort": "u2", "uint16": "u2",
    "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4",
    "float": "f4", "float32": "f4", "double": "f8", "float64": "f8",
}
_COLOR_NAMES = (
    ("red", "green", "blue"),
    ("r", "g", "b"),
    ("diffuse_red", "diffuse_green", "diffuse_blue"),
)


def _parse_ply_header(f):
    if f.readline().strip() != b"ply":
        raise ValueError("not a PLY file (missing 'ply' magic)")
    fmt, count, props = None, None, []
    first_element, in_vertex = None, False
    while True:
        line = f.readline()
        if not line:
            raise ValueError("PLY header is truncated (no end_header)")
        t = line.strip().split()
        if not t:
            continue
        kw = t[0]
        if kw == b"format":
            fmt = t[1].decode()
        elif kw == b"element":
            name = t[1].decode()
            if first_element is None:
                first_element = name
            in_vertex = name == "vertex"
            if in_vertex:
                count = int(t[2])
        elif kw == b"property" and in_vertex:
            if t[1] == b"list":
                raise ValueError("PLY vertex element has list properties (unsupported)")
            ptype = t[1].decode()
            if ptype not in _PLY_TYPES:
                raise ValueError(f"unknown PLY property type '{ptype}'")
            props.append((t[2].decode(), ptype))
        elif kw == b"end_header":
            break
    if count is None:
        raise ValueError("PLY file has no vertex element")
    if first_element != "vertex":
        raise ValueError("PLY vertex element must come first")
    names = [p[0] for p in props]
    if not all(axis in names for axis in ("x", "y", "z")):
        raise ValueError("PLY vertices have no x/y/z properties")
    if fmt not in ("ascii", "binary_little_endian", "binary_big_endian"):
        raise ValueError(f"unsupported PLY format '{fmt}'")
    return fmt, count, props, f.tell()


def _ply_color_fields(names):
    for trio in _COLOR_NAMES:
        if all(n in names for n in trio):
            return trio
    return None


class _PlyReader:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            self.fmt, self.count, self.props, self.offset = _parse_ply_header(f)
        self.names = [p[0] for p in self.props]
        self.color_fields = _ply_color_fields(self.names)
        if self.fmt != "ascii":
            order = "<" if self.fmt == "binary_little_endian" else ">"
            self.dtype = np.dtype([(n, order + _PLY_TYPES[t]) for n, t in self.props])
            expected = self.offset + self.count * self.dtype.itemsize
            actual = os.path.getsize(path)
            if actual < expected:
                raise ValueError(
                    f"PLY file is truncated: header declares {self.count:,} points "
                    f"({expected:,} bytes) but the file has {actual:,} bytes"
                )

    def chunks(self, size):
        if self.count == 0:
            return
        if self.fmt == "ascii":
            yield from self._ascii_chunks(size)
            return
        data = np.memmap(self.path, dtype=self.dtype, mode="r",
                         offset=self.offset, shape=(self.count,))
        try:
            for start in range(0, self.count, size):
                block = data[start:start + size]
                xyz = np.column_stack([block[a].astype(np.float64) for a in ("x", "y", "z")])
                rgb = None
                if self.color_fields:
                    rgb = np.column_stack(
                        [block[c].astype(np.float64) for c in self.color_fields]
                    )
                yield xyz, rgb
        finally:
            del data

    def _ascii_chunks(self, size):
        ix = [self.names.index(a) for a in ("x", "y", "z")]
        ic = [self.names.index(c) for c in self.color_fields] if self.color_fields else None
        with open(self.path, "rb") as f:
            f.seek(self.offset)
            remaining = self.count
            while remaining > 0:
                lines = list(islice(f, min(size, remaining)))
                if not lines:
                    raise ValueError(
                        f"PLY file is truncated: expected {self.count:,} points"
                    )
                remaining -= len(lines)
                try:
                    arr = np.array([ln.split()[: len(self.names)] for ln in lines],
                                   dtype=np.float64)
                except ValueError as exc:
                    raise ValueError(f"malformed ASCII PLY vertex row ({exc})")
                if arr.ndim != 2 or arr.shape[1] < len(self.names):
                    raise ValueError("malformed ASCII PLY vertex rows")
                yield arr[:, ix], (arr[:, ic] if ic else None)


class _LasReader:
    def __init__(self, path):
        try:
            import laspy
        except ImportError:  # pragma: no cover - laspy is a requirement
            raise ValueError("laspy is required to read LAS/LAZ files")
        self.path = path
        self._laspy = laspy
        with laspy.open(path) as reader:
            self.count = int(reader.header.point_count)
            dims = set(reader.header.point_format.dimension_names)
        self.has_color = {"red", "green", "blue"} <= dims

    def chunks(self, size):
        with self._laspy.open(self.path) as reader:
            for pts in reader.chunk_iterator(size):
                xyz = np.column_stack([
                    np.asarray(pts.x, dtype=np.float64),
                    np.asarray(pts.y, dtype=np.float64),
                    np.asarray(pts.z, dtype=np.float64),
                ])
                rgb = None
                if self.has_color:
                    rgb = np.column_stack([
                        np.asarray(pts.red, dtype=np.float64),
                        np.asarray(pts.green, dtype=np.float64),
                        np.asarray(pts.blue, dtype=np.float64),
                    ])
                yield xyz, rgb


class _AsciiReader:
    """PTS / XYZ: `x y z`, `x y z r g b` or `x y z intensity r g b` rows.
    A leading point-count line (PTS) and comment lines are skipped."""

    def __init__(self, path):
        self.path = path
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(min(size, 1 << 20))
        lines = max(head.count(b"\n"), 1)
        # Estimated point count (only used to pick the sampling rate).
        self.count = max(int(size / max(len(head) / lines, 1)), 1)

    @staticmethod
    def _parse(lines):
        xyz, rgb, colored = [], [], True
        for raw in lines:
            parts = raw.split()
            if len(parts) < 3 or parts[0].startswith(b"#"):
                continue
            try:
                p = (float(parts[0]), float(parts[1]), float(parts[2]))
            except ValueError:
                continue
            xyz.append(p)
            try:
                if len(parts) >= 7:
                    rgb.append((float(parts[4]), float(parts[5]), float(parts[6])))
                elif len(parts) == 6:
                    rgb.append((float(parts[3]), float(parts[4]), float(parts[5])))
                else:
                    colored = False
            except ValueError:
                colored = False
        xyz = np.array(xyz, dtype=np.float64).reshape(-1, 3)
        colors = np.array(rgb, dtype=np.float64).reshape(-1, 3) if colored and len(rgb) == len(xyz) else None
        return xyz, colors

    def chunks(self, size):
        with open(self.path, "rb") as f:
            while True:
                lines = list(islice(f, size))
                if not lines:
                    return
                xyz, rgb = self._parse(lines)
                if len(xyz):
                    yield xyz, rgb


def open_reader(path, ext):
    """Open a chunked reader; raises ValueError with a readable reason."""
    if not os.path.exists(path):
        raise ValueError("file is missing from storage")
    if os.path.getsize(path) == 0:
        raise ValueError("file is empty")
    if ext == ".ply":
        return _PlyReader(path)
    if ext in (".las", ".laz"):
        return _LasReader(path)
    if ext in (".pts", ".xyz"):
        return _AsciiReader(path)
    raise ValueError(f"'{ext}' files cannot be read by the server")


# ─── Geometry helpers ─────────────────────────────────────────────────────────

def transform_from_saved(saved):
    """4x4 from the viewer's saved {position, quaternion (x,y,z,w), scale}.
    Returns None when the transform is absent or invalid."""
    if not isinstance(saved, dict):
        return None
    try:
        pos = np.asarray(saved.get("position", [0, 0, 0]), dtype=np.float64)
        quat = np.asarray(saved.get("quaternion", [0, 0, 0, 1]), dtype=np.float64)
        scl = np.asarray(saved.get("scale", [1, 1, 1]), dtype=np.float64)
    except (TypeError, ValueError):
        return None
    if pos.shape != (3,) or quat.shape != (4,) or scl.shape != (3,):
        return None
    if not (np.isfinite(pos).all() and np.isfinite(quat).all() and np.isfinite(scl).all()):
        return None
    norm = np.linalg.norm(quat)
    if norm < 1e-9 or np.any(np.abs(scl) < 1e-9):
        return None
    x, y, z, w = quat / norm
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    T = np.eye(4)
    T[:3, :3] = R @ np.diag(scl)
    T[:3, 3] = pos
    return T


def _translate(v):
    T = np.eye(4)
    T[:3, 3] = v
    return T


def _scale(s):
    T = np.eye(4)
    T[:3, :3] *= s
    return T


def apply(T, pts):
    return pts @ T[:3, :3].T + T[:3, 3]


def _uniform_scale(T):
    return float(np.cbrt(abs(np.linalg.det(T[:3, :3]))))


def _robust_extents(pts):
    lo, hi = np.percentile(pts, [2, 98], axis=0)
    return np.sort(hi - lo)


def detect_unit_scale(src, ref):
    """Factor converting `src` units to `ref` units, from robust extents.
    Returns (factor, label). 1.0 when the extents already agree or no common
    unit conversion explains the difference."""
    es, er = _robust_extents(src), _robust_extents(ref)
    valid = (es > 1e-9) & (er > 1e-9)
    if not valid.any():
        return 1.0, UNIT_FACTORS[1.0]
    ratio = float(np.median(er[valid] / es[valid]))
    best, best_err = 1.0, abs(np.log(ratio))
    for f in UNIT_FACTORS:
        err = abs(np.log(ratio / f))
        if err < best_err:
            best, best_err = f, err
    # Only trust a conversion that explains the ratio within ±50 %; scans of
    # the same site on different days can legitimately differ in coverage.
    if best != 1.0 and best_err > np.log(1.5):
        return 1.0, UNIT_FACTORS[1.0]
    return best, UNIT_FACTORS[best]


def registration_voxel(points, target=REGISTRATION_POINTS):
    diag = float(np.linalg.norm(points.max(axis=0) - points.min(axis=0)))
    voxel = max(diag / 200.0, 1e-6)
    for _ in range(30):
        if voxel_downsample(points, voxel).shape[0] <= target * 1.3:
            break
        voxel *= 1.25
    return voxel


def evaluate(T, src, ref_tree, threshold):
    """fitness = share of src points within `threshold` of the reference,
    rmse over those inliers."""
    d, _ = ref_tree.query(apply(T, src), k=1, workers=-1)
    mask = d <= threshold
    fitness = float(mask.mean()) if len(d) else 0.0
    rmse = float(np.sqrt((d[mask] ** 2).mean())) if mask.any() else float("inf")
    return fitness, rmse


def _accept(fitness, rmse, voxel):
    return fitness >= MIN_FITNESS and rmse <= MAX_RMSE_VOXELS * voxel


def _refine(T, src, ref, ref_tree, voxel):
    res = run_icp(src, ref, init_transform=T, max_iterations=40,
                  threshold=ICP_THRESHOLD_VOXELS * voxel, target_tree=ref_tree)
    return np.asarray(res["transform"], dtype=np.float64)


def is_best_nearby(score, T, voxel, tolerance=LOCAL_OPT_TOLERANCE):
    """True when no translation of T within ~±16 voxels that is more than
    SHIFT_TOLERANCE_VOXELS away scores better than score(T) (beyond
    `tolerance`). Coarse-to-fine grid: 4-voxel steps, then 2, then 1, around
    the best so far. Gains from shifts within SHIFT_TOLERANCE_VOXELS are
    below what this check can resolve (voxel-centroid effects) and are
    ignored; the pose is then verified to within that distance.

    A correct pose can only lose overlap when shifted — sliding along a floor
    or wall keeps it level at best — whereas a pose that is off by a few
    decimetres has a shift toward the truth that recovers the surfaces it
    misses. Used where ICP was not run, so nothing else guarantees the pose
    is even locally best."""
    base = best = score(T)
    centre = np.zeros(3)
    for step, radius in ((4 * voxel, 4), (2 * voxel, 2), (voxel, 1)):
        grid = np.arange(-radius, radius + 1) * step
        best_off = centre
        for dx in grid:
            for dy in grid:
                for dz in grid:
                    off = centre + (dx, dy, dz)
                    s = score(_translate(off) @ T)
                    if s > best:
                        best, best_off = s, off
        centre = best_off
    return base >= tolerance * best or (
        float(np.linalg.norm(centre)) <= SHIFT_TOLERANCE_VOXELS * voxel)


def boundary_points(T, src, ref, threshold, limit=2_000, rng=None):
    """Source points (raw) that lie, under pose T, where the two clouds'
    extents meet: inside the reference's bounding box grown by `threshold`.
    Subsampled to `limit` for the translation search."""
    moved = apply(T, src)
    lo, hi = ref.min(axis=0) - threshold, ref.max(axis=0) + threshold
    band = src[np.all((moved >= lo) & (moved <= hi), axis=1)]
    if len(band) > limit:
        rng = rng or np.random.default_rng(0)
        band = band[rng.choice(len(band), limit, replace=False)]
    return band


def plane_fit(T, pts, ref, ref_tree, ref_normals, threshold):
    """Point-to-plane overlap: share of `pts` (under T) whose nearest
    reference point is within 2*threshold AND whose distance to that point's
    tangent plane is within threshold / 1.5 (one registration voxel).
    Unlike point-to-point distance, sliding along a surface doesn't change
    it, so a boundary band isn't penalised for sticking out past the
    reference's last points. Returns (fitness, plane rmse of inliers)."""
    moved = apply(T, pts)
    d, idx = ref_tree.query(moved, k=1, workers=-1)
    plane = np.abs(np.einsum("ij,ij->i", moved - ref[idx], ref_normals[idx]))
    mask = (d <= 2 * threshold) & (plane <= threshold / 1.5)
    if not len(mask):
        return 0.0, float("inf")
    rmse = float(np.sqrt((plane[mask] ** 2).mean())) if mask.any() else float("inf")
    return float(mask.mean()), rmse


def boundary_fit(T, src, ref, ref_tree, ref_normals, threshold):
    """Overlap measured only where the two clouds' extents meet (source
    points inside the reference's bounding box grown by `threshold`), using
    point-to-plane distance. Adjoining pieces of one survey (e.g. height
    slices) score well here even though their global overlap is tiny.
    Returns (fitness, rmse, n_points_in_region)."""
    band = boundary_points(T, src, ref, threshold, limit=len(src))
    n = len(band)
    if n < BOUNDARY_MIN_POINTS:
        return 0.0, float("inf"), n
    fit, rmse = plane_fit(T, band, ref, ref_tree, ref_normals, threshold)
    return fit, rmse, n


def reverse_fit(T, src, ref, threshold):
    """Overlap seen from the reference: of the reference points inside the
    region the moved source covers, the share the source explains. A wrong
    pose that lays the scan onto look-alike geometry (e.g. upper walls onto
    lower walls) leaves the reference's other surfaces there unexplained;
    a correct pose of the same site explains most of them."""
    moved = apply(T, src)
    lo, hi = np.percentile(moved, [2, 98], axis=0)
    inside = ref[np.all((ref >= lo - threshold) & (ref <= hi + threshold), axis=1)]
    if len(inside) < BOUNDARY_MIN_POINTS:
        return 0.0
    d, _ = cKDTree(moved).query(inside, k=1, workers=-1)
    return float((d <= threshold).mean())


def _global_registration(src, ref, ref_tree, voxel, rng, base):
    """FPFH + RANSAC coarse hypotheses (on src already scaled by `base`),
    each ICP-refined. Returns (T, fitness, rmse, ambiguous) for the best one,
    or None. `ambiguous` is set when a clearly different pose fits almost as
    well — the scene is too repetitive / the overlap too small to decide."""
    src_s = apply(base, src)
    src_tree = cKDTree(src_s)
    if src_s.shape[0] < 30 or ref.shape[0] < 30:
        return None
    feat_src = compute_fpfh(src_s, estimate_normals(src_s, src_tree), src_tree, 5 * voxel)
    feat_ref = compute_fpfh(ref, estimate_normals(ref, ref_tree), ref_tree, 5 * voxel)
    si, ti = match_features(feat_src, feat_ref)
    hyps = ransac_correspondences(src_s[si], ref[ti], 1.5 * voxel, rng)
    threshold = EVAL_THRESHOLD_VOXELS * voxel
    results = []
    for _, H in hyps[:6]:
        T = _refine(H @ base, src, ref, ref_tree, voxel)
        fit, rmse = evaluate(T, src, ref_tree, threshold)
        results.append((fit, -rmse, T))
    if not results:
        return None
    results.sort(key=lambda r: (r[0], r[1]), reverse=True)
    fit, neg_rmse, T = results[0]
    centre = src.mean(axis=0)          # _same_pose maps it with each pose
    ambiguous = any(
        other[0] >= AMBIGUITY_RATIO * fit
        and not _same_pose(T, other[2], centre, 3 * voxel)
        for other in results[1:]
    )
    return T, fit, -neg_rmse, ambiguous


def register_source(src, ref, ref_tree, voxel, saved_T, unit, rng, dense=None):
    """Find raw -> output-frame transform for one source sample.

    src: voxelised sample (raw units); dense: the full random sample, used
    for the boundary test (thin regions need more points).
    Returns dict(T, method, fitness, rmse, accepted, note)."""
    threshold = EVAL_THRESHOLD_VOXELS * voxel
    tried = []

    if saved_T is not None:
        fit, rmse = evaluate(saved_T, src, ref_tree, threshold)
        tried.append(("saved_transform", saved_T, fit, rmse))
        if _accept(fit, rmse, voxel):
            return dict(T=saved_T, method="saved_transform", fitness=fit, rmse=rmse,
                        accepted=True, note="Saved viewer alignment reused unchanged.")
        T = _refine(saved_T, src, ref, ref_tree, voxel)
        fit, rmse = evaluate(T, src, ref_tree, threshold)
        tried.append(("saved_transform+icp", T, fit, rmse))
        if _accept(fit, rmse, voxel):
            return dict(T=T, method="saved_transform+icp", fitness=fit, rmse=rmse,
                        accepted=True,
                        note="Saved alignment refined by ICP for the merge "
                             "(the saved transform itself was not changed).")
        best = max(tried, key=lambda t: (t[2], -t[3]))
        return dict(T=best[1], method=best[0], fitness=best[2], rmse=best[3], accepted=False,
                    note="The saved alignment does not overlap the other scans of this "
                         "month. Re-check this scan's alignment in the viewer and save it again.")

    base = _scale(unit)

    # (a) Already in a common coordinate system, overlapping: ICP fine-tune.
    fit, rmse = evaluate(base, src, ref_tree, threshold)
    tried.append(("common_coordinates", base, fit, rmse))
    if fit >= MIN_FITNESS:
        T = _refine(base, src, ref, ref_tree, voxel)
        fit2, rmse2 = evaluate(T, src, ref_tree, threshold)
        tried.append(("common_coordinates+icp", T, fit2, rmse2))
        if _accept(fit2, rmse2, voxel):
            return dict(T=T, method="common_coordinates+icp", fitness=fit2, rmse=rmse2,
                        accepted=True, note="Already in the reference frame; ICP fine-tuned.")

    # (b) Already in a common coordinate system, but only adjoining (e.g.
    # slices of one survey): judge the raw pose where the extents meet. ICP
    # is not run — with so little overlap it could slide the scan.
    dense = src if dense is None else dense
    ref_normals = estimate_normals(ref, ref_tree)
    bfit, brmse, n = boundary_fit(base, dense, ref, ref_tree, ref_normals, threshold)
    if n >= BOUNDARY_MIN_POINTS:
        tried.append(("common_coordinates_adjoining", base, bfit, brmse))
        # Score shifted poses on the SAME boundary points; re-selecting the
        # region per shift would reward shifting the scan into the reference.
        band = boundary_points(base, dense, ref, threshold, rng=rng)
        band_score = lambda T: plane_fit(T, band, ref, ref_tree, ref_normals,  # noqa: E731
                                         threshold)[0]
        if (bfit >= BOUNDARY_MIN_FITNESS and brmse <= MAX_RMSE_VOXELS * voxel
                and is_best_nearby(band_score, base, voxel)):
            tol = SHIFT_TOLERANCE_VOXELS * voxel
            return dict(T=base, method="common_coordinates_adjoining", fitness=bfit,
                        rmse=brmse, accepted=True, overlap_basis="boundary",
                        verified_within=tol,
                        note="Already in the same coordinate system; the scans adjoin, so "
                             "overlap was measured along their shared boundary (position "
                             f"verified to within {tol:.3g} units).")

    # (c) Different frame: FPFH + RANSAC + ICP, with stricter acceptance since
    # there is no prior to fall back on.
    best = _global_registration(src, ref, ref_tree, voxel, rng, base)
    if best is not None:
        T, gfit, grmse, ambiguous = best
        tried.append(("ransac+icp", T, gfit, grmse))
        rfit = reverse_fit(T, src, ref, threshold)
        if (gfit >= MIN_FEATURE_FITNESS and rfit >= MIN_REVERSE_FITNESS
                and grmse <= MAX_RMSE_VOXELS * voxel and not ambiguous):
            return dict(T=T, method="ransac+icp", fitness=gfit, rmse=grmse,
                        reverse_fitness=rfit, accepted=True,
                        note="Registered with FPFH + RANSAC, refined by ICP.")

    top = max(tried, key=lambda t: (t[2], -t[3]))
    return dict(T=top[1], method=top[0], fitness=top[2], rmse=top[3], accepted=False,
                note="Could not register this scan to the others reliably (too little "
                     "or ambiguous overlap). Align it in the viewer and save its position, "
                     "then merge again.")


# ─── Scan pass ────────────────────────────────────────────────────────────────

def scan_source(src, rng, chunk_points=CHUNK_POINTS, on_chunk=None):
    """Stream one source: count, bbox, colour range, registration sample."""
    reader = open_reader(src["path"], src["ext"])
    estimate = max(getattr(reader, "count", 0) or 0, 1)
    keep_p = min(1.0, SAMPLE_POINTS * 1.5 / estimate)
    count, lo, hi, peak, has_color = 0, None, None, 0.0, False
    samples = []
    for xyz, rgb in reader.chunks(chunk_points):
        ok = np.isfinite(xyz).all(axis=1)
        if not ok.all():
            xyz = xyz[ok]
            rgb = rgb[ok] if rgb is not None else None
        if not len(xyz):
            continue
        count += len(xyz)
        cmin, cmax = xyz.min(axis=0), xyz.max(axis=0)
        lo = cmin if lo is None else np.minimum(lo, cmin)
        hi = cmax if hi is None else np.maximum(hi, cmax)
        if rgb is not None:
            has_color = True
            peak = max(peak, float(rgb.max()))
        pick = rng.random(len(xyz)) < keep_p
        if pick.any():
            samples.append(xyz[pick])
        if on_chunk:
            on_chunk()
    if count == 0:
        raise ValueError("file contains no readable points")
    sample = np.vstack(samples) if samples else np.empty((0, 3))
    if len(sample) > SAMPLE_POINTS:
        sample = sample[rng.choice(len(sample), SAMPLE_POINTS, replace=False)]
    if len(sample) < 3:
        sample = np.vstack([lo, hi, (lo + hi) / 2])
    return {
        "count": count,
        "bbox_min": lo,
        "bbox_max": hi,
        "center": (lo + hi) / 2.0,
        "sample": sample,
        "has_color": has_color,
        # LAS / PLY ushort colours are 16-bit; 8-bit data stored in 16-bit
        # fields peaks at <= 255 (same rule as the viewer's converter).
        "color_scale": (255.0 / 65535.0) if peak > 255.0 else 1.0,
    }


# ─── Voxel accumulator ────────────────────────────────────────────────────────

class VoxelAccumulator:
    """Streams points into a voxel grid: per voxel, the xyz sum, the colour
    sum, and point counts. Memory ~ number of occupied voxels."""

    def __init__(self, origin, voxel, extent):
        self.origin = np.asarray(origin, dtype=np.float64)
        self.voxel = float(voxel)
        dims = np.floor(np.asarray(extent) / self.voxel).astype(np.int64) + 2
        if float(dims[0]) * float(dims[1]) * float(dims[2]) >= 2 ** 62:
            raise MergeError("The merged area is too large for the chosen voxel size.")
        self.dims = dims
        self.master = None
        self.pending = []
        self.pending_rows = 0
        self.input_points = 0

    def _keys(self, pts):
        idx = np.floor((pts - self.origin) / self.voxel).astype(np.int64)
        np.clip(idx, 0, self.dims - 1, out=idx)
        return idx[:, 0] + self.dims[0] * (idx[:, 1] + self.dims[1] * idx[:, 2])

    @staticmethod
    def _reduce(keys, cols):
        uniq, inv = np.unique(keys, return_inverse=True)
        inv = inv.ravel()
        out = np.empty((len(uniq), cols.shape[1]), dtype=np.float64)
        for j in range(cols.shape[1]):
            out[:, j] = np.bincount(inv, weights=cols[:, j], minlength=len(uniq))
        return uniq, out

    def add(self, pts, rgb):
        """pts: (n,3) in the output frame; rgb: (n,3) 0-255 floats or None."""
        n = len(pts)
        self.input_points += n
        cols = np.zeros((n, 8), dtype=np.float64)
        cols[:, 0:3] = pts - self.origin
        cols[:, 6] = 1.0                      # point count
        if rgb is not None:
            cols[:, 3:6] = rgb
            cols[:, 7] = 1.0                  # coloured point count
        keys, sums = self._reduce(self._keys(pts), cols)
        self.pending.append((keys, sums))
        self.pending_rows += len(keys)
        if self.pending_rows >= CONSOLIDATE_ROWS:
            self.consolidate()

    def consolidate(self):
        if not self.pending:
            return
        parts = self.pending if self.master is None else [self.master] + self.pending
        keys = np.concatenate([p[0] for p in parts])
        sums = np.concatenate([p[1] for p in parts])
        self.master = self._reduce(keys, sums)
        self.pending, self.pending_rows = [], 0

    @property
    def size(self):
        return 0 if self.master is None else len(self.master[0])

    def result(self):
        """(xyz centroids float64, rgb uint8 or None)."""
        self.consolidate()
        if self.master is None:
            return np.empty((0, 3)), None
        sums = self.master[1]
        xyz = sums[:, 0:3] / sums[:, 6:7] + self.origin
        colored = sums[:, 7]
        if not colored.any():
            return xyz, None
        rgb = np.full((len(xyz), 3), 255.0)
        has = colored > 0
        rgb[has] = sums[has, 3:6] / colored[has, None]
        return xyz, np.clip(np.rint(rgb), 0, 255).astype(np.uint8)


def write_ply(path, xyz_rel, rgb=None):
    """Binary little-endian PLY (float32 xyz [+ uchar rgb]), written to disk."""
    n = len(xyz_rel)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        "comment C'TWIN monthly merged point cloud\n"
        f"element vertex {n}\n"
        "property float x\nproperty float y\nproperty float z\n"
    )
    if rgb is not None:
        header += "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        dtype = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                          ("r", "u1"), ("g", "u1"), ("b", "u1")])
    else:
        dtype = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4")])
    header += "end_header\n"
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        for start in range(0, n, CHUNK_POINTS):
            block = xyz_rel[start:start + CHUNK_POINTS]
            arr = np.empty(len(block), dtype=dtype)
            arr["x"], arr["y"], arr["z"] = block[:, 0], block[:, 1], block[:, 2]
            if rgb is not None:
                c = rgb[start:start + CHUNK_POINTS]
                arr["r"], arr["g"], arr["b"] = c[:, 0], c[:, 1], c[:, 2]
            arr.tofile(f)


# ─── Engine entry point ───────────────────────────────────────────────────────

def _bbox_corners(lo, hi):
    return np.array([[x, y, z] for x in (lo[0], hi[0])
                     for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])


def _estimate_voxel(scans, transforms, ref_cloud, reg_voxel, max_points):
    """Voxel size: the finest native point spacing among the sources (so
    non-overlapping areas keep their detail and overlap duplicates collapse),
    raised only as far as needed to keep the output under `max_points`."""
    spacings = []
    for sid, scan in scans.items():
        pts = apply(transforms[sid], scan["sample"])
        if len(pts) < 10:
            continue
        d, _ = cKDTree(pts).query(pts, k=2, workers=-1)
        sample_spacing = float(np.median(d[:, 1]))
        # A random sample of a surface is sparser by sqrt(count / sample).
        spacings.append(sample_spacing * np.sqrt(len(pts) / max(scan["count"], 1)))
    native = min(spacings) if spacings else reg_voxel / 10.0
    area = len(ref_cloud) * reg_voxel ** 2       # occupied surface estimate
    budget = np.sqrt(area / max(max_points, 1))
    return float(max(native, budget, 1e-6))


def merge_point_clouds(sources, output_path, *, max_output_points=DEFAULT_MAX_OUTPUT_POINTS,
                       voxel_size=None, progress=None, seed=0, chunk_points=CHUNK_POINTS):
    """Merge `sources` into one PLY at `output_path`.

    sources: list of dicts {id, name, path, ext, date (str), transform (saved
             viewer transform dict or None)}, in date order.
    progress: optional callback(fraction 0..1, stage label).
    Returns a metadata dict (see bottom). Raises MergeError for user-facing
    failures (unreadable files, failed registration).
    """
    def report(frac, label):
        if progress:
            progress(min(max(frac, 0.0), 1.0), label)

    if not sources:
        raise MergeError("There are no point cloud files to merge.")
    rng = np.random.default_rng(seed)

    # 1. Scan + validate every source before doing any heavy work.
    scans, bad = {}, []
    for i, src in enumerate(sources):
        report(0.02 + 0.18 * i / len(sources), f"Validating {src['name']}")
        try:
            scans[src["id"]] = scan_source(src, rng, chunk_points,
                                           on_chunk=lambda: report(0.02 + 0.18 * i / len(sources),
                                                                   f"Validating {src['name']}"))
        except MergeError:
            raise
        except Exception as exc:  # corrupt / unreadable file
            bad.append({"id": src["id"], "name": src["name"], "date": src.get("date"),
                        "reason": f"Unreadable: {exc}"})
    if bad:
        raise MergeError(
            f"{len(bad)} point cloud file(s) are missing or unreadable. "
            "Replace or delete them, then merge again.", affected=bad)

    # 2. Common frame.
    saved = {s["id"]: transform_from_saved(s.get("transform")) for s in sources}
    saved_raw = {sid: (T @ _translate(-scans[sid]["center"])) if T is not None else None
                 for sid, T in saved.items()}
    with_saved = [s for s in sources if saved_raw[s["id"]] is not None]
    pool = with_saved or sources
    ref_src = max(pool, key=lambda s: scans[s["id"]]["count"])
    frame = "viewer_world" if with_saved else "source"
    ref_T = saved_raw[ref_src["id"]] if with_saved else np.eye(4)

    transforms = {ref_src["id"]: ref_T}
    ref_pts = apply(ref_T, scans[ref_src["id"]]["sample"])
    reg_voxel = registration_voxel(ref_pts)
    ref_cloud = voxel_downsample(ref_pts, reg_voxel)
    registration = [{
        "id": ref_src["id"], "name": ref_src["name"], "date": ref_src.get("date"),
        "role": "reference",
        "method": "saved_transform" if with_saved else "reference_frame",
        "fitness": 1.0, "rmse": 0.0, "unit_scale": 1.0, "accepted": True,
        "points": scans[ref_src["id"]]["count"],
        "note": ("Reference scan (saved viewer alignment)." if with_saved
                 else "Reference scan: its own coordinates define the merged frame."),
    }]

    # 3. Register the others: saved-alignment sources first, then the rest.
    others = [s for s in sources if s["id"] != ref_src["id"]]
    others.sort(key=lambda s: (saved_raw[s["id"]] is None, s.get("date") or "", s["id"]))
    failed = []
    for i, src in enumerate(others):
        report(0.2 + 0.3 * i / max(len(others), 1), f"Registering {src['name']}")
        sample = scans[src["id"]]["sample"]
        unit, unit_label = (1.0, UNIT_FACTORS[1.0])
        if saved_raw[src["id"]] is None:
            unit, unit_label = detect_unit_scale(sample, ref_cloud)
        ref_tree = cKDTree(ref_cloud)
        # Downsample in the source's own units with the voxel the reference
        # uses in output units (saved transforms and unit fixes can scale).
        src_scale = unit if saved_raw[src["id"]] is None else _uniform_scale(saved_raw[src["id"]])
        src_ds = voxel_downsample(sample, reg_voxel / max(src_scale, 1e-12))
        res = register_source(src_ds, ref_cloud, ref_tree, reg_voxel,
                              saved_raw[src["id"]], unit, rng, dense=sample)
        entry = {
            "id": src["id"], "name": src["name"], "date": src.get("date"),
            "role": "source", "method": res["method"],
            "fitness": round(res["fitness"], 4),
            "rmse": None if not np.isfinite(res["rmse"]) else round(res["rmse"], 6),
            "unit_scale": unit, "unit_note": unit_label,
            "accepted": res["accepted"], "points": scans[src["id"]]["count"],
            "overlap_basis": res.get("overlap_basis", "global"),
            "verified_within": res.get("verified_within"),
            "reverse_fitness": (round(res["reverse_fitness"], 4)
                                if res.get("reverse_fitness") is not None else None),
            "note": res["note"],
        }
        registration.append(entry)
        if not res["accepted"]:
            failed.append({"id": src["id"], "name": src["name"], "date": src.get("date"),
                           "reason": res["note"], "fitness": entry["fitness"],
                           "rmse": entry["rmse"]})
            continue
        transforms[src["id"]] = res["T"]
        grown = np.vstack([ref_cloud, apply(res["T"], sample)])
        ref_cloud = voxel_downsample(grown, reg_voxel)

    for entry in registration:
        entry["fit_threshold"] = round(EVAL_THRESHOLD_VOXELS * reg_voxel, 6)

    if failed:
        raise MergeError(
            f"{len(failed)} scan(s) could not be aligned reliably with the rest of "
            "the month. No merged file was created.",
            affected=failed, registration=registration)

    # 4. Merge pass.
    voxel = float(voxel_size) if voxel_size else _estimate_voxel(
        scans, transforms, ref_cloud, reg_voxel, max_output_points)
    corners = np.vstack([apply(transforms[s["id"]], _bbox_corners(scans[s["id"]]["bbox_min"],
                                                                  scans[s["id"]]["bbox_max"]))
                         for s in sources])
    lo, hi = corners.min(axis=0), corners.max(axis=0)
    acc = VoxelAccumulator(lo - voxel, voxel, hi - lo + 2 * voxel)

    total_in = sum(scans[s["id"]]["count"] for s in sources)
    done = 0
    for src in sources:
        T, scan = transforms[src["id"]], scans[src["id"]]
        reader = open_reader(src["path"], src["ext"])
        for xyz, rgb in reader.chunks(chunk_points):
            ok = np.isfinite(xyz).all(axis=1)
            if not ok.all():
                xyz = xyz[ok]
                rgb = rgb[ok] if rgb is not None else None
            if rgb is not None:
                rgb = np.clip(rgb * scan["color_scale"], 0, 255)
            acc.add(apply(T, xyz), rgb)
            done += len(xyz)
            report(0.5 + 0.4 * done / max(total_in, 1), f"Merging {src['name']}")

    report(0.92, "Writing merged point cloud")
    xyz, rgb = acc.result()
    if len(xyz) == 0:
        raise MergeError("The merge produced no points.")
    centre = (xyz.min(axis=0) + xyz.max(axis=0)) / 2.0
    write_ply(output_path, xyz - centre, rgb)

    transform = None
    if frame == "viewer_world":
        # Output coordinates are viewer-world minus `centre`; the viewer
        # recentres the geometry on its bbox centre (= 0 here), so placing the
        # object at `centre` reproduces the aligned world positions.
        transform = {"position": centre.tolist(), "quaternion": [0, 0, 0, 1],
                     "scale": [1, 1, 1]}

    accepted = [r for r in registration if r["role"] == "source"]
    return {
        "point_count": int(len(xyz)),
        "input_point_count": int(total_in),
        "voxel_size": voxel,
        "registration_voxel": reg_voxel,
        "coordinate_frame": frame,
        "reference_source_id": ref_src["id"],
        "transform": transform,
        "origin_offset": centre.tolist(),
        "has_color": rgb is not None,
        "registration": registration,
        "min_fitness": min((r["fitness"] for r in accepted), default=1.0),
        "max_rmse": max((r["rmse"] or 0.0 for r in accepted), default=0.0),
    }


# ─── Source selection / fingerprint (shared with the views) ───────────────────

def month_label(year, month):
    return f"{calendar.month_name[month]} {year}"


def merged_file_name(year, month):
    return f"{calendar.month_name[month]}_{year}_Merged_PointCloud.ply"


def source_ext(pc):
    return os.path.splitext(pc.file.name or "")[1].lower()


def month_sources(project_id, year, month):
    """All point clouds of a project dated within the month, oldest first."""
    from projects.models import PointCloudData
    return list(PointCloudData.objects.filter(
        project_id=project_id, date__year=year, date__month=month,
    ).order_by("date", "id"))


def classify_sources(pcs):
    """Split into (eligible, excluded, missing) with display info."""
    eligible, excluded, missing = [], [], []
    for pc in pcs:
        ext = source_ext(pc)
        info = {
            "id": pc.id,
            "date": pc.date.isoformat() if pc.date else None,
            "name": os.path.basename(pc.file.name or "") or f"pointcloud-{pc.id}",
            "description": pc.description,
            "format": ext.lstrip(".").upper() or "?",
            "has_saved_alignment": transform_from_saved(pc.transform) is not None,
        }
        if ext not in READABLE_EXTS:
            excluded.append({**info, "reason": f"{info['format']} files cannot be read by "
                                               "the server, so they are left out."})
            continue
        try:
            exists = bool(pc.file.name) and pc.file.storage.exists(pc.file.name)
        except Exception:
            exists = False
        if not exists:
            missing.append({**info, "reason": "The file is missing from storage."})
            continue
        eligible.append(info)
    return eligible, excluded, missing


def fingerprint(pcs):
    """Changes whenever a source is added, removed, replaced, re-dated or
    re-aligned, so an older merge can be recognised as out of date."""
    rows = []
    for pc in sorted(pcs, key=lambda p: p.id):
        try:
            size = pc.file.size
        except Exception:
            size = -1
        rows.append([pc.id, pc.file.name, size, str(pc.date),
                     json.dumps(pc.transform, sort_keys=True, default=str)])
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


# ─── Background job runner ────────────────────────────────────────────────────

# Merges are CPU/memory heavy: run at most this many at once per process;
# others wait in "queued" without blocking request threads.
_SLOTS = threading.BoundedSemaphore(1)
STALE_AFTER_SECONDS = 15 * 60


def _local_path(field_file, work_dir):
    """Absolute path to read from; copies remote-storage files in chunks."""
    try:
        return field_file.path
    except NotImplementedError:
        dest = os.path.join(work_dir, os.path.basename(field_file.name))
        with field_file.open("rb") as src, open(dest, "wb") as out:
            for chunk in src.chunks():
                out.write(chunk)
        return dest


def run_merge_job(merge_id):
    """Execute one PointCloudMerge job (called in a worker thread, or inline
    in tests). Never raises: failures are recorded on the job."""
    from django.conf import settings
    from django.core.files import File
    from django.utils import timezone
    from .models import PointCloudMerge

    job = PointCloudMerge.objects.select_related("project").get(pk=merge_id)
    job.status = "running"
    job.started_at = job.heartbeat_at = timezone.now()
    job.progress, job.stage_label = 0.01, "Starting"
    job.save(update_fields=["status", "started_at", "heartbeat_at", "progress", "stage_label"])

    last = [0.0]

    def progress(frac, label):
        now = time.time()
        if now - last[0] < 1.5 and frac < 0.99:
            return
        last[0] = now
        PointCloudMerge.objects.filter(pk=job.pk).update(
            progress=round(frac, 3), stage_label=label[:120], heartbeat_at=timezone.now())

    work_dir = tempfile.mkdtemp(prefix="pcmerge_")
    try:
        pcs = list(job.sources.all().order_by("date", "id"))
        if not pcs:
            raise MergeError("The source point clouds were deleted before the merge started.")
        sources = []
        for pc in pcs:
            sources.append({
                "id": pc.id,
                "name": os.path.basename(pc.file.name or ""),
                "path": _local_path(pc.file, work_dir),
                "ext": source_ext(pc),
                "date": pc.date.isoformat() if pc.date else None,
                "transform": pc.transform,
            })
        out_path = os.path.join(work_dir, merged_file_name(job.year, job.month))
        meta = merge_point_clouds(
            sources, out_path,
            max_output_points=getattr(settings, "POINTCLOUD_MERGE_MAX_POINTS",
                                      DEFAULT_MAX_OUTPUT_POINTS),
            voxel_size=job.requested_voxel_size,
            progress=progress,
            seed=job.pk,
        )
        progress(0.97, "Saving merged file")
        with open(out_path, "rb") as fh:
            job.file.save(merged_file_name(job.year, job.month), File(fh), save=False)
        job.file_size = os.path.getsize(out_path)
        for key in ("point_count", "input_point_count", "voxel_size", "coordinate_frame",
                    "reference_source_id", "transform", "origin_offset", "registration",
                    "min_fitness", "max_rmse"):
            setattr(job, key, meta[key])
        job.status, job.progress, job.stage_label = "completed", 1.0, "Completed"
        job.error_message, job.failed_sources = "", []
    except MergeError as exc:
        job.status, job.stage_label = "failed", "Failed"
        job.error_message = str(exc)
        job.failed_sources = exc.affected
        job.registration = exc.registration or None
    except Exception as exc:  # unexpected — keep the server up, record it
        logger.exception("Point cloud merge %s crashed", merge_id)
        job.status, job.stage_label = "failed", "Failed"
        job.error_message = f"The merge failed unexpectedly: {exc}"
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        job.completed_at = job.heartbeat_at = timezone.now()
        job.save()


def start_merge_job(merge_id):
    """Run the job in a daemon thread, one merge at a time per process."""
    from django.db import connection

    def worker():
        try:
            with _SLOTS:
                run_merge_job(merge_id)
        finally:
            connection.close()

    threading.Thread(target=worker, name=f"pointcloud-merge-{merge_id}", daemon=True).start()
