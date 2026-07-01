useConstructionSegmentation.js;

/**
 * useConstructionSegmentation.js
 *
 * Replaces the old rule-based pixel-scoring approach with real
 * SAM ViT-B + CLIP zero-shot segmentation via the Python backend.
 *
 * Backend endpoints (segmentation_service.py):
 *   POST /segment        — multipart file upload
 *   POST /segment/base64 — JSON { image_base64, return_overlay }
 *   GET  /health         — liveness check
 *
 * Exported hook:
 *   const { segmentImage, segmentImageUrl, isLoading, error, result } =
 *     useConstructionSegmentation(options?)
 *
 * `result` shape:
 *   {
 *     overlayDataUrl : string,          // blended PNG (base64 data-URI)
 *     presentClasses : ClassInfo[],     // unique detected classes
 *     masks          : MaskResult[],    // per-mask details
 *     imageWidth     : number,
 *     imageHeight    : number,
 *   }
 */

import { useState, useCallback, useRef } from "react";

// ── Default config ────────────────────────────────────────────────────────────
const DEFAULT_OPTIONS = {
  /** Base URL of segmentation_service.py */
  serviceUrl: "http://localhost:8001",

  /** Request a blended overlay PNG from the backend */
  returnOverlay: true,

  /**
   * If true, also draw masks locally on a <canvas> using the segmentation
   * boolean arrays (useful when you want custom styling client-side).
   * Requires passing a targetCanvas ref via segmentImage().
   */
  renderLocally: false,

  /** Overlay opacity for local canvas rendering (0–1) */
  localAlpha: 0.55,
};

// ── Class colour map (mirrors Python service) ─────────────────────────────────
// Kept here so the UI can reference colours without waiting for the API.
export const CONSTRUCTION_CLASSES = {
  sky: { id: 0, label: "Sky", color: [135, 206, 235], emoji: "🌤" },
  ground: {
    id: 1,
    label: "Ground / Soil / Mud",
    color: [101, 67, 33],
    emoji: "🟫",
  },
  concrete: {
    id: 2,
    label: "Concrete / Cement",
    color: [169, 169, 169],
    emoji: "🪨",
  },
  structure: {
    id: 3,
    label: "Structure / Walls",
    color: [70, 100, 160],
    emoji: "🏗",
  },
  scaffolding: {
    id: 4,
    label: "Scaffolding / Steel",
    color: [220, 120, 30],
    emoji: "🔩",
  },
  rebar: {
    id: 5,
    label: "Rebar / Metal Rods",
    color: [160, 60, 20],
    emoji: "📏",
  },
  equipment: {
    id: 6,
    label: "Equipment / Machinery",
    color: [230, 190, 0],
    emoji: "🚧",
  },
  worker: {
    id: 7,
    label: "Worker / Person",
    color: [210, 40, 40],
    emoji: "👷",
  },
};

// ── Utility: draw masks onto a canvas element ─────────────────────────────────
function renderMasksToCanvas(
  canvas,
  masks,
  imageWidth,
  imageHeight,
  alpha = 0.55,
) {
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, imageWidth, imageHeight);

  for (const mask of masks) {
    const [r, g, b] = mask.color;
    const imageData = ctx.createImageData(imageWidth, imageHeight);
    const segFlat = mask.segmentation; // flat boolean array

    for (let i = 0; i < segFlat.length; i++) {
      if (segFlat[i]) {
        imageData.data[i * 4] = r;
        imageData.data[i * 4 + 1] = g;
        imageData.data[i * 4 + 2] = b;
        imageData.data[i * 4 + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // White boundary lines between adjacent different-class pixels
  const labelMap = new Uint8Array(imageWidth * imageHeight);
  for (const mask of masks) {
    const seg = mask.segmentation;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i]) labelMap[i] = mask.class_id;
    }
  }
  const borderData = ctx.createImageData(imageWidth, imageHeight);
  for (let y = 0; y < imageHeight - 1; y++) {
    for (let x = 0; x < imageWidth - 1; x++) {
      const i = y * imageWidth + x;
      if (
        labelMap[i] !== labelMap[i + 1] ||
        labelMap[i] !== labelMap[i + imageWidth]
      ) {
        borderData.data[i * 4] = 255;
        borderData.data[i * 4 + 1] = 255;
        borderData.data[i * 4 + 2] = 255;
        borderData.data[i * 4 + 3] = 180;
      }
    }
  }
  ctx.putImageData(borderData, 0, 0);
}

// ── Internal: call the segmentation API ──────────────────────────────────────
async function callSegmentationApi(serviceUrl, payload, signal) {
  const isFile = payload instanceof File || payload instanceof Blob;

  let url, init;

  if (isFile) {
    // Multipart upload
    const form = new FormData();
    form.append("file", payload, payload.name ?? "image.jpg");
    url = `${serviceUrl}/segment?return_overlay=true`;
    init = { method: "POST", body: form, signal };
  } else {
    // base64 JSON
    url = `${serviceUrl}/segment/base64`;
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: payload,
        return_overlay: true,
      }),
      signal,
    };
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Segmentation API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Internal: convert URL → base64 string ────────────────────────────────────
async function urlToBase64(imageUrl) {
  const res = await fetch(imageUrl);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // full data-URI
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Internal: normalize raw API response → clean result object ───────────────
function normalizeResult(apiData) {
  return {
    overlayDataUrl: apiData.overlay_base64
      ? `data:image/png;base64,${apiData.overlay_base64}`
      : null,
    presentClasses: (apiData.present_classes ?? []).map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      emoji: c.emoji,
      color: c.color,
    })),
    masks: (apiData.masks ?? []).map((m) => ({
      maskId: m.mask_id,
      classId: m.class_id,
      classKey: m.class_key,
      classLabel: m.class_label,
      emoji: m.emoji,
      color: m.color,
      confidence: m.confidence,
      area: m.area,
      bbox: m.bbox,
      iouScore: m.iou_score,
      segmentation: m.segmentation, // flat bool array
    })),
    imageWidth: apiData.image_width,
    imageHeight: apiData.image_height,
    numMasks: apiData.num_masks,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────
/**
 * @param {Partial<typeof DEFAULT_OPTIONS>} options
 */
export function useConstructionSegmentation(options = {}) {
  const cfg = { ...DEFAULT_OPTIONS, ...options };

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null); // e.g. "Running SAM…"
  const abortRef = useRef(null);

  // ── Cancel any in-flight request ─────────────────────────────────────────
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setProgress(null);
  }, []);

  // ── Core segmentation runner ──────────────────────────────────────────────
  /**
   * @param {File | Blob | string} source
   *   - File/Blob  → sent as multipart
   *   - string     → treated as base64 data-URI or plain base64
   * @param {HTMLCanvasElement | null} targetCanvas
   *   Optional canvas to render masks onto (requires renderLocally: true in options)
   */
  const segmentImage = useCallback(
    async (source, targetCanvas = null) => {
      // Cancel any previous run
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);
      setResult(null);
      setProgress("Sending image to segmentation service…");

      try {
        const apiData = await callSegmentationApi(
          cfg.serviceUrl,
          source,
          controller.signal,
        );

        setProgress("Processing masks…");
        const normalized = normalizeResult(apiData);

        // Optional local canvas render
        if (cfg.renderLocally && targetCanvas) {
          renderMasksToCanvas(
            targetCanvas,
            normalized.masks,
            normalized.imageWidth,
            normalized.imageHeight,
            cfg.localAlpha,
          );
        }

        setResult(normalized);
        return normalized;
      } catch (err) {
        if (err.name === "AbortError") return null; // user cancelled
        const message = err.message ?? "Unknown segmentation error";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
        setProgress(null);
        abortRef.current = null;
      }
    },
    [cfg.serviceUrl, cfg.renderLocally, cfg.localAlpha],
  );

  // ── Convenience wrapper: URL → segmentation ───────────────────────────────
  /**
   * @param {string} imageUrl  – any URL accessible by the browser
   * @param {HTMLCanvasElement | null} targetCanvas
   */
  const segmentImageUrl = useCallback(
    async (imageUrl, targetCanvas = null) => {
      setProgress("Fetching image…");
      const base64 = await urlToBase64(imageUrl);
      return segmentImage(base64, targetCanvas);
    },
    [segmentImage],
  );

  // ── Health-check helper ───────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${cfg.serviceUrl}/health`);
      const data = await res.json();
      return data.status === "ok";
    } catch {
      return false;
    }
  }, [cfg.serviceUrl]);

  return {
    // Actions
    segmentImage,
    segmentImageUrl,
    cancel,
    checkHealth,

    // State
    isLoading,
    error,
    result,
    progress,

    // Expose class map for UI consumption
    CONSTRUCTION_CLASSES,
  };
}

// ── Named export of the standalone render helper ──────────────────────────────
export { renderMasksToCanvas };
