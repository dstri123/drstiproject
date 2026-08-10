"""
segmentation_service.py — SAM (ViT-B) + CLIP zero-shot construction segmentation.

Setup:
  pip install fastapi "uvicorn[standard]" torch torchvision segment-anything ^
              open_clip_torch pillow numpy python-multipart

  Download the SAM ViT-B checkpoint (~375 MB) and place it next to this file:
    https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth

Run:
  python segmentation_service.py
  # then check: http://localhost:8001/health
"""

import base64
import io
import os
import urllib.request
from typing import Optional

import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

SAM_CHECKPOINT_PATH = os.environ.get("SAM_CHECKPOINT_PATH", "sam_vit_b_01ec64.pth")
SAM_CHECKPOINT_URL = (
    "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
)
SAM_MODEL_TYPE = "vit_b"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Caps the longest edge before SAM runs. Keeps inference time AND response
# size sane, since each mask ships a flat boolean array of length w*h.
MAX_IMAGE_EDGE = 384

# Must mirror CONSTRUCTION_CLASSES in useConstructionSegmentation.js —
# same key/id/color per class, so front-end and back-end never disagree.
CONSTRUCTION_CLASSES = [
    {"key": "sky", "id": 0, "label": "Sky", "color": [135, 206, 235], "emoji": ":mostly_sunny:",
     "prompts": ["a photo of the sky", "clouds"]},
    {"key": "ground", "id": 1, "label": "Ground / Soil / Mud", "color": [101, 67, 33], "emoji": ":large_brown_square:",
     "prompts": ["bare ground", "soil", "mud", "dirt at a construction site"]},
    {"key": "concrete", "id": 2, "label": "Concrete / Cement", "color": [169, 169, 169], "emoji": ":rock:",
     "prompts": ["poured concrete", "a cement surface", "a concrete slab"]},
    {"key": "structure", "id": 3, "label": "Structure / Walls", "color": [70, 100, 160], "emoji": ":building_construction:",
     "prompts": ["a building wall", "a structural frame", "a brick or block wall"]},
    {"key": "scaffolding", "id": 4, "label": "Scaffolding / Steel", "color": [220, 120, 30], "emoji": ":nut_and_bolt:",
     "prompts": ["construction scaffolding", "steel scaffold poles"]},
    {"key": "rebar", "id": 5, "label": "Rebar / Metal Rods", "color": [160, 60, 20], "emoji": ":straight_ruler:",
     "prompts": ["steel rebar", "metal reinforcement rods"]},
    {"key": "equipment", "id": 6, "label": "Equipment / Machinery", "color": [230, 190, 0], "emoji": ":construction:",
     "prompts": ["heavy construction machinery", "a crane or excavator"]},
    {"key": "worker", "id": 7, "label": "Worker / Person", "color": [210, 40, 40], "emoji": ":construction_worker:",
     "prompts": ["a construction worker", "a person wearing a hard hat"]},
]

# ── Lazy-loaded models — loaded once, on first request ──────────────────────
_sam_generator = None
_clip_model = None
_clip_preprocess = None
_clip_text_features = None


def _ensure_checkpoint_available():
    if os.path.exists(SAM_CHECKPOINT_PATH):
        return

    try:
        urllib.request.urlretrieve(SAM_CHECKPOINT_URL, SAM_CHECKPOINT_PATH)
    except Exception as exc:
        raise RuntimeError(
            f"SAM checkpoint not found at '{SAM_CHECKPOINT_PATH}' and auto-download failed: {exc}. "
            f"Download it from {SAM_CHECKPOINT_URL}, place it next to segmentation_service.py, "
            f"or set SAM_CHECKPOINT_PATH."
        ) from exc


def _ensure_models_loaded():
    global _sam_generator, _clip_model, _clip_preprocess, _clip_text_features
    if _sam_generator is not None:
        return

    _ensure_checkpoint_available()

    from segment_anything import SamAutomaticMaskGenerator, sam_model_registry

    sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT_PATH)
    sam.to(device=DEVICE)
    _sam_generator = SamAutomaticMaskGenerator(
        sam,
        points_per_side=16,           # lower = faster/coarser, raise for finer masks
        pred_iou_thresh=0.88,
        stability_score_thresh=0.92,
        min_mask_region_area=500,
    )

    import open_clip
    _clip_model, _, _clip_preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    _clip_model.to(DEVICE).eval()
    tokenizer = open_clip.get_tokenizer("ViT-B-32")

    all_prompts, prompt_class_idx = [], []
    for ci, cls in enumerate(CONSTRUCTION_CLASSES):
        for p in cls["prompts"]:
            all_prompts.append(p)
            prompt_class_idx.append(ci)

    with torch.no_grad():
        tokens = tokenizer(all_prompts).to(DEVICE)
        text_feats = _clip_model.encode_text(tokens)
        text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)

    _clip_text_features = (text_feats, np.array(prompt_class_idx))


def _classify_crop(crop_img: Image.Image):
    with torch.no_grad():
        img_t = _clip_preprocess(crop_img).unsqueeze(0).to(DEVICE)
        img_feat = _clip_model.encode_image(img_t)
        img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)
        text_feats, prompt_class_idx = _clip_text_features
        sims = (img_feat @ text_feats.T).squeeze(0).cpu().numpy()

    num_classes = len(CONSTRUCTION_CLASSES)
    best_per_class = np.full(num_classes, -1.0)
    for sim, ci in zip(sims, prompt_class_idx):
        best_per_class[ci] = max(best_per_class[ci], sim)

    best_class = int(np.argmax(best_per_class))
    exp = np.exp((best_per_class - best_per_class.max()) * 20.0)
    probs = exp / exp.sum()
    return best_class, float(probs[best_class])


def _resize_max_edge(img: Image.Image, max_edge: int) -> Image.Image:
    w, h = img.size
    scale = max_edge / max(w, h)
    if scale >= 1.0:
        return img
    return img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def run_segmentation(image: Image.Image, return_overlay: bool = True):
    _ensure_models_loaded()

    image = image.convert("RGB")
    image = _resize_max_edge(image, MAX_IMAGE_EDGE)
    np_img = np.array(image)
    h, w = np_img.shape[:2]

    raw_masks = _sam_generator.generate(np_img)

    masks_out, present_ids = [], set()
    overlay = np_img.copy().astype(np.float32)

    for mi, m in enumerate(raw_masks):
        seg = m["segmentation"]
        x0, y0, bw, bh = [int(v) for v in m["bbox"]]
        x1, y1 = min(x0 + bw, w), min(y0 + bh, h)
        if x1 <= x0 or y1 <= y0:
            continue

        crop = image.crop((x0, y0, x1, y1))
        class_idx, confidence = _classify_crop(crop)
        cls = CONSTRUCTION_CLASSES[class_idx]
        present_ids.add(class_idx)

        color = np.array(cls["color"], dtype=np.float32)
        overlay[seg] = overlay[seg] * 0.5 + color * 0.5

        masks_out.append({
            "mask_id": mi,
            "class_id": cls["id"],
            "class_key": cls["key"],
            "class_label": cls["label"],
            "emoji": cls["emoji"],
            "color": cls["color"],
            "confidence": round(confidence, 4),
            "area": int(m["area"]),
            "bbox": [x0, y0, bw, bh],
            "iou_score": round(float(m.get("predicted_iou", 0.0)), 4),
            # Flat row-major boolean array — matches useConstructionSegmentation.js
            "segmentation": seg.flatten().astype(bool).tolist(),
        })

    overlay_b64 = None
    if return_overlay:
        buf = io.BytesIO()
        Image.fromarray(np.clip(overlay, 0, 255).astype(np.uint8)).save(buf, format="PNG")
        overlay_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    present_classes = [
        {"id": c["id"], "key": c["key"], "label": c["label"], "emoji": c["emoji"], "color": c["color"]}
        for c in CONSTRUCTION_CLASSES if c["id"] in present_ids
    ]

    return {
        "overlay_base64": overlay_b64,
        "present_classes": present_classes,
        "masks": masks_out,
        "image_width": w,
        "image_height": h,
        "num_masks": len(masks_out),
    }


app = FastAPI(title="Construction Segmentation Service")


def _get_allowed_origins() -> list[str]:
    raw_origins = os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
    )
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


class Base64Request(BaseModel):
    image_base64: str
    return_overlay: Optional[bool] = True


@app.get("/health")
def health():
    try:
        _ensure_checkpoint_available()
        _ensure_models_loaded()
        return {
            "status": "ok",
            "device": DEVICE,
            "model_ready": True,
            "checkpoint": SAM_CHECKPOINT_PATH,
        }
    except RuntimeError as exc:
        return {
            "status": "degraded",
            "device": DEVICE,
            "model_ready": False,
            "checkpoint": SAM_CHECKPOINT_PATH,
            "error": str(exc),
        }


@app.post("/segment")
async def segment(file: UploadFile = File(...), return_overlay: bool = True):
    try:
        image = Image.open(io.BytesIO(await file.read()))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")
    try:
        return run_segmentation(image, return_overlay=return_overlay)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/segment/base64")
async def segment_base64(req: Base64Request):
    raw = req.image_base64
    if raw.strip().startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        image = Image.open(io.BytesIO(base64.b64decode(raw)))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}")
    try:
        return run_segmentation(image, return_overlay=req.return_overlay)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)