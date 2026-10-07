import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { parseDay } from "./scheduleParser";

const DAY_MS = 86400000;
export const LEFT_W = 380;
const HEADER_TOP_H = 30;
const HEADER_BOT_H = 30;
const GROUP_H = 46;
const TASK_H = 38;
const BAR_H = 18;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayDiff = (a, b) => Math.round((b - a) / DAY_MS);
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const fmtShort = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

export function fmtRange(a, b) {
  const s = parseDay(a);
  const f = parseDay(b);
  if (!s || !f) return "";
  if (a === b) return fmtShort(s);
  if (s.getUTCMonth() === f.getUTCMonth() && s.getUTCFullYear() === f.getUTCFullYear()) {
    return `${fmtShort(s)} - ${f.getUTCDate()}`;
  }
  return `${fmtShort(s)} - ${fmtShort(f)}`;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - firstThu) / DAY_MS - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

// Header units for the current zoom: a coarse top band and a fine bottom band.
function buildHeader(rangeStart, totalDays, pxPerDay) {
  const top = [];
  const bottom = [];
  const end = addDays(rangeStart, totalDays);
  const push = (arr, from, to, label, extra = {}) => {
    const x = Math.max(0, dayDiff(rangeStart, from)) * pxPerDay;
    const x2 = Math.min(totalDays, dayDiff(rangeStart, to)) * pxPerDay;
    if (x2 > x) arr.push({ x, w: x2 - x, label, ...extra });
  };
  const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const nextMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

  if (pxPerDay >= 18) {
    // Days: weeks on top, day numbers below.
    for (let d = rangeStart; d < end; d = addDays(d, 7)) {
      const we = addDays(d, 6);
      push(top, d, addDays(d, 7), `Week ${isoWeek(d)}`, { sub: `${fmtShort(d)} - ${fmtShort(we)}` });
    }
    for (let d = rangeStart; d < end; d = addDays(d, 1)) {
      const wd = d.getUTCDay();
      push(bottom, d, addDays(d, 1), String(d.getUTCDate()), {
        weekend: wd === 0 || wd === 6,
        iso: d.toISOString().slice(0, 10),
      });
    }
  } else if (pxPerDay >= 5) {
    // Weeks: months on top, week numbers below.
    for (let d = monthStart(rangeStart); d < end; d = nextMonth(d)) {
      push(top, d, nextMonth(d), `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
    }
    for (let d = rangeStart; d < end; d = addDays(d, 7)) {
      push(bottom, d, addDays(d, 7), pxPerDay >= 8 ? `W${isoWeek(d)} · ${d.getUTCDate()}` : `W${isoWeek(d)}`);
    }
  } else {
    // Months: years on top, months below.
    for (let y = rangeStart.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
      push(top, new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)), String(y));
    }
    for (let d = monthStart(rangeStart); d < end; d = nextMonth(d)) {
      push(bottom, d, nextMonth(d), MONTHS[d.getUTCMonth()]);
    }
  }
  return { top, bottom };
}

const GanttChart = forwardRef(function GanttChart(
  { groups, collapsed, onToggleGroup, pxPerDay, rangeStart, totalDays, today, selectedId, onSelect },
  ref,
) {
  const scrollRef = useRef(null);
  const [tip, setTip] = useState(null);
  const chartW = totalDays * pxPerDay;
  const xOf = (iso) => dayDiff(rangeStart, parseDay(iso)) * pxPerDay;

  useImperativeHandle(ref, () => ({
    scrollToDate(iso) {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ left: Math.max(0, xOf(iso) - (el.clientWidth - LEFT_W) / 3), behavior: "smooth" });
    },
    chartViewportWidth: () => (scrollRef.current?.clientWidth || 1200) - LEFT_W - 2,
  }));

  // Flatten groups into rows with y offsets.
  const { rows, totalH, rowById } = useMemo(() => {
    const out = [];
    const byId = {};
    let y = 0;
    groups.forEach((g) => {
      out.push({ type: "group", group: g, y, h: GROUP_H });
      y += GROUP_H;
      if (!collapsed.has(g.key)) {
        g.activities.forEach((a) => {
          const row = { type: "task", a, group: g, y, h: TASK_H };
          out.push(row);
          byId[a.id] = row;
          y += TASK_H;
        });
      }
    });
    return { rows: out, totalH: y, rowById: byId };
  }, [groups, collapsed]);

  const header = useMemo(
    () => buildHeader(rangeStart, totalDays, pxPerDay),
    [rangeStart, totalDays, pxPerDay],
  );

  const todayX = today ? dayDiff(rangeStart, today) * pxPerDay : null;
  const todayIso = today ? today.toISOString().slice(0, 10) : null;
  const showToday = todayX != null && todayX >= 0 && todayX <= chartW;

  // Finish-to-start dependency connectors (elbow lines, like the reference).
  const arrows = useMemo(() => {
    const paths = [];
    rows.forEach((r) => {
      if (r.type !== "task") return;
      r.a.predecessors.forEach((pid) => {
        const p = rowById[pid];
        if (!p) return;
        const x1 = xOf(p.a.finish) + pxPerDay;
        const y1 = p.y + p.h / 2;
        const x2 = xOf(r.a.start);
        const y2 = r.y + r.h / 2;
        const stub = 8;
        const d =
          x2 - x1 >= stub * 2
            ? `M${x1},${y1} H${x1 + stub} V${y2} H${x2 - 2}`
            : `M${x1},${y1} H${x1 + stub} V${y2 - r.h / 2} H${x2 - stub} V${y2} H${x2 - 2}`;
        paths.push({ key: `${pid}->${r.a.id}`, d });
      });
    });
    return paths;
  }, [rows, rowById, pxPerDay, rangeStart]);

  const showTip = (e, a, g) => setTip({ x: e.clientX, y: e.clientY, a, g });

  return (
    <div
      ref={scrollRef}
      style={{ flex: 1, overflow: "auto", position: "relative", background: "#fff" }}
      onMouseLeave={() => setTip(null)}
    >
      <div style={{ width: LEFT_W + chartW, minWidth: "100%", position: "relative" }}>
        {/* ---------- sticky header ---------- */}
        <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", background: "#fff" }}>
          <div
            style={{
              position: "sticky",
              left: 0,
              zIndex: 6,
              width: LEFT_W,
              flexShrink: 0,
              height: HEADER_TOP_H + HEADER_BOT_H,
              background: "#fff",
              borderBottom: "1px solid #e5e7eb",
              borderRight: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "flex-end",
              padding: "0 14px 8px 24px",
              fontSize: 11,
              fontWeight: 600,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              boxSizing: "border-box",
            }}
          >
            <span style={{ flex: 1 }}>Activity</span>
            <span style={{ width: 120 }}>Dates</span>
          </div>
          <div style={{ position: "relative", width: chartW, height: HEADER_TOP_H + HEADER_BOT_H, borderBottom: "1px solid #e5e7eb" }}>
            {header.top.map((u, i) => (
              <div
                key={`t${i}`}
                style={{
                  position: "absolute",
                  left: u.x,
                  width: u.w,
                  top: 0,
                  height: HEADER_TOP_H,
                  borderLeft: "1px solid #eef0f3",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 8px",
                  fontSize: 12,
                  color: "#334155",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}
              >
                <b style={{ fontWeight: 700 }}>{u.label}</b>
                {u.sub && <span style={{ marginLeft: 6, color: "#64748b" }}>{u.sub}</span>}
              </div>
            ))}
            {header.bottom.map((u, i) => {
              const isToday = u.iso && u.iso === todayIso;
              return (
                <div
                  key={`b${i}`}
                  style={{
                    position: "absolute",
                    left: u.x,
                    width: u.w,
                    top: HEADER_TOP_H,
                    height: HEADER_BOT_H,
                    borderLeft: "1px solid #eef0f3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 500,
                    color: u.weekend ? "#b6bec9" : "#475569",
                    background: u.weekend ? "#f8fafc" : "transparent",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    boxSizing: "border-box",
                  }}
                >
                  <span
                    style={
                      isToday
                        ? { background: "#2563eb", color: "#fff", borderRadius: 5, padding: "2px 6px", fontWeight: 700 }
                        : undefined
                    }
                  >
                    {u.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- body ---------- */}
        <div style={{ position: "relative", height: totalH }}>
          {/* grid + weekend shading */}
          <div style={{ position: "absolute", left: LEFT_W, top: 0, width: chartW, height: totalH, pointerEvents: "none" }}>
            {header.bottom.map((u, i) => (
              <div
                key={`g${i}`}
                style={{
                  position: "absolute",
                  left: u.x,
                  width: u.w,
                  top: 0,
                  bottom: 0,
                  borderLeft: "1px solid #f1f3f6",
                  background: u.weekend ? "#fafbfc" : "transparent",
                }}
              />
            ))}
          </div>

          {/* dependency arrows */}
          <svg
            width={chartW}
            height={totalH}
            style={{ position: "absolute", left: LEFT_W, top: 0, pointerEvents: "none", zIndex: 1 }}
          >
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#475569" />
              </marker>
            </defs>
            {arrows.map((p) => (
              <path key={p.key} d={p.d} fill="none" stroke="#64748b" strokeWidth="1" markerEnd="url(#gantt-arrow)" />
            ))}
          </svg>

          {/* rows */}
          {rows.map((r) => {
            if (r.type === "group") {
              const g = r.group;
              const isCollapsed = collapsed.has(g.key);
              const gx = xOf(g.start);
              const gw = xOf(g.finish) + pxPerDay - gx;
              return (
                <div
                  key={`g-${g.key}`}
                  style={{
                    position: "absolute",
                    top: r.y,
                    left: 0,
                    height: r.h,
                    width: LEFT_W + chartW,
                    display: "flex",
                    borderTop: "1px solid #e5e7eb",
                  }}
                >
                  <div
                    onClick={() => onToggleGroup(g.key)}
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 3,
                      width: LEFT_W,
                      flexShrink: 0,
                      background: "#fff",
                      borderRight: "1px solid #e5e7eb",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0 14px 0 6px",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    {isCollapsed ? <ChevronRight size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.label}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {g.activities.length} task{g.activities.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ position: "relative", width: chartW }}>
                    <div
                      style={{
                        position: "absolute",
                        left: gx,
                        top: 9,
                        fontSize: 12,
                        color: "#334155",
                        whiteSpace: "nowrap",
                        zIndex: 2,
                      }}
                    >
                      <b>{g.label}</b>
                      <span style={{ color: "#64748b" }}>
                        {" "}• {fmtRange(g.start, g.finish)} • {g.days} day{g.days === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        left: gx,
                        width: Math.max(gw, 2),
                        top: 30,
                        height: 4,
                        borderRadius: 2,
                        background: g.color,
                        opacity: 0.35,
                      }}
                    />
                  </div>
                </div>
              );
            }

            const { a, group: g } = r;
            const x = xOf(a.start);
            const w = Math.max(xOf(a.finish) + pxPerDay - x, 3);
            const selected = selectedId === a.id;
            return (
              <div
                key={a.id}
                onClick={() => onSelect(selected ? null : a.id)}
                style={{
                  position: "absolute",
                  top: r.y,
                  left: 0,
                  height: r.h,
                  width: LEFT_W + chartW,
                  display: "flex",
                  background: selected ? "rgba(226,232,240,0.6)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 3,
                    width: LEFT_W,
                    flexShrink: 0,
                    background: selected ? "#e8edf3" : "#fff",
                    borderRight: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 14px 0 34px",
                    fontSize: 13,
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                >
                  <span
                    title={`${a.id} · ${a.name}`}
                    style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}
                  >
                    <span style={{ color: "#94a3b8", fontSize: 11, marginRight: 6 }}>{a.id}</span>
                    {a.name}
                  </span>
                  <span title={`${a.start} → ${a.finish}`} style={{ width: 120, color: "#475569", whiteSpace: "nowrap" }}>
                    {fmtRange(a.start, a.finish)}
                  </span>
                </div>
                <div style={{ position: "relative", width: chartW }}>
                  {a.milestone ? (
                    <div
                      onMouseMove={(e) => showTip(e, a, g)}
                      onMouseLeave={() => setTip(null)}
                      style={{
                        position: "absolute",
                        left: x - 8,
                        top: r.h / 2 - 9,
                        width: 18,
                        height: 18,
                        border: `4px solid ${g.color}`,
                        background: "#fff",
                        transform: "rotate(45deg)",
                        borderRadius: 3,
                        boxSizing: "border-box",
                        zIndex: 2,
                      }}
                    />
                  ) : (
                    <div
                      onMouseMove={(e) => showTip(e, a, g)}
                      onMouseLeave={() => setTip(null)}
                      style={{
                        position: "absolute",
                        left: x,
                        width: w,
                        top: (r.h - BAR_H) / 2,
                        height: BAR_H,
                        borderRadius: 4,
                        background: g.color,
                        boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${g.color}` : "none",
                        zIndex: 2,
                        overflow: "hidden",
                      }}
                    >
                      {a.plannedPct > 0 && a.plannedPct < 100 && (
                        <div style={{ width: `${a.plannedPct}%`, height: "100%", background: "rgba(0,0,0,0.18)" }} />
                      )}
                    </div>
                  )}
                  <div
                    style={{
                      position: "absolute",
                      left: x + (a.milestone ? 16 : w + 8),
                      top: 0,
                      height: r.h,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 12,
                      color: "#334155",
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                  >
                    {a.name}
                  </div>
                </div>
              </div>
            );
          })}

          {/* today line */}
          {showToday && (
            <div
              style={{
                position: "absolute",
                left: LEFT_W + todayX,
                top: 0,
                height: totalH,
                width: 2,
                marginLeft: -1,
                background: "#2563eb",
                // Same layer as the bars (drawn after them) but below the
                // sticky task column (zIndex 3) when scrolled horizontally.
                zIndex: 2,
                pointerEvents: "none",
              }}
            >
              <div style={{ position: "absolute", top: -4, left: -4, width: 10, height: 10, borderRadius: "50%", background: "#2563eb" }} />
            </div>
          )}
        </div>
      </div>

      {tip && (
        <div
          style={{
            position: "fixed",
            left: tip.x + 14,
            top: tip.y + 14,
            zIndex: 1000,
            background: "#0f172a",
            color: "#f8fafc",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            lineHeight: 1.55,
            maxWidth: 320,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {tip.a.id} · {tip.a.name}
          </div>
          <div>Level: {tip.g.label}{tip.a.wbs ? ` (WBS ${tip.a.wbs})` : ""}</div>
          <div>{tip.a.start} → {tip.a.finish} · {tip.a.duration} workday{tip.a.duration === 1 ? "" : "s"}</div>
          {tip.a.ifcTypes && <div>IFC: {tip.a.ifcTypes}</div>}
          {tip.a.elementCount != null && <div>Elements: {tip.a.elementCount}</div>}
          {tip.a.predecessors.length > 0 && (
            <div>Predecessor: {tip.a.predecessors.join(", ")} ({tip.a.dependency || "FS"})</div>
          )}
          <div>Status: {tip.a.status} · Planned {tip.a.plannedPct}% by today</div>
        </div>
      )}
    </div>
  );
});

export default GanttChart;
