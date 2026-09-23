"""COLMAP-driven Gaussian training and standard Gaussian PLY export."""
import math
import os
import struct
import zipfile

import numpy as np
from PIL import Image

torch = None


def _data_lines(text):
    return [line.strip() for line in text.splitlines()
            if line.strip() and not line.lstrip().startswith("#")]


def parse_cameras(text):
    cameras = {}
    for line in _data_lines(text):
        parts = line.split()
        if len(parts) < 5:
            continue
        camera_id, model = int(parts[0]), parts[1]
        width, height = int(parts[2]), int(parts[3])
        params = [float(value) for value in parts[4:]]
        if model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL"):
            fx = fy = params[0]
            cx, cy = params[1:3]
        elif model in ("PINHOLE", "OPENCV", "OPENCV_FISHEYE"):
            fx, fy, cx, cy = params[:4]
        else:
            raise ValueError(f"Unsupported COLMAP camera model: {model}")
        cameras[camera_id] = (width, height, fx, fy, cx, cy)
    if not cameras:
        raise ValueError("cameras.txt contains no supported cameras")
    return cameras


def parse_images(text):
    images = []
    lines = _data_lines(text)
    index = 0
    while index < len(lines):
        parts = lines[index].split()
        index += 1
        if len(parts) < 10:
            continue
        values = [float(value) for value in parts[1:8]]
        images.append({"name": " ".join(parts[9:]), "camera_id": int(parts[8]),
                       "q": values[:4], "t": values[4:]})
        if index < len(lines):
            index += 1
    if not images:
        raise ValueError("images.txt contains no camera poses")
    return images


def parse_points(text):
    points = []
    for line in _data_lines(text):
        parts = line.split()
        if len(parts) >= 8:
            points.append([float(value) for value in parts[1:8]])
    if not points:
        raise ValueError("points3d.txt contains no sparse points")
    return np.asarray(points, dtype=np.float32)


def _quat_to_matrix(q):
    qw, qx, qy, qz = q
    return np.asarray([
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ], dtype=np.float32)


def _load_images(image_zip, poses, cameras, side=256):
    with zipfile.ZipFile(image_zip) as archive:
        names = {name.replace("\\", "/"): name for name in archive.namelist()}
        basenames = {}
        for name in archive.namelist():
            basenames.setdefault(os.path.basename(name.replace("\\", "/")).lower(), name)
        frames = []
        for pose in poses:
            key = "/".join(part for part in pose["name"].replace("\\", "/").split("/") if part)
            archive_name = names.get(key) or basenames.get(os.path.basename(key).lower())
            if not archive_name:
                continue
            with Image.open(archive.open(archive_name)) as image:
                image = image.convert("RGB")
                width, height = image.size
                scale = min(1.0, side / max(width, height))
                image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
                pixels = np.asarray(image, dtype=np.float32) / 255.0
            camera_width, camera_height, fx, fy, cx, cy = cameras[pose["camera_id"]]
            scaled_camera = (pixels.shape[1], pixels.shape[0], fx * scale, fy * scale, cx * scale, cy * scale)
            frames.append((pose, scaled_camera, pixels))
    if not frames:
        available = ", ".join(os.path.basename(name) for name in archive.namelist()[:5])
        requested = ", ".join(pose["name"] for pose in poses[:5])
        raise ValueError(f"No images matched images.txt. Requested: {requested}. ZIP contains: {available}.")
    return frames


def _quat_normalize(q):
    return q / q.norm(dim=-1, keepdim=True).clamp_min(1e-8)


def _quat_to_rotmat_batch(q):
    """Batched (N,4) wxyz quaternion -> (N,3,3) rotation matrix, same convention as `_quat_to_matrix`."""
    w, x, y, z = _quat_normalize(q).unbind(-1)
    return torch.stack([
        torch.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], dim=-1),
        torch.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], dim=-1),
        torch.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], dim=-1),
    ], dim=-2)


def _covariance_3d(scales, rotations):
    """Anisotropic world-space 3D covariance Sigma = R diag(s^2) R^T, batched over N points."""
    rotmat = _quat_to_rotmat_batch(rotations)
    scaled = rotmat * scales.unsqueeze(-2)
    return scaled @ scaled.transpose(-1, -2)


def _render(points, colours, opacity, scales, rotations, pose, camera, height, width):
    """True EWA-splat rendering: anisotropic 3D covariance is projected to a 2D screen-space
    covariance per gaussian (Kerbl et al. 2023), then gaussians are depth-sorted and
    alpha-composited front-to-back (like a real Gaussian rasterizer), instead of averaging a
    fixed isotropic 2x2-pixel window irrespective of depth or orientation."""
    _, _, fx, fy, cx, cy = camera
    device = points.device
    rotation = torch.as_tensor(_quat_to_matrix(pose["q"]), device=device, dtype=points.dtype)
    translation = torch.as_tensor(pose["t"], device=device, dtype=points.dtype)
    camera_points = points @ rotation.T + translation

    visible = camera_points[:, 2] > 0.05
    camera_points = camera_points[visible]
    colours_v, opacity_v = colours[visible], opacity[visible]
    scales_v, rotations_v = scales[visible], rotations[visible]

    tz = camera_points[:, 2]
    px = fx * camera_points[:, 0] / tz + cx
    py = fy * camera_points[:, 1] / tz + cy
    inside = (px >= 0) & (px < width) & (py >= 0) & (py < height)
    empty = torch.zeros((height, width, 3), device=device), torch.zeros((height, width, 1), device=device)
    if inside.sum() == 0:
        return empty

    camera_points, px, py, tz = camera_points[inside], px[inside], py[inside], tz[inside]
    colours_v, opacity_v = colours_v[inside], opacity_v[inside]
    scales_v, rotations_v = scales_v[inside], rotations_v[inside]

    sigma_world = _covariance_3d(scales_v, rotations_v)
    view = rotation.unsqueeze(0)
    sigma_cam = view @ sigma_world @ view.transpose(-1, -2)

    zero = torch.zeros_like(tz)
    jacobian = torch.stack([
        torch.stack([fx / tz, zero, -fx * camera_points[:, 0] / (tz * tz)], dim=-1),
        torch.stack([zero, fy / tz, -fy * camera_points[:, 1] / (tz * tz)], dim=-1),
        torch.stack([zero, zero, zero], dim=-1),
    ], dim=-2)
    sigma_2d = jacobian @ sigma_cam @ jacobian.transpose(-1, -2)
    a = sigma_2d[:, 0, 0] + 0.3
    b = sigma_2d[:, 0, 1]
    c = sigma_2d[:, 1, 1] + 0.3

    det = (a * c - b * b).clamp_min(1e-6)
    inv_a, inv_b, inv_c = c / det, -b / det, a / det

    mid = (a + c) * 0.5
    spread = torch.sqrt(((a - c) * 0.5) ** 2 + b * b)
    lambda_max = (mid + spread).clamp_min(1e-6)
    radius = torch.clamp((3.0 * lambda_max.sqrt()).ceil(), min=1, max=24).long()

    order = torch.argsort(tz).tolist()
    cx0 = px.detach().round().long()
    cy0 = py.detach().round().long()

    accum = torch.zeros((height * width, 3), device=device, dtype=colours_v.dtype)
    transmittance = torch.ones((height * width, 1), device=device, dtype=colours_v.dtype)

    for idx in order:
        r = int(radius[idx].item())
        x0, x1 = max(0, int(cx0[idx]) - r), min(width - 1, int(cx0[idx]) + r)
        y0, y1 = max(0, int(cy0[idx]) - r), min(height - 1, int(cy0[idx]) + r)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = torch.meshgrid(
            torch.arange(y0, y1 + 1, device=device),
            torch.arange(x0, x1 + 1, device=device),
            indexing="ij",
        )
        flat_idx = (ys * width + xs).reshape(-1)
        dx = xs.reshape(-1).to(colours_v.dtype) - px[idx]
        dy = ys.reshape(-1).to(colours_v.dtype) - py[idx]
        maha = inv_a[idx] * dx * dx + 2 * inv_b[idx] * dx * dy + inv_c[idx] * dy * dy
        weight = torch.exp(-0.5 * maha)
        alpha = (opacity_v[idx] * weight).clamp(0, 0.999)
        visible_transmittance = transmittance.index_select(0, flat_idx).squeeze(-1)
        contribution = (visible_transmittance * alpha).unsqueeze(-1) * colours_v[idx]
        accum = accum.index_add(0, flat_idx, contribution)
        transmittance = transmittance.index_add(0, flat_idx, (-(visible_transmittance * alpha)).unsqueeze(-1))

    coverage = (1.0 - transmittance).clamp(0, 1)
    return accum.reshape(height, width, 3), coverage.reshape(height, width, 1)


def _write_ply(path, points, colours, opacity, scales, rotations):
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {len(points)}\n"
              "property float x\nproperty float y\nproperty float z\n"
              "property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n"
              "property float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\n"
              "property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nend_header\n")
    with open(path, "wb") as output:
        output.write(header.encode("ascii"))
        for point, colour, alpha, scale, rotation in zip(points, colours, opacity, scales, rotations):
            output.write(struct.pack(
                "<14f", *point, *(colour - 0.5), float(alpha), *np.log(scale), *rotation,
            ))


def train_colmap_gaussians(cameras_text, images_text, points_text, image_zip, output_path, iterations=120):
    global torch
    if torch is None:
        try:
            import torch as torch_module
            torch = torch_module
        except ImportError as error:
            raise RuntimeError(
                "PyTorch is required for Gaussian training. Install the backend requirements with "
                "python -m pip install -r requirements.txt."
            ) from error
    cameras, poses = parse_cameras(cameras_text), parse_images(images_text)
    point_data = parse_points(points_text)
    frames = _load_images(image_zip, poses, cameras)
    point_data = point_data[:50000]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    points = torch.nn.Parameter(torch.tensor(point_data[:, :3], device=device))
    colours = torch.nn.Parameter(torch.tensor(point_data[:, 3:6] / 255.0, device=device).clamp(0, 1))
    base_scale = max(float(np.linalg.norm(point_data[:, :3].std(axis=0))) * 0.003, 0.002)
    log_scales = torch.nn.Parameter(torch.full((len(point_data), 3), math.log(base_scale), device=device))
    opacity = torch.nn.Parameter(torch.full((len(point_data),), 0.6, device=device))
    rotations = torch.nn.Parameter(
        torch.tensor([1.0, 0.0, 0.0, 0.0], device=device).repeat(len(point_data), 1)
    )
    optimizer = torch.optim.Adam([points, colours, log_scales, opacity, rotations], lr=0.01)
    for step in range(max(1, int(iterations))):
        pose, camera, target = frames[step % len(frames)]
        height, width = target.shape[:2]
        prediction, alpha = _render(
            points, colours, opacity.sigmoid(), log_scales.exp(), rotations, pose, camera, height, width,
        )
        target_tensor = torch.as_tensor(target, device=device)
        loss = ((prediction - target_tensor) ** 2 * alpha).mean() + 0.0001 * log_scales.exp().mean()
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
    final_rotations = rotations.detach()
    final_rotations = (final_rotations / final_rotations.norm(dim=-1, keepdim=True).clamp_min(1e-8))
    _write_ply(
        output_path,
        points.detach().cpu().numpy(),
        colours.detach().cpu().numpy().clip(0, 1),
        opacity.detach().sigmoid().cpu().numpy(),
        log_scales.detach().exp().cpu().numpy(),
        final_rotations.cpu().numpy(),
    )
    return {"point_count": len(point_data), "iterations": int(iterations), "device": device}