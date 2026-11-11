"""
Automatic BIM <-> point-cloud registration, numpy + scipy only.

Pipeline (the team's "Automatic BIM <-> Point Cloud Registration" flowchart,
with gravity used as a hard constraint):
  1. BIM surface points (sampled from the mesh in the viewer) + cloud points
  2. Level the cloud: its dominant plane (ground/floors) becomes horizontal;
     up vs down is decided by "most of a site lies above its ground"
     (COLMAP clouds often arrive upside down)
  3. Heading from wall directions (orientation-histogram correlation)
  4. Scale + position exhaustively: FFT cross-correlation of floor/wall
     occupancy grids for each heading x scale
  5. Rank by plan-footprint agreement — overlap scores alone favour wrong
     poses inside a dense BIM — then ICP with tilt locked, finishing with
     point-to-plane ICP for precision -> final 4x4 for the viewer
  Fallback when the cloud has no dominant plane: FPFH features + RANSAC +
  ICP over all rotations.

Photogrammetry clouds (COLMAP etc.) have no real-world scale. The scale search
assumes the survey covers the building's footprint; for scans of only part of
a site, pass picked point pairs as `init_transform` instead.

Both inputs must be in the SAME frame (viewer world space). The returned
transform maps the cloud's current world points onto the BIM.
"""
import time

import numpy as np
from scipy.spatial import cKDTree

from .registration import _best_fit_transform, run_icp

MAX_INPUT_POINTS = 80_000
TARGET_DOWNSAMPLED = 5_000      # aim for roughly this many points after voxelising
RANSAC_ITERATIONS = 20_000
RANSAC_BATCH = 256              # hypotheses evaluated per vectorised batch
MAX_CANDIDATES = 5
SCALE_REFINE_LIMIT = 0.25       # final ICP may change scale by at most ±25 %


# ─── Input / preprocessing ───────────────────────────────────────────────────

def _as_points(points, name, rng):
    arr = np.asarray(points, dtype=np.float64)
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(f'"{name}" must be a list of [x, y, z] points.')
    arr = arr[np.isfinite(arr).all(axis=1)]
    if arr.shape[0] < 100:
        raise ValueError(f'"{name}" needs at least 100 valid points.')
    if arr.shape[0] > MAX_INPUT_POINTS:
        arr = arr[rng.choice(arr.shape[0], MAX_INPUT_POINTS, replace=False)]
    return arr


def voxel_downsample(points, voxel):
    """Replace all points inside each voxel by their centroid."""
    keys = np.floor((points - points.min(axis=0)) / voxel).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    out = np.empty((counts.size, 3))
    for axis in range(3):
        out[:, axis] = np.bincount(inverse, weights=points[:, axis]) / counts
    return out


def _choose_voxel(target):
    """Voxel size giving roughly TARGET_DOWNSAMPLED BIM points."""
    diag = np.linalg.norm(target.max(axis=0) - target.min(axis=0))
    voxel = diag / 60.0
    for _ in range(12):
        if voxel_downsample(target, voxel).shape[0] <= TARGET_DOWNSAMPLED * 1.3:
            break
        voxel *= 1.25
    return voxel


def estimate_normals(points, tree, k=16):
    """PCA normals, oriented away from the centroid so FPFH signs agree."""
    k = min(k, points.shape[0])
    _, idx = tree.query(points, k=k)
    nbrs = points[idx]
    centred = nbrs - nbrs.mean(axis=1, keepdims=True)
    cov = np.einsum('nki,nkj->nij', centred, centred)
    _, vecs = np.linalg.eigh(cov)
    normals = vecs[:, :, 0]
    flip = np.einsum('ni,ni->n', normals, points - points.mean(axis=0)) < 0
    normals[flip] *= -1
    return normals


# ─── FPFH features ────────────────────────────────────────────────────────────

def _pair_features(p1, n1, p2, n2):
    """Darboux-frame angles (f1, f2, f3) for point pairs, as in PCL / Open3D."""
    d = p2 - p1
    dist = np.linalg.norm(d, axis=-1)
    d = d / np.where(dist > 0, dist, 1.0)[..., None]
    a1 = np.sum(n1 * d, axis=-1)
    a2 = np.sum(n2 * d, axis=-1)

    # Use the endpoint whose normal is closer to the connecting line as source.
    swap = np.abs(a1) < np.abs(a2)
    ns = np.where(swap[..., None], n2, n1)
    nt = np.where(swap[..., None], n1, n2)
    d = np.where(swap[..., None], -d, d)
    f3 = np.where(swap, -a2, a1)

    v = np.cross(d, ns)
    v_norm = np.linalg.norm(v, axis=-1)
    v = v / np.where(v_norm > 0, v_norm, 1.0)[..., None]
    w = np.cross(ns, v)
    f2 = np.sum(v * nt, axis=-1)
    f1 = np.arctan2(np.sum(w * nt, axis=-1), np.sum(ns * nt, axis=-1))
    return f1, f2, f3


def compute_fpfh(points, normals, tree, radius, max_nn=40):
    """(N, 33) Fast Point Feature Histograms."""
    n = points.shape[0]
    k = min(max_nn + 1, n)
    dist, idx = tree.query(points, k=k, distance_upper_bound=radius)
    dist, idx = dist[:, 1:], idx[:, 1:]          # drop the point itself
    valid = np.isfinite(dist)
    idx = np.where(valid, idx, 0)

    f1, f2, f3 = _pair_features(points[:, None, :], normals[:, None, :],
                                points[idx], normals[idx])
    bins = [
        np.floor(11 * (f1 + np.pi) / (2 * np.pi)),
        np.floor(11 * (f2 + 1.0) / 2.0),
        np.floor(11 * (f3 + 1.0) / 2.0),
    ]

    # Simplified PFH: three 11-bin histograms per point, each summing to 100.
    counts = valid.sum(axis=1)
    weights = np.where(valid, (100.0 / np.maximum(counts, 1))[:, None], 0.0)
    rows = np.repeat(np.arange(n), idx.shape[1])
    spfh = np.zeros((n, 33))
    for j, b in enumerate(bins):
        col = j * 11 + np.clip(b, 0, 10).astype(np.int64).ravel()
        spfh += np.bincount(rows * 33 + col, weights=weights.ravel(),
                            minlength=n * 33).reshape(n, 33)

    # FPFH = own SPFH + distance-weighted neighbour SPFHs, renormalised per block.
    inv_d = np.where(valid, 1.0 / np.maximum(dist, 1e-12), 0.0)
    fpfh = spfh + np.einsum('nk,nkf->nf', inv_d, spfh[idx]) / np.maximum(counts, 1)[:, None]
    blocks = fpfh.reshape(n, 3, 11)
    sums = blocks.sum(axis=2, keepdims=True)
    return (blocks / np.where(sums > 0, sums, 1.0) * 100.0).reshape(n, 33)


def match_features(feat_src, feat_dst):
    """Mutual nearest neighbours in feature space (all source NN if too few)."""
    _, s2t = cKDTree(feat_dst).query(feat_src, k=1)
    _, t2s = cKDTree(feat_src).query(feat_dst, k=1)
    src_idx = np.arange(feat_src.shape[0])
    mutual = t2s[s2t] == src_idx
    if mutual.sum() >= 30:
        return src_idx[mutual], s2t[mutual]
    return src_idx, s2t


# ─── RANSAC ──────────────────────────────────────────────────────────────────

def _batched_kabsch(a, b):
    """Rigid transforms mapping each (3,3) triplet in a onto b."""
    ca, cb = a.mean(axis=1), b.mean(axis=1)
    H = np.einsum('bki,bkj->bij', a - ca[:, None], b - cb[:, None])
    U, _, Vt = np.linalg.svd(H)
    V = np.transpose(Vt, (0, 2, 1))
    d = np.sign(np.linalg.det(V @ np.transpose(U, (0, 2, 1))))
    V[:, :, 2] *= d[:, None]
    R = V @ np.transpose(U, (0, 2, 1))
    t = cb - np.einsum('bij,bj->bi', R, ca)
    return R, t


def ransac_correspondences(P, Q, threshold, rng, iterations=RANSAC_ITERATIONS,
                           keep=20, edge_similarity=0.9):
    """Top rigid hypotheses (4x4, inlier count) from corresponding points P -> Q."""
    c = P.shape[0]
    if c < 3:
        return []
    hypotheses = []
    min_edge = threshold
    for _ in range(0, iterations, RANSAC_BATCH):
        tri = rng.integers(0, c, size=(RANSAC_BATCH, 3))
        a, b = P[tri], Q[tri]
        ea = np.linalg.norm(a - a[:, [1, 2, 0]], axis=-1)
        eb = np.linalg.norm(b - b[:, [1, 2, 0]], axis=-1)
        # Cheap pre-check: a rigid transform preserves edge lengths.
        ok = (np.minimum(ea, eb) >= edge_similarity * np.maximum(ea, eb)).all(axis=1)
        ok &= ea.min(axis=1) > min_edge
        if not ok.any():
            continue
        R, t = _batched_kabsch(a[ok], b[ok])
        moved = np.einsum('bij,cj->bci', R, P) + t[:, None, :]
        inliers = (np.linalg.norm(moved - Q[None], axis=-1) < threshold).sum(axis=1)
        for i in np.argsort(inliers)[::-1][:keep]:
            T = np.eye(4)
            T[:3, :3], T[:3, 3] = R[i], t[i]
            hypotheses.append((int(inliers[i]), T))
        hypotheses.sort(key=lambda h: h[0], reverse=True)
        hypotheses = hypotheses[: keep * 4]

    # Refit each surviving hypothesis on all of its inliers.
    refined = []
    for count, T in hypotheses[: keep * 2]:
        moved = P @ T[:3, :3].T + T[:3, 3]
        mask = np.linalg.norm(moved - Q, axis=1) < threshold
        if mask.sum() >= 3:
            T = _best_fit_transform(P[mask], Q[mask])
        refined.append((int(mask.sum()), T))
    return _dedupe(refined, P.mean(axis=0), threshold * 2, keep)


# ─── Candidate handling / scoring ────────────────────────────────────────────

def _rotation_angle_deg(R1, R2):
    R = R1 @ R2.T
    cos = np.clip((np.trace(R) - 1) / 2, -1.0, 1.0)
    return np.degrees(np.arccos(cos))


def _uniform_scale(T):
    return float(np.cbrt(abs(np.linalg.det(T[:3, :3]))))


def _same_pose(T1, T2, centre, position_tol):
    s1, s2 = _uniform_scale(T1), _uniform_scale(T2)
    if abs(s1 - s2) > 0.1 * max(s1, s2):
        return False
    if _rotation_angle_deg(T1[:3, :3] / s1, T2[:3, :3] / s2) > 10:
        return False
    p1 = T1[:3, :3] @ centre + T1[:3, 3]
    p2 = T2[:3, :3] @ centre + T2[:3, 3]
    return np.linalg.norm(p1 - p2) < position_tol


def _dedupe(scored, centre, position_tol, limit):
    """Keep the best of each group of near-identical poses.
    `scored` holds tuples (score, T, ...) in any order."""
    out = []
    for item in sorted(scored, key=lambda s: s[0], reverse=True):
        if not any(_same_pose(item[1], kept[1], centre, position_tol) for kept in out):
            out.append(item)
        if len(out) >= limit:
            break
    return out


def _evaluate(T, source, target, target_tree, threshold):
    """Scored against the full-resolution BIM with a tight threshold so that
    slightly wrong scales / poses lose to the right one.

    fitness: share of cloud points lying on the BIM.
    coverage: share of BIM points (inside the aligned cloud's bounding box)
    that the cloud reaches — penalises shrinking the cloud into a corner."""
    moved = source @ T[:3, :3].T + T[:3, 3]
    d, _ = target_tree.query(moved, k=1)
    on_bim = d < threshold
    fitness = float(on_bim.mean())
    rmse = float(np.sqrt((d[on_bim] ** 2).mean())) if on_bim.any() else float(threshold)

    lo, hi = moved.min(axis=0) - threshold, moved.max(axis=0) + threshold
    local = target[((target >= lo) & (target <= hi)).all(axis=1)]
    coverage = 0.0
    if local.shape[0]:
        d2, _ = cKDTree(moved).query(local, k=1)
        coverage = float((d2 < threshold).mean())
    return {
        'fitness': fitness,
        'coverage': coverage,
        'rmse': rmse,
        'score': 0.7 * fitness + 0.3 * coverage,
    }


def _plan_cells(points_w, cell, min_points):
    """Plan-view (XZ) cells holding at least `min_points` points, as int keys."""
    ij = np.floor(points_w[:, [0, 2]] / cell).astype(np.int64)
    keys, counts = np.unique(ij[:, 0] * 1_000_003 + ij[:, 1], return_counts=True)
    return keys[counts >= min_points]


def footprint_iou(points_w, bim_cells, cell):
    """Overlap of the cloud's and the BIM's plan footprints (levelled frame).

    The deciding cue for site surveys: a drone survey covers the building's
    whole footprint, while wrong poses — a shrunken cloud tucked into a dense
    BIM, or one flipped 180° — leave much of the footprint uncovered or spill
    outside it. Point-overlap scores can't tell those apart; this can."""
    cloud_cells = _plan_cells(points_w, cell, 3)
    inter = np.intersect1d(cloud_cells, bim_cells).size
    union = np.union1d(cloud_cells, bim_cells).size
    return inter / union if union else 0.0


def flat_points(points, cloud, cloud_tree, k=24, max_curvature=0.03):
    """Mask of `points` lying on locally flat surfaces of `cloud` (walls, slabs).
    Foliage, vehicles and loose clutter are curved or scattered."""
    _, nb = cloud_tree.query(points, k=k, workers=-1)
    local = cloud[nb] - cloud[nb].mean(axis=1, keepdims=True)
    ev = np.linalg.eigvalsh(np.einsum('nki,nkj->nij', local, local))
    return ev[:, 0] / np.maximum(ev.sum(axis=1), 1e-12) < max_curvature


def building_fit(points_w, flat, bim_w, bim_normals, bim_tree, bim_cells, cell, threshold):
    """How well the cloud's *building* points sit on the BIM (levelled frame).

    Plain fitness counts trees, ground, vehicles and stray points as misses, so
    even a perfect alignment scores low on a site survey. Here only flat points
    (see flat_points) inside the BIM's plan footprint (one cell of slack) and
    height range count. error is the median point-to-surface distance of those
    on the BIM, so it measures precision rather than BIM sampling density."""
    offsets = np.array([di * 1_000_003 + dj for di in (-1, 0, 1) for dj in (-1, 0, 1)])
    footprint = np.unique((bim_cells[:, None] + offsets[None]).ravel())
    ij = np.floor(points_w[:, [0, 2]] / cell).astype(np.int64)
    inside = flat & np.isin(ij[:, 0] * 1_000_003 + ij[:, 1], footprint)
    lo, hi = bim_w[:, 1].min() - cell, bim_w[:, 1].max() + cell
    inside &= (points_w[:, 1] >= lo) & (points_w[:, 1] <= hi)
    building = points_w[inside]
    if building.shape[0] < 10:
        return {'building_share': 0.0, 'building_fit': 0.0, 'error': None}
    d, idx = bim_tree.query(building, k=1)
    on_bim = d < threshold
    surface = np.abs(((building - bim_w[idx]) * bim_normals[idx]).sum(axis=1))[on_bim]
    return {
        'building_share': float(inside.mean()),
        'building_fit': float(on_bim.mean()),
        'error': float(np.median(surface)) if surface.size else None,
    }


def _site_score(fitness, iou):
    """Footprint agreement, discounted when too little of the cloud is on the BIM.
    The plan footprint can't tell storeys apart, so fitness breaks those ties."""
    return iou * min(1.0, fitness / 0.6) + 0.1 * fitness


def _scale_matrix(s):
    S = np.eye(4)
    S[:3, :3] *= s
    return S


def _robust_extents(points):
    lo, hi = np.percentile(points, [2, 98], axis=0)
    return np.sort(hi - lo)[::-1]


def scale_candidates(source, target):
    """Pre-scale factors for the cloud. [1.0] when sizes already agree."""
    es, et = _robust_extents(source), _robust_extents(target)
    es = np.maximum(es, 1e-9)
    ratios = [et[0] / es[0], np.linalg.norm(et) / np.linalg.norm(es), et[1] / es[1]]
    if all(0.67 < r < 1.5 for r in ratios[:2]):
        return [1.0]
    out = []
    for r in ratios:
        if r > 0 and np.isfinite(r) and all(abs(r - o) > 0.1 * o for o in out):
            out.append(float(r))
    return out


# ─── Levelling (gravity direction) ───────────────────────────────────────────

UP = np.array([0.0, 1.0, 0.0])
MIN_FLOOR_SHARE = 0.12      # share of normals needed on the dominant plane direction
MAX_POLISH_TILT_DEG = 2.0   # final free-rotation ICP may not tilt the cloud more


def _hemisphere_directions(n=4000):
    """Evenly spread unit vectors with y >= 0 (normals are sign-free)."""
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    return np.c_[np.cos(theta) * np.sin(phi), np.cos(phi), np.sin(theta) * np.sin(phi)]


def dominant_direction(normals, tol_deg=10):
    """Most common sign-free normal direction, and the share of normals on it.
    On building data this is the floor/ground direction."""
    cos_tol = np.cos(np.radians(tol_deg))
    dirs = _hemisphere_directions()
    u = dirs[np.argmax((np.abs(normals @ dirs.T) > cos_tol).sum(axis=0))]
    near = normals[np.abs(normals @ u) > cos_tol]
    u = (near * np.sign(near @ u)[:, None]).mean(axis=0)
    return u / np.linalg.norm(u), near.shape[0] / normals.shape[0]


def rotation_between(a, b):
    """Smallest rotation taking unit vector a onto unit vector b."""
    v = np.cross(a, b)
    c = float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def _share_above_floor(points, normals):
    """Share of (levelled) points above the most populated horizontal plane."""
    flat = np.abs(normals[:, 1]) > 0.95
    if flat.sum() < 10:
        return 0.5
    hist, edges = np.histogram(points[flat, 1], bins=60)
    return float((points[:, 1] > edges[np.argmax(hist)]).mean())


def cloud_level_rotations(points, normals):
    """Rotations that make the cloud's dominant plane horizontal, likeliest first.

    The plane normal's sign is ambiguous — COLMAP frames are often Y-down, so a
    raw cloud can be upside down. A site scan has most of its points above the
    ground, so that side wins; both are kept when the evidence is weak.
    Returns [] when there is no clear dominant plane to level by."""
    u, share = dominant_direction(normals)
    if share < MIN_FLOOR_SHARE:
        return []
    options = []
    for sign in (1.0, -1.0):
        R = rotation_between(sign * u, UP)
        options.append((_share_above_floor(points @ R.T, normals @ R.T), R))
    options.sort(key=lambda o: o[0], reverse=True)
    if options[0][0] - options[1][0] >= 0.2:
        return [options[0][1]]
    return [R for _, R in options]


def bim_level_rotation(normals):
    """The viewer shows the BIM Y-up; only correct a small tilt of its floors."""
    u, share = dominant_direction(normals)
    u = u if u[1] >= 0 else -u
    if share < MIN_FLOOR_SHARE or u[1] < np.cos(np.radians(15)):
        return np.eye(3)
    return rotation_between(u, UP)


# ─── Heading (yaw) from wall directions ──────────────────────────────────────

def yaw_matrix(theta):
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def _azimuth_histogram(normals):
    """1-degree histogram of wall/slope normal azimuths, modulo 180°, smoothed."""
    steep = np.abs(normals[:, 1]) < 0.7
    az = np.degrees(np.arctan2(normals[steep, 2], normals[steep, 0])) % 180
    h, _ = np.histogram(az, bins=180, range=(0, 180))
    kernel = np.array([1, 2, 3, 2, 1], dtype=float)
    return np.convolve(np.r_[h[-2:], h, h[:2]], kernel, mode='valid')


def heading_candidates(cloud_normals, bim_normals, max_peaks=2):
    """Yaw angles (rad) that line the cloud's walls up with the BIM's walls.
    Sign-free normals fix heading only modulo 180°, so each peak comes with
    its opposite; the translation search tells them apart."""
    hb = _azimuth_histogram(bim_normals)
    hc = _azimuth_histogram(cloud_normals)
    # Yawing by t degrees moves every azimuth from a to a - t.
    scores = np.array([hb @ np.roll(hc, -t) for t in range(180)])
    peaks = []
    for t in np.argsort(scores)[::-1]:
        if scores[t] < 0.8 * scores.max() or len(peaks) == max_peaks:
            break
        is_local_max = scores[t] >= max(scores[t - 1], scores[(t + 1) % 180])
        if is_local_max and all(min(abs(t - p), 180 - abs(t - p)) >= 10 for p in peaks):
            peaks.append(int(t))
    return [np.radians(t + flip) for t in peaks for flip in (0, 180)]


# ─── Position (FFT cross-correlation of surface grids) ───────────────────────

def _surface_grids(points, normals, origin, cell, shape):
    """Occupancy grids of floor-like and wall-like surfaces."""
    idx = np.floor((points - origin) / cell).astype(np.int64)
    ok = ((idx >= 0) & (idx < shape)).all(axis=1)
    idx, normals = idx[ok], normals[ok]
    grids = []
    for mask in (np.abs(normals[:, 1]) > 0.8, np.abs(normals[:, 1]) < 0.4):
        g = np.zeros(shape, dtype=np.float32)
        g[tuple(idx[mask].T)] = 1.0
        grids.append(g)
    return grids


def translation_peaks(bim_ffts, bim_origin, shape, reach, points, normals, cell, n_peaks=2):
    """Best translations for an already rotated + scaled cloud, exhaustively.
    `reach` = how many cells the cloud may stick out below the BIM origin."""
    lo = points.min(axis=0)
    grids = _surface_grids(points, normals, lo, cell, shape)
    corr = sum(np.fft.irfftn(bf * np.conj(np.fft.rfftn(g)), s=shape, axes=(0, 1, 2))
               for bf, g in zip(bim_ffts, grids))
    flat = corr.ravel()
    order = np.argpartition(flat, -200)[-200:]
    peaks = []
    for i in order[np.argsort(flat[order])[::-1]]:
        k = np.array(np.unravel_index(i, shape))
        if any(np.abs(k - p).max() <= 3 for p in peaks):
            continue
        peaks.append(k)
        if len(peaks) == n_peaks:
            break
    shape = np.array(shape)
    return [bim_origin + np.where(k > shape - reach, k - shape, k) * cell - lo for k in peaks]


def levelled_scales(cloud, bim):
    """Scale factors to try for a levelled cloud. [1.0] when sizes agree."""
    def horizontal_extent(p):
        lo, hi = np.percentile(p, [2, 98], axis=0)
        return max(hi[0] - lo[0], hi[2] - lo[2])
    r = horizontal_extent(bim) / max(horizontal_extent(cloud), 1e-9)
    if 0.67 < r < 1.5:
        return [1.0]
    # Site surveys cover the whole footprint, often plus some surroundings.
    # Smaller scales are a trap: a shrunken cloud fits *somewhere* inside a
    # dense BIM almost perfectly. (Partial scans: use picked point pairs.)
    scales = list(r * np.geomspace(0.75, 1.3, 9))
    if all(abs(s - 1.0) > 0.05 for s in scales) and 0.75 * r <= 1.0 <= 1.3 * r:
        scales.append(1.0)
    return scales


def levelled_search(cloud, cloud_normals, bim, bim_normals, cell):
    """Coarse similarity poses (levelled frame, rotation about +Y only):
    heading peaks x scale grid x best FFT translations. Returns [(T, scale)]."""
    scales = levelled_scales(cloud, bim)
    origin = bim.min(axis=0)
    bim_cells = np.ceil(np.ptp(bim, axis=0) / cell).astype(int) + 1
    reach = int(np.ceil(np.ptp(cloud, axis=0).max() * max(scales) / cell)) + 2
    shape = tuple(int(n) for n in bim_cells + reach)
    bim_ffts = [np.fft.rfftn(g) for g in _surface_grids(bim, bim_normals, origin, cell, shape)]

    poses = []
    for yaw in heading_candidates(cloud_normals, bim_normals):
        R = yaw_matrix(yaw)
        P, N = cloud @ R.T, cloud_normals @ R.T
        for s in scales:
            for t in translation_peaks(bim_ffts, origin, shape, reach, P * s, N, cell):
                T = np.eye(4)
                T[:3, :3] = s * R
                T[:3, 3] = t
                poses.append((T, s))
    return poses


# ─── Refinement ──────────────────────────────────────────────────────────────

def _coarse_refine(T, src_ds, target_ds, target_ds_tree, voxel, yaw_only=False):
    """Cheap ICP on the voxelised clouds — run for many candidate poses."""
    for factor in (3.0, 1.5):
        T = np.asarray(run_icp(src_ds, target_ds, init_transform=T, threshold=factor * voxel,
                               max_iterations=30, target_tree=target_ds_tree,
                               yaw_only=yaw_only)['transform'])
    return T


def _fine_refine(T, src_eval, target_full, target_full_tree, voxel, allow_scale, base_scale,
                 yaw_only=False):
    """ICP against the full-resolution BIM, optionally refining scale.
    Matching against the voxelised BIM biases a scale fit towards shrinking
    the cloud, so scale is only fitted here."""
    kw = dict(max_iterations=30, target_tree=target_full_tree, yaw_only=yaw_only)
    T = np.asarray(run_icp(src_eval, target_full, init_transform=T,
                           threshold=0.8 * voxel, **kw)['transform'])
    if allow_scale:
        Ts = T
        for factor in (1.0, 0.5):
            Ts = np.asarray(run_icp(src_eval, target_full, init_transform=Ts, with_scale=True,
                                    threshold=factor * voxel, **kw)['transform'])
        if abs(_uniform_scale(Ts) / base_scale - 1.0) <= SCALE_REFINE_LIMIT:
            T = Ts
    return T


def _axis_angle_matrix(w):
    angle = np.linalg.norm(w)
    if angle < 1e-12:
        return np.eye(3)
    k = w / angle
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * K @ K


def point_to_plane_icp(T, source, target, target_normals, target_tree, thresholds,
                       yaw_only=False, with_scale=False, iterations=15):
    """Precise final refinement: minimise distances to the BIM's surfaces
    (not to its sample points), so accuracy isn't capped by sample spacing.

    Linearised least squares per iteration over [rotation, translation,
    scale], rotation about +Y only when `yaw_only`. Correspondences are
    re-matched each iteration within a shrinking distance threshold.
    """
    T = np.asarray(T, dtype=np.float64).copy()
    cols = ([1] if yaw_only else [0, 1, 2]) + [3, 4, 5] + ([6] if with_scale else [])
    for threshold in thresholds:
        for _ in range(iterations):
            moved = source @ T[:3, :3].T + T[:3, 3]
            dist, idx = target_tree.query(moved, k=1, distance_upper_bound=threshold,
                                          workers=-1)
            ok = np.isfinite(dist)
            if ok.sum() < 20:
                break
            p, q, n = moved[ok], target[idx[ok]], target_normals[idx[ok]]
            c = p.mean(axis=0)
            pc = p - c
            A = np.hstack([np.cross(pc, n), n, np.einsum('ij,ij->i', pc, n)[:, None]])[:, cols]
            b = -np.einsum('ij,ij->i', p - q, n)
            x = np.linalg.lstsq(A, b, rcond=None)[0]
            full = np.zeros(7)
            full[cols] = x
            delta = np.eye(4)
            delta[:3, :3] = (1.0 + full[6]) * _axis_angle_matrix(full[:3])
            delta[:3, 3] = c + full[3:6] - delta[:3, :3] @ c
            T = delta @ T
            if np.abs(full).max() < 1e-7:
                break
    return T


def _homogeneous(R):
    T = np.eye(4)
    T[:3, :3] = R
    return T


def _tilt_change_deg(T_before, T_after, up):
    """How far a pose change tips the BIM-frame up axis."""
    delta = T_after[:3, :3] @ np.linalg.inv(T_before[:3, :3])
    moved = delta @ up
    return np.degrees(np.arccos(np.clip(moved @ up / np.linalg.norm(moved), -1.0, 1.0)))


def _level_picked_pose(T0, Rb, level_rotations, cloud_centre, max_tilt_deg=20.0):
    """Remove the tilt that hand-picked points leave in `T0`.

    Picks give a good scale and position but a few degrees of tilt. When the
    cloud's floor plane (from `level_rotations`) maps close to vertical under
    T0, rotate it exactly upright about the cloud centre. Returns
    (T_work, Rc) for the levelled frame, or None when the picks disagree with
    every levelling by more than `max_tilt_deg` (then they are trusted as-is)."""
    R0 = T0[:3, :3] / _uniform_scale(T0)
    up_bim = Rb.T @ UP
    best = None
    for Rc in level_rotations:
        mapped = R0 @ (Rc.T @ UP)
        tilt = np.degrees(np.arccos(np.clip(mapped @ up_bim, -1.0, 1.0)))
        if tilt <= max_tilt_deg and (best is None or tilt < best[0]):
            best = (tilt, Rc, mapped)
    if best is None:
        return None
    _, Rc, mapped = best
    pivot = T0[:3, :3] @ cloud_centre + T0[:3, 3]
    C = _homogeneous(rotation_between(mapped, up_bim))
    C[:3, 3] = pivot - C[:3, :3] @ pivot
    return _homogeneous(Rb) @ C @ T0 @ _homogeneous(Rc.T), Rc


# ─── Public entry point ──────────────────────────────────────────────────────

def auto_register(source, target, init_transform=None, seed=0):
    """Register cloud `source` onto BIM `target` without manual picks.

    Global search, in order of preference:
      • levelled: make the cloud's floor/ground plane horizontal, take the
        heading from wall directions, then find scale + position exhaustively
        (FFT). Every pose stays upright, so tilted false matches can't win.
      • features: FPFH + RANSAC over all rotations, when the cloud has no
        clear dominant plane to level by.
    init_transform: optional coarse 4x4 (e.g. from picked point pairs); when
    given, the global search is skipped and we only refine.

    Returns {transform, fitness, coverage, rmse, scale, building_fit,
    building_share, error, confidence, ambiguous, candidates: [...best first],
    method, voxel_size, timing_s}. building_fit / error (BIM units) describe
    the building points only — see building_fit().
    """
    started = time.time()
    rng = np.random.default_rng(seed)
    source = _as_points(source, 'source', rng)
    target = _as_points(target, 'target', rng)

    voxel = _choose_voxel(target)
    src_eval = source if source.shape[0] <= 10_000 else \
        source[rng.choice(source.shape[0], 10_000, replace=False)]

    def analysis_set(points):
        diag = np.linalg.norm(np.ptp(points, axis=0))
        ds = voxel_downsample(points, diag / 150)
        return ds, estimate_normals(ds, cKDTree(ds), k=20)

    # Work frame: BIM floors exactly horizontal. With cloud levelling Rc,
    # a work-frame pose maps (source @ Rc.T) onto (target @ Rb.T).
    bim_a, bim_a_n = analysis_set(target)
    Rb = bim_level_rotation(bim_a_n)
    target_w = target @ Rb.T
    target_w_tree = cKDTree(target_w)
    target_w_normals = estimate_normals(target_w, target_w_tree, k=12)
    plan_cell = 1.25 * voxel
    bim_plan = _plan_cells(target_w, plan_cell, 3)
    target_w_ds = voxel_downsample(target_w, voxel)
    target_w_ds_tree = cKDTree(target_w_ds)
    target_ds = target_w_ds @ Rb            # same points, original frame
    target_ds_tree = cKDTree(target_ds)
    target_tree = cKDTree(target)

    def to_original(T_work, Rc):
        return _homogeneous(Rb.T) @ T_work @ _homogeneous(Rc)

    coarse = []   # (score, T, base_scale, allow_scale, Rc, yaw_only); T in original frame

    def site_score(T_work, Rc, threshold, metrics=None):
        """Footprint-based score for levelled (site survey) poses."""
        T = to_original(T_work, Rc)
        metrics = metrics or _evaluate(T, src_eval, target_ds, target_ds_tree, threshold)
        moved_w = src_eval @ Rc.T @ T_work[:3, :3].T + T_work[:3, 3]
        iou = footprint_iou(moved_w, bim_plan, plan_cell)
        return _site_score(metrics['fitness'], iou), iou

    def consider(T_work, base_scale, allow_scale, Rc, yaw_only):
        src_ds = voxel_downsample(source, voxel / base_scale)
        T_work = _coarse_refine(T_work, src_ds @ Rc.T, target_w_ds, target_w_ds_tree,
                                voxel, yaw_only)
        T = to_original(T_work, Rc)
        if yaw_only:
            score = site_score(T_work, Rc, voxel)[0]
        else:
            score = _evaluate(T, src_ds, target_ds, target_ds_tree, voxel)['score']
        coarse.append((score, T, base_scale, allow_scale, Rc, yaw_only))

    method = 'levelled'
    if init_transform is not None:
        method = 'refine'
        T0 = np.asarray(init_transform, dtype=np.float64)
        if T0.shape != (4, 4) or not np.isfinite(T0).all():
            raise ValueError('"init_transform" must be a 4x4 matrix.')
        s0 = _uniform_scale(T0)
        cloud_a, cloud_a_n = analysis_set(source)
        levelled = _level_picked_pose(T0, Rb, cloud_level_rotations(cloud_a, cloud_a_n),
                                      source.mean(axis=0))
        if levelled is not None:
            # Picks fix scale + position; the cloud's own floor plane fixes tilt.
            T_work, Rc = levelled
            consider(T_work, s0, abs(s0 - 1.0) > 0.05, Rc, True)
        else:
            consider(_homogeneous(Rb) @ T0, s0, abs(s0 - 1.0) > 0.05, np.eye(3), False)
    else:
        cloud_a, cloud_a_n = analysis_set(source)
        bim_w_a, bim_w_a_n = bim_a @ Rb.T, bim_a_n @ Rb.T
        for Rc in cloud_level_rotations(cloud_a, cloud_a_n):
            cloud_w_a = cloud_a @ Rc.T
            poses = levelled_search(cloud_w_a, cloud_a_n @ Rc.T, bim_w_a, bim_w_a_n, voxel)
            # Cheap ranking first: only the most promising poses get ICP.
            quick = sorted(((site_score(T_work, Rc, voxel)[0], i)
                            for i, (T_work, _) in enumerate(poses)), reverse=True)
            allow_scale = len(levelled_scales(cloud_w_a, bim_w_a)) > 1
            for _, i in quick[:16]:
                T_work, s = poses[i]
                consider(T_work, s, allow_scale, Rc, True)
        if not coarse:
            method = 'features'
            _feature_search(source, target_w_ds, target_w_ds_tree, voxel, rng, consider)

    if not coarse:
        raise ValueError('Could not find any alignment — the models may not overlap.')

    # Only the best few distinct coarse poses get the expensive fine passes.
    centre = source.mean(axis=0)
    src_flat = flat_points(src_eval, source, cKDTree(source))
    fine = []
    for _, T, base_scale, allow_scale, Rc, yaw_only in _dedupe(coarse, centre, 3 * voxel,
                                                               MAX_CANDIDATES + 1):
        T_work = _homogeneous(Rb) @ T @ _homogeneous(Rc.T)
        src_w = src_eval @ Rc.T
        T_work = _fine_refine(T_work, src_w, target_w, target_w_tree, voxel,
                              allow_scale, base_scale, yaw_only)
        T_pl = point_to_plane_icp(T_work, src_w, target_w, target_w_normals, target_w_tree,
                                  [0.5 * voxel, 0.25 * voxel, 0.12 * voxel],
                                  yaw_only=yaw_only, with_scale=allow_scale)
        if abs(_uniform_scale(T_pl) / base_scale - 1.0) <= SCALE_REFINE_LIMIT:
            T_work = T_pl
        if yaw_only:
            # A free-rotation polish removes residual levelling error, but it
            # may not tip the cloud over.
            Tp = point_to_plane_icp(T_work, src_w, target_w, target_w_normals, target_w_tree,
                                    [0.12 * voxel], with_scale=allow_scale)
            if _tilt_change_deg(T_work, Tp, UP) <= MAX_POLISH_TILT_DEG and                     abs(_uniform_scale(Tp) / base_scale - 1.0) <= SCALE_REFINE_LIMIT:
                T_work = Tp
        T = to_original(T_work, Rc)
        metrics = _evaluate(T, src_eval, target, target_tree, 0.5 * voxel)
        metrics['footprint_iou'] = None
        if yaw_only and method == 'levelled':
            metrics['score'], metrics['footprint_iou'] = site_score(T_work, Rc, None, metrics)
        metrics.update(building_fit(src_w @ T_work[:3, :3].T + T_work[:3, 3], src_flat, target_w,
                                    target_w_normals, target_w_tree, bim_plan, plan_cell,
                                    0.5 * voxel))
        fine.append((metrics['score'], T, metrics))

    candidates = []
    for _, T, m in _dedupe(fine, centre, 3 * voxel, MAX_CANDIDATES):
        candidates.append({
            'transform': T.tolist(),
            'fitness': round(m['fitness'], 4),
            'coverage': round(m['coverage'], 4),
            'rmse': m['rmse'],
            'scale': round(_uniform_scale(T), 6),
            'score': round(m['score'], 4),
            'footprint_iou': None if m['footprint_iou'] is None else round(m['footprint_iou'], 4),
            'building_fit': round(m['building_fit'], 4),
            'building_share': round(m['building_share'], 4),
            'error': None if m['error'] is None else round(m['error'], 4),
        })

    best = candidates[0]
    runner_up = candidates[1]['score'] if len(candidates) > 1 else 0.0
    ambiguous = runner_up >= 0.9 * best['score']
    if best['fitness'] >= 0.6 and not ambiguous:
        confidence = 'high'
    elif best['fitness'] >= 0.35:
        confidence = 'medium'
    else:
        confidence = 'low'

    return {
        **best,
        'confidence': confidence,
        'ambiguous': bool(ambiguous),
        'candidates': candidates,
        'method': method,
        'voxel_size': float(voxel),
        'fit_tolerance': float(0.5 * voxel),
        'timing_s': round(time.time() - started, 2),
    }


def _feature_search(source, target_w_ds, target_w_ds_tree, voxel, rng, consider):
    """Fallback for clouds with no dominant plane: FPFH + RANSAC over all
    rotations, with a scale search for unscaled clouds."""
    eye = np.eye(3)
    target_feat = compute_fpfh(target_w_ds, estimate_normals(target_w_ds, target_w_ds_tree),
                               target_w_ds_tree, 5 * voxel)

    def search(s, allow_scale):
        src_ds = voxel_downsample(source * s, voxel)
        if src_ds.shape[0] < 30:
            return
        src_tree = cKDTree(src_ds)
        src_feat = compute_fpfh(src_ds, estimate_normals(src_ds, src_tree), src_tree, 5 * voxel)
        si, ti = match_features(src_feat, target_feat)
        for _, T in ransac_correspondences(src_ds[si], target_w_ds[ti], 1.5 * voxel, rng)[:6]:
            consider(T @ _scale_matrix(s), s, allow_scale, eye, False)

    scales = scale_candidates(source, target_w_ds)
    for s in scales:
        search(s, allow_scale=scales != [1.0])