"""
Point-cloud registration (ICP) using numpy + scipy.

This replaces the browser's hand-written JS ICP, which only ever re-ran a
3-point Kabsch fit. Here we do genuine iterative closest point refinement:
nearest-neighbour matching via a KD-tree, outlier rejection by distance, and a
rigid (optionally similarity) best-fit at each iteration.

We use numpy/scipy rather than Open3D on purpose — Open3D currently ships no
wheel for Python 3.13, while scipy.spatial.cKDTree gives us fast nearest
neighbour with no extra dependency.
"""
import numpy as np
from scipy.spatial import cKDTree


def _best_fit_transform(src, dst, with_scale=False):
    """Least-squares rigid (or similarity) transform mapping src → dst.

    src, dst: (N, 3) arrays of corresponding points.
    Returns a 4x4 numpy matrix. Uses the Kabsch/Umeyama solution.
    """
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_c = src - src_mean
    dst_c = dst - dst_mean

    H = src_c.T @ dst_c
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1.0, 1.0, d])
    R = Vt.T @ D @ U.T

    if with_scale:
        var_src = (src_c ** 2).sum() / src.shape[0]
        scale = (S * np.array([1.0, 1.0, d])).sum() / (var_src * 3.0) if var_src > 0 else 1.0
    else:
        scale = 1.0

    t = dst_mean - scale * (R @ src_mean)

    T = np.eye(4)
    T[:3, :3] = scale * R
    T[:3, 3] = t
    return T


def _pca_frame(points):
    """Centroid + right-handed principal-axis frame (columns = axes, desc)."""
    c = points.mean(axis=0)
    cov = np.cov((points - c).T)
    evals, evecs = np.linalg.eigh(cov)
    order = np.argsort(evals)[::-1]
    V = evecs[:, order]
    if np.linalg.det(V) < 0:  # force right-handed
        V[:, 2] *= -1
    return c, V


def _pca_candidates(source, target):
    """Coarse 4x4 guesses aligning the two clouds' principal axes + centroids.

    PCA axes have a sign ambiguity, so we emit the four sign combinations that
    keep a proper (det=+1) rotation. ICP then picks the best of these — this is
    what lets alignment work with NO manually-picked correspondences.
    """
    cs, Vs = _pca_frame(source)
    ct, Vt = _pca_frame(target)
    candidates = []
    for s in [(1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)]:
        R = Vt @ np.diag(s) @ Vs.T
        if np.linalg.det(R) < 0:
            continue
        T = np.eye(4)
        T[:3, :3] = R
        T[:3, 3] = ct - R @ cs
        candidates.append(T)
    return candidates


def run_icp_auto(source, target, init_transform=None, **kwargs):
    """One-call alignment that needs no manual correspondences.

    • If an init_transform is given (e.g. a 3-point Kabsch pick-align), refine
      straight from it.
    • Otherwise, try the current pose (identity) AND several PCA-based coarse
      guesses, run ICP from each, and return whichever converges best.
    """
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)

    if init_transform is not None:
        return run_icp(source, target, init_transform=init_transform, **kwargs)

    best = None
    # Identity first: the viewer's auto-normalization often already overlays
    # the clouds, so the current pose is frequently the best starting point.
    seeds = [None] + _pca_candidates(source, target)
    for seed in seeds:
        try:
            res = run_icp(source, target, init_transform=seed, **kwargs)
        except Exception:
            continue
        if best is None or res["fitness"] > best["fitness"] or (
            res["fitness"] == best["fitness"] and res["rmse"] < best["rmse"]
        ):
            best = res

    if best is None:
        raise ValueError("Could not find any valid alignment.")
    return best


def run_icp(
    source,
    target,
    init_transform=None,
    max_iterations=50,
    threshold=None,
    tolerance=1e-6,
    with_scale=False,
):
    """Refine the alignment of `source` onto `target` with ICP.

    source, target: (N,3) / (M,3) point arrays in the SAME (viewer-world) frame.
    init_transform: optional 4x4 initial guess (e.g. a coarse Kabsch fit).
    threshold: max correspondence distance; pairs farther apart are ignored.
               Defaults to ~3% of the target's bounding-box diagonal.
    Returns dict: { transform (4x4 list), fitness, rmse, iterations }.
    `transform` already includes init_transform — apply it directly to source.
    """
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if source.shape[0] < 3 or target.shape[0] < 3:
        raise ValueError("Need at least 3 points in both source and target.")

    if threshold is None:
        diag = np.linalg.norm(target.max(axis=0) - target.min(axis=0))
        threshold = max(diag * 0.03, 1e-6)

    T = np.eye(4) if init_transform is None else np.asarray(init_transform, dtype=np.float64)

    tree = cKDTree(target)
    src_h = np.hstack([source, np.ones((source.shape[0], 1))])

    prev_rmse = np.inf
    fitness = 0.0
    rmse = np.inf
    it = 0
    for it in range(1, max_iterations + 1):
        moved = (src_h @ T.T)[:, :3]
        dists, idx = tree.query(moved, k=1)

        mask = dists <= threshold
        matched = int(mask.sum())
        if matched < 3:
            # threshold too tight to find correspondences — stop with what we have
            break

        corr_src = moved[mask]
        corr_dst = target[idx[mask]]

        delta = _best_fit_transform(corr_src, corr_dst, with_scale=with_scale)
        T = delta @ T

        rmse = float(np.sqrt((dists[mask] ** 2).mean()))
        fitness = matched / source.shape[0]

        if abs(prev_rmse - rmse) < tolerance:
            break
        prev_rmse = rmse

    return {
        "transform": T.tolist(),
        "fitness": float(fitness),
        "rmse": float(rmse),
        "iterations": int(it),
    }
