/**
 * SegmentationButton.jsx
 *
 * Usage:
 *   const { toggleSegmentation, isSegmented, wasCompressed, pcModel } =
 *         useModelLoader(sceneData, props);
 *
 *   <SegmentationButton
 *     onToggle={toggleSegmentation}
 *     active={isSegmented}
 *     disabled={!pcModel}
 *     wasCompressed={wasCompressed}
 *   />
 *
 * Behaviour:
 *   • On first click  → replaces point-cloud colours with spatial segments.
 *   • On second click → restores exact original colours from the loaded file.
 *   • The point cloud always loads with its original colours — this button is
 *     the ONLY thing that triggers a colour change.
 */

import React from "react";

export default function SegmentationButton({
  onToggle,
  active = false,
  disabled = false,
  wasCompressed = false,
}) {
  return (
    <div style={styles.wrapper}>
      <button
        onClick={onToggle}
        disabled={disabled}
        title={
          disabled
            ? "Load a point cloud first"
            : active
              ? "Restore original colours"
              : "Show spatial segmentation"
        }
        style={{
          ...styles.btn,
          ...(active ? styles.btnActive : {}),
          ...(disabled ? styles.btnDisabled : {}),
        }}
      >
        {/* 4-quadrant icon */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ marginRight: 6, flexShrink: 0 }}
        >
          <rect
            x="1"
            y="1"
            width="6"
            height="6"
            rx="1"
            fill={active ? "#f43f5e" : "#64748b"}
          />
          <rect
            x="9"
            y="1"
            width="6"
            height="6"
            rx="1"
            fill={active ? "#3b82f6" : "#64748b"}
          />
          <rect
            x="1"
            y="9"
            width="6"
            height="6"
            rx="1"
            fill={active ? "#22c55e" : "#64748b"}
          />
          <rect
            x="9"
            y="9"
            width="6"
            height="6"
            rx="1"
            fill={active ? "#f59e0b" : "#64748b"}
          />
        </svg>

        {active ? "Hide Segments" : "Show Segments"}
      </button>

      {wasCompressed && (
        <span
          style={styles.badge}
          title="File exceeded 700 MB — point cloud was subsampled to 70% for performance"
        >
          ⚡ Compressed
        </span>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  btnActive: {
    background: "#0f172a",
    borderColor: "#6366f1",
    color: "#a5b4fc",
    boxShadow: "0 0 0 2px rgba(99,102,241,0.35)",
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#fbbf24",
    background: "rgba(251,191,36,0.10)",
    border: "1px solid rgba(251,191,36,0.28)",
    borderRadius: 4,
    padding: "2px 7px",
    whiteSpace: "nowrap",
    cursor: "default",
  },
};
