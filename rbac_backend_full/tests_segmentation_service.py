"""
Tests for segmentation_service.py (the standalone FastAPI SAM + CLIP service).

Run from the backend root (not part of `manage.py test`):
    C:\\Python314\\python.exe -m unittest tests_segmentation_service

No model is ever loaded and nothing is downloaded:
  * torch is replaced by a tiny stub when it can't be imported (on this machine
    `import torch` fails with a DLL error); the service only needs
    torch.cuda.is_available() and torch.no_grad() at that level.
  * segment_anything / open_clip are injected as fake modules where the
    lazy loader is exercised.
  * CLIP tensors are replaced by a minimal numpy-backed tensor (FakeTensor),
    so the zero-shot classification maths runs for real on known inputs.
"""
import base64
import contextlib
import io
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

import numpy as np
from PIL import Image

try:  # pragma: no cover - depends on the machine
    import torch  # noqa: F401
    TORCH_STUBBED = False
except Exception:  # ImportError, or OSError when the DLLs are broken
    torch_stub = types.ModuleType("torch")
    torch_stub.cuda = types.SimpleNamespace(is_available=lambda: False)
    torch_stub.no_grad = contextlib.nullcontext
    sys.modules["torch"] = torch_stub
    TORCH_STUBBED = True

from fastapi.testclient import TestClient  # noqa: E402

import segmentation_service as svc  # noqa: E402


class FakeTensor:
    """Just the tensor operations segmentation_service uses, on numpy."""

    def __init__(self, a):
        self.a = np.asarray(a, dtype=np.float64)

    def norm(self, dim=-1, keepdim=False):
        return FakeTensor(np.linalg.norm(self.a, axis=dim, keepdims=keepdim))

    def __truediv__(self, other):
        return FakeTensor(self.a / other.a)

    def __matmul__(self, other):
        return FakeTensor(self.a @ other.a)

    @property
    def T(self):
        return FakeTensor(self.a.T)

    def squeeze(self, dim):
        return FakeTensor(np.squeeze(self.a, axis=dim))

    def unsqueeze(self, dim):
        return FakeTensor(np.expand_dims(self.a, axis=dim))

    def to(self, *_a, **_k):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.a


WORKER = next(i for i, c in enumerate(svc.CONSTRUCTION_CLASSES) if c["key"] == "worker")


def _prompt_class_idx():
    return np.array([ci for ci, c in enumerate(svc.CONSTRUCTION_CLASSES) for _ in c["prompts"]])


def _install_fake_clip(target_class=WORKER):
    """Image features are always [1, 0]; prompts of `target_class` point the
    same way, every other prompt is orthogonal ([0, 1])."""
    idx = _prompt_class_idx()
    text = FakeTensor([[1.0, 0.0] if ci == target_class else [0.0, 1.0] for ci in idx])
    svc._clip_preprocess = lambda img: FakeTensor([1.0, 0.0])
    svc._clip_model = types.SimpleNamespace(encode_image=lambda t: t)
    svc._clip_text_features = (text, idx)


def _png_bytes(size=(40, 20), color=(0, 0, 0), fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    return buf.getvalue()


class FakeSam:
    def __init__(self, masks):
        self.masks = masks
        self.calls = []

    def generate(self, np_img):
        self.calls.append(np_img.shape)
        return self.masks(np_img) if callable(self.masks) else self.masks


def _mask(h, w, box):
    x0, y0, bw, bh = box
    seg = np.zeros((h, w), dtype=bool)
    seg[y0:y0 + bh, x0:x0 + bw] = True
    return {"segmentation": seg, "bbox": list(box), "area": int(seg.sum()), "predicted_iou": 0.912345}


class ServiceTestBase(unittest.TestCase):
    def setUp(self):
        self._saved = (svc._sam_generator, svc._clip_model, svc._clip_preprocess, svc._clip_text_features)
        svc._sam_generator = svc._clip_model = svc._clip_preprocess = svc._clip_text_features = None
        self.client = TestClient(svc.app)

    def tearDown(self):
        (svc._sam_generator, svc._clip_model, svc._clip_preprocess, svc._clip_text_features) = self._saved

    def _ready(self, masks=()):
        """Pretend the models are loaded."""
        _install_fake_clip()
        svc._sam_generator = FakeSam(masks)
        return svc._sam_generator


class HelperTests(ServiceTestBase):
    def test_resize_max_edge(self):
        self.assertEqual(svc._resize_max_edge(Image.new("RGB", (100, 50)), 384).size, (100, 50))
        self.assertEqual(svc._resize_max_edge(Image.new("RGB", (384, 10)), 384).size, (384, 10))
        self.assertEqual(svc._resize_max_edge(Image.new("RGB", (768, 384)), 384).size, (384, 192))
        self.assertEqual(svc._resize_max_edge(Image.new("RGB", (300, 900)), 384).size, (128, 384))

    def test_allowed_origins_env(self):
        with mock.patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": " http://a.com , ,http://b.com,"}):
            self.assertEqual(svc._get_allowed_origins(), ["http://a.com", "http://b.com"])
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIn("http://localhost:3000", svc._get_allowed_origins())

    def test_classes_are_consistent(self):
        ids = [c["id"] for c in svc.CONSTRUCTION_CLASSES]
        self.assertEqual(ids, list(range(len(ids))))
        for c in svc.CONSTRUCTION_CLASSES:
            self.assertEqual(len(c["color"]), 3)
            self.assertTrue(c["prompts"])

    def test_classify_crop_picks_best_class_with_softmax_confidence(self):
        _install_fake_clip(WORKER)
        cls, conf = svc._classify_crop(Image.new("RGB", (4, 4)))
        self.assertEqual(cls, WORKER)
        n = len(svc.CONSTRUCTION_CLASSES)
        expected = 1.0 / (1.0 + (n - 1) * np.exp(-20.0))
        self.assertAlmostEqual(conf, expected, places=12)

    def test_classify_crop_tie_gives_first_class_and_uniform_confidence(self):
        idx = _prompt_class_idx()
        svc._clip_preprocess = lambda img: FakeTensor([1.0, 0.0])
        svc._clip_model = types.SimpleNamespace(encode_image=lambda t: t)
        svc._clip_text_features = (FakeTensor([[1.0, 0.0]] * len(idx)), idx)
        cls, conf = svc._classify_crop(Image.new("RGB", (4, 4)))
        self.assertEqual(cls, 0)
        self.assertAlmostEqual(conf, 1.0 / len(svc.CONSTRUCTION_CLASSES))


class CheckpointAndLoadingTests(ServiceTestBase):
    def test_existing_checkpoint_is_not_downloaded(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            path = f.name
        try:
            with mock.patch.object(svc, "SAM_CHECKPOINT_PATH", path), \
                    mock.patch.object(svc.urllib.request, "urlretrieve") as dl:
                svc._ensure_checkpoint_available()
            dl.assert_not_called()
        finally:
            os.remove(path)

    def test_missing_checkpoint_is_downloaded(self):
        with mock.patch.object(svc, "SAM_CHECKPOINT_PATH", "/nonexistent/sam.pth"), \
                mock.patch.object(svc.urllib.request, "urlretrieve") as dl:
            svc._ensure_checkpoint_available()
        dl.assert_called_once_with(svc.SAM_CHECKPOINT_URL, "/nonexistent/sam.pth")

    def test_download_failure_raises_runtime_error(self):
        with mock.patch.object(svc, "SAM_CHECKPOINT_PATH", "/nonexistent/sam.pth"), \
                mock.patch.object(svc.urllib.request, "urlretrieve", side_effect=OSError("offline")):
            with self.assertRaises(RuntimeError) as ctx:
                svc._ensure_checkpoint_available()
        self.assertIn("auto-download failed: offline", str(ctx.exception))
        self.assertIn("SAM_CHECKPOINT_PATH", str(ctx.exception))

    def test_lazy_loader_builds_sam_and_clip_text_features(self):
        sam_model = mock.MagicMock()
        sam_mod = types.ModuleType("segment_anything")
        sam_mod.sam_model_registry = {"vit_b": mock.MagicMock(return_value=sam_model)}
        sam_mod.SamAutomaticMaskGenerator = mock.MagicMock(return_value="GENERATOR")

        prompts_seen = []

        def tokenizer(prompts):
            prompts_seen.extend(prompts)
            return FakeTensor(np.ones((len(prompts), 2)) * [3.0, 4.0])

        clip_model = mock.MagicMock()
        clip_model.to.return_value = clip_model
        clip_model.encode_text.side_effect = lambda t: t
        clip_mod = types.ModuleType("open_clip")
        clip_mod.create_model_and_transforms = mock.MagicMock(return_value=(clip_model, None, "PREPROCESS"))
        clip_mod.get_tokenizer = mock.MagicMock(return_value=tokenizer)

        with mock.patch.dict(sys.modules, {"segment_anything": sam_mod, "open_clip": clip_mod}), \
                mock.patch.object(svc, "_ensure_checkpoint_available") as ckpt:
            svc._ensure_models_loaded()
            svc._ensure_models_loaded()  # second call is a no-op

        ckpt.assert_called_once()
        sam_mod.sam_model_registry["vit_b"].assert_called_once_with(checkpoint=svc.SAM_CHECKPOINT_PATH)
        sam_model.to.assert_called_once_with(device=svc.DEVICE)
        self.assertEqual(sam_mod.SamAutomaticMaskGenerator.call_args.kwargs["points_per_side"], 16)
        self.assertEqual(svc._sam_generator, "GENERATOR")
        self.assertEqual(svc._clip_preprocess, "PREPROCESS")
        clip_model.eval.assert_called_once()
        all_prompts = [p for c in svc.CONSTRUCTION_CLASSES for p in c["prompts"]]
        self.assertEqual(prompts_seen, all_prompts)
        feats, idx = svc._clip_text_features
        np.testing.assert_allclose(feats.numpy(), np.tile([0.6, 0.8], (len(all_prompts), 1)))  # normalised
        np.testing.assert_array_equal(idx, _prompt_class_idx())


class RunSegmentationTests(ServiceTestBase):
    def test_masks_overlay_and_skips_degenerate_boxes(self):
        img = Image.new("RGB", (8, 4), (0, 0, 0))
        sam = self._ready(lambda a: [
            _mask(4, 8, (0, 0, 2, 2)),
            {"segmentation": np.zeros((4, 8), bool), "bbox": [8, 0, 3, 3], "area": 0},  # x1 <= x0
            {"segmentation": np.zeros((4, 8), bool), "bbox": [1, 1, 0, 2], "area": 0},  # zero width
        ])
        out = svc.run_segmentation(img)
        self.assertEqual(sam.calls, [(4, 8, 3)])
        self.assertEqual((out["image_width"], out["image_height"], out["num_masks"]), (8, 4, 1))
        m = out["masks"][0]
        worker = svc.CONSTRUCTION_CLASSES[WORKER]
        self.assertEqual((m["mask_id"], m["class_key"], m["class_id"], m["color"]), (0, "worker", 7, worker["color"]))
        self.assertEqual((m["area"], m["bbox"], m["iou_score"]), (4, [0, 0, 2, 2], 0.9123))
        self.assertEqual(len(m["segmentation"]), 32)
        self.assertEqual(sum(m["segmentation"]), 4)
        self.assertTrue(m["segmentation"][0] and m["segmentation"][9] and not m["segmentation"][2])
        self.assertEqual([c["key"] for c in out["present_classes"]], ["worker"])

        overlay = np.array(Image.open(io.BytesIO(base64.b64decode(out["overlay_base64"]))))
        # Masked pixel = 50% black + 50% class colour; unmasked stays black.
        np.testing.assert_array_equal(overlay[0, 0], (np.array(worker["color"]) * 0.5).astype(np.uint8))
        np.testing.assert_array_equal(overlay[3, 7], [0, 0, 0])

    def test_large_image_is_downscaled_before_sam_and_overlay_optional(self):
        sam = self._ready([])
        out = svc.run_segmentation(Image.new("L", (1000, 500)), return_overlay=False)
        self.assertEqual(sam.calls, [(192, 384, 3)])  # converted to RGB too
        self.assertEqual((out["image_width"], out["image_height"]), (384, 192))
        self.assertIsNone(out["overlay_base64"])
        self.assertEqual((out["masks"], out["present_classes"], out["num_masks"]), ([], [], 0))

    def test_bbox_is_clipped_to_image(self):
        self._ready(lambda a: [_mask(4, 8, (6, 2, 10, 10))])
        with mock.patch.object(svc, "_classify_crop", wraps=svc._classify_crop) as cls:
            out = svc.run_segmentation(Image.new("RGB", (8, 4)))
        self.assertEqual(cls.call_args.args[0].size, (2, 2))
        self.assertEqual(out["masks"][0]["bbox"], [6, 2, 10, 10])  # reported as SAM gave it


class EndpointTests(ServiceTestBase):
    def test_health_ok(self):
        self._ready()
        with mock.patch.object(svc, "_ensure_checkpoint_available"):
            r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "ok", "device": svc.DEVICE, "model_ready": True,
                                    "checkpoint": svc.SAM_CHECKPOINT_PATH})

    def test_health_degraded_when_checkpoint_missing(self):
        with mock.patch.object(svc, "_ensure_checkpoint_available", side_effect=RuntimeError("no ckpt")):
            r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["status"], r.json()["model_ready"], r.json()["error"]),
                         ("degraded", False, "no ckpt"))

    def test_health_degraded_when_ml_package_missing(self):
        """Regression: an ImportError (segment_anything not installed) was a 500."""
        with mock.patch.object(svc, "_ensure_checkpoint_available"), \
                mock.patch.object(svc, "_ensure_models_loaded", side_effect=ImportError("No module named 'x'")):
            r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "degraded")

    def test_segment_upload(self):
        self._ready(lambda a: [_mask(a.shape[0], a.shape[1], (0, 0, 4, 4))])
        r = self.client.post("/segment", files={"file": ("a.png", _png_bytes(), "image/png")})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual((body["image_width"], body["image_height"], body["num_masks"]), (40, 20, 1))
        self.assertIsNotNone(body["overlay_base64"])
        r = self.client.post("/segment?return_overlay=false", files={"file": ("a.jpg", _png_bytes(fmt="JPEG"))})
        self.assertIsNone(r.json()["overlay_base64"])

    def test_segment_requires_file(self):
        self.assertEqual(self.client.post("/segment").status_code, 422)

    def test_segment_invalid_image_is_400(self):
        r = self.client.post("/segment", files={"file": ("a.png", b"not an image")})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(r.json()["detail"].startswith("Invalid image:"))

    def test_segment_truncated_image_is_400(self):
        """Regression: a PNG cut short passed Image.open (lazy) and crashed
        later in convert() with a 500."""
        self._ready()
        data = _png_bytes((64, 64), (10, 200, 30))
        r = self.client.post("/segment", files={"file": ("a.png", data[: len(data) // 2])})
        self.assertEqual(r.status_code, 400)

    def test_segment_model_unavailable_is_503(self):
        with mock.patch.object(svc, "run_segmentation", side_effect=RuntimeError("checkpoint missing")):
            r = self.client.post("/segment", files={"file": ("a.png", _png_bytes())})
        self.assertEqual((r.status_code, r.json()["detail"]), (503, "checkpoint missing"))

    def test_segment_base64_plain_and_data_url(self):
        self._ready()
        raw = base64.b64encode(_png_bytes((10, 6))).decode()
        for payload in (raw, "data:image/png;base64," + raw, "  data:image/png;base64," + raw):
            r = self.client.post("/segment/base64", json={"image_base64": payload})
            self.assertEqual(r.status_code, 200, payload[:30])
            self.assertEqual((r.json()["image_width"], r.json()["image_height"]), (10, 6))
        r = self.client.post("/segment/base64", json={"image_base64": raw, "return_overlay": False})
        self.assertIsNone(r.json()["overlay_base64"])

    def test_segment_base64_errors(self):
        r = self.client.post("/segment/base64", json={"image_base64": "%%%not-base64"})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(r.json()["detail"].startswith("Invalid base64 image:"))
        r = self.client.post("/segment/base64", json={"image_base64": base64.b64encode(b"text").decode()})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.post("/segment/base64", json={}).status_code, 422)
        with mock.patch.object(svc, "run_segmentation", side_effect=RuntimeError("down")):
            r = self.client.post("/segment/base64",
                                 json={"image_base64": base64.b64encode(_png_bytes()).decode()})
        self.assertEqual(r.status_code, 503)

    def test_cors(self):
        r = self.client.options("/segment", headers={
            "Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
        self.assertEqual(r.headers.get("access-control-allow-origin"), "http://localhost:3000")
        r = self.client.options("/segment", headers={
            "Origin": "http://127.0.0.1:4321", "Access-Control-Request-Method": "POST"})
        self.assertEqual(r.headers.get("access-control-allow-origin"), "http://127.0.0.1:4321")
        r = self.client.options("/segment", headers={
            "Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertIsNone(r.headers.get("access-control-allow-origin"))


if __name__ == "__main__":
    unittest.main()
