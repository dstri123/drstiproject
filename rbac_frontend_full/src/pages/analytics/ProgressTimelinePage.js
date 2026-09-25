import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import API from "../../api/axios";
import Header from "../viewer/layout/Header";
import IconToolbar from "../viewer/layout/IconToolbar";
import { useToast } from "../../components/ToastContainer";
import { FolderOpen, CalendarRange, ArrowLeft, Loader, Download } from "lucide-react";

const STATUS_COLORS = {
  completed: "#16a34a",
  in_progress: "#d97706",
  not_started: "#dc2626",
};

function fmtDate(d) {
  return d || "No date";
}

// Label for a timeline entry — a period label when the entry represents a
// grouped week/month/year, otherwise the scan date itself.
function dateLabel(d) {
  return d.label || fmtDate(d.pointcloud_date);
}

const VIEW_MODES = [
  { key: "last3", label: "Last 3 dates" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "year", label: "Yearly" },
  { key: "all", label: "All dates" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parse "YYYY-MM-DD" as a UTC date so week/month bucketing isn't shifted by
// the viewer's timezone.
function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function isoDay(dt) {
  return dt.toISOString().slice(0, 10);
}

// Bucket key + display label for a date under the given period.
function periodOf(dt, mode) {
  if (mode === "year") {
    const y = dt.getUTCFullYear();
    return { key: `${y}`, label: `${y}` };
  }
  if (mode === "month") {
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth();
    return { key: `${y}-${String(mo + 1).padStart(2, "0")}`, label: `${MONTHS[mo]} ${y}` };
  }
  // week — ISO-style, starting Monday
  const start = new Date(dt);
  start.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return { key: isoDay(start), label: `Week of ${isoDay(start)}` };
}

// Reduce the timeline to what the selected view shows. For weekly / monthly /
// yearly views, each period is represented by its latest scan that has a saved
// assessment (progress is cumulative, so the latest scan is the period's
// end-state). Entries without a scan date can't be placed in a period.
function applyViewMode(dates, mode) {
  const dated = dates.filter((d) => parseISODate(d.pointcloud_date));
  if (mode === "all") return dates;
  if (mode === "last3") return (dated.length ? dated : dates).slice(-3);

  const buckets = new Map();
  dated.forEach((d) => {
    const p = periodOf(parseISODate(d.pointcloud_date), mode);
    const b = buckets.get(p.key) || { ...p, entries: [] };
    b.entries.push(d);
    buckets.set(p.key, b);
  });
  return Array.from(buckets.values())
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((b) => {
      const assessed = b.entries.filter((e) => e.summary);
      const rep = (assessed.length ? assessed : b.entries).slice(-1)[0];
      const n = b.entries.length;
      return {
        ...rep,
        label: b.label,
        subLabel: `${n} scan${n === 1 ? "" : "s"} · latest ${rep.pointcloud_date}`,
      };
    });
}

// Percentage with up to 2 decimals: 51.43%, 7.15%, 100%.
function fmtPct(v) {
  return `${Math.round((v || 0) * 100) / 100}%`;
}

function fmtNum(n) {
  return (n || 0).toLocaleString();
}

function catOf(d, cat) {
  return (d.categories || []).find((x) => x.category === cat);
}

function deltaText(delta) {
  if (delta == null) return "";
  return delta === 0 ? "no change" : `${delta > 0 ? "+" : "−"}${fmtNum(Math.abs(delta))}`;
}

function DeltaBadge({ delta, small }) {
  if (delta == null) return <div style={{ height: small ? 12 : 14 }} />;
  const color = delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8";
  return (
    <div
      title="Change in completed elements vs the previous date shown"
      style={{
        fontSize: small ? 8 : 9,
        fontWeight: 700,
        color,
        lineHeight: small ? "12px" : "14px",
        whiteSpace: "nowrap",
      }}
    >
      {deltaText(delta)}
    </div>
  );
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

function drawLegend(ctx, items, x, y) {
  ctx.font = "11px Segoe UI, Arial, sans-serif";
  let cx = x;
  items.forEach((it) => {
    ctx.fillStyle = it.color;
    roundRectPath(ctx, cx, y - 9, 10, 10, 2);
    ctx.fill();
    ctx.fillStyle = "#475569";
    ctx.textAlign = "left";
    ctx.fillText(it.label, cx + 16, y);
    cx += 16 + ctx.measureText(it.label).width + 20;
  });
}

// Renders the status-by-date chart to an offscreen canvas (no external
// deps, matching the app's existing chart-export convention) and downloads
// it as a PNG.
function exportStatusChartToPNG(dates) {
  const W = Math.max(640, dates.length * 130 + 140);
  const H = 400;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 15px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Completed / In Progress / Not Started by Point Cloud date", 24, 30);

  drawLegend(
    ctx,
    [
      { label: "Completed", color: STATUS_COLORS.completed },
      { label: "In Progress", color: STATUS_COLORS.in_progress },
      { label: "Not Started", color: STATUS_COLORS.not_started },
    ],
    24,
    58,
  );

  const marginLeft = 24;
  const marginRight = 24;
  const marginTop = 100;
  const marginBottom = 60;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  const maxCount = Math.max(
    1,
    ...dates.flatMap((d) => [
      d.summary?.completed || 0,
      d.summary?.in_progress || 0,
      d.summary?.not_started || 0,
    ]),
  );

  const n = dates.length || 1;
  const slot = plotW / n;
  const barW = Math.min(22, slot / 5);
  const gap = 6;

  dates.forEach((d, i) => {
    const s = d.summary;
    const groupCx = marginLeft + slot * i + slot / 2;
    const bars = s
      ? [
          { value: s.completed, color: STATUS_COLORS.completed },
          { value: s.in_progress, color: STATUS_COLORS.in_progress },
          { value: s.not_started, color: STATUS_COLORS.not_started },
        ]
      : [];
    const groupW = bars.length * barW + (bars.length - 1) * gap;
    const startX = groupCx - groupW / 2;

    if (s) {
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${fmtPct(s.overall_completion)} overall`, groupCx, marginTop - 22);
      ctx.fillStyle = STATUS_COLORS.completed;
      ctx.fillText(`${fmtNum(s.completed)} / ${fmtNum(s.total)} completed`, groupCx, marginTop - 10);
    }

    bars.forEach((b, j) => {
      const h = maxCount ? Math.max(2, (b.value / maxCount) * (plotH - 14)) : 2;
      const x = startX + j * (barW + gap);
      const y = marginTop + plotH - h;
      ctx.fillStyle = b.color;
      roundRectPath(ctx, x, y, barW, h, 3);
      ctx.fill();
      ctx.font = "bold 9px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(fmtNum(b.value), x + barW / 2, y - 4);
    });

    ctx.fillStyle = "#475569";
    ctx.font = "11px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(dateLabel(d), groupCx, marginTop + plotH + 22);
  });

  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(marginLeft, marginTop + plotH);
  ctx.lineTo(marginLeft + plotW, marginTop + plotH);
  ctx.stroke();

  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `progress-timeline-status-${Date.now()}.png`);
  }, "image/png");
}

// Renders the category small-multiples chart to an offscreen canvas and
// downloads it as a PNG.
function exportCategoryChartsToPNG(dates, categories) {
  const cols = Math.min(4, Math.max(1, categories.length));
  const cellW = 260;
  const cellH = 190;
  const pad = 24;
  const rows = Math.ceil(categories.length / cols);
  const W = pad * 2 + cols * cellW;
  const H = pad * 2 + 40 + rows * cellH;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 15px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Category completion by date", pad, pad + 6);

  categories.forEach((cat, ci) => {
    const color = COMPLETION_COLOR;
    const col = ci % cols;
    const row = Math.floor(ci / cols);
    const cellX = pad + col * cellW;
    const cellY = pad + 40 + row * cellH;

    ctx.strokeStyle = "#e5e7eb";
    ctx.strokeRect(cellX + 6, cellY, cellW - 20, cellH - 20);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(cat, cellX + 18, cellY + 22);

    const plotLeft = cellX + 18;
    const plotBottom = cellY + cellH - 46;
    const plotH = 80;
    const n = dates.length || 1;
    const barSlot = (cellW - 56) / n;
    const barW = Math.min(20, barSlot * 0.6);

    dates.forEach((d, di) => {
      const c = d.categories.find((x) => x.category === cat);
      const pct = c?.completion || 0;
      const bx = plotLeft + barSlot * di + barSlot / 2;
      const h = (pct / 100) * plotH;

      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(bx - barW / 2, plotBottom - plotH, barW, plotH);
      ctx.fillStyle = color;
      ctx.fillRect(bx - barW / 2, plotBottom - h, barW, h);

      ctx.fillStyle = "#334155";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(c ? fmtPct(pct) : "—", bx, plotBottom - plotH - 18);
      if (c) {
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 9px Segoe UI, Arial, sans-serif";
        ctx.fillText(`${fmtNum(c.completed)}/${fmtNum(c.count)}`, bx, plotBottom - plotH - 6);
      }

      ctx.fillStyle = "#94a3b8";
      ctx.fillText(dateLabel(d), bx, plotBottom + 14);
    });
  });

  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `progress-timeline-categories-${Date.now()}.png`);
  }, "image/png");
}

function DownloadButton({ onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title || "Download chart as PNG"}
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        border: "1px solid #e2e8f0",
        background: "#fff",
        color: "#64748b",
        cursor: "pointer",
      }}
    >
      <Download size={14} />
    </button>
  );
}

function Legend({ items, hidden, onToggle }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, color: "#64748b" }}>
      {items.map((it) => {
        const off = hidden?.has(it.key);
        const Tag = onToggle ? "button" : "div";
        return (
          <Tag
            key={it.label}
            onClick={onToggle ? () => onToggle(it.key) : undefined}
            title={onToggle ? `Click to ${off ? "show" : "hide"} ${it.label}` : undefined}
            aria-pressed={onToggle ? !off : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: onToggle ? "3px 8px" : 0,
              border: onToggle ? "1px solid #e5e7eb" : "none",
              borderRadius: 999,
              background: "#fff",
              color: off ? "#cbd5e1" : "#475569",
              textDecoration: off ? "line-through" : "none",
              cursor: onToggle ? "pointer" : "default",
              fontSize: 11,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: off ? "#e2e8f0" : it.color,
                display: "inline-block",
              }}
            />
            {it.label}
          </Tag>
        );
      })}
    </div>
  );
}

// ─── Shared hover / focus tooltip ───────────────────────────────────────────
// Portaled to <body> with position: fixed so card/scroll containers never clip
// it. `tip` = { x, y, title, subtitle, rows: [{ color, label, value, note }], footer }.
function Tip({ tip }) {
  if (!tip) return null;
  const W = 250;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(tip.x + 14, vw - W - 8));
  const flipUp = tip.y > vh - 220;
  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left,
        top: flipUp ? tip.y - 12 : tip.y + 14,
        transform: flipUp ? "translateY(-100%)" : "none",
        width: W,
        background: "#0f172a",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 10px 30px rgba(15,23,42,0.25)",
        pointerEvents: "none",
        zIndex: 3000,
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 12 }}>{tip.title}</div>
      {tip.subtitle && <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 6 }}>{tip.subtitle}</div>}
      {tip.rows?.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: r.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
          <span style={{ color: "#94a3b8" }}>{r.label}</span>
          {r.note && (
            <span style={{ marginLeft: "auto", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
              {r.note}
            </span>
          )}
        </div>
      ))}
      {tip.footer && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px solid #1e293b",
            color: "#cbd5e1",
            fontSize: 10,
          }}
        >
          {tip.footer}
        </div>
      )}
    </div>,
    document.body,
  );
}

// Props that wire an element to the shared tooltip for both pointer and
// keyboard users. `build()` returns the tooltip content (minus x/y).
function tipHandlers(setTip, build) {
  return {
    tabIndex: 0,
    onPointerMove: (e) => setTip({ ...build(), x: e.clientX, y: e.clientY }),
    onPointerLeave: () => setTip(null),
    onFocus: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ ...build(), x: r.right, y: r.top });
    },
    onBlur: () => setTip(null),
  };
}

const pctOf = (n, total) => (total ? ((n || 0) / total) * 100 : 0);

function changeLine(delta, prevLabel, noun = "completed") {
  if (delta == null) return "First date in view — nothing to compare yet.";
  if (delta === 0) return `No change in ${noun} vs ${prevLabel}.`;
  return `${delta > 0 ? "+" : "−"}${fmtNum(Math.abs(delta))} ${noun} vs ${prevLabel}`;
}

function prevIndexWith(dates, i, has) {
  for (let j = Math.min(i, dates.length) - 1; j >= 0; j--) if (dates[j] && has(dates[j])) return j;
  return -1;
}

function statusTip(d, prev) {
  const s = d.summary;
  if (!s) {
    return { title: dateLabel(d), subtitle: d.subLabel, footer: "No saved assessment for this date yet." };
  }
  const delta = prev?.summary ? s.completed - prev.summary.completed : null;
  return {
    title: dateLabel(d),
    subtitle: d.subLabel || `${fmtNum(s.total)} BIM elements assessed`,
    rows: [
      { color: STATUS_COLORS.completed, label: "completed", value: fmtNum(s.completed), note: fmtPct(pctOf(s.completed, s.total)) },
      { color: STATUS_COLORS.in_progress, label: "in progress", value: fmtNum(s.in_progress), note: fmtPct(pctOf(s.in_progress, s.total)) },
      { color: STATUS_COLORS.not_started, label: "not started", value: fmtNum(s.not_started), note: fmtPct(pctOf(s.not_started, s.total)) },
    ],
    footer: (
      <>
        <div>
          <b style={{ color: "#fff" }}>{fmtPct(s.overall_completion)}</b> overall completion
        </div>
        <div>{changeLine(delta, prev ? dateLabel(prev) : "")}</div>
      </>
    ),
  };
}

function categoryTip(cat, d, prev) {
  const c = catOf(d, cat);
  if (!c) return { title: cat, subtitle: dateLabel(d), footer: "No data for this category on this date." };
  const p = prev ? catOf(prev, cat) : null;
  const delta = p ? c.completed - p.completed : null;
  const ppDelta = p ? (c.completion || 0) - (p.completion || 0) : null;
  return {
    title: cat,
    subtitle: `${dateLabel(d)}${d.subLabel ? ` · ${d.subLabel}` : ""}`,
    rows: [
      { color: STATUS_COLORS.completed, label: "completed", value: `${fmtNum(c.completed)} / ${fmtNum(c.count)}`, note: fmtPct(c.completion) },
      { color: STATUS_COLORS.in_progress, label: "in progress", value: fmtNum(c.in_progress), note: fmtPct(pctOf(c.in_progress, c.count)) },
      { color: STATUS_COLORS.not_started, label: "not started", value: fmtNum(c.not_started), note: fmtPct(pctOf(c.not_started, c.count)) },
    ],
    footer: (
      <>
        <div>
          {changeLine(delta, prev ? dateLabel(prev) : "")}
          {ppDelta != null && ppDelta !== 0 ? ` (${ppDelta > 0 ? "+" : "−"}${fmtPct(Math.abs(ppDelta))})` : ""}
        </div>
        {c.points_coverage != null && <div>{fmtPct(c.points_coverage)} points coverage</div>}
        <div style={{ color: "#64748b", marginTop: 2 }}>Click to open {cat} details</div>
      </>
    ),
  };
}

// ─── Summary tiles for the selected date ────────────────────────────────────
function StatTiles({ dates, selIdx }) {
  const d = dates[selIdx];
  const s = d?.summary;
  const pi = prevIndexWith(dates, selIdx, (x) => x.summary);
  const prev = pi >= 0 ? dates[pi].summary : null;
  const tiles = s
    ? [
        {
          label: "Overall completion",
          value: fmtPct(s.overall_completion),
          sub: `${fmtNum(s.completed)} of ${fmtNum(s.total)} elements`,
          delta: prev ? (s.overall_completion || 0) - (prev.overall_completion || 0) : null,
          deltaFmt: (v) => `${v > 0 ? "+" : "−"}${fmtPct(Math.abs(v))}`,
        },
        { label: "Completed", color: STATUS_COLORS.completed, value: fmtNum(s.completed), sub: fmtPct(pctOf(s.completed, s.total)) + " of elements", delta: prev ? s.completed - prev.completed : null },
        { label: "In progress", color: STATUS_COLORS.in_progress, value: fmtNum(s.in_progress), sub: fmtPct(pctOf(s.in_progress, s.total)) + " of elements", delta: prev ? s.in_progress - prev.in_progress : null, neutral: true },
        { label: "Not started", color: STATUS_COLORS.not_started, value: fmtNum(s.not_started), sub: fmtPct(pctOf(s.not_started, s.total)) + " of elements", delta: prev ? s.not_started - prev.not_started : null, invert: true },
      ]
    : [];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
        Selected: <b style={{ color: "#0f172a" }}>{d ? dateLabel(d) : "—"}</b>
        {pi >= 0 && <> · compared with {dateLabel(dates[pi])}</>}
        <span style={{ color: "#94a3b8" }}> — click a date in the chart below to change it.</span>
      </div>
      {s ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          {tiles.map((t) => {
            // Up is good for completed/overall, bad for not-started; in-progress is neutral.
            const good = t.delta == null || t.delta === 0 || t.neutral ? null : t.invert ? t.delta < 0 : t.delta > 0;
            return (
              <div
                key={t.label}
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                  {t.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color }} />}
                  {t.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                  {t.value}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{t.sub}</div>
                {t.delta != null && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      marginTop: 4,
                      color: good == null ? "#64748b" : good ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {t.delta === 0
                      ? "No change"
                      : t.deltaFmt
                        ? t.deltaFmt(t.delta)
                        : `${t.delta > 0 ? "▲ +" : "▼ −"}${fmtNum(Math.abs(t.delta))}`}
                    <span style={{ color: "#94a3b8", fontWeight: 500 }}> vs previous</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#94a3b8" }}>No saved assessment for this date yet.</div>
      )}
    </div>
  );
}

// ─── Segmented toggle ───────────────────────────────────────────────────────
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "#f1f5f9", borderRadius: 8 }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: 6,
              border: "none",
              background: active ? "#fff" : "transparent",
              color: active ? "#0f172a" : "#64748b",
              boxShadow: active ? "0 1px 2px rgba(15,23,42,0.12)" : "none",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const STATUS_KEYS = [
  { key: "completed", label: "Completed", color: STATUS_COLORS.completed },
  { key: "in_progress", label: "In Progress", color: STATUS_COLORS.in_progress },
  { key: "not_started", label: "Not Started", color: STATUS_COLORS.not_started },
];

// ─── Chart 1: Completed / In Progress / Not Started per date ───────────────
// Side-by-side bars (absolute counts) or 100%-stacked (share of all elements).
// Hover a date for the full breakdown; click it to select that date for the
// tiles, category cards and comparison table.
function StatusByDateChart({ dates, selIdx, onSelect, setTip }) {
  const [layout, setLayout] = useState("grouped");
  const [hidden, setHidden] = useState(() => new Set());
  const toggle = (k) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const visible = STATUS_KEYS.filter((k) => !hidden.has(k.key));
  const barAreaHeight = 190;
  // Scale each status bar against the largest single visible count, so a
  // bar's height reflects its own value (the element total barely changes).
  const maxCount = Math.max(1, ...dates.flatMap((d) => visible.map((k) => d.summary?.[k.key] || 0)));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
        <Legend items={STATUS_KEYS} hidden={hidden} onToggle={toggle} />
        <Segmented
          options={[
            { key: "grouped", label: "Counts" },
            { key: "stacked", label: "100% stacked" },
          ]}
          value={layout}
          onChange={setLayout}
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          marginTop: 16,
          overflowX: "auto",
          padding: "0 4px 4px",
        }}
      >
        {dates.map((d, di) => {
          const s = d.summary;
          const selected = di === selIdx;
          const pi = prevIndexWith(dates, di, (x) => x.summary);
          const prev = pi >= 0 ? dates[pi] : null;
          const delta = prev && s ? s.completed - prev.summary.completed : null;
          return (
            <div
              key={d.pair_id}
              role="button"
              aria-pressed={selected}
              aria-label={`${dateLabel(d)} — select this date`}
              onClick={() => onSelect(di)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(di);
                }
              }}
              {...tipHandlers(setTip, () => statusTip(d, prev))}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: "0 0 140px",
                padding: "8px 4px 6px",
                borderRadius: 10,
                cursor: "pointer",
                background: selected ? "#eef2ff" : "transparent",
                outline: selected ? "1.5px solid #c7d2fe" : "none",
                transition: "background 0.15s",
              }}
            >
              <div style={{ fontSize: 11, color: "#0f172a", fontWeight: 800 }}>
                {s ? `${fmtPct(s.overall_completion)} overall` : "—"}
              </div>
              {s && (
                <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, marginTop: 1 }}>
                  {`${fmtNum(s.completed)} / ${fmtNum(s.total)} completed`}
                </div>
              )}
              <DeltaBadge delta={delta} />
              {s ? (
                layout === "grouped" ? (
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: barAreaHeight, marginTop: 4 }}>
                    {visible.map((k) => (
                      <div key={k.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 38 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", marginBottom: 2, fontVariantNumeric: "tabular-nums" }}>
                          {fmtNum(s[k.key])}
                        </div>
                        <div
                          style={{
                            width: 22,
                            height: Math.max(2, ((s[k.key] || 0) / maxCount) * (barAreaHeight - 16)),
                            background: k.color,
                            borderRadius: "4px 4px 0 0",
                            transition: "height 0.35s cubic-bezier(.4,0,.2,1)",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      width: 44,
                      height: barAreaHeight,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column-reverse",
                      gap: 2,
                    }}
                  >
                    {visible.map((k) => {
                      const share = pctOf(s[k.key], s.total);
                      const h = (share / 100) * (barAreaHeight - (visible.length - 1) * 2);
                      return (
                        <div
                          key={k.key}
                          style={{
                            height: h,
                            background: k.color,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            fontWeight: 800,
                            color: "#fff",
                            overflow: "hidden",
                            transition: "height 0.35s cubic-bezier(.4,0,.2,1)",
                          }}
                        >
                          {h >= 14 ? `${Math.round(share)}%` : ""}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div style={{ width: 22, height: 4, background: "#e2e8f0", borderRadius: 3, marginTop: barAreaHeight }} />
              )}
              <div
                style={{
                  fontSize: 10,
                  color: selected ? "#0f172a" : "#64748b",
                  fontWeight: selected ? 800 : 500,
                  marginTop: 8,
                  paddingTop: 6,
                  borderTop: "1px solid #e2e8f0",
                  width: "100%",
                  textAlign: "center",
                }}
              >
                {dateLabel(d)}
              </div>
              {d.subLabel && (
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2, textAlign: "center" }}>{d.subLabel}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const COMPLETION_COLOR = "#4f46e5";

const CATEGORY_SORTS = [
  { key: "name", label: "Name (A–Z)" },
  { key: "pct_desc", label: "Completion: high → low" },
  { key: "pct_asc", label: "Completion: low → high" },
  { key: "gain", label: "Biggest gain" },
  { key: "drop", label: "Biggest drop" },
  { key: "size", label: "Most elements" },
];

const inputStyle = {
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
};

// ─── Chart 2: per-category completion — small multiples, one per category ──
function CategoryByDateCharts({ dates, categories, selIdx, onSelect, onOpen, openCat, setTip }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [hideEmpty, setHideEmpty] = useState(false);

  const sel = dates[selIdx];
  const pi = prevIndexWith(dates, selIdx, (x) => x.categories?.length);
  const prev = pi >= 0 ? dates[pi] : null;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = categories
      .filter((cat) => !q || cat.toLowerCase().includes(q))
      .map((cat) => {
        const c = sel ? catOf(sel, cat) : null;
        const p = prev ? catOf(prev, cat) : null;
        return {
          cat,
          c,
          delta: c && p ? c.completed - p.completed : null,
          everCompleted: dates.some((d) => (catOf(d, cat)?.completed || 0) > 0),
        };
      })
      .filter((r) => !hideEmpty || r.everCompleted);
    const by = {
      name: (a, b) => a.cat.localeCompare(b.cat),
      pct_desc: (a, b) => (b.c?.completion || 0) - (a.c?.completion || 0),
      pct_asc: (a, b) => (a.c?.completion || 0) - (b.c?.completion || 0),
      gain: (a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity),
      drop: (a, b) => (a.delta ?? Infinity) - (b.delta ?? Infinity),
      size: (a, b) => (b.c?.count || 0) - (a.c?.count || 0),
    }[sort];
    return list.sort(by);
  }, [categories, dates, sel, prev, search, sort, hideEmpty]);

  if (!categories.length) {
    return (
      <div style={{ fontSize: 12, color: "#94a3b8" }}>
        No saved assessments yet — save an assessment for at least one Point
        Cloud date to see category trends.
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories…"
          aria-label="Search categories"
          style={{ ...inputStyle, flex: "1 1 180px", maxWidth: 260 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort categories" style={inputStyle}>
          {CATEGORY_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide categories with nothing completed
        </label>
        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
          {rows.length} of {categories.length} categories · sorted by {sel ? dateLabel(sel) : "—"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "#94a3b8", padding: 20, textAlign: "center" }}>
          No categories match "{search}".
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {rows.map(({ cat, c, delta }) => {
            const isOpen = openCat === cat;
            return (
              <div
                key={cat}
                style={{
                  border: `1px solid ${isOpen ? "#a5b4fc" : "#e5e7eb"}`,
                  boxShadow: isOpen ? "0 0 0 3px #eef2ff" : "none",
                  borderRadius: 10,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <button
                  onClick={() => onOpen(isOpen ? null : cat)}
                  title={`Open ${cat} details`}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "block",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>{cat}</span>
                    <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 700 }}>{isOpen ? "Close" : "Details →"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                      {c ? fmtPct(c.completion) : "—"}
                    </span>
                    <span style={{ fontSize: 11, color: "#475569", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {c ? `${fmtNum(c.completed)} / ${fmtNum(c.count)}` : ""}
                    </span>
                    <span style={{ marginLeft: "auto" }}>
                      <DeltaBadge delta={delta} />
                    </span>
                  </div>
                  {/* Status split for the selected date */}
                  {c && c.count > 0 && (
                    <div style={{ display: "flex", gap: 2, height: 6, marginTop: 6, borderRadius: 3, overflow: "hidden" }}>
                      {STATUS_KEYS.map((k) =>
                        c[k.key] ? (
                          <div key={k.key} style={{ flex: c[k.key], background: k.color }} />
                        ) : null,
                      )}
                    </div>
                  )}
                </button>

                {/* Mini bars across dates */}
                <div style={{ overflowX: "auto", marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end", minWidth: dates.length * 40 }}>
                    {dates.map((d, di) => {
                      const cd = catOf(d, cat);
                      const pct = cd?.completion || 0;
                      const dpi = prevIndexWith(dates, di, (x) => catOf(x, cat));
                      const dprev = dpi >= 0 ? dates[dpi] : null;
                      const selected = di === selIdx;
                      return (
                        <div
                          key={d.pair_id}
                          role="button"
                          aria-label={`${cat}, ${dateLabel(d)}: ${cd ? `${cd.completed} of ${cd.count} completed, ${fmtPct(pct)}` : "no data"}`}
                          onClick={() => onSelect(di)}
                          {...tipHandlers(setTip, () => categoryTip(cat, d, dprev))}
                          style={{
                            flex: 1,
                            minWidth: 34,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            cursor: "pointer",
                            padding: "2px 0",
                            borderRadius: 6,
                            background: selected ? "#eef2ff" : "transparent",
                          }}
                        >
                          <div style={{ fontSize: 9, color: "#475569", fontWeight: selected ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>
                            {cd ? `${fmtNum(cd.completed)}` : "—"}
                          </div>
                          <div
                            style={{
                              width: 20,
                              height: 56,
                              background: "#f1f5f9",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "flex-end",
                              overflow: "hidden",
                              marginTop: 2,
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: `${pct}%`,
                                minHeight: pct > 0 ? 2 : 0,
                                background: COMPLETION_COLOR,
                                opacity: selected ? 1 : 0.45,
                                borderRadius: "4px 4px 0 0",
                                transition: "height 0.35s cubic-bezier(.4,0,.2,1)",
                              }}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: 8,
                              color: selected ? "#0f172a" : "#94a3b8",
                              fontWeight: selected ? 800 : 500,
                              marginTop: 3,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {dateLabel(d).replace(/^Week of /, "Wk ")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Detail panel for one category: status counts per date + table ─────────
function CategoryDetail({ cat, dates, selIdx, onSelect, onClose, setTip }) {
  const entries = dates.map((d, di) => {
    const c = catOf(d, cat);
    const pi = prevIndexWith(dates, di, (x) => catOf(x, cat));
    return { d, di, c, prev: pi >= 0 ? dates[pi] : null, p: pi >= 0 ? catOf(dates[pi], cat) : null };
  });
  const total = Math.max(1, ...entries.map((e) => e.c?.count || 0));
  const H = 170;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #c7d2fe",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{cat}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>— element status on each date</span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 700,
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#475569",
            borderRadius: 7,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          Close ✕
        </button>
      </div>
      <Legend items={STATUS_KEYS} />

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", overflowX: "auto", marginTop: 14, paddingBottom: 4 }}>
        {entries.map(({ d, di, c, prev }) => {
          const selected = di === selIdx;
          return (
            <div
              key={d.pair_id}
              role="button"
              onClick={() => onSelect(di)}
              {...tipHandlers(setTip, () => categoryTip(cat, d, prev))}
              style={{
                flex: "0 0 92px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                cursor: "pointer",
                borderRadius: 10,
                padding: "6px 2px",
                background: selected ? "#eef2ff" : "transparent",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f172a" }}>{c ? fmtPct(c.completion) : "—"}</div>
              <div style={{ fontSize: 10, color: "#475569", fontWeight: 700 }}>{c ? `${fmtNum(c.completed)} / ${fmtNum(c.count)}` : ""}</div>
              <div style={{ height: H, width: 34, display: "flex", flexDirection: "column-reverse", gap: 2, marginTop: 6 }}>
                {c &&
                  STATUS_KEYS.map((k) => {
                    const h = ((c[k.key] || 0) / total) * (H - 4);
                    return h > 0 ? (
                      <div
                        key={k.key}
                        style={{
                          height: Math.max(2, h),
                          background: k.color,
                          borderRadius: 4,
                          transition: "height 0.35s cubic-bezier(.4,0,.2,1)",
                        }}
                      />
                    ) : null;
                  })}
              </div>
              <div
                style={{
                  fontSize: 10,
                  marginTop: 6,
                  color: selected ? "#0f172a" : "#64748b",
                  fontWeight: selected ? 800 : 500,
                  whiteSpace: "nowrap",
                }}
              >
                {dateLabel(d)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Table view — every number reachable without hovering */}
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {["Date", "Completed", "In progress", "Not started", "Completion", "Change"].map((h) => (
                <th key={h} style={thCell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(({ d, di, c, p }) => {
              const delta = c && p ? c.completed - p.completed : null;
              return (
                <tr key={d.pair_id} style={{ background: di === selIdx ? "#eef2ff" : "transparent" }}>
                  <td style={tdCell}>{dateLabel(d)}</td>
                  <td style={tdCell}>{c ? `${fmtNum(c.completed)} / ${fmtNum(c.count)}` : "—"}</td>
                  <td style={tdCell}>{c ? fmtNum(c.in_progress) : "—"}</td>
                  <td style={tdCell}>{c ? fmtNum(c.not_started) : "—"}</td>
                  <td style={{ ...tdCell, fontWeight: 800 }}>{c ? fmtPct(c.completion) : "—"}</td>
                  <td style={tdCell}><DeltaBadge delta={delta} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thCell = {
  textAlign: "left",
  fontSize: 10,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
};
const tdCell = {
  padding: "7px 10px",
  borderBottom: "1px solid #f1f5f9",
  color: "#0f172a",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

// ─── Compare any two dates, category by category ────────────────────────────
function CompareTable({ dates, categories, selIdx }) {
  const assessed = dates.map((d, i) => ({ d, i })).filter((x) => x.d.summary);
  const defaultTo = assessed.some((x) => x.i === selIdx) ? selIdx : assessed.slice(-1)[0]?.i;
  const defaultFrom = assessed.filter((x) => x.i < defaultTo).slice(-1)[0]?.i ?? assessed[0]?.i;
  const [fromIdx, setFromIdx] = useState(defaultFrom);
  const [toIdx, setToIdx] = useState(defaultTo);
  const [sortKey, setSortKey] = useState("change");
  const [sortDir, setSortDir] = useState("desc");

  // Follow the page's selected date; either dropdown can still pick any pair.
  useEffect(() => {
    setToIdx(defaultTo);
    setFromIdx(defaultFrom);
  }, [defaultTo, defaultFrom]);

  const from = dates[fromIdx];
  const to = dates[toIdx];

  const rows = useMemo(() => {
    const list = categories.map((cat) => {
      const a = from ? catOf(from, cat) : null;
      const b = to ? catOf(to, cat) : null;
      return {
        cat,
        a,
        b,
        change: a && b ? b.completed - a.completed : null,
        pp: a && b ? (b.completion || 0) - (a.completion || 0) : null,
      };
    });
    const val = {
      cat: (r) => r.cat,
      from: (r) => r.a?.completion ?? -1,
      to: (r) => r.b?.completion ?? -1,
      change: (r) => r.change ?? -Infinity,
    }[sortKey];
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort((x, y) => {
      const vx = val(x);
      const vy = val(y);
      return (typeof vx === "string" ? vx.localeCompare(vy) : vx - vy) * dir;
    });
  }, [categories, from, to, sortKey, sortDir]);

  if (assessed.length < 1) return null;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.change || 0)));
  const sa = from?.summary;
  const sb = to?.summary;

  const header = (key, label) => (
    <th
      style={{ ...thCell, cursor: "pointer", userSelect: "none" }}
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
          setSortKey(key);
          setSortDir(key === "cat" ? "asc" : "desc");
        }
      }}
      aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : ""}
    </th>
  );

  const cell = (c) =>
    c ? (
      <span>
        <b>{fmtPct(c.completion)}</b>{" "}
        <span style={{ color: "#64748b" }}>
          ({fmtNum(c.completed)} / {fmtNum(c.count)})
        </span>
      </span>
    ) : (
      "—"
    );

  const option = ({ d, i }) => (
    <option key={d.pair_id} value={i}>
      {dateLabel(d)}
    </option>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: 12, color: "#475569" }}>
        <span style={{ fontWeight: 700 }}>From</span>
        <select value={fromIdx ?? ""} onChange={(e) => setFromIdx(+e.target.value)} style={inputStyle} aria-label="Compare from date">
          {assessed.map(option)}
        </select>
        <span style={{ fontWeight: 700 }}>to</span>
        <select value={toIdx ?? ""} onChange={(e) => setToIdx(+e.target.value)} style={inputStyle} aria-label="Compare to date">
          {assessed.map(option)}
        </select>
        {sa && sb && (
          <span style={{ marginLeft: "auto", fontSize: 12 }}>
            Overall: <b>{fmtPct(sa.overall_completion)}</b> → <b>{fmtPct(sb.overall_completion)}</b> ·{" "}
            <b style={{ color: sb.completed - sa.completed > 0 ? "#16a34a" : sb.completed - sa.completed < 0 ? "#dc2626" : "#64748b" }}>
              {deltaText(sb.completed - sa.completed)}
            </b>{" "}
            completed elements
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {header("cat", "Category")}
              {header("from", from ? dateLabel(from) : "From")}
              {header("to", to ? dateLabel(to) : "To")}
              {header("change", "Change (completed)")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pos = (r.change || 0) > 0;
              const neg = (r.change || 0) < 0;
              const w = r.change ? (Math.abs(r.change) / maxAbs) * 60 : 0;
              return (
                <tr key={r.cat}>
                  <td style={{ ...tdCell, fontWeight: 700 }}>{r.cat}</td>
                  <td style={tdCell}>{cell(r.a)}</td>
                  <td style={tdCell}>{cell(r.b)}</td>
                  <td style={tdCell}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Diverging bar around a centre line: right = gained, left = lost */}
                      <div style={{ position: "relative", width: 124, height: 10, flexShrink: 0 }}>
                        <div style={{ position: "absolute", left: 62, top: 0, bottom: 0, width: 1, background: "#cbd5e1" }} />
                        {w > 0 && (
                          <div
                            style={{
                              position: "absolute",
                              top: 1,
                              height: 8,
                              width: w,
                              left: pos ? 63 : 62 - w,
                              background: pos ? "#16a34a" : "#dc2626",
                              borderRadius: 3,
                            }}
                          />
                        )}
                      </div>
                      <span style={{ fontWeight: 800, color: pos ? "#16a34a" : neg ? "#dc2626" : "#64748b" }}>
                        {r.change == null ? "—" : deltaText(r.change)}
                      </span>
                      {r.pp != null && r.pp !== 0 && (
                        <span style={{ color: "#64748b" }}>
                          ({r.pp > 0 ? "+" : "−"}
                          {fmtPct(Math.abs(r.pp))})
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cardStyle = {
  position: "relative",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};

function CardTitle({ title, subtitle }) {
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12, paddingRight: 40 }}>{subtitle}</div>
    </>
  );
}

export default function ProgressTimelinePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const role = localStorage.getItem("role") || "viewer";

  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [dates, setDates] = useState([]);
  const [viewMode, setViewMode] = useState("last3");
  const [rawSelIdx, setSelIdx] = useState(0);
  const [openCat, setOpenCat] = useState(null);
  const [tip, setTip] = useState(null);

  const visibleDates = useMemo(() => applyViewMode(dates, viewMode), [dates, viewMode]);
  // Switching view mode can shrink visibleDates before the effect below resets
  // the selection, so clamp to keep the index in range for that render.
  const selIdx = Math.max(0, Math.min(rawSelIdx, visibleDates.length - 1));
  const undatedCount = useMemo(
    () => dates.filter((d) => !parseISODate(d.pointcloud_date)).length,
    [dates],
  );

  // Default selection = the latest date in view that has a saved assessment.
  useEffect(() => {
    let i = visibleDates.length - 1;
    while (i > 0 && !visibleDates[i].summary) i--;
    setSelIdx(Math.max(0, i));
  }, [visibleDates]);

  const categories = useMemo(() => {
    const names = new Set();
    dates.forEach((d) => d.categories.forEach((c) => names.add(c.category)));
    return Array.from(names).sort();
  }, [dates]);

  const leadingId = useMemo(() => {
    const n = parseInt(slug, 10);
    return Number.isFinite(n) ? n : null;
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    API.get("projects/")
      .then((res) => {
        const proj = (res.data || []).find(
          (p) =>
            p.slug === slug ||
            String(p.id) === String(slug) ||
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
  }, [slug, leadingId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    API.get(`processing/progress/timeline/${projectId}/`)
      .then((res) => setDates(res.data?.dates || []))
      .catch(() => toast.error("Failed to load progress timeline."))
      .finally(() => setLoading(false));
  }, [projectId, toast]);

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
          projectSlug={slug}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
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
            <button
              onClick={() => navigate(-1)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 11,
                color: "#4f46e5",
                fontWeight: 600,
                padding: "4px 6px",
              }}
            >
              <ArrowLeft size={13} /> Back
            </button>
            <CalendarRange size={15} color="#0891b2" />
            <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
              Progress Timeline
            </span>
            <FolderOpen size={13} color="#94a3b8" style={{ marginLeft: 10 }} />
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {projectName || `Project #${projectId || "—"}`}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }} onScroll={() => tip && setTip(null)}>
            {loading ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#64748b",
                  fontSize: 13,
                }}
              >
                <Loader size={14} /> Loading timeline…
              </div>
            ) : dates.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94a3b8" }}>
                No registered alignment pairs for this project yet.
              </div>
            ) : (
              <>
                {/* View selector — scopes everything below */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>View:</span>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      padding: 3,
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 999,
                    }}
                  >
                    {VIEW_MODES.map((m) => {
                      const active = viewMode === m.key;
                      return (
                        <button
                          key={m.key}
                          onClick={() => setViewMode(m.key)}
                          aria-pressed={active}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "5px 12px",
                            borderRadius: 999,
                            border: "none",
                            background: active ? "#0891b2" : "transparent",
                            color: active ? "#fff" : "#64748b",
                            cursor: "pointer",
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {viewMode === "last3" || viewMode === "all"
                      ? `Showing ${visibleDates.length} of ${dates.length} scan date${dates.length === 1 ? "" : "s"}.`
                      : `${visibleDates.length} ${viewMode}${visibleDates.length === 1 ? "" : "s"} — each shows the latest assessed scan in that ${viewMode}.`}
                    {viewMode !== "all" && undatedCount > 0
                      ? ` ${undatedCount} scan${undatedCount === 1 ? "" : "s"} without a date hidden.`
                      : ""}
                  </span>
                </div>

                <StatTiles dates={visibleDates} selIdx={selIdx} />

                <div style={cardStyle}>
                  <DownloadButton
                    onClick={() => exportStatusChartToPNG(visibleDates)}
                    title="Download this chart as a PNG image"
                  />
                  <CardTitle
                    title="Completed / In Progress / Not Started by Point Cloud date"
                    subtitle="Hover a date for the full breakdown, click it to select that date. Click a legend item to hide or show a status."
                  />
                  <StatusByDateChart
                    dates={visibleDates}
                    selIdx={selIdx}
                    onSelect={setSelIdx}
                    setTip={setTip}
                  />
                </div>

                {openCat && (
                  <CategoryDetail
                    cat={openCat}
                    dates={visibleDates}
                    selIdx={selIdx}
                    onSelect={setSelIdx}
                    onClose={() => setOpenCat(null)}
                    setTip={setTip}
                  />
                )}

                <div style={cardStyle}>
                  {categories.length > 0 && (
                    <DownloadButton
                      onClick={() => exportCategoryChartsToPNG(visibleDates, categories)}
                      title="Download this chart as a PNG image"
                    />
                  )}
                  <CardTitle
                    title="Category completion by date"
                    subtitle="Completion % = completed elements ÷ total elements. Hover any bar for counts and change; click a card for its full breakdown."
                  />
                  <CategoryByDateCharts
                    dates={visibleDates}
                    categories={categories}
                    selIdx={selIdx}
                    onSelect={setSelIdx}
                    onOpen={(cat) => {
                      setOpenCat(cat);
                      setTip(null);
                    }}
                    openCat={openCat}
                    setTip={setTip}
                  />
                </div>

                <div style={cardStyle}>
                  <CardTitle
                    title="Compare two dates"
                    subtitle="Completed elements per category between any two dates — click a column header to sort."
                  />
                  <CompareTable
                    dates={visibleDates}
                    categories={categories}
                    selIdx={selIdx}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <Tip tip={tip} />
    </div>
  );
}
