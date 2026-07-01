import React from "react";

const AXIS_COLORS = { x: "#dc2626", y: "#16a34a", z: "#2563eb" };

function NumberStepper({ value, step, color, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(value - step)}
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: "4px 6px",
          fontSize: 10,
          color: "#64748b",
        }}
      >
        ▼
      </button>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          minWidth: 48,
          textAlign: "center",
          color: "#0f172a",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toFixed(2)}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + step)}
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: "4px 6px",
          fontSize: 10,
          color: "#64748b",
        }}
      >
        ▲
      </button>
    </div>
  );
}

function AxisControls({ axis, bounds, clip, setAxisClip }) {
  const [bLo, bHi] = bounds[axis];
  const [lo, hi] = clip[axis];
  const range = bHi - bLo || 1;
  const step = range / 200;
  const color = AXIS_COLORS[axis];

  const slider = (which, value) => (
    <input
      type="range"
      min={bLo}
      max={bHi}
      step={step}
      value={value}
      onChange={(e) => setAxisClip(axis, which, e.target.value)}
      style={{ width: 110, accentColor: color, cursor: "pointer" }}
    />
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color }}>
        {axis.toUpperCase()}
      </span>
      <NumberStepper
        value={lo}
        step={step * 5}
        color={color}
        onChange={(v) => setAxisClip(axis, 0, v)}
      />
      {slider(0, lo)}
      {slider(1, hi)}
      <NumberStepper
        value={hi}
        step={step * 5}
        color={color}
        onChange={(v) => setAxisClip(axis, 1, v)}
      />
    </div>
  );
}

/**
 * Bottom CLIP bar (inspired by IFCtoFDS): min/max clipping per axis with
 * paired sliders and numeric steppers, plus Reset.
 */
export default function ClipBar({
  bounds,
  clip,
  setAxisClip,
  reset,
  boxVisible = true,
  setBoxVisible,
}) {
  if (!bounds || !clip) return null;

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 16,
  };
  const labelStyle = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "#0f172a",
    width: 34,
    flexShrink: 0,
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
        // Two-row layout so it stays compact instead of one very wide bar.
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 18px",
        borderRadius: 14,
        background: "rgba(255,255,255,0.96)",
        border: "1px solid rgba(148,163,184,0.32)",
        boxShadow: "0 20px 40px rgba(15, 23, 42, 0.14)",
        pointerEvents: "auto",
        maxWidth: "calc(100% - 48px)",
        overflowX: "auto",
      }}
    >
      {/* Row 1: CLIP label + X + Y */}
      <div style={rowStyle}>
        <span style={labelStyle}>CLIP</span>
        <AxisControls axis="x" bounds={bounds} clip={clip} setAxisClip={setAxisClip} />
        <AxisControls axis="y" bounds={bounds} clip={clip} setAxisClip={setAxisClip} />
      </div>

      {/* Row 2: Z + Show box toggle + Reset */}
      <div style={rowStyle}>
        <span style={labelStyle} />
        <AxisControls axis="z" bounds={bounds} clip={clip} setAxisClip={setAxisClip} />
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {setBoxVisible && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: "#475569",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title="Hide the blue box but keep the clipping"
            >
              <input
                type="checkbox"
                checked={boxVisible}
                onChange={(e) => setBoxVisible(e.target.checked)}
              />
              Show box
            </label>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
