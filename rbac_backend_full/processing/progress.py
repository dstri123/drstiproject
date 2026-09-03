"""
Scan-to-BIM progress analysis.

Given an IFC (BIM) file and a Point Cloud (.ply/.las/.laz/.pts/.xyz), both
geo-aligned in the viewer (their world transforms saved on the DB records),
this:

  1. Extracts every BIM element via ifcopenshell (id, type, name, category)
     and computes its real 3D volume (m^3) from its triangulated geometry,
  2. Brings the point cloud into the BIM's local frame using the saved
     transforms,
  3. Assigns every real scan point to the single nearest BIM element (within
     a tolerance) — the server-side equivalent of the viewer's voxel-hash
     "overlapping points" check — giving an exact actual-point count per
     element (no double counting),
  4. Converts each element into a "maximum possible point cloud points"
     figure using a point density (points/m^3) measured from the scan's OWN
     local point spacing near that element (falling back to a scan-wide
     spacing where an element has no nearby scan data at all) — never a
     hardcoded constant. The density is applied to the element's
     SCAN-ACCESSIBLE SHELL volume (surface area × scan tolerance), not its
     full solid volume: a real scanner can only ever place points on an
     element's visible surface, never inside solid material, so sizing the
     point budget off the full interior volume would make 100% unreachable
     for any element with real thickness (a wall/column/slab's solid volume
     dwarfs the thin shell a scan can actually populate). The displayed
     "BIM Volume" is still the element's true solid volume.
  5. Completion % = actual overlapping points / maximum possible points,
  6. Classifies Not Started / In Progress / Completed.

Coordinate note: the viewer applies  world = T · local  to each model
(T = compose(position, quaternion, scale)). To compare the IFC element
geometry (≈ BIM local/world coords from the converter) against the cloud we
map the cloud into the BIM local frame:  pc_in_bim = inv(T_bim) · T_pc · pc_local.
"""
import os
import struct
import hashlib
import logging
import numpy as np
from scipy.spatial import cKDTree

logger = logging.getLogger(__name__)


def _stable_seed(*parts):
    """Deterministic seed derived from stable inputs (content hashes, ids), so
    the same BIM/point-cloud data always draws the same 'random' samples
    across separate `analyze()` calls — clicking "Analyze" repeatedly on an
    unchanged registered pair must return identical results, not results that
    drift because they came from the process-global (unseeded) RNG."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:4], "big")


_FILE_CONTENT_SEED_CACHE = {}


def _file_content_seed(path):
    """Stable seed derived from a file's actual BYTES (sha256), cached by
    (path, mtime, size) to avoid re-hashing on every call. Deliberately
    content-based rather than path-based: two people uploading the identical
    BIM/point-cloud file each get their own DB record and storage path/ID, so
    seeding off the path would still make their analyses disagree even though
    the underlying data is byte-for-byte the same. Hashing the content
    instead means identical uploads always converge on the same seed no
    matter where or by whom they were uploaded."""
    try:
        st = os.stat(path)
        key = (path, st.st_mtime, st.st_size)
    except OSError:
        key = None
    if key is not None and key in _FILE_CONTENT_SEED_CACHE:
        return _FILE_CONTENT_SEED_CACHE[key]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    seed = int.from_bytes(h.digest()[:4], "big")
    if key is not None:
        _FILE_CONTENT_SEED_CACHE[key] = seed
    return seed


def _content_subsample_seed(pts, max_points):
    """Seed for the initial point-cloud cap, derived from the parsed points
    themselves (not the file path) — so the same raw point data always caps
    to the same subset regardless of which upload/path it came from."""
    h = hashlib.sha256(pts.tobytes()).digest()
    return _stable_seed(int.from_bytes(h[:4], "big"), max_points)

# IFC type → friendly category. Every element with geometry is extracted and
# categorized — nothing is filtered out and no category list is hardcoded
# against the data; unmapped types simply fall back to "Other" so the page
# still reflects exactly what's in the file.
CATEGORY_MAP = {
    "IFCWALL": "Walls", "IFCWALLSTANDARDCASE": "Walls", "IFCWALLELEMENTEDCASE": "Walls",
    "IFCSLAB": "Slabs", "IFCSLABSTANDARDCASE": "Slabs", "IFCSLABELEMENTEDCASE": "Slabs",
    "IFCROOF": "Roofs",
    "IFCCOLUMN": "Columns", "IFCCOLUMNSTANDARDCASE": "Columns",
    "IFCBEAM": "Beams", "IFCBEAMSTANDARDCASE": "Beams",
    "IFCSTAIR": "Stairs", "IFCSTAIRFLIGHT": "Stairs",
    "IFCRAMP": "Ramps", "IFCRAMPFLIGHT": "Ramps",
    "IFCDOOR": "Doors", "IFCDOORSTANDARDCASE": "Doors",
    "IFCWINDOW": "Windows", "IFCWINDOWSTANDARDCASE": "Windows",
    "IFCMEMBER": "Members", "IFCRAILING": "Railings",
    "IFCCURTAINWALL": "Curtain Walls",
    "IFCPLATE": "Plates", "IFCPLATESTANDARDCASE": "Plates",
    "IFCCOVERING": "Ceilings/Coverings", "IFCFOOTING": "Footings", "IFCPILE": "Piles",
    "IFCBUILDINGELEMENTPROXY": "Other Building Elements",
    "IFCBUILDINGELEMENTPART": "Building Element Parts",
    "IFCSPACE": "Spaces", "IFCOPENINGELEMENT": "Openings",
    "IFCFURNISHINGELEMENT": "Furniture", "IFCFURNITURE": "Furniture",
    "IFCSANITARYTERMINAL": "Sanitary Fixtures",
    "IFCFLOWTERMINAL": "MEP Terminals", "IFCFLOWSEGMENT": "MEP Segments",
    "IFCFLOWFITTING": "MEP Fittings", "IFCFLOWCONTROLLER": "MEP Controllers",
    "IFCDISTRIBUTIONELEMENT": "MEP Elements", "IFCDISTRIBUTIONCHAMBERELEMENT": "MEP Chambers",
    "IFCTRANSPORTELEMENT": "Transport Elements",
    "IFCDISCRETEACCESSORY": "Accessories",
    "IFCREINFORCINGBAR": "Reinforcement", "IFCREINFORCINGMESH": "Reinforcement",
    "IFCTENDON": "Reinforcement",
}


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
        rng = np.random.default_rng(_content_subsample_seed(pts, max_points))
        idx = rng.choice(len(pts), max_points, replace=False)
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
        rng = np.random.default_rng(_content_subsample_seed(pts, max_points))
        idx = rng.choice(len(pts), max_points, replace=False)
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
        rng = np.random.default_rng(_content_subsample_seed(pts, max_points))
        idx = rng.choice(len(pts), max_points, replace=False)
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


def _signed_volume_sum(verts, faces):
    """Mesh volume via the divergence theorem (signed sum of tetrahedra formed
    with the origin). Exact for a closed/watertight shell, which is what IFC's
    B-rep tessellation produces for solid elements."""
    if len(faces) == 0:
        return 0.0
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    vol6 = np.einsum("ij,ij->i", v0, np.cross(v1, v2))
    return abs(float(vol6.sum())) / 6.0


def _bbox_volume(verts):
    if len(verts) == 0:
        return 0.0
    mins = verts.min(axis=0)
    maxs = verts.max(axis=0)
    dims = np.maximum(maxs - mins, 1e-4)
    return float(dims[0] * dims[1] * dims[2])


def _element_volume(verts, faces):
    """Real 3D volume (m^3). Falls back to the bounding-box volume for
    open/non-manifold shells (e.g. thin single-sided plates/coverings), where
    the closed-mesh formula sums to ~0 but the element still occupies space."""
    vol = _signed_volume_sum(verts, faces)
    return vol if vol > 1e-6 else _bbox_volume(verts)


def _triangle_area_sum(verts, faces):
    """Total surface area (m^2) — used only internally as an ingredient for
    the scan-accessible shell volume (see `analyze`), not displayed directly."""
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
    """Return list of dicts: global_id, ifc_type, name, category, volume, verts,
    faces — for EVERY IFC element that has renderable geometry (no type
    filtering), so the count matches the real number of elements in the file."""
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
    threads = max(1, multiprocessing.cpu_count())

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
            g = shape.geometry
            verts = np.array(g.verts, dtype=np.float64).reshape(-1, 3)
            faces = np.array(g.faces, dtype=np.int64).reshape(-1, 3)
            volume = _element_volume(verts, faces)
            area = _triangle_area_sum(verts, faces)
            out.append({
                "global_id": getattr(product, "GlobalId", "") or str(shape.id),
                # STEP express ID (the IFC file's own line-numbering) — stable
                # across parsers, so the browser viewer (web-ifc) and this
                # server-side extraction (ifcopenshell) identify the same
                # physical element with the same integer. Used to match a
                # viewer-sent overlap snapshot to the right element.
                "express_id": int(shape.id),
                "ifc_type": ifc_type,
                "name": getattr(product, "Name", "") or "",
                "category": CATEGORY_MAP.get(ifc_type, "Other"),
                "volume": volume,
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


# ─── Surface sampling + RANSAC plane verification ──────────────────────────────

# Element categories where a planar fit is meaningful ("really built" check).
PLANAR_CATEGORIES = {"Walls", "Slabs", "Roofs"}

# Samples generated per element to represent its surface when assigning real
# scan points to their nearest element (not a coverage metric by itself).
# Sized per element (not fixed) so large surfaces still get samples closer
# together than `threshold` — a fixed low count would leave gaps wider than
# the tolerance on big walls/slabs, silently missing real overlapping points.
MIN_ASSIGN_SAMPLES = 60
MAX_ASSIGN_SAMPLES = 6000


def _assignment_sample_count(area, threshold):
    """~1/threshold^2 samples per m^2 keeps the average nearest-sample gap
    around threshold/2, so points actually within `threshold` of the true
    surface reliably find a sample within `threshold` too."""
    if area <= 0 or threshold <= 0:
        return MIN_ASSIGN_SAMPLES
    n = int(round(area / (threshold ** 2)))
    return int(np.clip(n, MIN_ASSIGN_SAMPLES, MAX_ASSIGN_SAMPLES))


def sample_surface(verts, faces, n, rng):
    """Sample n points spread across the mesh, weighted by triangle area — so
    samples reflect actual SURFACE AREA, not uneven vertex density. `rng` is a
    caller-owned, deterministically-seeded Generator (see `analyze`) so the
    same element always draws the same samples across repeated analyses."""
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
    tri = rng.choice(len(faces), size=n, p=probs)
    u = rng.random((n, 1))
    w = rng.random((n, 1))
    over = (u + w > 1).flatten()
    u[over] = 1 - u[over]
    w[over] = 1 - w[over]
    a, b, c = v0[tri], v1[tri], v2[tri]
    return a + u * (b - a) + w * (c - a)


def ransac_plane(points, rng, iters=60, thresh=0.05):
    """numpy RANSAC plane fit. Returns (inlier_ratio, normal) — high ratio means
    the nearby scan points form a coherent surface (a real wall/slab), not
    scattered clutter. No Open3D needed. `rng` is a caller-owned,
    deterministically-seeded Generator (see `analyze`)."""
    n = len(points)
    if n < 3:
        return 0.0, None
    best_ratio = 0.0
    best_normal = None
    for _ in range(iters):
        idx = rng.choice(n, 3, replace=False)
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


# ─── Point-cloud density (dynamic — never hardcoded) ───────────────────────────
#
# Point clouds are fundamentally SURFACE samples, not isotropic 3D fills.
# Measuring density via nearest-neighbour spacing (1/spacing^3) or via a ball
# spanning an element's whole solid both mis-measure it — one assumes 3D
# isotropy a surface scan never has, the other dilutes the count against
# mostly-empty solid interior. Instead we measure it exactly where points can
# physically exist: small threshold-radius bubbles centred ON the element's
# own surface (from real scan probes that actually got a hit). Probes with NO
# hit are excluded from the density measurement itself — they represent
# un-scanned surface, which is what the completion % (actual/max) already
# captures; folding them into the density would make "max possible" collapse
# to "however much was actually scanned" and completion trivially ~100%.

PROBES_PER_ELEMENT = 60  # surface probes used only to *measure* local density
GLOBAL_PROBES_PER_ELEMENT = 40  # smaller per-element share pooled model-wide


def _probe_density(pc_tree, probes, threshold, min_hits=5, exclude_self=False):
    """Points/m^3, measured directly: for surface probes that DID land within
    `threshold` of a real scan point, how many real points are typically found
    around them. No isotropy assumption, no whole-solid dilution, and not
    circular with the coverage fraction (misses are excluded rather than
    counted as zero density).

    Uses a Chebyshev (max-norm) neighborhood of half-width threshold/2 — i.e.
    a cube of side `threshold` and volume threshold^3 — rather than a
    Euclidean ball. This must match the unit the shell volume is built from
    (`area * threshold`, i.e. the surface decomposed into threshold^3 cubes);
    a spherical ball has ~4.19/3 = 1.33x the volume of that cube for the same
    radius, which would silently inflate completion % by that same constant
    factor for every element.

    `exclude_self`: pass True when the probes ARE points from `pc_tree` itself
    (see `_intrinsic_density`) so every probe doesn't trivially count itself
    as a hit."""
    if pc_tree is None or len(probes) == 0:
        return None
    cube_volume = threshold ** 3
    if cube_volume <= 0:
        return None
    counts = np.asarray(
        pc_tree.query_ball_point(probes, threshold / 2.0, p=np.inf, workers=-1, return_length=True)
    )
    if exclude_self:
        counts = np.maximum(counts - 1, 0)
    hits = counts[counts > 0]
    if len(hits) < min_hits:
        return None
    return float(np.mean(hits)) / cube_volume


def _intrinsic_density(pc_points, threshold, rng, cap=3000):
    """Points/m^3 from the scan's OWN local point spacing — probes centred on
    the cloud's own points, so this needs NO correct BIM registration at all
    (unlike `_element_density`/`_global_probe_density`, which probe at BIM
    surface locations and therefore silently read 0 if the saved alignment is
    wrong). Last-resort fallback for when the BIM-anchored global density
    comes back empty, so "BIM Points" stays a real number even when this
    module's own point-cloud-vs-BIM matching can't be trusted — e.g. because
    `overlap_points` for this analysis came from a viewer-sent snapshot
    instead of the alignment saved on the BIM/Point Cloud records."""
    n = len(pc_points)
    if n < 2:
        return 0.0
    sample = pc_points if n <= cap else pc_points[rng.choice(n, cap, replace=False)]
    tree = cKDTree(sample, balanced_tree=False, compact_nodes=False)
    return _probe_density(tree, sample, threshold, exclude_self=True) or 0.0


def _element_density(pc_tree, verts, faces, threshold, global_density, rng):
    """Local density measured from probes on THIS element's own surface — scan
    density varies across a real site, so this is more accurate than one
    project-wide figure. Falls back to the global figure only when this
    element has no nearby scan data at all (e.g. not yet scanned)."""
    if len(verts) == 0 or pc_tree is None:
        return global_density
    probes = sample_surface(verts, faces, PROBES_PER_ELEMENT, rng)
    local = _probe_density(pc_tree, probes, threshold)
    return local if local is not None and local > 0 else global_density


def _global_probe_density(pc_tree, elements, threshold, rng):
    """Same probe-bubble methodology as `_element_density`, pooled across
    every element's own surface — the fallback used only for elements with no
    nearby scan data of their own."""
    if pc_tree is None:
        return 0.0
    probes = []
    for el in elements:
        if len(el["verts"]):
            probes.append(sample_surface(el["verts"], el.get("faces"), GLOBAL_PROBES_PER_ELEMENT, rng))
    if not probes:
        return 0.0
    all_probes = np.concatenate(probes, axis=0)
    density = _probe_density(pc_tree, all_probes, threshold)
    return density or 0.0


def _assign_points_to_elements(elements, pc_points, threshold, rng):
    """Assign every real scan point to its single nearest BIM element (within
    `threshold`) — the server-side equivalent of the viewer's voxel-hash
    "which element does this point overlap" check. Each point counts for
    exactly one element, so per-element counts never double-count."""
    n_points = len(pc_points)
    owner_of_point = np.full(n_points, -1, dtype=np.int64)
    if n_points == 0:
        return owner_of_point

    all_samples = []
    owners = []
    for i, el in enumerate(elements):
        verts, faces = el["verts"], el.get("faces")
        if len(verts) == 0:
            continue
        n = _assignment_sample_count(el.get("area", 0.0), threshold)
        s = sample_surface(verts, faces, n, rng)
        all_samples.append(s)
        owners.append(np.full(len(s), i, dtype=np.int64))

    if not all_samples:
        return owner_of_point

    all_samples = np.concatenate(all_samples, axis=0)
    owners = np.concatenate(owners, axis=0)
    sample_tree = cKDTree(all_samples, balanced_tree=False, compact_nodes=False)
    d, idx = sample_tree.query(pc_points, k=1, workers=-1)
    near = d <= threshold
    owner_of_point[near] = owners[idx[near]]
    return owner_of_point


# ─── Main analysis ─────────────────────────────────────────────────────────────

COMPLETED_THRESHOLD = 100.0  # completion % at/above which an element is "Completed"


def _status(overlap_points, pct):
    if overlap_points <= 0:
        return "not_started"
    if pct >= COMPLETED_THRESHOLD:
        return "completed"
    return "in_progress"


def analyze(ifc_path, pc_path, bim_transform, pc_transform, threshold=0.15, overlap_snapshot=None):
    """
    Returns { elements: [...], summary: {...}, categories: [...] } or raises.
    `threshold` = max distance (m) a scan point may be from a BIM surface to
    count as overlapping it.

    `pc_path` accepts any supported format: .ply, .las, .laz, .pts, .xyz.

    `overlap_snapshot`: optional {express_id(str): overlap_point_count} sent
    by the viewer's own voxel-hash overlap check (see useOverlap.js /
    "Send Overlap to Progress Assessment"). When given, each element's
    `overlap_points` comes from this browser-verified count instead of being
    re-derived from `bim_transform`/`pc_transform` here — those saved
    transforms only need to be roughly reasonable for element VOLUME/density
    purposes, not pixel-perfect, since the actual overlap number is coming
    from the same live session the user visually confirmed. This sidesteps
    any mismatch between ifcopenshell's and the browser's IFC-geometry
    coordinate frames for elements that were actually measured live.
    """
    elements = extract_elements(ifc_path)
    if not elements:
        return {"elements": [], "summary": _empty_summary(), "categories": [], "point_count": 0, "threshold": threshold}
    # Cap the cloud for speed — 150k points is plenty for coverage/plane checks.
    pts = read_pointcloud_points(pc_path, max_points=150000)
    point_count = len(pts)

    # Deterministic RNG seeded from the BIM/point-cloud CONTENT itself (an IFC
    # file hash + a hash of the loaded points), not their storage paths/DB
    # ids: every sampling step below (element/plane/density probes) draws
    # from this one Generator, consumed in the same fixed order (element list
    # is cached and stable) every time — so repeated "Analyze" clicks on an
    # unchanged pair, AND separate uploads of the identical BIM/point-cloud
    # files (e.g. by different people), reproduce bit-identical
    # elements/summary/categories, instead of drawing from the process-global
    # (unseeded) RNG that differs on every call, or from a seed that differs
    # just because the same content was uploaded under a different path/ID.
    pc_content_seed = int.from_bytes(hashlib.sha256(pts.tobytes()).digest()[:4], "big")
    rng = np.random.default_rng(_stable_seed(_file_content_seed(ifc_path), pc_content_seed))

    # Bring the cloud into the BIM local frame: inv(T_bim) · T_pc · pc_local.
    T_bim = compose_matrix(bim_transform)
    T_pc = compose_matrix(pc_transform)
    rel = np.linalg.inv(T_bim) @ T_pc
    homog = np.hstack([pts, np.ones((len(pts), 1))])
    pc_in_bim = (rel @ homog.T).T[:, :3]

    # Tree over the real scan points — used for local density lookups.
    pc_tree = cKDTree(pc_in_bim, balanced_tree=False, compact_nodes=False) if point_count else None
    global_density = _global_probe_density(pc_tree, elements, threshold, rng) if point_count else 0.0
    if not global_density and point_count:
        # The BIM-anchored probes found nothing anywhere in the model — most
        # likely the saved bim/pc transforms don't actually register the two
        # correctly (rather than genuinely zero scan data). Fall back to the
        # scan's own intrinsic density so "BIM Points" is still a real number.
        global_density = _intrinsic_density(pc_in_bim, threshold, rng)

    # Assign every real scan point to its nearest BIM element ("actual
    # overlapping points" — mirrors the viewer's 🟢 overlap check). Skipped
    # entirely when a snapshot is supplied — those counts already come from
    # the browser doing the equivalent check on the live, visually-confirmed
    # alignment.
    owner_of_point = None
    if overlap_snapshot is None:
        owner_of_point = _assign_points_to_elements(elements, pc_in_bim, threshold, rng)

    results = []
    for i, el in enumerate(elements):
        verts = el["verts"]
        volume = el["volume"]
        if overlap_snapshot is not None:
            overlap_points = int(overlap_snapshot.get(str(el["express_id"]), 0))
            overlap_idx = np.empty(0, dtype=np.int64)
        else:
            overlap_idx = np.nonzero(owner_of_point == i)[0]
            overlap_points = int(len(overlap_idx))

        density = _element_density(pc_tree, verts, el.get("faces"), threshold, global_density, rng)
        # Points can only physically land in the thin shell around the true
        # surface (surface_area × threshold), not the full solid volume.
        shell_volume = el["area"] * threshold
        points_max = int(round(shell_volume * density)) if shell_volume > 0 and density > 0 else 0
        pct = round(min(100.0, overlap_points / points_max * 100.0), 1) if points_max > 0 else 0.0

        # Plane verification (walls/slabs/roofs): reuse the real points already
        # assigned to this element — no extra query needed. Not available when
        # overlap comes from a snapshot (no real point positions, just counts).
        plane_inlier = None
        verified = None
        if (
            overlap_snapshot is None
            and el["category"] in PLANAR_CATEGORIES
            and overlap_points >= 20
        ):
            near = pc_in_bim[overlap_idx]
            if len(near) > 1500:
                near = near[rng.choice(len(near), 1500, replace=False)]
            ratio, _n = ransac_plane(near, rng, iters=25, thresh=threshold * 0.5)
            plane_inlier = round(ratio, 3)
            verified = ratio >= 0.5

        results.append({
            "element_id": el["global_id"],
            "express_id": el["express_id"],
            "element_type": el["ifc_type"],
            "category": el["category"],
            "name": el["name"],
            "bim_volume": round(volume, 4),
            "bim_points": points_max,
            "overlap_points": overlap_points,
            "completion": pct,
            "status": _status(overlap_points, pct),
            "plane_inlier": plane_inlier,
            "verified": verified,
        })

    summary = _summarize(results)
    categories = _by_category(results)
    return {
        "elements": results, "summary": summary, "categories": categories,
        "point_count": point_count, "threshold": threshold,
        "overlap_source": "viewer_snapshot" if overlap_snapshot is not None else "server_alignment",
    }


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
    # Points-weighted overall completion (falls back to simple mean if no
    # element has a computable max-points figure).
    points_max_total = sum(r["bim_points"] for r in results)
    overlap_total = sum(r["overlap_points"] for r in results)
    if points_max_total > 0:
        overall = min(100.0, overlap_total / points_max_total * 100.0)
    else:
        overall = (sum(r["completion"] for r in results) / total) if total else 0.0
    return {
        "total": total,
        "completed": completed,
        "in_progress": in_progress,
        "not_started": not_started,
        "overall_completion": round(overall, 1),
    }


def _by_category(results):
    from collections import defaultdict
    g = defaultdict(lambda: {"count": 0, "bim_volume": 0.0, "bim_points": 0, "overlap_points": 0})
    for r in results:
        c = g[r["category"]]
        c["count"] += 1
        c["bim_volume"] += r["bim_volume"]
        c["bim_points"] += r["bim_points"]
        c["overlap_points"] += r["overlap_points"]
    out = []
    for cat, v in sorted(g.items()):
        pct = round(min(100.0, (v["overlap_points"] / v["bim_points"] * 100.0)), 1) if v["bim_points"] > 0 else 0.0
        out.append({
            "category": cat,
            "count": v["count"],
            "bim_volume": round(v["bim_volume"], 3),
            "overlap_volume": round(v["bim_volume"] * pct / 100.0, 3),
            "bim_points": v["bim_points"],
            "overlap_points": v["overlap_points"],
            "completion": pct,
        })
    return out


def sanitize_result(obj):
    """Recursively convert numpy/scientific types to Python builtins for JSON.

    This ensures DRF's JSON renderer can serialize the analyze output.
    """
    import numpy as _np

    if obj is None:
        return None
    if isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, (int, float)):
        return obj
    if isinstance(obj, _np.generic):
        try:
            return obj.item()
        except Exception:
            return float(obj)
    if isinstance(obj, dict):
        return {k: sanitize_result(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_result(v) for v in obj]
    try:
        # Fallback: try to convert numpy arrays to lists
        if hasattr(obj, "tolist"):
            return sanitize_result(obj.tolist())
    except Exception:
        pass
    return obj
