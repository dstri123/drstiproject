import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { viridisColor } from "../../enhancements/utils/colormap.js";

// Small chart of one Camera Data column, one point/bar per camera.
// Colours use the same viridis mapping as colorCamerasByColumn, so the chart
// matches the colour of each camera dot in the 3D view.
//   "line" — smooth ECG-style wave, stroke coloured by value, sweeps in.
//   "bar"  — one bar per camera.
const WIDTH = 332;
const HEIGHT = 120;
const PAD = { top: 8, right: 6, bottom: 6, left: 36 };
const GRADIENT_STOPS = [0, 0.25, 0.5, 0.75, 1];

const fmt = (v) =>
  Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)
    ? v.toExponential(1)
    : +v.toFixed(2);

// Monotone cubic (Fritsch–Carlson) path: smooth like a wave, but never
// overshoots above/below the actual data points.
function smoothPath(pts) {
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const n = pts.length;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const m = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m[i] =
      slope[i - 1] * slope[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) /
          ((2 * dx[i] + dx[i - 1]) / slope[i - 1] +
            (dx[i] + 2 * dx[i - 1]) / slope[i]);
  }
  m[n - 1] = slope[n - 2];

  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

const toggleBtn = (active) => ({
  padding: "2px 8px",
  fontSize: 10,
  fontWeight: 700,
  border: "none",
  borderRadius: 6,
  background: active ? "#fff" : "transparent",
  color: active ? "#0F172A" : "#64748B",
  boxShadow: active ? "0 1px 2px rgba(15,23,42,0.12)" : "none",
  cursor: "pointer",
});

export default function CameraDataChart({ column, tableData, cameraIds, onClose }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [mode, setMode] = useState("line");

  const { entries, min, max, avg } = useMemo(() => {
    const entries = cameraIds
      .map((camId) => ({ camId, val: parseFloat(tableData?.[camId]?.[column]) }))
      .filter((e) => Number.isFinite(e.val));
    if (!entries.length) return { entries };
    const values = entries.map((e) => e.val);
    return {
      entries,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }, [column, tableData, cameraIds]);

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700 }}>
        {column} <span style={{ color: "#64748B", fontWeight: 500 }}>per camera</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {entries.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: 2,
              borderRadius: 8,
              background: "#E2E8F0",
            }}
          >
            {["line", "bar"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMode(m);
                }}
                style={toggleBtn(mode === m)}
              >
                {m === "line" ? "Line" : "Bar"}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          title="Hide chart"
          style={{
            border: "none",
            background: "transparent",
            color: "#94A3B8",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );

  const wrapperStyle = {
    flexShrink: 0,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    border: "1px solid #E2E8F0",
    background: "#F8FAFC",
  };

  if (!entries.length) {
    return (
      <div style={wrapperStyle}>
        {header}
        <div style={{ fontSize: 11, color: "#94A3B8" }}>
          No numeric values in "{column}" to chart.
        </div>
      </div>
    );
  }

  const range = max - min || 1;
  const isLine = mode === "line";
  // Bars start at 0 when all values are positive; the wave uses the data's
  // own min→max so small ups and downs stay visible.
  let yMin = isLine ? min : min >= 0 ? 0 : min;
  let yMax = max;
  if (yMax <= yMin) {
    yMin -= 1;
    yMax += 1;
  }
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerW / entries.length;
  const y = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const cx = (i) => PAD.left + (i + 0.5) * slot;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH - PAD.left;
    const idx = Math.floor(x / slot);
    setHoverIdx(idx >= 0 && idx < entries.length ? idx : null);
  };

  const hovered = hoverIdx != null ? entries[hoverIdx] : null;
  const gradId = `cam-chart-grad-${column.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const renderBars = () => {
    const gap = slot > 6 ? 2 : 0;
    const barW = Math.max(1, slot - gap);
    const radius = Math.min(4, barW / 2);
    return entries.map((e, i) => {
      const top = y(e.val);
      const base = y(yMin);
      const h = Math.max(1, base - top);
      const x = PAD.left + i * slot + gap / 2;
      const r = Math.min(radius, h);
      // Rounded data-end, square baseline end.
      const d = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${
        x + barW - r
      } Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
      return (
        <path
          key={e.camId}
          d={d}
          fill={viridisColor((e.val - min) / range)}
          opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.45}
        />
      );
    });
  };

  const renderLine = () => {
    const pts = entries.map((e, i) => [cx(i), y(e.val)]);
    const d = smoothPath(pts);
    const base = PAD.top + innerH;
    const area = `${d} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`;
    return (
      <>
        <defs>
          {/* vertical gradient: a point's colour depends on its value,
              exactly like the camera dots */}
          <linearGradient
            id={gradId}
            gradientUnits="userSpaceOnUse"
            x1={0}
            x2={0}
            y1={y(min)}
            y2={y(max)}
          >
            {GRADIENT_STOPS.map((t) => (
              <stop key={t} offset={t} stopColor={viridisColor(t)} />
            ))}
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} opacity={0.12} />
        <path
          key={`${column}-${entries.length}`}
          d={d}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
        >
          {/* ECG-style sweep: trace draws left → right */}
          <animate
            attributeName="stroke-dashoffset"
            from={1}
            to={0}
            dur="1.2s"
            fill="freeze"
          />
        </path>
        {hovered && (
          <>
            <line
              x1={cx(hoverIdx)}
              x2={cx(hoverIdx)}
              y1={PAD.top}
              y2={base}
              stroke="#94A3B8"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={cx(hoverIdx)}
              cy={y(hovered.val)}
              r={4}
              fill={viridisColor((hovered.val - min) / range)}
              stroke="#fff"
              strokeWidth={2}
            />
          </>
        )}
      </>
    );
  };

  return (
    <div style={wrapperStyle}>
      {header}

      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          style={{ display: "block", overflow: "visible" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* recessive gridlines + y labels at min / max */}
          {[yMin, yMax].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="#E2E8F0"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9}
                fill="#64748B"
              >
                {fmt(v)}
              </text>
            </g>
          ))}

          {isLine ? renderLine() : renderBars()}
        </svg>

        {hovered && (
          <div
            style={{
              position: "absolute",
              top: -4,
              left: `${Math.min(
                70,
                Math.max(0, (cx(hoverIdx) / WIDTH) * 100 - 15),
              )}%`,
              transform: "translateY(-100%)",
              padding: "4px 8px",
              borderRadius: 6,
              background: "#0F172A",
              color: "#fff",
              fontSize: 11,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            <span style={{ opacity: 0.7 }}>{hovered.camId}</span>{" "}
            <b>{fmt(hovered.val)}</b>
          </div>
        )}
      </div>

      {/* colour scale legend — same mapping as the camera dots */}
      <div
        style={{
          marginTop: 6,
          marginLeft: `${(PAD.left / WIDTH) * 100}%`,
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(to right, ${GRADIENT_STOPS.map((t) =>
            viridisColor(t),
          ).join(", ")})`,
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginLeft: `${(PAD.left / WIDTH) * 100}%`,
          fontSize: 10,
          color: "#64748B",
          marginTop: 2,
        }}
      >
        <span>min {fmt(min)}</span>
        <span>
          avg {fmt(avg)} · {entries.length} cams
        </span>
        <span>max {fmt(max)}</span>
      </div>
    </div>
  );
}