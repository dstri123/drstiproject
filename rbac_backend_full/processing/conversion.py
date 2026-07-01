"""
IFC to FBX conversion pipeline.

FBX is a proprietary Autodesk format that no pip-installable library can
write reliably, so the conversion happens in two stages:

  1. ifcopenshell extracts triangulated geometry from the IFC and the
     result is written to an intermediate GLB file via trimesh.
  2. Blender (headless) imports the GLB and exports a genuine binary FBX.

Converted files are stored under MEDIA_ROOT/converted_tools/<uuid>/ and
cleaned up after download (plus a stale sweep on every new conversion).
"""

import os
import shutil
import subprocess
import tempfile
import time
import uuid
import multiprocessing

from django.conf import settings as django_settings

# Where converted output files live until they are downloaded
CONVERTED_DIR = os.path.join(django_settings.MEDIA_ROOT, "converted_tools")

# How long converted files are kept before the stale sweep removes them
MAX_FILE_AGE_SECONDS = 60 * 60  # 1 hour

BLENDER_CANDIDATES = [
    r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
]

# Python script executed inside headless Blender: GLB in -> FBX out
_BLENDER_SCRIPT = """
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
glb_path, fbx_path = argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)
bpy.ops.export_scene.fbx(filepath=fbx_path, path_mode='AUTO')
"""


class ConversionError(Exception):
    """Raised with a user-presentable message when conversion fails."""


def find_blender():
    """Locate the Blender executable."""
    exe = shutil.which("blender")
    if exe:
        return exe
    for candidate in BLENDER_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    # Scan any other versioned install folders
    base = r"C:\Program Files\Blender Foundation"
    if os.path.isdir(base):
        for entry in sorted(os.listdir(base), reverse=True):
            candidate = os.path.join(base, entry, "blender.exe")
            if os.path.exists(candidate):
                return candidate
    return None


def _make_geom_settings():
    """Create ifcopenshell geometry settings across 0.7/0.8 API versions."""
    import ifcopenshell.geom

    geom_settings = ifcopenshell.geom.settings()
    try:
        # ifcopenshell >= 0.8 uses string keys
        geom_settings.set("use-world-coords", True)
        geom_settings.set("weld-vertices", True)
    except Exception:
        # ifcopenshell 0.7.x enum-attribute API
        geom_settings.set(geom_settings.USE_WORLD_COORDS, True)
        geom_settings.set(geom_settings.WELD_VERTICES, True)
    return geom_settings


def ifc_to_glb(input_path, glb_path, log):
    """Extract geometry from an IFC file and write an intermediate GLB."""
    import ifcopenshell
    import ifcopenshell.geom
    import numpy as np
    import trimesh

    log("Opening IFC file...")
    ifc_file = ifcopenshell.open(input_path)

    geom_settings = _make_geom_settings()

    log("Extracting geometry (this can take a while for large models)...")
    iterator = ifcopenshell.geom.iterator(
        geom_settings, ifc_file, multiprocessing.cpu_count()
    )

    scene = trimesh.Scene()
    shape_count = 0

    if not iterator.initialize():
        raise ConversionError(
            "No 3D geometry found in this IFC file - nothing to convert."
        )

    while True:
        shape = iterator.get()
        try:
            verts = np.array(shape.geometry.verts, dtype=np.float64).reshape(-1, 3)
            faces = np.array(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)

            if len(verts) and len(faces):
                mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)

                # Apply the first material's diffuse colour when available
                try:
                    materials = shape.geometry.materials
                    if materials:
                        m = materials[0]
                        diffuse = getattr(m, "diffuse", None)
                        if diffuse is not None:
                            rgb = [
                                int(max(0.0, min(1.0, c)) * 255)
                                for c in list(diffuse)[:3]
                            ]
                            mesh.visual.face_colors = rgb + [255]
                except Exception:
                    pass

                name = shape.name or f"element_{shape.id}"
                scene.add_geometry(mesh, node_name=f"{name}_{shape_count}")
                shape_count += 1
        except Exception:
            pass  # skip malformed elements, keep the rest of the model

        if not iterator.next():
            break

    if shape_count == 0:
        raise ConversionError(
            "Could not extract any geometry from this IFC file."
        )

    # IFC is Z-up by specification; glTF (and three.js) are Y-up. Bake the
    # standard -90 deg X rotation so buildings always load upright.
    z_up_to_y_up = trimesh.transformations.rotation_matrix(
        -np.pi / 2, [1, 0, 0]
    )
    scene.apply_transform(z_up_to_y_up)

    log(f"Extracted {shape_count} elements, writing intermediate GLB...")
    scene.export(glb_path)

    if not os.path.exists(glb_path) or os.path.getsize(glb_path) == 0:
        raise ConversionError("Failed to write intermediate geometry file.")

    return shape_count


def glb_to_fbx(glb_path, fbx_path, log):
    """Convert the intermediate GLB to FBX using headless Blender."""
    blender = find_blender()
    if not blender:
        raise ConversionError(
            "Blender is required for FBX export but was not found on the server."
        )

    script_path = None
    try:
        fd, script_path = tempfile.mkstemp(suffix=".py")
        with os.fdopen(fd, "w") as f:
            f.write(_BLENDER_SCRIPT)

        log("Exporting FBX with Blender...")
        result = subprocess.run(
            [
                blender,
                "--background",
                "--factory-startup",
                "--python", script_path,
                "--",
                glb_path,
                fbx_path,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )

        if result.returncode != 0 or not os.path.exists(fbx_path):
            tail = (result.stderr or result.stdout or "").strip()[-500:]
            raise ConversionError(f"Blender FBX export failed. {tail}")
    except subprocess.TimeoutExpired:
        raise ConversionError("FBX export timed out (model too large).")
    finally:
        if script_path and os.path.exists(script_path):
            os.remove(script_path)


def cleanup_stale_conversions():
    """Remove converted files older than MAX_FILE_AGE_SECONDS."""
    if not os.path.isdir(CONVERTED_DIR):
        return
    now = time.time()
    for entry in os.listdir(CONVERTED_DIR):
        path = os.path.join(CONVERTED_DIR, entry)
        try:
            if now - os.path.getmtime(path) > MAX_FILE_AGE_SECONDS:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass


def convert_ifc_to_fbx(uploaded_file, log=print):
    """
    Full pipeline entry point.

    Returns (file_id, output_filename, element_count). The converted FBX is
    stored at CONVERTED_DIR/<file_id>/<output_filename> until downloaded.
    """
    cleanup_stale_conversions()

    file_id = uuid.uuid4().hex
    out_dir = os.path.join(CONVERTED_DIR, file_id)
    os.makedirs(out_dir, exist_ok=True)

    base_name = os.path.splitext(os.path.basename(uploaded_file.name))[0]
    output_filename = base_name + ".fbx"
    fbx_path = os.path.join(out_dir, output_filename)

    work_dir = tempfile.mkdtemp(prefix="ifc2fbx_")
    try:
        input_path = os.path.join(work_dir, os.path.basename(uploaded_file.name))
        with open(input_path, "wb") as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)

        glb_path = os.path.join(work_dir, base_name + ".glb")

        element_count = ifc_to_glb(input_path, glb_path, log)
        glb_to_fbx(glb_path, fbx_path, log)

        log("Conversion complete.")
        return file_id, output_filename, element_count
    except Exception:
        shutil.rmtree(out_dir, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def get_converted_file(file_id):
    """Resolve a converted file by id. Returns absolute path or None."""
    # file_id must be a bare uuid hex - prevents path traversal
    if not file_id or not file_id.isalnum():
        return None
    out_dir = os.path.join(CONVERTED_DIR, file_id)
    if not os.path.isdir(out_dir):
        return None
    for name in os.listdir(out_dir):
        if name.lower().endswith(".fbx"):
            return os.path.join(out_dir, name)
    return None


def delete_converted_file(file_id):
    """Remove a converted file directory after successful download."""
    if not file_id or not file_id.isalnum():
        return
    shutil.rmtree(os.path.join(CONVERTED_DIR, file_id), ignore_errors=True)
