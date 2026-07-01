"""
Scan-to-BIM progress analysis.

Given an IFC (BIM) file and a Point Cloud (.ply), both geo-aligned in the viewer
(their world transforms saved on the DB records), this:

  1. Extracts every physical BIM element via ifcopenshell (id, type, name, area),
  2. Brings the point cloud into the BIM's local frame using the saved transforms,
  3. For each element, measures how much of its surface is covered by scan points
     (fraction of mesh-vertex samples with a nearby point) → completion %,
  4. Classifies Not Started / In Progress / Completed.

Coordinate note: the viewer applies  world = T · local  to each model
(T = compose(position, quaternion, scale)). To compare the IFC element geometry
(≈ BIM local/world coords from the converter) against the cloud we map the cloud
into the BIM local frame:  pc_in_bim = inv(T_bim) · T_pc · pc_local.
"""
import os
import struct
import logging
import numpy as np

logger = logging.getLogger(__name__)

# IFC type → friendly category (subset of ifc_parser map, building elements).
CATEGORY_MAP = {
    "IFCWALL": "Walls", "IFCWALLSTANDARDCASE": "Walls",
    "IFCSLAB": "Slabs", "IFCROOF": "Roofs",
    "IFCCOLUMN": "Columns", "IFCBEAM": "Beams",
    "IFCSTAIR": "Stairs", "IFCSTAIRFLIGHT": "Stairs",
    "IFCDOOR": "Doors", "IFCWINDOW": "Windows",
    "IFCMEMBER": "Members", "IFCRAILING": "Railings",
    "IFCCURTAINWALL": "Curtain Walls", "IFCPLATE": "Plates",
    "IFCCOVERING": "Coverings", "IFCFOOTING": "Footings",
    "IFCPILE": "Piles", "IFCBUILDINGELEMENTPROXY": "Other",
}

# Only assess physical building elements (skip spaces/openings/annotation).
ASSESS_TYPES = set(CATEGORY_MAP.keys())


# ─── Transform helpers ─────────────────────────────────────────────────────────

def _quat_to_matrix(q):
    x, y, z, w = q
    n = x * x + y * y + z * z + w * w
    if n < 1e-12:
        return np.eye(3)
    s = 2.0 / n
    return np.array([
        [1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w)],
        [s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w)],
        [s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y)],
    ])


def compose_matrix(transform):
    """Build a 4x4 from a saved {position, quaternion, scale} transform."""
    M = np.eye(4)
    if not transform:
        return M
    pos = transform.get("position") or [0, 0, 0]
    quat = transform.get("quaternion") or [0, 0, 0, 1]
    scale = transform.get("scale") or [1, 1, 1]
    R = _quat_to_matrix(quat)
    S = np.diag(scale)
    M[:3, :3] = R @ S
    M[:3, 3] = pos
    return M


# ─── PLY reader (ascii + binary_little_endian, xyz only) ───────────────────────

def read_ply_points(path, max_points=400000):
    with open(path, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError("Not a PLY file")
        fmt = None
        count = 0
        props = []  # (name, type) for the vertex element
        in_vertex = False
        while True:
            line = f.readline()
            if not line:
                raise ValueError("Unexpected EOF in PLY header")
            t = line.strip().split()
            if not t:
                continue
            kw = t[0]
            if kw == b"format":
                fmt = t[1].decode()
            elif kw == b"element":
                in_vertex = t[1] == b"vertex"
                if in_vertex:
                    count = int(t[2])
            elif kw == b"property" and in_vertex:
                props.append((t[2].decode(), t[1].decode()))
            elif kw == b"end_header":
                break

        names = [p[0] for p in props]
        ix, iy, iz = names.index("x"), names.index("y"), names.index("z")

        if fmt == "ascii":
            pts = np.empty((count, 3), dtype=np.float64)
            for i in range(count):
                vals = f.readline().split()
                pts[i] = (float(vals[ix]), float(vals[iy]), float(vals[iz]))
        else:
            # binary_little_endian (the common export). Build a struct format.
            type_map = {
                "char": "b", "uchar": "B", "int8": "b", "uint8": "B",
                "short": "h", "ushort": "H", "int16": "h", "uint16": "H",
                "int": "i", "uint": "I", "int32": "i", "uint32": "I",
                "float": "f", "float32": "f", "double": "d", "float64": "d",
            }
            order = "<" if "little" in (fmt or "") else ">"
            sizes = [type_map[p[1]] for p in props]
            rec = order + "".join(sizes)
            rec_size = struct.calcsize(rec)
            buf = f.read(rec_size * count)
            arr = np.frombuffer(buf, dtype=np.dtype([
                (f"f{i}", order + sizes[i]) for i in range(len(sizes))
            ]), count=count)
            pts = np.stack([
                arr[f"f{ix}"].astype(np.float64),
                arr[f"f{iy}"].astype(np.float64),
                arr[f"f{iz}"].astype(np.float64),
            ], axis=1)

    if len(pts) > max_points:
        idx = np.random.choice(len(pts), max_points, replace=False)
        pts = pts[idx]
    return pts


# ─── LAS / LAZ reader ──────────────────────────────────────────────────────────

def read_las_points(path, max_points=400000):
    """Read a LAS or LAZ file using laspy and return an Nx3 float64 xyz array."""
    try:
        import laspy
    except ImportError:
        raise ImportError(
            "laspy is required for LAS/LAZ support. "
            "Install with: pip install laspy[lazrs]"
        )
    las = laspy.read(path)
    pts = np.stack([
        np.asarray(las.x, dtype=np.float64),
        np.asarray(las.y, dtype=np.float64),
        np.asarray(las.z, dtype=np.float64),
    ], axis=1)
    if len(pts) > max_points:
        idx = np.random.choice(len(pts), max_points, replace=False)
        pts = pts[idx]
    return pts


# ─── ASCII point cloud reader (.pts / .xyz) ────────────────────────────────────

def read_ascii_points(path, max_points=400000):
    """Read space/tab-delimited ASCII point clouds — first three columns are x y z."""
    rows = []
    with open(path, "r", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 3:
                try:
                    rows.append((float(parts[0]), float(parts[1]), float(parts[2])))
                except ValueError:
                    continue
    pts = np.array(rows, dtype=np.float64)
    if len(pts) > max_points:
        idx = np.random.choice(len(pts), max_points, replace=False)
        pts = pts[idx]
    return pts


# ─── Format dispatcher ─────────────────────────────────────────────────────────

def read_pointcloud_points(path, max_points=400000):
    """Read any supported point cloud format and return an Nx3 float64 xyz array."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".ply":
        return read_ply_points(path, max_points=max_points)
    if ext in (".las", ".laz"):
        return read_las_points(path, max_points=max_points)
    if ext in (".pts", ".xyz"):
        return read_ascii_points(path, max_points=max_points)
    raise ValueError(
        f"Unsupported point cloud format '{ext}'. "
        "Supported: .ply, .las, .laz, .pts, .xyz"
    )


# ─── BIM element extraction (ifcopenshell + geom) ──────────────────────────────

def _settings_world_coords():
    import ifcopenshell.geom as geom
    s = geom.settings()
    # Setting name differs across ifcopenshell versions — try both.
    try:
        s.set(s.USE_WORLD_COORDS, True)
    except Exception:
        try:
            s.set("use-world-coords", True)
        except Exception:
            pass
    return s


def _triangle_area_sum(verts, faces):
    if len(faces) == 0:
        return 0.0
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    return float(0.5 * np.linalg.norm(cross, axis=1).sum())


# Cache extracted geometry per IFC (keyed by path + mtime) — triangulation is
# the slowest step, and the BIM doesn't change between analyses.
_ELEMENT_CACHE = {}


def extract_elements(ifc_path):
    """Return list of dicts: global_id, ifc_type, name, category, area, verts."""
    import multiprocessing
    import ifcopenshell
    import ifcopenshell.geom as geom

    try:
        key = (ifc_path, os.path.getmtime(ifc_path))
        if key in _ELEMENT_CACHE:
            return _ELEMENT_CACHE[key]
    except OSError:
        key = None

    model = ifcopenshell.open(ifc_path)
    settings = _settings_world_coords()
    out = []

    # Only triangulate the element types we actually assess (skip furniture,
    # MEP, openings, etc.) and use all CPU cores — both are big speedups.
    include = []
    for t in ASSESS_TYPES:
        try:
            include += model.by_type(t)
        except Exception:
            pass
    threads = max(1, multiprocessing.cpu_count())

    try:
        it = geom.iterator(settings, model, threads, include=include or None)
    except Exception:
        try:
            it = geom.iterator(settings, model, threads)
        except Exception:
            it = geom.iterator(settings, model)

    if not it.initialize():
        return out
    while True:
        shape = it.get()
        try:
            product = model.by_id(shape.id)
            ifc_type = product.is_a().upper()
            if ifc_type in ASSESS_TYPES:
                g = shape.geometry
                verts = np.array(g.verts, dtype=np.float64).reshape(-1, 3)
                faces = np.array(g.faces, dtype=np.int64).reshape(-1, 3)
                area = _triangle_area_sum(verts, faces)
                out.append({
                    "global_id": getattr(product, "GlobalId", "") or str(shape.id),
                    "ifc_type": ifc_type,
                    "name": getattr(product, "Name", "") or "",
                    "category": CATEGORY_MAP.get(ifc_type, "Other"),
                    "area": area,
                    "verts": verts,
                    "faces": faces,
                })
        except Exception:
            logger.debug("skip element", exc_info=True)
        if not it.next():
            break

    if key is not None:
        _ELEMENT_CACHE[key] = out
    return out


# ─── Density (area-weighted) sampling + RANSAC plane verification ──────────────

# Element categories where a planar fit is meaningful ("really built" check).
PLANAR_CATEGORIES = {"Walls", "Slabs", "Roofs"}


def sample_surface(verts, faces, n):
    """Sample n points spread across the mesh, weighted by triangle area — so
    completion reflects covered SURFACE AREA, not uneven vertex density."""
    if faces is None or len(faces) == 0:
        return verts[: n] if len(verts) else verts
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    areas = 0.5 * np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1)
    total = areas.sum()
    if total <= 0:
        return verts
    probs = areas / total
    tri = np.random.choice(len(faces), size=n, p=probs)
    u = np.random.rand(n, 1)
    w = np.random.rand(n, 1)
    over = (u + w > 1).flatten()
    u[over] = 1 - u[over]
    w[over] = 1 - w[over]
    a, b, c = v0[tri], v1[tri], v2[tri]
    return a + u * (b - a) + w * (c - a)


def ransac_plane(points, iters=60, thresh=0.05):
    """numpy RANSAC plane fit. Returns (inlier_ratio, normal) — high ratio means
    the nearby scan points form a coherent surface (a real wall/slab), not
    scattered clutter. No Open3D needed."""
    n = len(points)
    if n < 3:
        return 0.0, None
    best_ratio = 0.0
    best_normal = None
    for _ in range(iters):
        idx = np.random.choice(n, 3, replace=False)
        p0, p1, p2 = points[idx]
        nrm = np.cross(p1 - p0, p2 - p0)
        ln = np.linalg.norm(nrm)
        if ln < 1e-9:
            continue
        nrm = nrm / ln
        dist = np.abs((points - p0) @ nrm)
        ratio = float(np.mean(dist <= thresh))
        if ratio > best_ratio:
            best_ratio = ratio
            best_normal = nrm
    return best_ratio, best_normal


# ─── Main analysis ─────────────────────────────────────────────────────────────

def _status(pct):
    if pct < 10:
        return "not_started"
    if pct < 90:
        return "in_progress"
    return "completed"


def analyze(ifc_path, pc_path, bim_transform, pc_transform, threshold=0.15):
    """
    Returns { elements: [...], summary: {...}, categories: [...] } or raises.
    `threshold` = max distance (m) a surface sample may be from a scan point to
    count as "covered".

    `pc_path` accepts any supported format: .ply, .las, .laz, .pts, .xyz.
    """
    from scipy.spatial import cKDTree

    elements = extract_elements(ifc_path)
    if not elements:
        return {"elements": [], "summary": _empty_summary(), "categories": []}

    # Cap the cloud for speed — 150k points is plenty for coverage/plane checks.
    pts = read_pointcloud_points(pc_path, max_points=150000)

    # Bring the cloud into the BIM local frame: inv(T_bim) · T_pc · pc_local.
    T_bim = compose_matrix(bim_transform)
    T_pc = compose_matrix(pc_transform)
    rel = np.linalg.inv(T_bim) @ T_pc
    homog = np.hstack([pts, np.ones((len(pts), 1))])
    pc_in_bim = (rel @ homog.T).T[:, :3]

    # balanced_tree=False builds faster; workers=-1 uses all cores for queries.
    tree = cKDTree(pc_in_bim, balanced_tree=False, compact_nodes=False)

    results = []
    for el in elements:
        verts = el["verts"]
        faces = el.get("faces")
        # Density-accurate coverage: area-weighted surface sampling. 600 samples
        # is enough for a stable % and much faster than 2000.
        if len(verts) == 0:
            covered = 0.0
            sample = verts
        else:
            sample = sample_surface(verts, faces, 600)
            d, _ = tree.query(sample, k=1, workers=-1)
            covered = float(np.mean(d <= threshold))
        pct = round(covered * 100, 1)

        # Plane verification (walls/slabs/roofs): reuse the coverage samples'
        # nearest neighbours (no extra ball-point query) and a light RANSAC.
        plane_inlier = None
        verified = None
        if el["category"] in PLANAR_CATEGORIES and covered > 0.05 and len(sample):
            probe = sample if len(sample) <= 150 else sample[
                np.random.choice(len(sample), 150, replace=False)
            ]
            d2, idx2 = tree.query(probe, k=1, workers=-1)
            near_idx = np.unique(idx2[d2 <= threshold])
            if len(near_idx) >= 20:
                near = pc_in_bim[near_idx]
                if len(near) > 1500:
                    near = near[np.random.choice(len(near), 1500, replace=False)]
                ratio, _n = ransac_plane(near, iters=25, thresh=threshold * 0.5)
                plane_inlier = round(ratio, 3)
                verified = ratio >= 0.5

        results.append({
            "element_id": el["global_id"],
            "element_type": el["ifc_type"],
            "category": el["category"],
            "name": el["name"],
            "bim_area": round(el["area"], 3),
            "overlap_area": round(el["area"] * covered, 3),
            "completion": pct,
            "status": _status(pct),
            "plane_inlier": plane_inlier,
            "verified": verified,
        })

    summary = _summarize(results)
    categories = _by_category(results)
    return {"elements": results, "summary": summary, "categories": categories}


def _empty_summary():
    return {
        "total": 0, "completed": 0, "in_progress": 0,
        "not_started": 0, "overall_completion": 0.0,
    }


def _summarize(results):
    total = len(results)
    completed = sum(1 for r in results if r["status"] == "completed")
    in_progress = sum(1 for r in results if r["status"] == "in_progress")
    not_started = total - completed - in_progress
    # Area-weighted overall completion (falls back to simple mean if no area).
    area = sum(r["bim_area"] for r in results)
    if area > 0:
        overall = sum(r["overlap_area"] for r in results) / area * 100
    else:
        overall = (sum(r["completion"] for r in results) / total) if total else 0
    return {
        "total": total,
        "completed": completed,
        "in_progress": in_progress,
        "not_started": not_started,
        "overall_completion": round(overall, 1),
    }


def _by_category(results):
    from collections import defaultdict
    g = defaultdict(lambda: {"count": 0, "bim_area": 0.0, "overlap_area": 0.0})
    for r in results:
        c = g[r["category"]]
        c["count"] += 1
        c["bim_area"] += r["bim_area"]
        c["overlap_area"] += r["overlap_area"]
    out = []
    for cat, v in sorted(g.items()):
        pct = (v["overlap_area"] / v["bim_area"] * 100) if v["bim_area"] > 0 else 0
        out.append({
            "category": cat,
            "count": v["count"],
            "bim_area": round(v["bim_area"], 2),
            "overlap_area": round(v["overlap_area"], 2),
            "completion": round(pct, 1),
        })
    return out
