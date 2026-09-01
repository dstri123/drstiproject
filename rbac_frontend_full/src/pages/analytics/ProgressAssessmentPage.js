import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import API from "../../api/axios";
import Header from "../viewer/layout/Header";
import IconToolbar from "../viewer/layout/IconToolbar";
import { useToast } from "../../components/ToastContainer";
import {
  FolderOpen,
  Boxes,
  CheckCircle2,
  Loader,
  CircleDashed,
  Save,
  Play,
  BarChart3,
  Search,
  X,
  Maximize2,
  Minimize2,
  FileDown,
  ImageDown,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  ListOrdered,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MousePointerClick,
  Percent,
  Layers,
  ScanLine,
  Crosshair,
  TrendingUp,
  TrendingDown,
  Minus,
  Grid3x3,
  Gauge as GaugeIcon,
  AlertTriangle,
  AlertCircle,
  Eye,
} from "lucide-react";

// ─── Status helpers ─────────────────────────────────────────────────────────
const STATUS_META = {
  completed: { label: "Completed", color: "#16a34a", bg: "#f0fdf4" },
  in_progress: { label: "In Progress", color: "#d97706", bg: "#fffbeb" },
  not_started: { label: "Not Started", color: "#dc2626", bg: "#fef2f2" },
  // Virtual bucket (in_progress + not_started) used by the completion gauge's
  // "view incomplete elements" interaction — not a real element status value.
  incomplete: { label: "Incomplete", color: "#dc2626", bg: "#fef2f2" },
};

function fmtDate(d) {
  return d || "—";
}

// ─── Tiny SVG donut (completed / in-progress / not-started) ─────────────────
function Donut({ completed, inProgress, notStarted, size = 132 }) {
  const total = completed + inProgress + notStarted || 1;
  const segs = [
    { v: completed, c: "#16a34a" },
    { v: inProgress, c: "#d97706" },
    { v: notStarted, c: "#dc2626" },
  ];
  const r = size / 2 - 12;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="#eef2f6"
        strokeWidth={14}
      />
      {segs.map((s, i) => {
        const frac = s.v / total;
        const dash = frac * circ;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={s.c}
            strokeWidth={14}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cx})`}
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return el;
      })}
      <text
        x={cx}
        y={cx - 2}
        textAnchor="middle"
        fontSize="20"
        fontWeight="800"
        fill="#0f172a"
      >
        {Math.round((completed / total) * 100)}%
      </text>
      <text x={cx} y={cx + 16} textAnchor="middle" fontSize="9" fill="#94a3b8">
        done
      </text>
    </svg>
  );
}

function Bar({ pct, color }) {
  return (
    <div
      style={{
        height: 8,
        borderRadius: 6,
        background: "#eef2f6",
        overflow: "hidden",
        minWidth: 80,
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: "100%",
          background: color,
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}

// ─── Category analytics dashboard (ICED-style interactive bar charts) ──────
const CHART_METRICS = [
  {
    key: "count",
    label: "Count",
    color: "#4f46e5",
    format: (v) => Math.round(v).toLocaleString(),
  },
  {
    key: "bim_volume",
    label: "BIM Volume (m³)",
    color: "#0ea5e9",
    format: (v) => `${(Math.round(v * 100) / 100).toLocaleString()} m³`,
  },
  {
    key: "overlap_volume",
    label: "Overlap Volume (m³)",
    color: "#06b6d4",
    format: (v) => `${(Math.round(v * 100) / 100).toLocaleString()} m³`,
  },
  {
    key: "bim_points",
    label: "BIM Points",
    color: "#8b5cf6",
    format: (v) => Math.round(v).toLocaleString(),
  },
  {
    key: "overlap_points",
    label: "Overlap Points",
    color: "#a855f7",
    format: (v) => Math.round(v).toLocaleString(),
  },
  {
    key: "completion",
    label: "Completion (%)",
    color: "#16a34a",
    format: (v) => `${Math.round(v * 10) / 10}%`,
    isPercentage: true,
  },
];

// Round a max value up to a "nice" number so axis ticks read cleanly.
function niceCeil(v) {
  if (!v || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const frac = v / base;
  let niceFrac;
  if (frac <= 1) niceFrac = 1;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 5) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * base;
}

// Darken/lighten a "#rrggbb" color by `amt` (-100..100).
function shade(hex, amt) {
  const n = hex.replace("#", "");
  const num = parseInt(n, 16);
  let r = (num >> 16) + Math.round((amt / 100) * 255);
  let g = ((num >> 8) & 0xff) + Math.round((amt / 100) * 255);
  let b = (num & 0xff) + Math.round((amt / 100) * 255);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCategoriesToCSV(rows, metricKey) {
  const headers = [
    "Category",
    "Count",
    "BIM Volume (m3)",
    "Overlap Volume (m3)",
    "BIM Points",
    "Overlap Points",
    "Completion (%)",
  ];
  const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((c) => {
    lines.push(
      [
        csvCell(c.category),
        c.count,
        c.bim_volume,
        c.overlap_volume,
        c.bim_points,
        c.overlap_points,
        c.completion,
      ].join(","),
    );
  });
  downloadBlob(
    new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }),
    `category-metrics-${metricKey}-${Date.now()}.csv`,
  );
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Renders the current view to an offscreen canvas (no external deps) and
// downloads it as a PNG.
function exportChartToPNG(data, metric) {
  const W = Math.max(720, data.length * 70 + 160);
  const H = 460;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const marginLeft = 74;
  const marginRight = 24;
  const marginTop = 46;
  const marginBottom = 74;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  const max = Math.max(0, ...data.map((d) => d.value || 0));
  const niceMax = niceCeil(max);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 15px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${metric.label} by BIM Element Category`, marginLeft, 26);

  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "right";
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const frac = i / gridSteps;
    const y = marginTop + plotH - frac * plotH;
    ctx.beginPath();
    ctx.moveTo(marginLeft, y);
    ctx.lineTo(marginLeft + plotW, y);
    ctx.stroke();
    ctx.fillText(metric.format(niceMax * frac), marginLeft - 10, y + 4);
  }

  const n = data.length || 1;
  const slot = plotW / n;
  const barW = Math.min(46, slot * 0.6);
  data.forEach((d, i) => {
    const cx = marginLeft + slot * i + slot / 2;
    const h = niceMax ? (d.value / niceMax) * plotH : 0;
    const y = marginTop + plotH - h;
    ctx.fillStyle = d.color || metric.color;
    roundRectPath(ctx, cx - barW / 2, y, barW, Math.max(h, 0), 5);
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 10px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(metric.format(d.value), cx, y - 6);

    ctx.save();
    ctx.fillStyle = "#475569";
    ctx.font = "10px Segoe UI, Arial, sans-serif";
    ctx.translate(cx, marginTop + plotH + 16);
    const label =
      d.category.length > 14 ? `${d.category.slice(0, 13)}…` : d.category;
    if (n > 8) {
      ctx.rotate(-Math.PI / 5);
      ctx.textAlign = "right";
    } else {
      ctx.textAlign = "center";
    }
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });

  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(marginLeft, marginTop + plotH);
  ctx.lineTo(marginLeft + plotW, marginTop + plotH);
  ctx.stroke();

  canvas.toBlob((blob) => {
    if (blob)
      downloadBlob(blob, `category-chart-${metric.key}-${Date.now()}.png`);
  }, "image/png");
}

function IconBtn({ onClick, icon: Icon, title, disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        flexShrink: 0,
        borderRadius: 7,
        border: "1px solid #e2e8f0",
        background: disabled ? "#f1f5f9" : "#fff",
        color: disabled ? "#cbd5e1" : "#64748b",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Icon size={13} />
    </button>
  );
}

function SortButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        padding: "6px 10px",
        borderRadius: 8,
        border: active ? "1px solid #4f46e5" : "1px solid #e2e8f0",
        background: active ? "#eef2ff" : "#fff",
        color: active ? "#4f46e5" : "#64748b",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

const ghostBtn = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  padding: "6px 11px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// Interactive, animated, zoom/pan-able bar chart with hover tooltips and
// click-to-focus. Renders directly off the `data` it's given — the caller
// (CategoryChartsPanel) owns search/sort/filter state.
// Fixed-position tooltip rendered outside the chart's scroll container (via
// a portal), so it's never clipped — a bar-scoped tooltip positioned with
// `bottom: %` gets cropped by the plot area's own bounds whenever the bar is
// tall (vertical clip) or sits at the first/last slot (horizontal clip),
// because `overflowX: auto` forces the computed overflow-y to `auto` too.
function ChartTooltip({ anchorRect, category, color, lines }) {
  if (!anchorRect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(anchorRect.left + anchorRect.width / 2, 90), vw - 90);
  const top = Math.max(anchorRect.top, 70);
  const flipBelow = top < 80;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left,
        top: flipBelow ? Math.min(anchorRect.bottom, vh - 20) : top,
        transform: flipBelow
          ? "translate(-50%, 10px)"
          : "translate(-50%, calc(-100% - 10px))",
        background: "#0f172a",
        color: "#fff",
        borderRadius: 8,
        padding: "8px 11px",
        fontSize: 11,
        whiteSpace: "nowrap",
        boxShadow: "0 4px 14px rgba(15,23,42,0.25)",
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 800,
          marginBottom: 3,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: color,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        {category}
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{ color: i === 0 ? "#fff" : "#94a3b8", marginTop: i ? 1 : 0 }}>
          {line}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          ...(flipBelow
            ? {
                bottom: "100%",
                borderBottom: "5px solid #0f172a",
                borderTop: "none",
              }
            : { top: "100%", borderTop: "5px solid #0f172a" }),
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
        }}
      />
    </div>,
    document.body,
  );
}

function InteractiveBarChart({
  data,
  metric,
  totalForPercent,
  focused,
  onToggleFocus,
  zoom = 1,
  height = 260,
}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const scrollRef = useRef(null);
  const barElsRef = useRef({});
  const dragRef = useRef({ dragging: false, startX: 0, startScroll: 0, moved: false });

  const max = Math.max(0, ...data.map((d) => d.value || 0));
  const niceMax = niceCeil(max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => niceMax * f).reverse();
  const baseBarWidth = data.length <= 8 ? 0 : 56;
  const barMinWidth = baseBarWidth ? Math.round(baseBarWidth * zoom) : 0;
  const gap = data.length > 14 ? 6 : 14;

  const measure = (category) => {
    const el = barElsRef.current[category];
    if (el) setAnchorRect(el.getBoundingClientRect());
  };
  const showTooltip = (i, category) => {
    setHoverIdx(i);
    measure(category);
  };
  const hideTooltip = () => {
    setHoverIdx(null);
    setAnchorRect(null);
  };

  const onPointerDown = (e) => {
    if (!barMinWidth) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startScroll: scrollRef.current?.scrollLeft || 0,
      moved: false,
    };
  };
  const onPointerMove = (e) => {
    const st = dragRef.current;
    if (!st.dragging || !scrollRef.current) return;
    const dx = e.clientX - st.startX;
    if (Math.abs(dx) > 3) {
      st.moved = true;
      hideTooltip();
    }
    scrollRef.current.scrollLeft = st.startScroll - dx;
  };
  const endDrag = () => {
    dragRef.current.dragging = false;
  };

  const hoveredDatum = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredShare =
    hoveredDatum && totalForPercent ? (hoveredDatum.value / totalForPercent) * 100 : 0;

  return (
    <>
    <div style={{ display: "flex", gap: 10 }}>
      {/* Y axis */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height,
          flexShrink: 0,
          paddingBottom: 30,
        }}
      >
        {ticks.map((t, i) => (
          <span
            key={i}
            style={{
              fontSize: 10,
              color: "#94a3b8",
              textAlign: "right",
              minWidth: 58,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {metric.format(t)}
          </span>
        ))}
      </div>

      {/* Plot area — draggable to pan when zoomed / many categories */}
      <div
        ref={scrollRef}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          cursor: barMinWidth ? "grab" : "default",
        }}
      >
        <div
          style={{
            minWidth: barMinWidth
              ? data.length * barMinWidth + (data.length - 1) * gap
              : "100%",
          }}
        >
          <div style={{ position: "relative", height }}>
            {/* Gridlines */}
            {ticks.map((t, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${(i / (ticks.length - 1)) * 100}%`,
                  borderTop:
                    i === ticks.length - 1
                      ? "1px solid #cbd5e1"
                      : "1px dashed #eef2f6",
                }}
              />
            ))}
            {/* Bars */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "flex-end",
                gap,
                padding: "0 6px",
              }}
            >
              {data.map((d, i) => {
                const pct = niceMax ? (d.value / niceMax) * 100 : 0;
                const hovered = hoverIdx === i;
                const isFocused = focused === d.category;
                const dimmed = !!focused && !isFocused;
                return (
                  <div
                    key={d.category}
                    onMouseEnter={() => showTooltip(i, d.category)}
                    onMouseMove={() => hovered && measure(d.category)}
                    onMouseLeave={hideTooltip}
                    onClick={() => {
                      if (!dragRef.current.moved) onToggleFocus(d.category);
                    }}
                    style={{
                      flex: barMinWidth ? `0 0 ${barMinWidth}px` : "1 1 0",
                      height: "100%",
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      position: "relative",
                      cursor: "pointer",
                      opacity: dimmed ? 0.25 : 1,
                      transition: "opacity 0.2s ease",
                    }}
                  >
                    <div
                      ref={(el) => {
                        barElsRef.current[d.category] = el;
                      }}
                      style={{
                        width: "70%",
                        maxWidth: 46,
                        height: `${pct}%`,
                        minHeight: d.value > 0 ? 3 : 0,
                        background:
                          hovered || isFocused ? shade(metric.color, -14) : metric.color,
                        borderRadius: "5px 5px 0 0",
                        transition:
                          "height 0.4s cubic-bezier(.4,0,.2,1), background 0.15s ease, box-shadow 0.15s ease",
                        boxShadow: isFocused
                          ? `0 0 0 3px ${metric.color}55`
                          : hovered
                            ? `0 0 0 3px ${metric.color}33`
                            : "none",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* X axis labels */}
          <div
            style={{
              display: "flex",
              gap,
              padding: "8px 6px 0",
              borderTop: "1px solid #cbd5e1",
            }}
          >
            {data.map((d) => {
              const isFocused = focused === d.category;
              return (
                <div
                  key={d.category}
                  title={d.category}
                  style={{
                    flex: barMinWidth ? `0 0 ${barMinWidth}px` : "1 1 0",
                    fontSize: 10,
                    fontWeight: isFocused ? 800 : 600,
                    color: isFocused ? metric.color : "#475569",
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.category}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    {hoveredDatum && (
      <ChartTooltip
        anchorRect={anchorRect}
        category={hoveredDatum.category}
        color={metric.color}
        lines={[
          metric.format(hoveredDatum.value),
          ...(!metric.isPercentage && totalForPercent > 0
            ? [`${hoveredShare.toFixed(1)}% of total`]
            : []),
        ]}
      />
    )}
    </>
  );
}

// ─── Lightweight non-bordered heading used to separate the dashboard's
// chart blocks (KPI cards, gauge, stacked bar, etc.) inside one Section. ────
function ChartBlock({ title, icon: Icon, subtitle, right, children, last }) {
  return (
    <div
      style={{
        marginBottom: last ? 0 : 24,
        paddingBottom: last ? 0 : 20,
        borderBottom: last ? "none" : "1px solid #f1f5f9",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: subtitle ? 4 : 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "#0f172a",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {Icon && <Icon size={13} color="#64748b" />}
          {title}
        </span>
        {right}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
          {subtitle}
        </div>
      )}
      {children}
    </div>
  );
}

// A tiny line-chart used inside a KPI card for a genuine time trend (only
// valid where we actually have historical data — overall_completion).
function Sparkline({ values, color, height = 30, width = 78 }) {
  if (!values || values.length < 2) {
    return (
      <div
        style={{
          height,
          width,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: "#cbd5e1",
        }}
      >
        no history yet
      </div>
    );
  }
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - ((v - min) / range) * height,
  ]);
  const path = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const [lastX, lastY] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path
        d={`${path} L${width},${height} L0,${height} Z`}
        fill={`${color}1f`}
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.6} fill={color} />
    </svg>
  );
}

// A tiny bar strip showing this metric's spread across categories — used on
// KPI cards where no time series exists, so we don't fabricate a trend.
function MiniBars({ values, color, height = 30, width = 78 }) {
  const max = Math.max(...values, 1);
  const n = values.length || 1;
  const barW = Math.max(1.5, width / n - 2);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * (width / n)}
            y={height - h}
            width={barW}
            height={h}
            rx={1}
            fill={color}
            opacity={0.35 + 0.55 * (v / max)}
          />
        );
      })}
    </svg>
  );
}

function KPICard({ icon: Icon, label, value, valueSuffix, color, chart, caption }) {
  return (
    <div
      style={{
        flex: "1 1 210px",
        minWidth: 210,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: `${color}15`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={14} color={color} />
          </span>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
            {label}
          </span>
        </div>
        {chart}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>
          {value}
        </span>
        {valueSuffix && (
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>
            {valueSuffix}
          </span>
        )}
      </div>
      {caption && (
        <span style={{ fontSize: 10, color: "#94a3b8" }}>{caption}</span>
      )}
    </div>
  );
}

// KPI row: Completion (real time trend from assessment history), BIM Points,
// Overlap Points, and Coverage Accuracy (overlap / bim points). The latter
// three show a per-category distribution strip rather than a fabricated
// trend, since only overall_completion is tracked historically.
function KPICardsRow({ summary, categories, history }) {
  const bimPointsTotal = categories.reduce((s, c) => s + (c.bim_points || 0), 0);
  const overlapPointsTotal = categories.reduce(
    (s, c) => s + (c.overlap_points || 0),
    0,
  );
  const accuracy = bimPointsTotal ? (overlapPointsTotal / bimPointsTotal) * 100 : 0;

  const completionSeries = history
    .slice()
    .reverse()
    .map((h) => h.overall_completion || 0);
  const delta =
    completionSeries.length >= 2
      ? completionSeries[completionSeries.length - 1] -
        completionSeries[completionSeries.length - 2]
      : null;
  const TrendIcon = delta == null || Math.abs(delta) < 0.05 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const trendColor =
    delta == null || Math.abs(delta) < 0.05
      ? "#94a3b8"
      : delta > 0
        ? "#16a34a"
        : "#dc2626";

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <KPICard
        icon={Percent}
        label="Completion"
        color="#4f46e5"
        value={`${Math.round(summary.overall_completion)}%`}
        chart={<Sparkline values={completionSeries} color="#4f46e5" />}
        caption={
          delta == null ? (
            "First recorded assessment"
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                color: trendColor,
                fontWeight: 700,
              }}
            >
              <TrendIcon size={11} />
              {`${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs last assessment`}
            </span>
          )
        }
      />
      <KPICard
        icon={Layers}
        label="BIM Points"
        color="#8b5cf6"
        value={bimPointsTotal.toLocaleString()}
        chart={
          <MiniBars
            values={categories.map((c) => c.bim_points || 0)}
            color="#8b5cf6"
          />
        }
        caption={`Across ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
      />
      <KPICard
        icon={ScanLine}
        label="Overlap Points"
        color="#a855f7"
        value={overlapPointsTotal.toLocaleString()}
        chart={
          <MiniBars
            values={categories.map((c) => c.overlap_points || 0)}
            color="#a855f7"
          />
        }
        caption={`Matched in the point cloud scan`}
      />
      <KPICard
        icon={Crosshair}
        label="Coverage Accuracy"
        color="#0ea5e9"
        value={`${accuracy.toFixed(1)}%`}
        chart={
          <MiniBars
            values={categories.map((c) =>
              c.bim_points ? (c.overlap_points / c.bim_points) * 100 : 0,
            )}
            color="#0ea5e9"
          />
        }
        caption="Overlap points ÷ BIM points"
      />
    </div>
  );
}

// ─── Completion gauge (0–100% semicircular arc) ─────────────────────────────
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

const LEVEL_META = {
  high: { key: "high", label: "High Completion", color: "#16a34a", icon: CheckCircle2 },
  medium: { key: "medium", label: "Medium Completion", color: "#d97706", icon: AlertCircle },
  low: { key: "low", label: "Low Completion", color: "#dc2626", icon: AlertTriangle },
};
function levelFor(value) {
  if (value >= 70) return LEVEL_META.high;
  if (value >= 40) return LEVEL_META.medium;
  return LEVEL_META.low;
}

// Complete / Partial / Incomplete counts, each clickable to jump to the
// Elements table pre-filtered to that bucket, each hoverable for exact counts.
function CompletionBreakdownRow({ summary, onSelect }) {
  const total = summary.total || 0;
  const items = [
    { key: "completed", label: "Complete", color: "#16a34a", count: summary.completed || 0 },
    { key: "in_progress", label: "Partial", color: "#d97706", count: summary.in_progress || 0 },
    { key: "not_started", label: "Incomplete", color: "#dc2626", count: summary.not_started || 0 },
  ];
  const [hoverKey, setHoverKey] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const elsRef = useRef({});

  const measure = (key) => {
    const el = elsRef.current[key];
    if (el) setAnchorRect(el.getBoundingClientRect());
  };
  const hovered = items.find((it) => it.key === hoverKey);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {items.map((it) => {
        const pct = total ? (it.count / total) * 100 : 0;
        return (
          <button
            key={it.key}
            ref={(el) => {
              elsRef.current[it.key] = el;
            }}
            onClick={() => onSelect?.(it.key)}
            onMouseEnter={() => {
              setHoverKey(it.key);
              measure(it.key);
            }}
            onMouseLeave={() => {
              setHoverKey(null);
              setAnchorRect(null);
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${it.color}30`,
              background: `${it.color}0d`,
              cursor: onSelect ? "pointer" : "default",
              minWidth: 92,
              transition: "all 0.15s",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 10,
                fontWeight: 700,
                color: it.color,
              }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: "50%", background: it.color }}
              />
              {it.label}
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
              {it.count.toLocaleString()}
            </span>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>{pct.toFixed(1)}%</span>
          </button>
        );
      })}
      {hovered && (
        <ChartTooltip
          anchorRect={anchorRect}
          category={hovered.label}
          color={hovered.color}
          lines={[
            `${hovered.count.toLocaleString()} of ${total.toLocaleString()} elements`,
            `${(total ? (hovered.count / total) * 100 : 0).toFixed(1)}% of total`,
          ]}
        />
      )}
    </div>
  );
}

// Animated, interactive completion gauge: count-up sweep, hoverable value /
// remaining zones, color-coded level badge, breakdown, and a trend readout
// from assessment history. Clicking the gauge (or a breakdown pill) jumps to
// the Elements table below, pre-filtered to that bucket.
function CompletionOverview({ summary, history, onExplore }) {
  const value = Math.max(0, Math.min(100, summary.overall_completion || 0));
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    let raf;
    const duration = 900;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const [hoverZone, setHoverZone] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const valueArcRef = useRef(null);
  const remainingArcRef = useRef(null);

  const meta = levelFor(value);
  const LevelIcon = meta.icon;

  const size = 224;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const r = size / 2 - 30;
  const startAngle = -90;
  const endAngle = 90;
  const valueAngle = startAngle + (animated / 100) * (endAngle - startAngle);
  const strokeW = 18;
  const vh = size * 0.58;
  const zeroLabel = polarToCartesian(cx, cy, r + 20, startAngle);
  const hundredLabel = polarToCartesian(cx, cy, r + 20, endAngle);

  const total = summary.total || 0;
  const completeCount = summary.completed || 0;
  const incompleteTotal = (summary.in_progress || 0) + (summary.not_started || 0);

  const series = history
    .slice()
    .reverse()
    .map((h) => h.overall_completion || 0);
  const delta =
    series.length >= 2 ? series[series.length - 1] - series[series.length - 2] : null;
  const flat = delta != null && Math.abs(delta) < 0.05;
  const TrendIcon = delta == null || flat ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const trendColor = delta == null || flat ? "#94a3b8" : delta > 0 ? "#16a34a" : "#dc2626";

  const measure = (zone, ref) => {
    const el = ref.current;
    if (el) {
      setHoverZone(zone);
      setAnchorRect(el.getBoundingClientRect());
    }
  };
  const clearHover = () => {
    setHoverZone(null);
    setAnchorRect(null);
  };

  const zoneInfo =
    hoverZone === "value"
      ? {
          category: "Complete",
          color: meta.color,
          lines: [
            `${Math.round(value)}% complete`,
            `${completeCount.toLocaleString()} of ${total.toLocaleString()} elements`,
          ],
        }
      : hoverZone === "remaining"
        ? {
            category: "Remaining",
            color: "#94a3b8",
            lines: [
              `${Math.round(100 - value)}% remaining`,
              `${incompleteTotal.toLocaleString()} of ${total.toLocaleString()} elements`,
            ],
          }
        : null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 32,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div
          onClick={() => onExplore?.("incomplete")}
          title="Click to view incomplete elements"
          style={{ cursor: onExplore ? "pointer" : "default" }}
        >
          <svg width={size} height={vh} viewBox={`0 0 ${size} ${vh}`}>
            <path
              ref={remainingArcRef}
              d={describeArc(cx, cy, r, valueAngle, endAngle)}
              fill="none"
              stroke="#eef2f6"
              strokeWidth={strokeW}
              strokeLinecap="round"
              onMouseEnter={() => measure("remaining", remainingArcRef)}
              onMouseLeave={clearHover}
              style={{ transition: "d 0.05s linear" }}
            />
            <path
              ref={valueArcRef}
              d={describeArc(cx, cy, r, startAngle, valueAngle)}
              fill="none"
              stroke={meta.color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              onMouseEnter={() => measure("value", valueArcRef)}
              onMouseLeave={clearHover}
              style={{ transition: "d 0.05s linear, stroke 0.3s ease" }}
            />
            <text
              x={cx}
              y={cy - 10}
              textAnchor="middle"
              fontSize="30"
              fontWeight="800"
              fill="#0f172a"
            >
              {Math.round(animated)}%
            </text>
            <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="#94a3b8">
              overall completion
            </text>
            <text x={zeroLabel.x} y={zeroLabel.y} textAnchor="start" fontSize="9" fill="#cbd5e1">
              0%
            </text>
            <text
              x={hundredLabel.x}
              y={hundredLabel.y}
              textAnchor="end"
              fontSize="9"
              fill="#cbd5e1"
            >
              100%
            </text>
          </svg>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 800,
            color: meta.color,
            background: `${meta.color}15`,
            border: `1px solid ${meta.color}40`,
            borderRadius: 999,
            padding: "5px 12px",
            transition: "all 0.3s ease",
          }}
        >
          <LevelIcon size={13} />
          {meta.label}
        </span>
        {onExplore && (
          <button
            onClick={() => onExplore("incomplete")}
            style={{ ...ghostBtn, fontSize: 10, padding: "5px 10px" }}
          >
            <Eye size={12} />
            View incomplete elements
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 220 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>
              {Math.round(value)}%
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Complete</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#94a3b8" }}>
              {Math.round(100 - value)}%
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Remaining</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
              {total.toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Assessed elements</div>
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 6,
            }}
          >
            Completion Breakdown
          </div>
          <CompletionBreakdownRow summary={summary} onSelect={onExplore} />
        </div>

        <div style={{ fontSize: 11, color: "#64748b" }}>
          {delta == null ? (
            <span>First recorded assessment — no prior trend yet.</span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontWeight: 700,
                color: trendColor,
              }}
            >
              <TrendIcon size={13} />
              {`${delta > 0 ? "+" : ""}${delta.toFixed(1)}% from previous assessment`}
            </span>
          )}
        </div>
      </div>

      {zoneInfo && (
        <ChartTooltip
          anchorRect={anchorRect}
          category={zoneInfo.category}
          color={zoneInfo.color}
          lines={zoneInfo.lines}
        />
      )}
    </div>
  );
}

// ─── Stacked bar: covered (overlap) vs missing BIM points, per category ─────
function StackedPointsBar({ categories }) {
  const [hoverKey, setHoverKey] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const elsRef = useRef({});

  const data = categories.map((c) => {
    const total = c.bim_points || 0;
    const covered = Math.min(c.overlap_points || 0, total);
    const missing = Math.max(0, total - covered);
    return { category: c.category, covered, missing, total };
  });
  const max = niceCeil(Math.max(0, ...data.map((d) => d.total)));
  const barMinWidth = data.length <= 10 ? 0 : 52;
  const gap = data.length > 14 ? 6 : 12;
  const height = 220;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f).reverse();

  const measure = (key) => {
    const el = elsRef.current[key];
    if (el) setAnchorRect(el.getBoundingClientRect());
  };
  const hovered = data.find((d) => d.category === hoverKey);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: "#64748b" }}>
        <Legend c="#16a34a" t="Covered (overlap points)" />
        <Legend c="#e2e8f0" t="Missing (no scan match)" />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height,
            flexShrink: 0,
          }}
        >
          {ticks.map((t, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                color: "#94a3b8",
                textAlign: "right",
                minWidth: 58,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(t).toLocaleString()}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          <div
            style={{
              minWidth: barMinWidth
                ? data.length * barMinWidth + (data.length - 1) * gap
                : "100%",
            }}
          >
            <div style={{ position: "relative", height }}>
              {ticks.map((t, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${(i / (ticks.length - 1)) * 100}%`,
                    borderTop:
                      i === ticks.length - 1
                        ? "1px solid #cbd5e1"
                        : "1px dashed #eef2f6",
                  }}
                />
              ))}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "flex-end",
                  gap,
                  padding: "0 6px",
                }}
              >
                {data.map((d) => {
                  const totalPct = max ? (d.total / max) * 100 : 0;
                  const coveredPct = d.total ? (d.covered / d.total) * 100 : 0;
                  const missingPct = d.total ? (d.missing / d.total) * 100 : 0;
                  const isHovered = hoverKey === d.category;
                  return (
                    <div
                      key={d.category}
                      onMouseEnter={() => {
                        setHoverKey(d.category);
                        measure(d.category);
                      }}
                      onMouseLeave={() => {
                        setHoverKey(null);
                        setAnchorRect(null);
                      }}
                      style={{
                        flex: barMinWidth ? `0 0 ${barMinWidth}px` : "1 1 0",
                        height: "100%",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        ref={(el) => {
                          elsRef.current[d.category] = el;
                        }}
                        style={{
                          width: "70%",
                          maxWidth: 40,
                          height: `${totalPct}%`,
                          display: "flex",
                          flexDirection: "column-reverse",
                          borderRadius: "5px 5px 0 0",
                          overflow: "hidden",
                          boxShadow: isHovered ? "0 0 0 3px #16a34a33" : "none",
                          transition: "height 0.4s cubic-bezier(.4,0,.2,1)",
                        }}
                      >
                        <div
                          style={{
                            height: `${coveredPct}%`,
                            background: isHovered ? shade("#16a34a", -14) : "#16a34a",
                          }}
                        />
                        <div
                          style={{
                            height: `${missingPct}%`,
                            background: isHovered ? "#cbd5e1" : "#e2e8f0",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap,
                padding: "8px 6px 0",
                borderTop: "1px solid #cbd5e1",
              }}
            >
              {data.map((d) => (
                <div
                  key={d.category}
                  title={d.category}
                  style={{
                    flex: barMinWidth ? `0 0 ${barMinWidth}px` : "1 1 0",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#475569",
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.category}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {hovered && (
        <ChartTooltip
          anchorRect={anchorRect}
          category={hovered.category}
          color="#16a34a"
          lines={[
            `${hovered.covered.toLocaleString()} of ${hovered.total.toLocaleString()} BIM points covered`,
            `${hovered.total ? ((hovered.covered / hovered.total) * 100).toFixed(1) : 0}% covered · ${hovered.missing.toLocaleString()} missing`,
          ]}
        />
      )}
    </div>
  );
}

// ─── Element-wise horizontal bars — best for comparing many elements ───────
function ElementHorizontalBars({ elements }) {
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [limit, setLimit] = useState(20);
  const [hoverId, setHoverId] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const elsRef = useRef({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return elements;
    return elements.filter(
      (e) =>
        (e.name || e.element_id || "").toLowerCase().includes(q) ||
        (e.element_type || "").toLowerCase().includes(q),
    );
  }, [elements, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortOrder === "desc")
      arr.sort((a, b) => (b.completion || 0) - (a.completion || 0));
    else arr.sort((a, b) => (a.completion || 0) - (b.completion || 0));
    return arr;
  }, [filtered, sortOrder]);

  const visible = sorted.slice(0, limit);

  const measure = (id) => {
    const el = elsRef.current[id];
    if (el) setAnchorRect(el.getBoundingClientRect());
  };
  const hoveredEl = visible.find(
    (e, i) => (e.element_id || `${e.name}-${i}`) === hoverId,
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 170 }}>
          <Search
            size={13}
            color="#94a3b8"
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(20);
            }}
            placeholder="Search elements…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: 12,
              padding: "7px 9px 7px 28px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <SortButton
            active={sortOrder === "desc"}
            onClick={() => setSortOrder("desc")}
            icon={ArrowDownWideNarrow}
            label="Best covered"
          />
          <SortButton
            active={sortOrder === "asc"}
            onClick={() => setSortOrder("asc")}
            icon={ArrowUpWideNarrow}
            label="Least covered"
          />
        </div>
        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
          Showing {visible.length} of {sorted.length}
          {search ? ` (of ${elements.length} total)` : ""}
        </span>
      </div>

      <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
        {visible.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            No elements match "{search}".
          </div>
        )}
        {visible.map((e, i) => {
          const id = e.element_id || `${e.name}-${i}`;
          const st = STATUS_META[e.status] || STATUS_META.not_started;
          const pct = Math.max(0, Math.min(100, e.completion || 0));
          const isHovered = hoverId === id;
          return (
            <div
              key={id}
              onMouseEnter={() => {
                setHoverId(id);
                measure(id);
              }}
              onMouseLeave={() => {
                setHoverId(null);
                setAnchorRect(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 2px",
                cursor: "pointer",
              }}
            >
              <span
                title={e.name || e.element_id}
                style={{
                  width: 140,
                  flexShrink: 0,
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: "#334155",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.name || e.element_id}
              </span>
              <div
                ref={(el) => {
                  elsRef.current[id] = el;
                }}
                style={{
                  flex: 1,
                  height: 14,
                  borderRadius: 4,
                  background: "#f1f5f9",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: isHovered ? shade(st.color, -14) : st.color,
                    borderRadius: 4,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <span
                style={{
                  width: 40,
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#475569",
                  textAlign: "right",
                }}
              >
                {Math.round(pct)}%
              </span>
            </div>
          );
        })}
      </div>
      {sorted.length > limit && (
        <button
          onClick={() => setLimit((l) => l + 20)}
          style={{ ...ghostBtn, marginTop: 10 }}
        >
          Show 20 more ({sorted.length - limit} remaining)
        </button>
      )}
      {hoveredEl && (
        <ChartTooltip
          anchorRect={anchorRect}
          category={hoveredEl.name || hoveredEl.element_id}
          color={(STATUS_META[hoveredEl.status] || STATUS_META.not_started).color}
          lines={[
            `${Math.round(hoveredEl.completion || 0)}% complete · ${(STATUS_META[hoveredEl.status] || STATUS_META.not_started).label}`,
            `${hoveredEl.element_type} · ${hoveredEl.bim_volume} m³ · ${(hoveredEl.overlap_points || 0).toLocaleString()}/${(hoveredEl.bim_points || 0).toLocaleString()} pts`,
          ]}
        />
      )}
    </div>
  );
}

// ─── Category × status coverage heatmap ─────────────────────────────────────
function CoverageHeatmap({ categories, elements }) {
  const [hoverKey, setHoverKey] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const elsRef = useRef({});

  const cols = [
    { key: "completed", label: "Completed", color: "#16a34a" },
    { key: "in_progress", label: "In Progress", color: "#d97706" },
    { key: "not_started", label: "Not Started", color: "#dc2626" },
  ];

  const grid = useMemo(() => {
    const counts = {};
    elements.forEach((e) => {
      const cat = e.element_type || "Other";
      counts[cat] = counts[cat] || { completed: 0, in_progress: 0, not_started: 0 };
      if (counts[cat][e.status] != null) counts[cat][e.status] += 1;
    });
    return categories.map((c) => ({
      category: c.category,
      values: counts[c.category] || { completed: 0, in_progress: 0, not_started: 0 },
    }));
  }, [categories, elements]);

  const maxCount = Math.max(1, ...grid.flatMap((r) => cols.map((c) => r.values[c.key])));

  const measure = (key) => {
    const el = elsRef.current[key];
    if (el) setAnchorRect(el.getBoundingClientRect());
  };
  const hoveredCell = useMemo(() => {
    if (!hoverKey) return null;
    const [cat, colKey] = hoverKey.split("__");
    const row = grid.find((r) => r.category === cat);
    return row ? { category: cat, colKey, value: row.values[colKey] } : null;
  }, [hoverKey, grid]);
  const hoveredCol = hoveredCell && cols.find((c) => c.key === hoveredCell.colKey);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 6 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontSize: 10, color: "#94a3b8", padding: "0 8px 0 0" }}>
                Category
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={{
                    fontSize: 10,
                    color: "#94a3b8",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.category}>
                <td
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#334155",
                    whiteSpace: "nowrap",
                    padding: "0 8px 0 0",
                  }}
                >
                  {row.category}
                </td>
                {cols.map((c) => {
                  const v = row.values[c.key] || 0;
                  const intensity = maxCount ? v / maxCount : 0;
                  const key = `${row.category}__${c.key}`;
                  const isHovered = hoverKey === key;
                  const alpha = v === 0 ? 0 : Math.round(30 + intensity * 180);
                  return (
                    <td key={c.key} style={{ padding: 0 }}>
                      <div
                        ref={(el) => {
                          elsRef.current[key] = el;
                        }}
                        onMouseEnter={() => {
                          setHoverKey(key);
                          measure(key);
                        }}
                        onMouseLeave={() => {
                          setHoverKey(null);
                          setAnchorRect(null);
                        }}
                        style={{
                          width: 58,
                          height: 34,
                          borderRadius: 6,
                          background:
                            v === 0
                              ? "#f8fafc"
                              : `${c.color}${alpha.toString(16).padStart(2, "0")}`,
                          border: isHovered ? `1.5px solid ${c.color}` : "1px solid #eef2f6",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 800,
                          color: v === 0 ? "#cbd5e1" : intensity > 0.55 ? "#fff" : c.color,
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {v}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hoveredCell && hoveredCol && (
        <ChartTooltip
          anchorRect={anchorRect}
          category={hoveredCell.category}
          color={hoveredCol.color}
          lines={[
            `${hoveredCell.value} ${hoveredCol.label.toLowerCase()} element${hoveredCell.value === 1 ? "" : "s"}`,
          ]}
        />
      )}
    </div>
  );
}

// ─── Trend line — assessment history over time (replaces the old bar view) ─
function TrendLineChart({ history }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const ptsRef = useRef({});

  const ordered = useMemo(() => history.slice().reverse(), [history]);
  const width = 640;
  const height = 200;
  const padX = 20;
  const padY = 20;
  const n = ordered.length;
  const max = niceCeil(Math.max(10, ...ordered.map((h) => h.overall_completion || 0)));

  const points = ordered.map((h, i) => ({
    x: n > 1 ? padX + (i / (n - 1)) * (width - padX * 2) : width / 2,
    y: padY + (1 - (h.overall_completion || 0) / max) * (height - padY * 2),
    h,
  }));
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x},${height - padY} L${points[0].x},${height - padY} Z`
      : "";
  const labelStep = Math.max(1, Math.ceil(n / 8));

  const measure = (i) => {
    const el = ptsRef.current[i];
    if (el) setAnchorRect(el.getBoundingClientRect());
  };
  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={width - padX}
            y1={padY + f * (height - padY * 2)}
            y2={padY + f * (height - padY * 2)}
            stroke="#eef2f6"
            strokeDasharray={f === 1 ? "0" : "4 4"}
          />
        ))}
        {areaPath && <path d={areaPath} fill="#4f46e51f" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#4f46e5"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {points.map((p, i) => (
          <circle
            key={p.h.id ?? i}
            ref={(el) => {
              ptsRef.current[i] = el;
            }}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === i ? 5 : 3.5}
            fill="#fff"
            stroke="#4f46e5"
            strokeWidth={2}
            style={{ cursor: "pointer", transition: "r 0.15s" }}
            onMouseEnter={() => {
              setHoverIdx(i);
              measure(i);
            }}
            onMouseLeave={() => {
              setHoverIdx(null);
              setAnchorRect(null);
            }}
          />
        ))}
      </svg>
      <div style={{ display: "flex", padding: "0 10px" }}>
        {ordered.map((h, i) => (
          <span
            key={h.id ?? i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 9,
              color: "#94a3b8",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {i % labelStep === 0 ? fmtDate(h.pointcloud_date) : ""}
          </span>
        ))}
      </div>
      {hovered && (
        <ChartTooltip
          anchorRect={anchorRect}
          category={fmtDate(hovered.h.pointcloud_date)}
          color="#4f46e5"
          lines={[`${Math.round(hovered.h.overall_completion)}% overall completion`]}
        />
      )}
    </div>
  );
}

// ─── Full dashboard: tabs, search, sort, zoom/pan, focus, export, fullscreen ─
function CategoryChartsPanel({ categories, elements, summary, history, panelRef, onExplore }) {
  const [metricKey, setMetricKey] = useState("count");
  const [sortOrder, setSortOrder] = useState("default"); // "default" | "desc" | "asc"
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

  const metric = CHART_METRICS.find((m) => m.key === metricKey);

  useEffect(() => {
    if (expanded) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [expanded]);

  const baseData = useMemo(
    () =>
      categories.map((c, i) => ({
        category: c.category,
        value: c[metricKey] || 0,
        raw: c,
        _idx: i,
      })),
    [categories, metricKey],
  );

  const totalForPercent = useMemo(
    () => baseData.reduce((s, d) => s + (d.value || 0), 0),
    [baseData],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? baseData.filter((d) => d.category.toLowerCase().includes(q))
      : baseData;
  }, [baseData, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortOrder === "desc") arr.sort((a, b) => b.value - a.value);
    else if (sortOrder === "asc") arr.sort((a, b) => a.value - b.value);
    else arr.sort((a, b) => a._idx - b._idx);
    return arr;
  }, [filtered, sortOrder]);

  const focusedCategoryData = focused
    ? categories.find((c) => c.category === focused)
    : null;

  const isDirty =
    !!focused || !!search || sortOrder !== "default" || zoom !== 1;
  const resetView = () => {
    setFocused(null);
    setSearch("");
    setSortOrder("default");
    setZoom(1);
  };

  return (
    <div
      ref={panelRef}
      style={
        expanded
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 2000,
              background: "#f0f4f8",
              padding: 20,
              overflowY: "auto",
            }
          : undefined
      }
    >
      <Section
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart3 size={14} color="#0ea5e9" />
            Category Analytics Dashboard
          </span>
        }
        right={
          <button onClick={() => setExpanded((e) => !e)} style={ghostBtn}>
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {expanded ? "Exit Full Screen" : "Full Screen"}
          </button>
        }
      >
        {/* Key metrics */}
        <ChartBlock title="Key Metrics" icon={Percent}>
          <KPICardsRow summary={summary} categories={categories} history={history} />
        </ChartBlock>

        {/* Overall completion gauge */}
        <ChartBlock
          title="Overall Completion"
          icon={GaugeIcon}
          subtitle="Elements assessed as complete across the whole model — click the gauge or a breakdown bucket to jump to those elements below."
        >
          <CompletionOverview summary={summary} history={history} onExplore={onExplore} />
        </ChartBlock>

        {/* Stacked points coverage */}
        <ChartBlock
          title="Points Coverage by Category"
          icon={Layers}
          subtitle="BIM points vs. the portion actually matched in the point-cloud scan, per category."
        >
          <StackedPointsBar categories={categories} />
        </ChartBlock>

        {/* Element coverage ranking */}
        <ChartBlock
          title="Element Coverage Ranking"
          icon={ListOrdered}
          subtitle="Compare individual BIM elements — search, sort best/least covered."
        >
          <ElementHorizontalBars elements={elements} />
        </ChartBlock>

        {/* Coverage heatmap */}
        <ChartBlock
          title="Category × Status Coverage Heatmap"
          icon={Grid3x3}
          subtitle="Element counts by category and completion status — spot weak spots at a glance."
        >
          <CoverageHeatmap categories={categories} elements={elements} />
        </ChartBlock>

        {/* Metric tabs */}
        <ChartBlock
          title="Category Metric Explorer"
          icon={BarChart3}
          subtitle="Drill into any of the 6 metrics per category — search, sort, zoom/pan, export."
          last
        >
        <div
          style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}
        >
          {CHART_METRICS.map((m) => {
            const active = metricKey === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMetricKey(m.key)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: active ? `1px solid ${m.color}` : "1px solid #e2e8f0",
                  background: active ? `${m.color}15` : "#fff",
                  color: active ? m.color : "#64748b",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Toolbar: search · sort · zoom · export */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            marginBottom: 14,
            padding: "10px 12px",
            background: "#f8fafc",
            border: "1px solid #eef2f6",
            borderRadius: 10,
          }}
        >
          <div style={{ position: "relative", flex: "1 1 200px", minWidth: 170 }}>
            <Search
              size={13}
              color="#94a3b8"
              style={{
                position: "absolute",
                left: 9,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontSize: 12,
                padding: "7px 26px 7px 28px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#0f172a",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#94a3b8",
                  display: "flex",
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <SortButton
              active={sortOrder === "default"}
              onClick={() => setSortOrder("default")}
              icon={ListOrdered}
              label="Default"
            />
            <SortButton
              active={sortOrder === "desc"}
              onClick={() => setSortOrder("desc")}
              icon={ArrowDownWideNarrow}
              label="High → Low"
            />
            <SortButton
              active={sortOrder === "asc"}
              onClick={() => setSortOrder("asc")}
              icon={ArrowUpWideNarrow}
              label="Low → High"
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IconBtn
              onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))}
              icon={ZoomOut}
              title="Zoom out"
              disabled={zoom <= 0.6}
            />
            <span
              style={{
                fontSize: 11,
                color: "#64748b",
                minWidth: 36,
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <IconBtn
              onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.2).toFixed(2)))}
              icon={ZoomIn}
              title="Zoom in"
              disabled={zoom >= 2.2}
            />
          </div>

          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button
              onClick={() => exportCategoriesToCSV(sorted.map((d) => d.raw), metricKey)}
              style={ghostBtn}
              title="Export the current view as CSV"
            >
              <FileDown size={13} />
              CSV
            </button>
            <button
              onClick={() =>
                exportChartToPNG(
                  sorted.map((d) => ({ ...d, color: metric.color })),
                  metric,
                )
              }
              style={ghostBtn}
              title="Export the chart as a PNG image"
            >
              <ImageDown size={13} />
              PNG
            </button>
            {isDirty && (
              <button onClick={resetView} style={ghostBtn} title="Reset view">
                <RotateCcw size={13} />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Status line */}
        <div
          style={{
            fontSize: 11,
            color: "#94a3b8",
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <MousePointerClick size={12} />
          <span>
            {metric.label} by BIM element category — hover a bar for details,
            click to focus{sorted.length > 8 || zoom !== 1 ? ", drag to pan" : ""}.
          </span>
          {search && (
            <span>
              Showing {sorted.length} of {categories.length} categories matching
              "{search}".
            </span>
          )}
        </div>

        {sorted.length === 0 ? (
          <div
            style={{
              padding: 34,
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            No categories match "{search}".
          </div>
        ) : (
          <InteractiveBarChart
            data={sorted}
            metric={metric}
            totalForPercent={totalForPercent}
            focused={focused}
            onToggleFocus={(cat) => setFocused((f) => (f === cat ? null : cat))}
            zoom={zoom}
            height={expanded ? 420 : 260}
          />
        )}

        {/* Focused category detail card */}
        {focusedCategoryData && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              background: `${metric.color}0d`,
              border: `1px solid ${metric.color}40`,
              borderLeft: `4px solid ${metric.color}`,
              borderRadius: 10,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                {focusedCategoryData.category}
              </span>
              <button
                onClick={() => setFocused(null)}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#94a3b8",
                  display: "flex",
                }}
                title="Clear focus"
              >
                <X size={13} />
              </button>
            </div>
            {CHART_METRICS.map((m) => (
              <div key={m.key} style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "#94a3b8",
                    fontWeight: 700,
                  }}
                >
                  {m.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: m.key === metricKey ? m.color : "#0f172a",
                  }}
                >
                  {m.format(focusedCategoryData[m.key] || 0)}
                </span>
              </div>
            ))}
          </div>
        )}
        </ChartBlock>
      </Section>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color, onClick, active }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 150,
        background: active ? `${color}10` : "#fff",
        border: active ? `2px solid ${color}` : "1px solid #e5e7eb",
        borderRadius: 12,
        padding: active ? "13px 15px" : "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={16} color={color} />
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: 24, fontWeight: 800, color: "#0f172a" }}>
        {value}
      </span>
    </div>
  );
}

export default function ProgressAssessmentPage({ routeParam: routeParamProp } = {}) {
  // Accepts routeParam as a prop (from PersistentWorkspace, which keeps this
  // page mounted across navigation to the Viewer/Analytics) — falls back to
  // the route param so this still works if ever rendered directly by a
  // matched <Route>.
  const params = useParams();
  const routeParam = routeParamProp ?? params.slug;
  const toast = useToast();
  const role = localStorage.getItem("role") || "viewer";

  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState("");
  const [bimList, setBimList] = useState([]);
  const [pcList, setPcList] = useState([]);
  const [bimId, setBimId] = useState("");
  const [pcId, setPcId] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // {elements, summary, categories, warnings}
  const [history, setHistory] = useState([]);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL"); // "ALL" | "completed" | "in_progress" | "not_started" | "incomplete"
  const chartSectionRef = useRef(null);
  const elementsSectionRef = useRef(null);
  const [justExplored, setJustExplored] = useState(false);
  const exploreTimerRef = useRef(null);

  const scrollToCharts = () => {
    chartSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // Completion gauge / breakdown click: jump to the Elements table below,
  // pre-filtered to the chosen bucket, with a brief highlight pulse.
  const handleExplore = (status) => {
    setStatusFilter(status);
    setTypeFilter("ALL");
    elementsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    clearTimeout(exploreTimerRef.current);
    setJustExplored(true);
    exploreTimerRef.current = setTimeout(() => setJustExplored(false), 1800);
  };

  const [pairs, setPairs] = useState([]);
  const [pairId, setPairId] = useState("");
  const [pairDateFilter, setPairDateFilter] = useState("ALL");
  const [pairPage, setPairPage] = useState(1);
  const PAIRS_PER_PAGE = 5;

  // Resolve project. The URL param can be a plain id ("7"), a slug
  // ("nextgen-operations-center"), or a composite "7_NextGen Operations Center".
  // Extract the leading integer id as a robust fallback.
  const leadingId = useMemo(() => {
    const n = parseInt(routeParam, 10);
    return Number.isFinite(n) ? n : null;
  }, [routeParam]);

  useEffect(() => {
    if (!routeParam) return;
    API.get("projects/")
      .then((res) => {
        const proj = (res.data || []).find(
          (p) =>
            p.slug === routeParam ||
            String(p.id) === String(routeParam) ||
            (leadingId != null && p.id === leadingId),
        );
        if (proj) {
          setProjectId(proj.id);
          setProjectName(proj.project_name);
        } else if (leadingId != null) {
          setProjectId(leadingId);
        }
      })
      .catch(() => {
        if (leadingId != null) setProjectId(leadingId);
      });
  }, [routeParam, leadingId]);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      API.get(`projects/${projectId}/bim/`),
      API.get(`projects/${projectId}/pointcloud/`),
      API.get(`processing/progress/history/${projectId}/`).catch(() => ({
        data: [],
      })),
      API.get(`processing/alignment/pairs/${projectId}/`).catch(() => ({
        data: [],
      })),
    ]).then(([b, p, h, pr]) => {
      setBimList(b.data || []);
      setPcList(p.data || []);
      setHistory(h.data || []);
      setPairs(pr.data || []);
    });
  }, [projectId]);

  const selectPair = (pid) => {
    setPairId(pid);
    const pair = pairs.find((p) => String(p.id) === String(pid));
    if (pair) {
      setBimId(String(pair.bim_id));
      setPcId(String(pair.pointcloud_id));
    } else {
      setBimId("");
      setPcId("");
    }
  };

  const runAnalysis = async () => {
    if (!bimId || !pcId) {
      toast.info("Select a BIM file and a Point Cloud file first.");
      return;
    }
    setAnalyzing(true);
    setResult(null);
    setStatusFilter("ALL");
    setElapsed(0);
    const t0 = Date.now();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const res = await API.post("processing/progress/analyze/", {
        bim_id: bimId,
        pointcloud_id: pcId,
      });
      setResult(res.data);
      (res.data.warnings || []).forEach((w) => toast.info(w));
      const secs = Math.round((Date.now() - t0) / 1000);
      if (!res.data.elements?.length)
        toast.info("No assessable BIM elements found in this IFC.");
      else
        toast.success(
          `Analyzed ${res.data.elements.length} elements in ${secs}s.`,
        );
    } catch (e) {
      toast.error(e.response?.data?.error || "Analysis failed.");
    } finally {
      setAnalyzing(false);
      clearInterval(timerRef.current);
    }
  };

  // Clean up the timer on unmount.
  useEffect(() => () => clearInterval(timerRef.current), []);
  useEffect(() => () => clearTimeout(exploreTimerRef.current), []);

  const saveAssessment = async () => {
    if (!result?.elements?.length) return;
    setSaving(true);
    try {
      await API.post("processing/progress/save/", {
        project_id: projectId,
        bim_id: bimId,
        pointcloud_id: pcId,
        summary: result.summary,
        elements: result.elements,
      });
      toast.success("Assessment saved.");
      const h = await API.get(`processing/progress/history/${projectId}/`);
      setHistory(h.data || []);
    } catch (e) {
      toast.error(e.response?.data?.error || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const elemLabel = (it, kind) =>
    `${fmtDate(it.date)} · ${it.description || it.file?.split("/").pop() || kind}`;

  // Pair date filter (by scan / point-cloud date) + pagination.
  const pairDates = useMemo(
    () =>
      Array.from(new Set(pairs.map((p) => p.pointcloud_date).filter(Boolean)))
        .sort()
        .reverse(),
    [pairs],
  );
  const filteredPairs = useMemo(
    () =>
      pairDateFilter === "ALL"
        ? pairs
        : pairs.filter((p) => p.pointcloud_date === pairDateFilter),
    [pairs, pairDateFilter],
  );
  const pairPageCount = Math.max(
    1,
    Math.ceil(filteredPairs.length / PAIRS_PER_PAGE),
  );
  const pagedPairs = useMemo(() => {
    const start = (pairPage - 1) * PAIRS_PER_PAGE;
    return filteredPairs.slice(start, start + PAIRS_PER_PAGE);
  }, [filteredPairs, pairPage]);

  const summary = result?.summary;
  const elementTypes = useMemo(() => {
    if (!result?.elements) return [];
    return Array.from(
      new Set(result.elements.map((e) => e.element_type)),
    ).sort();
  }, [result]);
  const filteredElements = useMemo(() => {
    if (!result?.elements) return [];
    return result.elements.filter((e) => {
      const typeOk = typeFilter === "ALL" || e.element_type === typeFilter;
      const statusOk =
        statusFilter === "ALL" ||
        (statusFilter === "incomplete"
          ? e.status !== "completed"
          : e.status === statusFilter);
      return typeOk && statusOk;
    });
  }, [result, typeFilter, statusFilter]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 52,
        display: "flex",
        flexDirection: "column",
        background: "#f0f4f8",
        overflow: "hidden",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <Header />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <IconToolbar
          activePanel={null}
          onSelectPanel={() => {}}
          role={role}
          projectSlug={routeParam}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Title bar */}
          <div
            style={{
              height: 40,
              flexShrink: 0,
              background: "#fff",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 16px",
            }}
          >
            <Boxes size={15} color="#4f46e5" />
            <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
              BIM Element Progress Assessment
            </span>
            <FolderOpen size={13} color="#94a3b8" style={{ marginLeft: 10 }} />
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {projectName || `Project #${projectId || "—"}`}
            </span>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {/* Selection bar */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "flex-end",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <Field label="Registered alignment pair (BIM ↔ Point Cloud)">
                <select
                  value={pairId}
                  onChange={(e) => selectPair(e.target.value)}
                  style={{ ...selectStyle, minWidth: 340 }}
                >
                  <option value="">Select a registered pair…</option>
                  {pairs.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      BIM {fmtDate(pr.bim_date)} ↔ PC{" "}
                      {fmtDate(pr.pointcloud_date)}
                      {pr.fitness != null
                        ? ` · ${Math.round(pr.fitness * 100)}% fit`
                        : ` · ${pr.method}`}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                style={primaryBtn}
              >
                <Play size={14} />
                {analyzing ? `Analyzing… ${elapsed}s` : "Analyze"}
              </button>
              {result?.elements?.length > 0 && (
                <button
                  onClick={saveAssessment}
                  disabled={saving}
                  style={saveBtn}
                >
                  <Save size={14} />
                  {saving ? "Saving…" : "Save Assessment"}
                </button>
              )}
              {result?.categories?.length > 0 && (
                <button onClick={scrollToCharts} style={chartsBtn}>
                  <BarChart3 size={14} />
                  Charts
                </button>
              )}
              <span
                style={{
                  flexBasis: "100%",
                  fontSize: 11,
                  color: pairs.length ? "#64748b" : "#dc2626",
                }}
              >
                {pairs.length} registered alignment pair
                {pairs.length !== 1 ? "s" : ""} for this project
                {` (${bimList.length} BIM · ${pcList.length} point-cloud uploads).`}
                {!pairs.length &&
                  " Align a BIM + point cloud, then click \"Save Alignment Pair\" in the viewer's Actions panel to create a pair."}
              </span>
            </div>

            {/* Registered pairs — filter by scan date, with pagination. */}
            {pairs.length > 0 && (
              <Section
                title={`Registered Alignment Pairs (${filteredPairs.length})`}
                right={
                  <select
                    value={pairDateFilter}
                    onChange={(e) => {
                      setPairDateFilter(e.target.value);
                      setPairPage(1);
                    }}
                    style={{ ...selectStyle, minWidth: 160 }}
                  >
                    <option value="ALL">All scan dates</option>
                    {pairDates.map((d) => (
                      <option key={d} value={d}>
                        {fmtDate(d)}
                      </option>
                    ))}
                  </select>
                }
              >
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {[
                        "#",
                        "BIM date",
                        "PC date",
                        "BIM id",
                        "PC id",
                        "Method",
                        "Overlap / Fit",
                        "Viewer Overlap",
                      ].map((h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPairs.map((pr) => (
                      <tr
                        key={pr.id}
                        onClick={() => selectPair(String(pr.id))}
                        style={{
                          cursor: "pointer",
                          background:
                            String(pr.id) === String(pairId)
                              ? "#eef2ff"
                              : "transparent",
                        }}
                      >
                        <td style={tdStyle}>{pr.id}</td>
                        <td style={tdStyle}>{fmtDate(pr.bim_date)}</td>
                        <td style={tdStyle}>{fmtDate(pr.pointcloud_date)}</td>
                        <td style={tdStyle}>{pr.bim_id}</td>
                        <td style={tdStyle}>{pr.pointcloud_id}</td>
                        <td style={tdStyle}>{pr.method}</td>
                        <td style={tdStyle}>
                          {pr.fitness != null ? (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <Bar pct={pr.fitness * 100} color="#4f46e5" />
                              <span style={{ width: 38 }}>
                                {Math.round(pr.fitness * 100)}%
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={tdStyle}>
                          {pr.has_overlap_snapshot ? (
                            <span
                              title={
                                pr.overlap_snapshot_at
                                  ? `Sent from viewer at ${new Date(pr.overlap_snapshot_at).toLocaleString()}`
                                  : "Sent from viewer"
                              }
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#16a34a",
                                background: "#f0fdf4",
                                borderRadius: 999,
                                padding: "2px 8px",
                              }}
                            >
                              ✓ {pr.overlap_element_count ?? ""} elements
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "#94a3b8" }}>
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {pairPageCount > 1 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 10,
                      fontSize: 12,
                      color: "#475569",
                    }}
                  >
                    <button
                      onClick={() => setPairPage((p) => Math.max(1, p - 1))}
                      disabled={pairPage <= 1}
                      style={pageBtn(pairPage <= 1)}
                    >
                      Prev
                    </button>
                    <span>
                      Page {pairPage} / {pairPageCount}
                    </span>
                    <button
                      onClick={() =>
                        setPairPage((p) => Math.min(pairPageCount, p + 1))
                      }
                      disabled={pairPage >= pairPageCount}
                      style={pageBtn(pairPage >= pairPageCount)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </Section>
            )}

            {analyzing && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      border: "2px solid #c7d2fe",
                      borderTopColor: "#4f46e5",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "pa-spin 0.7s linear infinite",
                    }}
                  />
                  <span
                    style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}
                  >
                    Analyzing scan coverage…
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#4f46e5",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {elapsed}s
                  </span>
                </div>
                {/* Indeterminate bar (no true %, the backend call is one pass). */}
                <div
                  style={{
                    height: 6,
                    borderRadius: 6,
                    background: "#eef2f6",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "35%",
                      height: "100%",
                      background: "#4f46e5",
                      borderRadius: 6,
                      animation: "pa-indet 1.2s ease-in-out infinite",
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
                  Extracting BIM elements → computing 3D volume → loading the
                  point cloud → matching overlapping points per element.
                  Large clouds / many elements take longer.
                </div>
                <style>{`
                  @keyframes pa-spin { to { transform: rotate(360deg); } }
                  @keyframes pa-indet {
                    0% { margin-left: -35%; }
                    100% { margin-left: 100%; }
                  }
                `}</style>
              </div>
            )}

            {!result && !analyzing && (
              <div style={{ color: "#94a3b8", fontSize: 13, padding: 24 }}>
                Pick a registered pair, then click Analyze. Elements are matched
                against scan coverage to estimate completion. (Align &amp; Save
                the models in the viewer first for accurate overlap.)
              </div>
            )}

            {summary && (
              <>
                {result?.overlap_source === "viewer_snapshot" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: "#166534",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginBottom: 12,
                    }}
                  >
                    ✓ Overlap Points below come from the viewer's live
                    "Overlapping PointCloud Points" check (sent via "Send
                    Overlap to Progress Assessment"), not server-side
                    alignment.
                  </div>
                )}
                {/* Summary cards + donut */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <SummaryCard
                    icon={Boxes}
                    label="Total Elements"
                    value={summary.total}
                    color="#4f46e5"
                    active={statusFilter === "ALL"}
                    onClick={() => setStatusFilter("ALL")}
                  />
                  <SummaryCard
                    icon={CheckCircle2}
                    label="Completed"
                    value={summary.completed}
                    color="#16a34a"
                    active={statusFilter === "completed"}
                    onClick={() =>
                      setStatusFilter((f) =>
                        f === "completed" ? "ALL" : "completed",
                      )
                    }
                  />
                  <SummaryCard
                    icon={Loader}
                    label="In Progress"
                    value={summary.in_progress}
                    color="#d97706"
                    active={statusFilter === "in_progress"}
                    onClick={() =>
                      setStatusFilter((f) =>
                        f === "in_progress" ? "ALL" : "in_progress",
                      )
                    }
                  />
                  <SummaryCard
                    icon={CircleDashed}
                    label="Not Started"
                    value={summary.not_started}
                    color="#dc2626"
                    active={statusFilter === "not_started"}
                    onClick={() =>
                      setStatusFilter((f) =>
                        f === "not_started" ? "ALL" : "not_started",
                      )
                    }
                  />
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Donut
                      completed={summary.completed}
                      inProgress={summary.in_progress}
                      notStarted={summary.not_started}
                    />
                    <div style={{ fontSize: 11, color: "#475569" }}>
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: "#0f172a",
                        }}
                      >
                        {summary.overall_completion}% overall
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Legend c="#16a34a" t="Completed" />
                        <Legend c="#d97706" t="In Progress" />
                        <Legend c="#dc2626" t="Not Started" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Category breakdown */}
                {result.categories?.length > 0 && (
                  <Section title="By Category">
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {[
                            "Category",
                            "Count",
                            "BIM Volume (m³)",
                            "Overlap Volume (m³)",
                            "BIM Points",
                            "Overlap Points",
                            "Completion",
                          ].map((h) => (
                            <th key={h} style={thStyle}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.categories.map((c) => (
                          <tr key={c.category}>
                            <td style={tdStyle}>{c.category}</td>
                            <td style={tdStyle}>{c.count}</td>
                            <td style={tdStyle}>{c.bim_volume}</td>
                            <td style={tdStyle}>{c.overlap_volume}</td>
                            <td style={tdStyle}>{c.bim_points.toLocaleString()}</td>
                            <td style={tdStyle}>
                              {c.overlap_points.toLocaleString()}
                            </td>
                            <td style={tdStyle}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <Bar pct={c.completion} color="#4f46e5" />
                                <span style={{ width: 38 }}>
                                  {c.completion}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Section>
                )}

                {/* Category analytics dashboard (interactive, ICED-style) */}
                {result.categories?.length > 0 && (
                  <CategoryChartsPanel
                    categories={result.categories}
                    elements={result.elements || []}
                    summary={summary}
                    history={history}
                    panelRef={chartSectionRef}
                    onExplore={handleExplore}
                  />
                )}

                {/* Element table */}
                <div
                  ref={elementsSectionRef}
                  style={{
                    borderRadius: 12,
                    transition: "box-shadow 0.3s ease",
                    boxShadow: justExplored ? "0 0 0 3px #4f46e555" : "0 0 0 0px transparent",
                  }}
                >
                <Section
                  title={`Elements (${filteredElements.length}${
                    statusFilter !== "ALL"
                      ? ` · ${STATUS_META[statusFilter].label}`
                      : ""
                  })`}
                  right={
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      {statusFilter !== "ALL" && (
                        <button
                          onClick={() => setStatusFilter("ALL")}
                          style={{
                            fontSize: 11,
                            color: STATUS_META[statusFilter].color,
                            background: STATUS_META[statusFilter].bg,
                            border: "none",
                            borderRadius: 999,
                            padding: "4px 10px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {STATUS_META[statusFilter].label} ✕
                        </button>
                      )}
                      <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        style={{ ...selectStyle, minWidth: 140 }}
                      >
                        <option value="ALL">All types</option>
                        {elementTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  }
                >
                  <div style={{ maxHeight: 380, overflowY: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {[
                            "Element ID",
                            "Type",
                            "BIM Volume (m³)",
                            "BIM Points",
                            "Overlap Points",
                            "Completion",
                            "Status",
                          ].map((h) => (
                            <th key={h} style={thStyle}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredElements.map((e, i) => {
                          const st = STATUS_META[e.status];
                          return (
                            <tr key={e.element_id + i}>
                              <td
                                style={{
                                  ...tdStyle,
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                }}
                              >
                                {e.name || e.element_id}
                              </td>
                              <td style={tdStyle}>{e.element_type}</td>
                              <td style={tdStyle}>{e.bim_volume}</td>
                              <td style={tdStyle}>{e.bim_points.toLocaleString()}</td>
                              <td style={tdStyle}>
                                {e.overlap_points.toLocaleString()}
                              </td>
                              <td style={tdStyle}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <Bar pct={e.completion} color={st.color} />
                                  <span style={{ width: 38 }}>
                                    {e.completion}%
                                  </span>
                                </div>
                              </td>
                              <td style={tdStyle}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: st.color,
                                    background: st.bg,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                  }}
                                >
                                  {st.label}
                                </span>
                                {e.verified === true && (
                                  <span
                                    title={`Planar surface confirmed in scan${
                                      e.plane_inlier != null
                                        ? ` (${Math.round(e.plane_inlier * 100)}% planar)`
                                        : ""
                                    }`}
                                    style={{
                                      marginLeft: 6,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: "#0891b2",
                                    }}
                                  >
                                    ✓ verified
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Section>
                </div>
              </>
            )}

            {/* Progress over time */}
            {history.length > 0 && (
              <Section title="Progress Over Time">
                <TrendLineChart history={history} />
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small presentational helpers ───────────────────────────────────────────
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
function Section({ title, right, children }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}
function Legend({ c, t }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
      <span>{t}</span>
    </div>
  );
}

const selectStyle = {
  fontSize: 12,
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  minWidth: 220,
};
const primaryBtn = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "#4f46e5",
  color: "#fff",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};
const saveBtn = { ...primaryBtn, background: "#16a34a" };
const chartsBtn = { ...primaryBtn, background: "#0ea5e9" };
const pageBtn = (disabled) => ({
  padding: "5px 12px",
  borderRadius: 7,
  border: "1px solid #e2e8f0",
  background: disabled ? "#f1f5f9" : "#fff",
  color: disabled ? "#cbd5e1" : "#334155",
  cursor: disabled ? "default" : "pointer",
  fontSize: 12,
  fontWeight: 600,
});
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#94a3b8",
  borderBottom: "1px solid #e5e7eb",
  position: "sticky",
  top: 0,
  background: "#fff",
};
const tdStyle = {
  padding: "8px 10px",
  borderBottom: "1px solid #f1f5f9",
  color: "#334155",
};
