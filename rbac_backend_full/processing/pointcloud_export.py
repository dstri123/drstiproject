"""
Point-cloud export from the viewer ("Export PLY" in the section-box bar).

Writes the part of a point cloud that is inside the viewer's section box as a
binary PLY, read from the ORIGINAL uploaded file (full density and full
precision), not from the subsampled / half-float copy the browser renders.

Coordinate frames
-----------------
The viewer recentres every cloud's geometry on its bounding-box centre and
then places the object, so a raw file point maps to the viewer world as

    world = matrixWorld * translate(-centroid) * raw

The browser sends that combined 4x4 (`raw_to_world`, Three.js column-major
`Matrix4.elements`) together with the section box in world coordinates, so
the server crops exactly what the user sees, including unsaved moves.

Output frames:
  * "original" - the kept points keep their raw file coordinates (a plain
    crop; lines up with the original scan in any other tool).
  * "aligned"  - the viewer placement (alignment to the BIM), converted from
    the viewer's Y-up to the Z-up convention used by CloudCompare, Revit,
    ReCap, Navisworks, etc.: (x, y, z) -> (x, -z, y).

xyz is written as double so georeferenced coordinates keep their precision.
"""
import os

import numpy as np

from .pointcloud_merge import CHUNK_POINTS, open_reader

FRAMES = ("original", "aligned")
EXPORTABLE_EXTS = {".ply", ".las", ".laz", ".pts", ".xyz"}

# Viewer world (Y-up) -> Z-up.
Y_UP_TO_Z_UP = np.array([
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, -1.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
])

_TMP_DTYPE_XYZ = np.dtype("<f8")
_TMP_DTYPE_RGB = np.dtype("<u2")


class ExportError(Exception):
    """A user-presentable export failure."""


def matrix_from_elements(elements):
    """4x4 numpy matrix from Three.js column-major `Matrix4.elements`."""
    try:
        arr = np.asarray(elements, dtype=np.float64)
    except (TypeError, ValueError):
        raise ExportError("raw_to_world must be 16 numbers.")
    if arr.shape != (16,) or not np.isfinite(arr).all():
        raise ExportError("raw_to_world must be 16 finite numbers.")
    M = arr.reshape(4, 4).T
    if abs(np.linalg.det(M[:3, :3])) < 1e-12:
        raise ExportError("raw_to_world is not invertible.")
    return M


def box_from_payload(box):
    """(min, max) arrays from {"min": [x,y,z], "max": [x,y,z]}, or None."""
    if box is None:
        return None
    if not isinstance(box, dict):
        raise ExportError("box must be an object with min and max.")
    try:
        lo = np.asarray(box.get("min"), dtype=np.float64)
        hi = np.asarray(box.get("max"), dtype=np.float64)
    except (TypeError, ValueError):
        raise ExportError("box min/max must be [x, y, z] numbers.")
    if lo.shape != (3,) or hi.shape != (3,) or not (np.isfinite(lo).all() and np.isfinite(hi).all()):
        raise ExportError("box min/max must be [x, y, z] numbers.")
    if np.any(lo > hi):
        raise ExportError("box min must not exceed box max.")
    return lo, hi


def _apply(T, pts):
    return pts @ T[:3, :3].T + T[:3, 3]


def _write_header(f, count, has_color, comment):
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"comment {comment}\n"
        f"element vertex {count}\n"
        "property double x\nproperty double y\nproperty double z\n"
    )
    if has_color:
        header += "property uchar red\nproperty uchar green\nproperty uchar blue\n"
    header += "end_header\n"
    f.write(header.encode("ascii"))


def export_cropped_ply(src_path, ext, out_path, *, raw_to_world, box=None,
                       frame="original", original_offset=None,
                       chunk_points=CHUNK_POINTS):
    """Crop `src_path` to `box` (viewer world) and write a binary PLY.

    raw_to_world: 4x4 numpy matrix (raw file coords -> viewer world).
    box: (min, max) in viewer world, or None to keep every point.
    original_offset: [x, y, z] added to the raw coordinates in the
        "original" frame (merged PLYs are stored relative to an offset).
    Returns {"point_count", "input_point_count", "has_color"}.
    """
    if frame not in FRAMES:
        raise ExportError(f"frame must be one of {', '.join(FRAMES)}.")
    if ext not in EXPORTABLE_EXTS:
        raise ExportError(f"'{ext}' point clouds cannot be exported by the server.")
    try:
        reader = open_reader(src_path, ext)
    except ValueError as exc:
        raise ExportError(f"The point cloud cannot be read: {exc}")

    if frame == "aligned":
        out_T = Y_UP_TO_Z_UP @ raw_to_world
    elif original_offset is not None:
        out_T = np.eye(4)
        out_T[:3, 3] = np.asarray(original_offset, dtype=np.float64)
    else:
        out_T = None
    eps = 1e-9 if box is None else 1e-6 * max(float(np.max(box[1] - box[0])), 1.0)

    work_dir = os.path.dirname(out_path)
    xyz_tmp = os.path.join(work_dir, "export_xyz.bin")
    rgb_tmp = os.path.join(work_dir, "export_rgb.bin")

    kept = total = 0
    peak = 0.0
    any_color = False
    try:
        # Pass 1: stream the source once, keep points inside the box. Kept
        # points go to temp files (the colour depth — 8 or 16 bit — is only
        # known after every point has been seen).
        with open(xyz_tmp, "wb") as fx, open(rgb_tmp, "wb") as fc:
            for xyz, rgb in reader.chunks(chunk_points):
                ok = np.isfinite(xyz).all(axis=1)
                if not ok.all():
                    xyz = xyz[ok]
                    rgb = rgb[ok] if rgb is not None else None
                total += len(xyz)
                if not len(xyz):
                    continue
                if box is not None:
                    world = _apply(raw_to_world, xyz)
                    inside = np.all((world >= box[0] - eps) & (world <= box[1] + eps), axis=1)
                    if not inside.any():
                        continue
                    xyz = xyz[inside]
                    rgb = rgb[inside] if rgb is not None else None
                out = _apply(out_T, xyz) if out_T is not None else xyz
                out.astype(_TMP_DTYPE_XYZ).tofile(fx)
                if rgb is not None:
                    any_color = True
                    peak = max(peak, float(rgb.max()))
                    col = np.clip(rgb, 0, 65535)
                else:
                    # Chunk without colour (mixed ASCII files): written white.
                    col = np.full((len(xyz), 3), -1.0)
                _write_rgb_tmp(fc, col)
                kept += len(xyz)

        if total == 0:
            raise ExportError("The point cloud contains no readable points.")
        if kept == 0:
            raise ExportError(
                "No points are inside the clipping box. Enlarge the box and try again."
            )

        # Pass 2: write the PLY from the temp files.
        # LAS / PLY ushort colours are 16-bit; 8-bit data stored in 16-bit
        # fields peaks at <= 255 (same rule as the viewer's converter).
        scale = (255.0 / 65535.0) if peak > 255.0 else 1.0
        dtype = [("x", "<f8"), ("y", "<f8"), ("z", "<f8")]
        if any_color:
            dtype += [("r", "u1"), ("g", "u1"), ("b", "u1")]
        dtype = np.dtype(dtype)

        xyz_all = np.memmap(xyz_tmp, dtype=_TMP_DTYPE_XYZ, mode="r", shape=(kept, 3))
        rgb_all = np.memmap(rgb_tmp, dtype=_TMP_DTYPE_RGB, mode="r", shape=(kept, 3))
        try:
            with open(out_path, "wb") as f:
                _write_header(f, kept, any_color,
                              f"C'TWIN viewer export ({frame} coordinates)")
                for start in range(0, kept, chunk_points):
                    block = xyz_all[start:start + chunk_points]
                    arr = np.empty(len(block), dtype=dtype)
                    arr["x"], arr["y"], arr["z"] = block[:, 0], block[:, 1], block[:, 2]
                    if any_color:
                        c = np.asarray(rgb_all[start:start + chunk_points], dtype=np.float64)
                        white = c[:, 0] == _NO_COLOR
                        c = np.clip(np.rint(c * scale), 0, 255)
                        c[white] = 255
                        arr["r"], arr["g"], arr["b"] = c[:, 0], c[:, 1], c[:, 2]
                    arr.tofile(f)
        finally:
            del xyz_all, rgb_all
    finally:
        for p in (xyz_tmp, rgb_tmp):
            try:
                os.remove(p)
            except OSError:
                pass

    return {"point_count": kept, "input_point_count": total, "has_color": any_color}


# 65535 is reserved as "no colour" in the temp file; real 16-bit 65535 values
# are stored as 65534 (an invisible 1/65535 difference).
_NO_COLOR = 65535


def _write_rgb_tmp(f, col):
    out = np.where(col < 0, _NO_COLOR, np.minimum(np.rint(col), _NO_COLOR - 1))
    out.astype(_TMP_DTYPE_RGB).tofile(f)
