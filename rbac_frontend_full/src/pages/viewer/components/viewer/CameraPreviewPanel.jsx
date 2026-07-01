CameraPreviewPanel.js;

import { useEffect, useRef, useState, useCallback } from "react";
import {
  useConstructionSegmentation,
  CONSTRUCTION_CLASSES,
} from "./useConstructionSegmentation";

const PANEL_W = 360;
const PHOTO_H = 220;
const VIEW_H = 200;

// ── Spinning loader SVG ───────────────────────────────────────────────────
const Spinner = ({ size = 14, color = "#f97316" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    style={{ animation: "cspin 0.85s linear infinite" }}
  >
    <style>{`@keyframes cspin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="12" cy="12" r="9" strokeDasharray="40" strokeDashoffset="14" />
  </svg>
);

// ── Small icon button ─────────────────────────────────────────────────────
function IconBtn({
  onClick,
  title,
  children,
  active = false,
  disabled = false,
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: active ? "rgba(249,115,22,0.20)" : "rgba(0,0,0,0.55)",
        border: `1px solid ${active ? "rgba(249,115,22,0.60)" : "rgba(255,255,255,0.16)"}`,
        borderRadius: 6,
        width: 30,
        height: 30,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ── Class legend pill ─────────────────────────────────────────────────────
function ClassPill({ cls, faded = false }) {
  const [r, g, b] = cls.color;
  return (
    <div
      title={cls.label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 20,
        background: `rgba(${r},${g},${b},${faded ? 0.08 : 0.2})`,
        border: `1px solid rgba(${r},${g},${b},${faded ? 0.2 : 0.5})`,
        opacity: faded ? 0.38 : 1,
        transition: "opacity 0.2s",
      }}
    >
      <div
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          flexShrink: 0,
          background: `rgb(${r},${g},${b})`,
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: "#cbd5e1",
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {cls.emoji} {cls.label}
      </span>
    </div>
  );
}

// ── Per-session segmentation cache ───────────────────────────────────────
const SEG_CACHE = {};

export default function CameraPreviewPanel({
  selectedCamera,
  setSelectedCamera,
  previewCanvasRef,
  handleManualCameraImageUpload,
}) {
  const [visible, setVisible] = useState(false);
  const [viewMode, setViewMode] = useState("original"); // "original" | "segmented"
  const [segState, setSegState] = useState("idle"); // "idle"|"processing"|"done"|"error"
  const [segData, setSegData] = useState(null);
  const [segError, setSegError] = useState(null);
  const abortRef = useRef(false);

  const {
    segmentImageUrl,
    isLoading,
    result: hookResult,
  } = useConstructionSegmentation({
    serviceUrl: "http://localhost:8001",
  });

  // ── Reset when camera changes ─────────────────────────────────────────
  useEffect(() => {
    abortRef.current = true;
    setViewMode("original");
    setSegState("idle");
    setSegData(null);
    setSegError(null);
    setVisible(!!selectedCamera);
    setTimeout(() => {
      abortRef.current = false;
    }, 60);
  }, [selectedCamera?.name]);

  // ── Run segmentation ──────────────────────────────────────────────────
  const runSegmentation = useCallback(async () => {
    const url = selectedCamera?.image;
    if (!url) return;

    if (SEG_CACHE[url]) {
      setSegData(SEG_CACHE[url]);
      setSegState("done");
      setViewMode("segmented");
      return;
    }

    setSegState("processing");
    setSegError(null);
    abortRef.current = false;

    try {
      const result = await segmentImageUrl(url); // now calls the hook method
      if (abortRef.current) return;

      // normalize: hook returns { overlayDataUrl, presentClasses, masks }
      // panel expects { dataUrl, presentClasses }
      const normalized = {
        dataUrl: result.overlayDataUrl,
        presentClasses: result.presentClasses,
      };

      SEG_CACHE[url] = normalized;
      setSegData(normalized);
      setSegState("done");
      setViewMode("segmented");
    } catch (err) {
      if (abortRef.current) return;
      setSegError(err.message || "Segmentation failed");
      setSegState("error");
    }
  }, [selectedCamera?.image, segmentImageUrl]);

  // ── Toggle ────────────────────────────────────────────────────────────
  const handleToggle = useCallback(() => {
    if (viewMode === "segmented") {
      setViewMode("original");
      return;
    }
    if (segState === "done" && segData) {
      setViewMode("segmented");
      return;
    }
    runSegmentation();
  }, [viewMode, segState, segData, runSegmentation]);

  // ── Download 3-D view ─────────────────────────────────────────────────
  const handleDownload3DView = () => {
    const canvas = previewCanvasRef?.current;
    if (!canvas) return;
    requestAnimationFrame(() => {
      try {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${selectedCamera?.name || "camera"}-3d.png`;
        a.click();
      } catch (e) {
        console.error(e);
      }
    });
  };

  if (!selectedCamera || !visible) return null;

  const hasImage = !!selectedCamera.image;
  const awaitingImage = !!selectedCamera.awaitingImage;
  const isSegmented = viewMode === "segmented";
  const isProcessing = segState === "processing";
  const displayImage =
    isSegmented && segData ? segData.dataUrl : selectedCamera.image;

  // All classes for full legend reference
  const allClasses = Object.values(CONSTRUCTION_CLASSES);

  const presentIds = new Set((segData?.presentClasses || []).map((c) => c.id));

  return (
    <div
      id="camera-preview"
      style={{
        position: "fixed",
        top: "10px",
        right: "10px",
        width: PANEL_W,
        zIndex: 9999,
        background: "rgba(8,8,14,0.97)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.90)",
        overflow: "hidden",
        userSelect: "none",
        fontFamily: "system-ui,sans-serif",
      }}
    >
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9px 12px",
          background: "rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Camera name */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={awaitingImage ? "#06b6d4" : "#f97316"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span
            style={{
              color: "#e2e8f0",
              fontSize: 12,
              fontWeight: 600,
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedCamera.name}
            {awaitingImage && (
              <span style={{ color: "#06b6d4", marginLeft: 6, fontSize: 10 }}>
                • Manual
              </span>
            )}
          </span>
        </div>

        {/* Right controls */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {hasImage && !awaitingImage && (
            <IconBtn
              onClick={handleToggle}
              title={
                isSegmented ? "Show original" : "Run construction segmentation"
              }
              active={isSegmented}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Spinner size={14} color="#f97316" />
              ) : (
                /* construction / segment icon */
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isSegmented ? "#f97316" : "#64748b"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 3h7v7H3z" />
                  <path d="M14 3h7v7h-7z" />
                  <path d="M14 14h7v7h-7z" />
                  <path d="M3 14h7v7H3z" />
                </svg>
              )}
            </IconBtn>
          )}

          <button
            onClick={() => setSelectedCamera(null)}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.11)",
              borderRadius: 6,
              color: "#94a3b8",
              cursor: "pointer",
              width: 26,
              height: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Awaiting image ────────────────────────────────────────────────── */}
      {awaitingImage ? (
        <div
          style={{
            padding: "28px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 36 }}>📷</div>
          <div
            style={{
              color: "#cbd5e1",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Upload an image for this camera
          </div>
          <div style={{ color: "#94a3b8", fontSize: 11, textAlign: "center" }}>
            Supports JPG, PNG, WEBP — construction site photos recommended
          </div>
          <input
            id="manualCamImageInput"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              handleManualCameraImageUpload?.(file, selectedCamera.name);
              const url = URL.createObjectURL(file);
              setSelectedCamera((prev) => ({
                ...prev,
                image: url,
                awaitingImage: false,
              }));
              e.target.value = "";
            }}
          />
          <div
            onClick={() =>
              document.getElementById("manualCamImageInput").click()
            }
            style={{
              border: "2px dashed #06b6d4",
              borderRadius: 10,
              padding: "18px 32px",
              cursor: "pointer",
              textAlign: "center",
              color: "#06b6d4",
              fontSize: 13,
              fontWeight: 600,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            📁 Click to browse image
          </div>
        </div>
      ) : (
        <>
          {/* ── Photo header with toggle pill ─────────────────────────── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 10px",
              background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "#94a3b8",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              PHOTO
            </span>

            {hasImage && (
              <div
                style={{
                  display: "flex",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 20,
                  padding: "2px 3px",
                  gap: 2,
                }}
              >
                {[
                  { key: "original", label: "Original" },
                  {
                    key: "segmented",
                    label: isProcessing ? "Processing…" : "Segmented",
                  },
                ].map(({ key, label }) => {
                  const isCurrent = viewMode === key;
                  const isSegBtn = key === "segmented";
                  return (
                    <button
                      key={key}
                      disabled={isProcessing && isSegBtn}
                      onClick={() =>
                        key === "original"
                          ? setViewMode("original")
                          : handleToggle()
                      }
                      style={{
                        background: isCurrent
                          ? "rgba(249,115,22,0.25)"
                          : "transparent",
                        border: `1px solid ${isCurrent ? "rgba(249,115,22,0.55)" : "transparent"}`,
                        borderRadius: 16,
                        color: isCurrent ? "#fb923c" : "#475569",
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 9px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {isSegBtn && isProcessing && (
                        <Spinner size={9} color="#fb923c" />
                      )}
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Error banner */}
          {segState === "error" && (
            <div
              style={{
                background: "rgba(220,38,38,0.12)",
                borderBottom: "1px solid rgba(220,38,38,0.28)",
                padding: "6px 12px",
                fontSize: 11,
                color: "#fca5a5",
              }}
            >
              ⚠ {segError} —{" "}
              <span
                onClick={runSegmentation}
                style={{ textDecoration: "underline", cursor: "pointer" }}
              >
                retry
              </span>
            </div>
          )}

          {/* ── Image area ───────────────────────────────────────────────── */}
          <div
            style={{
              width: PANEL_W,
              height: PHOTO_H,
              background: "#050508",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              position: "relative",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {hasImage ? (
              <>
                <img
                  src={displayImage}
                  alt="cam"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />

                {/* Processing overlay */}
                {isProcessing && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(0,0,0,0.68)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                    }}
                  >
                    <Spinner size={36} color="#f97316" />
                    <span
                      style={{
                        color: "#fb923c",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      Analysing construction scene…
                    </span>
                    <span style={{ color: "#475569", fontSize: 10 }}>
                      Classifying structural elements
                    </span>
                  </div>
                )}

                {/* Segmented badge */}
                {isSegmented && !isProcessing && (
                  <div
                    style={{
                      position: "absolute",
                      top: 7,
                      left: 7,
                      background: "rgba(0,0,0,0.68)",
                      border: "1px solid rgba(249,115,22,0.45)",
                      borderRadius: 20,
                      padding: "3px 10px",
                      fontSize: 10,
                      color: "#fb923c",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#f97316",
                      }}
                    />
                    Segmentated
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", color: "#1e293b" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
                <div style={{ fontSize: 11 }}>
                  No image uploaded for this camera
                </div>
              </div>
            )}
          </div>

          {/* ── Construction class legend ─────────────────────────────────── */}
          {isSegmented && segData && (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(249,115,22,0.05)",
                borderBottom: "1px solid rgba(249,115,22,0.12)",
              }}
            >
              {/* Legend header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "#fb923c",
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                  }}
                >
                  🏗 CONSTRUCTION CLASSES
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#7c3f10",
                    fontFamily: "monospace",
                  }}
                >
                  {segData.presentClasses.length} / {allClasses.length} detected
                </span>
              </div>

              {/* Detected classes (highlighted) */}
              {segData.presentClasses.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 5,
                    marginBottom: 6,
                  }}
                >
                  {segData.presentClasses.map((cls) => (
                    <ClassPill key={cls.id} cls={cls} />
                  ))}
                </div>
              )}

              {/* Expandable: full palette */}
              <details>
                <summary
                  style={{
                    fontSize: 10,
                    color: "#7c3f10",
                    cursor: "pointer",
                    listStyle: "none",
                    userSelect: "none",
                    marginTop: 2,
                  }}
                >
                  ▸ All classes reference
                </summary>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 7,
                  }}
                >
                  {allClasses.map((cls) => (
                    <ClassPill
                      key={cls.id}
                      cls={cls}
                      faded={!presentIds.has(cls.id)}
                    />
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* ── 3D preview ───────────────────────────────────────────────── */}
          <div
            style={{
              padding: "4px 10px",
              fontSize: 10,
              color: "#94a3b8",
              letterSpacing: "0.08em",
              fontWeight: 600,
              background: "rgba(255,255,255,0.02)",
            }}
          >
            3D VIEW
          </div>

          <div
            style={{
              width: PANEL_W,
              height: VIEW_H,
              background: "#050508",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}>
              <IconBtn onClick={handleDownload3DView} title="Download 3D view">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </IconBtn>
            </div>
            <canvas
              ref={previewCanvasRef}
              width={PANEL_W}
              height={VIEW_H}
              style={{ width: PANEL_W, height: VIEW_H }}
            />
          </div>
        </>
      )}
    </div>
  );
}
