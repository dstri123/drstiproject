import React, { useEffect, useMemo, useState } from "react";
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

const CATEGORY_PALETTE = [
  "#4f46e5", "#0891b2", "#16a34a", "#d97706", "#dc2626",
  "#7c3aed", "#0d9488", "#ca8a04", "#db2777", "#2563eb",
  "#65a30d", "#ea580c",
];

function fmtDate(d) {
  return d || "No date";
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
  const marginTop = 90;
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
      ctx.fillText(`${Math.round(s.overall_completion)}% overall`, groupCx, marginTop - 10);
    }

    bars.forEach((b, j) => {
      const h = maxCount ? Math.max(2, (b.value / maxCount) * plotH) : 2;
      const x = startX + j * (barW + gap);
      const y = marginTop + plotH - h;
      ctx.fillStyle = b.color;
      roundRectPath(ctx, x, y, barW, h, 3);
      ctx.fill();
    });

    ctx.fillStyle = "#475569";
    ctx.font = "11px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fmtDate(d.pointcloud_date), groupCx, marginTop + plotH + 22);
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
    const color = CATEGORY_PALETTE[ci % CATEGORY_PALETTE.length];
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
      ctx.fillText(c ? `${pct}%` : "—", bx, plotBottom - plotH - 6);

      ctx.fillStyle = "#94a3b8";
      ctx.fillText(fmtDate(d.pointcloud_date), bx, plotBottom + 14);
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

function Legend({ items }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "#64748b" }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: it.color,
              display: "inline-block",
            }}
          />
          {it.label}
        </div>
      ))}
    </div>
  );
}

// ─── Chart 1: Completed / In Progress / Not Started, one stacked bar per PC date
function StatusByDateChart({ dates }) {
  const height = 220;
  const barAreaHeight = height - 40;
  // The BIM model is the same for every date, so `total` barely changes —
  // scaling bar height by total would make every bar look the same. Scale
  // each status bar independently against the largest single count seen
  // anywhere, so a bar's height always reflects its own actual value.
  const maxCount = Math.max(
    1,
    ...dates.flatMap((d) => [
      d.summary?.completed || 0,
      d.summary?.in_progress || 0,
      d.summary?.not_started || 0,
    ]),
  );

  return (
    <div>
      <Legend
        items={[
          { label: "Completed", color: STATUS_COLORS.completed },
          { label: "In Progress", color: STATUS_COLORS.in_progress },
          { label: "Not Started", color: STATUS_COLORS.not_started },
        ]}
      />
      <div
        style={{
          display: "flex",
          gap: 28,
          alignItems: "flex-end",
          height,
          marginTop: 20,
          overflowX: "auto",
          padding: "0 8px",
        }}
      >
        {dates.map((d) => {
          const s = d.summary;
          const bars = s
            ? [
                { key: "completed", value: s.completed, color: STATUS_COLORS.completed },
                { key: "in_progress", value: s.in_progress, color: STATUS_COLORS.in_progress },
                { key: "not_started", value: s.not_started, color: STATUS_COLORS.not_started },
              ]
            : [];
          return (
            <div
              key={d.pair_id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: "0 0 96px",
              }}
            >
              <div style={{ fontSize: 10, color: "#0f172a", fontWeight: 700, marginBottom: 4 }}>
                {s ? `${Math.round(s.overall_completion)}% overall` : "—"}
              </div>
              {s ? (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: barAreaHeight }}>
                  {bars.map((b) => (
                    <div
                      key={b.key}
                      title={`${fmtDate(d.pointcloud_date)} — ${b.key.replace("_", " ")}: ${b.value}`}
                      style={{
                        width: 20,
                        height: Math.max(2, (b.value / maxCount) * barAreaHeight),
                        background: b.color,
                        borderRadius: "3px 3px 0 0",
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div
                  title={`${fmtDate(d.pointcloud_date)} — no saved assessment yet`}
                  style={{ width: 20, height: 4, background: "#e2e8f0", borderRadius: 3 }}
                />
              )}
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 8, textAlign: "center" }}>
                {fmtDate(d.pointcloud_date)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Chart 2: per-category completion %, small-multiple bars across PC dates
function CategoryByDateCharts({ dates, categories }) {
  if (!categories.length) {
    return (
      <div style={{ fontSize: 12, color: "#94a3b8" }}>
        No saved assessments yet — save an assessment for at least one Point
        Cloud date to see category trends.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16,
      }}
    >
      {categories.map((cat, i) => {
        const color = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
        return (
          <div
            key={cat}
            style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
              {cat}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 90 }}>
              {dates.map((d) => {
                const c = d.categories.find((x) => x.category === cat);
                const pct = c?.completion || 0;
                return (
                  <div
                    key={d.pair_id}
                    title={c ? `${fmtDate(d.pointcloud_date)}: ${pct}%` : `${fmtDate(d.pointcloud_date)}: no data`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      flex: 1,
                      minWidth: 28,
                    }}
                  >
                    <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>
                      {c ? `${pct}%` : "—"}
                    </div>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 24,
                        height: 60,
                        background: "#f1f5f9",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "flex-end",
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ width: "100%", height: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {dates.map((d) => (
                <div
                  key={d.pair_id}
                  style={{
                    flex: 1,
                    minWidth: 28,
                    fontSize: 9,
                    color: "#94a3b8",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDate(d.pointcloud_date)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
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

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
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
                <div
                  style={{
                    position: "relative",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <DownloadButton
                    onClick={() => exportStatusChartToPNG(dates)}
                    title="Download this chart as a PNG image"
                  />
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                    Completed / In Progress / Not Started by Point Cloud date
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                    One bar per registered Point Cloud scan date — the BIM
                    model is the same across all dates.
                  </div>
                  <StatusByDateChart dates={dates} />
                </div>

                <div
                  style={{
                    position: "relative",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  {categories.length > 0 && (
                    <DownloadButton
                      onClick={() => exportCategoryChartsToPNG(dates, categories)}
                      title="Download this chart as a PNG image"
                    />
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                    Category completion by date
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                    Completion % per category, tracked across each Point Cloud
                    scan date.
                  </div>
                  <CategoryByDateCharts dates={dates} categories={categories} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
