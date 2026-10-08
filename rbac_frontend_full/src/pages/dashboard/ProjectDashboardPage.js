import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Upload,
  Search,
  ChartGantt,
  Table2,
  Minus,
  Plus,
  Maximize2,
  CalendarDays,
  Trash2,
  FileSpreadsheet,
  Loader,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import API from "../../api/axios";
import Header from "../viewer/layout/Header";
import { useToast } from "../../components/ToastContainer";
import { parseScheduleFile, parseDay, workdaysBetween } from "./scheduleParser";
import GanttChart, { fmtRange } from "./GanttChart";

const DAY_MS = 86400000;

const fmtDay = (d) => {
  const iso = d.toISOString().slice(0, 10);
  return fmtRange(iso, iso);
};

// One colour per level / phase, in schedule order.
const PALETTE = [
  "#b0384f", "#ee6a3b", "#2e7d4f", "#2563eb", "#7c3aed", "#0891b2", "#ca8a04",
  "#db2777", "#4d7c0f", "#9333ea", "#0d9488", "#c2410c", "#1d4ed8", "#be123c", "#15803d",
];

const ZOOMS = [
  { key: "days", label: "Days", px: 30 },
  { key: "weeks", label: "Weeks", px: 9 },
  { key: "months", label: "Months", px: 3 },
];
const zoomKeyFor = (px) => (px >= 18 ? "days" : px >= 5 ? "weeks" : "months");

const STATUS_STYLE = {
  "not started": { bg: "#fee2e2", fg: "#b91c1c" },
  "in progress": { bg: "#fef3c7", fg: "#b45309" },
  completed: { bg: "#dcfce7", fg: "#15803d" },
  delayed: { bg: "#fce7f3", fg: "#be185d" },
};

const storageKey = (key) => `drsti.projectDashboard.schedule.${key}`;

function loadStored(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStored(key, value) {
  try {
    if (value) localStorage.setItem(storageKey(key), JSON.stringify(value));
    else localStorage.removeItem(storageKey(key));
  } catch {
    /* storage full / blocked — the dashboard still works for this session */
  }
}

function utcToday() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

// Planned % complete as of today, by elapsed workdays.
function plannedPct(a, today) {
  const s = parseDay(a.start);
  const f = parseDay(a.finish);
  if (today < s) return 0;
  if (today > f) return 100;
  const total = workdaysBetween(s, f) || 1;
  return Math.round((workdaysBetween(s, today) / total) * 100);
}

function StatusChip({ status }) {
  const st = STATUS_STYLE[String(status).toLowerCase()] || { bg: "#e2e8f0", fg: "#334155" };
  return (
    <span style={{ background: st.bg, color: st.fg, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function ToolbarButton({ icon: Icon, label, onClick, active, primary, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: label ? "0 12px" : "0 9px",
        borderRadius: 6,
        border: primary ? "none" : "1px solid #e2e8f0",
        background: primary ? "#2563eb" : active ? "#eff6ff" : "#fff",
        color: primary ? "#fff" : active ? "#2563eb" : "#334155",
        fontSize: 13,
        fontWeight: primary ? 600 : 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon size={15} />}
      {label}
    </button>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px", minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

export default function ProjectDashboardPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const ganttRef = useRef(null);

  const [projectName, setProjectName] = useState("");
  const [schedule, setSchedule] = useState(() => loadStored(slug));
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState("gantt");
  const [pxPerDay, setPxPerDay] = useState(30);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);

  const today = useMemo(utcToday, []);

  useEffect(() => {
    setSchedule(loadStored(slug));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const leadingId = parseInt(slug, 10);
    API.get("projects/")
      .then((res) => {
        const proj = (res.data || []).find(
          (p) => p.slug === slug || String(p.id) === String(slug) || p.id === leadingId,
        );
        if (proj) setProjectName(proj.project_name);
      })
      .catch(() => {});
  }, [slug]);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { activities, meta } = await parseScheduleFile(file);
      const next = { fileName: file.name, uploadedAt: new Date().toISOString(), activities, meta };
      setSchedule(next);
      saveStored(slug, next);
      setCollapsed(new Set());
      setSelectedId(null);
      toast.success(`Loaded ${activities.length} activities from ${file.name}`);
    } catch (e) {
      toast.error(e.message || "Couldn't read that schedule file.", 6000);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clearSchedule = () => {
    if (!window.confirm("Remove the uploaded schedule from this dashboard?")) return;
    setSchedule(null);
    saveStored(slug, null);
  };

  const activities = useMemo(
    () => (schedule?.activities || []).map((a) => ({ ...a, plannedPct: plannedPct(a, today) })),
    [schedule, today],
  );

  const levels = useMemo(() => {
    const seen = [];
    activities.forEach((a) => !seen.includes(a.level) && seen.push(a.level));
    return seen;
  }, [activities]);

  const statuses = useMemo(() => Array.from(new Set(activities.map((a) => a.status))), [activities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter(
      (a) =>
        (levelFilter === "all" || a.level === levelFilter) &&
        (statusFilter === "all" || a.status === statusFilter) &&
        (!q ||
          [a.id, a.name, a.level, a.ifcTypes, a.wbs, a.mappingKey].some((v) =>
            String(v || "").toLowerCase().includes(q),
          )),
    );
  }, [activities, search, levelFilter, statusFilter]);

  // Groups (one per Level) keep the schedule's order and a stable colour.
  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((a) => {
      if (!map.has(a.level)) {
        const idx = levels.indexOf(a.level);
        map.set(a.level, { key: a.level, label: a.level, color: PALETTE[idx % PALETTE.length], activities: [] });
      }
      map.get(a.level).activities.push(a);
    });
    return Array.from(map.values()).map((g) => {
      const start = g.activities.reduce((m, a) => (a.start < m ? a.start : m), g.activities[0].start);
      const finish = g.activities.reduce((m, a) => (a.finish > m ? a.finish : m), g.activities[0].finish);
      const days = Math.round((parseDay(finish) - parseDay(start)) / DAY_MS) + 1;
      return { ...g, start, finish, days };
    });
  }, [filtered, levels]);

  // Timeline range: whole schedule (not just the filtered rows), padded and
  // snapped to a Monday so week bands line up.
  const range = useMemo(() => {
    if (!activities.length) return null;
    const s = parseDay(activities.reduce((m, a) => (a.start < m ? a.start : m), activities[0].start));
    const f = parseDay(activities.reduce((m, a) => (a.finish > m ? a.finish : m), activities[0].finish));
    const start = new Date(s.getTime() - (((s.getUTCDay() + 6) % 7) + 7) * DAY_MS);
    const totalDays = Math.round((f - start) / DAY_MS) + 21;
    return { start, totalDays, scheduleStart: s, scheduleFinish: f };
  }, [activities]);

  const stats = useMemo(() => {
    if (!range) return null;
    const totalWd = activities.reduce((n, a) => n + Math.max(a.duration || 0, 0), 0) || 1;
    const doneWd = activities.reduce((n, a) => n + ((a.duration || 0) * a.plannedPct) / 100, 0);
    return {
      count: activities.length,
      levels: levels.length,
      elements: activities.reduce((n, a) => n + (a.elementCount || 0), 0),
      days: Math.round((range.scheduleFinish - range.scheduleStart) / DAY_MS) + 1,
      workdays: workdaysBetween(range.scheduleStart, range.scheduleFinish),
      planned: Math.round((doneWd / totalWd) * 100),
      active: activities.filter((a) => a.plannedPct > 0 && a.plannedPct < 100).map((a) => a.id),
    };
  }, [activities, levels, range]);

  const todayInRange =
    range && today >= range.scheduleStart && today <= new Date(range.scheduleFinish.getTime() + 21 * DAY_MS);

  // Land near today (or the schedule start) when a schedule is first shown.
  useEffect(() => {
    if (!range || view !== "gantt") return;
    const target = todayInRange ? today : range.scheduleStart;
    const t = setTimeout(() => ganttRef.current?.scrollToDate(target.toISOString().slice(0, 10)), 50);
    return () => clearTimeout(t);
  }, [range, view]);

  const fitAll = () => {
    if (!range) return;
    const w = ganttRef.current?.chartViewportWidth() || 1000;
    setPxPerDay(Math.max(1, Math.min(60, w / range.totalDays)));
  };

  const toggleGroup = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));

  const selectStyle = {
    height: 32,
    borderRadius: 6,
    border: "1px solid #e2e8f0",
    padding: "0 8px",
    fontSize: 13,
    color: "#334155",
    background: "#fff",
    maxWidth: 170,
  };

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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <Header />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.csv,.json"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />

          {/* Title row */}
          <div
            style={{
              flexShrink: 0,
              background: "#fff",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "0 18px",
              height: 56,
            }}
          >
            <button
              onClick={() => navigate(-1)}
              title="Back"
              style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b", display: "flex" }}
            >
              <ArrowLeft size={16} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", lineHeight: 1.1 }}>Project Dashboard</div>
              <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {projectName || slug}
                {schedule && ` · ${schedule.fileName}`}
              </div>
            </div>

            {schedule && (
              <div style={{ display: "flex", gap: 4, marginLeft: 12, alignSelf: "stretch" }}>
                {[
                  { key: "table", label: "Main Table", icon: Table2 },
                  { key: "gantt", label: "Gantt", icon: ChartGantt },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setView(t.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 14px",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: 14,
                      color: view === t.key ? "#0f172a" : "#64748b",
                      fontWeight: view === t.key ? 600 : 500,
                      borderBottom: `2px solid ${view === t.key ? "#2563eb" : "transparent"}`,
                    }}
                  >
                    <t.icon size={15} />
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {schedule && <ToolbarButton icon={Trash2} onClick={clearSchedule} title="Remove uploaded schedule" />}
              <ToolbarButton
                icon={uploading ? Loader : Upload}
                label={schedule ? "Replace schedule" : "Upload schedule"}
                primary
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              />
            </div>
          </div>

          {!schedule ? (
            /* ---------- empty state / upload ---------- */
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
              <div
                onClick={() => !uploading && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                style={{
                  width: "100%",
                  maxWidth: 560,
                  background: dragOver ? "#eff6ff" : "#fff",
                  border: `2px dashed ${dragOver ? "#2563eb" : "#cbd5e1"}`,
                  borderRadius: 16,
                  padding: "48px 32px",
                  textAlign: "center",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                {uploading ? (
                  <Loader size={40} color="#2563eb" />
                ) : (
                  <FileSpreadsheet size={44} color="#2563eb" strokeWidth={1.5} />
                )}
                <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 14 }}>
                  Upload your project schedule
                </div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 6, lineHeight: 1.6 }}>
                  Drop an Excel file (.xlsx), CSV, or the 4D schedule mapping JSON here, or click to browse.
                  <br />
                  Expected columns: Activity ID, WBS, Level, Activity, Duration, Start, Finish, Predecessor.
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ---------- stats ---------- */}
              <div style={{ display: "flex", gap: 10, padding: "12px 18px 0", flexWrap: "wrap", flexShrink: 0 }}>
                <StatTile label="Activities" value={stats.count} sub={`${stats.levels} levels`} />
                <StatTile label="IFC elements" value={stats.elements.toLocaleString()} />
                <StatTile label="Start" value={fmtDay(range.scheduleStart)} sub={String(range.scheduleStart.getUTCFullYear())} />
                <StatTile label="Finish" value={fmtDay(range.scheduleFinish)} sub={String(range.scheduleFinish.getUTCFullYear())} />
                <StatTile label="Duration" value={`${stats.days} days`} sub={`${stats.workdays} workdays`} />
                <StatTile
                  label="Planned progress"
                  value={`${stats.planned}%`}
                  sub={stats.active.length ? `Active today: ${stats.active.join(", ")}` : "No activity scheduled today"}
                />
              </div>

              {/* ---------- toolbar ---------- */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", flexWrap: "wrap", flexShrink: 0 }}>
                <div style={{ position: "relative" }}>
                  <Search size={14} color="#94a3b8" style={{ position: "absolute", left: 9, top: 9 }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search activities"
                    style={{ ...selectStyle, paddingLeft: 28, width: 200, maxWidth: "none", boxSizing: "border-box" }}
                  />
                </div>
                <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} style={selectStyle}>
                  <option value="all">All levels</option>
                  {levels.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
                  <option value="all">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <ToolbarButton
                  icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
                  title={allCollapsed ? "Expand all levels" : "Collapse all levels"}
                  onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)))}
                />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {filtered.length} of {activities.length} activities
                </span>

                {view === "gantt" && (
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                    <ToolbarButton
                      icon={CalendarDays}
                      label="Today"
                      disabled={!todayInRange}
                      title={todayInRange ? "Scroll to today" : "Today is outside the schedule"}
                      onClick={() => ganttRef.current?.scrollToDate(today.toISOString().slice(0, 10))}
                    />
                    <ToolbarButton icon={Maximize2} label="Overview" onClick={fitAll} title="Fit the whole schedule" />
                    <select
                      value={zoomKeyFor(pxPerDay)}
                      onChange={(e) => setPxPerDay(ZOOMS.find((z) => z.key === e.target.value).px)}
                      style={selectStyle}
                    >
                      {ZOOMS.map((z) => (
                        <option key={z.key} value={z.key}>{z.label}</option>
                      ))}
                    </select>
                    <ToolbarButton icon={Minus} title="Zoom out" onClick={() => setPxPerDay((p) => Math.max(1, p / 1.3))} />
                    <ToolbarButton icon={Plus} title="Zoom in" onClick={() => setPxPerDay((p) => Math.min(60, p * 1.3))} />
                  </div>
                )}
              </div>

              {/* ---------- main view ---------- */}
              <div
                style={{
                  flex: 1,
                  margin: "0 18px 18px",
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  overflow: "hidden",
                  display: "flex",
                  minHeight: 0,
                }}
              >
                {filtered.length === 0 ? (
                  <div style={{ margin: "auto", color: "#94a3b8", fontSize: 13 }}>No activities match the current filters.</div>
                ) : view === "gantt" ? (
                  <GanttChart
                    ref={ganttRef}
                    groups={groups}
                    collapsed={collapsed}
                    onToggleGroup={toggleGroup}
                    pxPerDay={pxPerDay}
                    rangeStart={range.start}
                    totalDays={range.totalDays}
                    today={todayInRange ? today : null}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ) : (
                  <ScheduleTable groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleTable({ groups, selectedId, onSelect }) {
  const hasMapped = groups.some((g) => g.activities.some((a) => a.mappedElements != null));
  const cols = [
    ["id", "Activity ID"],
    ["wbs", "WBS"],
    ["name", "Activity"],
    ["elevation", "Elevation (mm)"],
    ["ifcTypes", "IFC Type(s)"],
    ["elementCount", "Elements"],
    ...(hasMapped ? [["mappedElements", "Mapped"]] : []),
    ["duration", "Duration (wd)"],
    ["start", "Start"],
    ["finish", "Finish"],
    ["predecessors", "Predecessor"],
    ["dependency", "Dep."],
    ["plannedPct", "Planned %"],
    ["status", "Status"],
  ];
  const th = {
    position: "sticky",
    top: 0,
    background: "#f8fafc",
    padding: "9px 10px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
    zIndex: 1,
  };
  const td = { padding: "8px 10px", fontSize: 13, color: "#1e293b", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {cols.map(([k, label]) => (
              <th key={k} style={th}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              <tr>
                <td colSpan={cols.length} style={{ ...td, background: "#fff", paddingTop: 14, fontWeight: 700, fontSize: 14 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: g.color, marginRight: 8, verticalAlign: -1 }} />
                  {g.label}
                  <span style={{ fontWeight: 400, color: "#64748b", fontSize: 12, marginLeft: 8 }}>
                    {g.start} → {g.finish} · {g.activities.length} activities
                  </span>
                </td>
              </tr>
              {g.activities.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => onSelect(selectedId === a.id ? null : a.id)}
                  style={{ background: selectedId === a.id ? "#eef2f7" : undefined, cursor: "pointer", boxShadow: `inset 3px 0 0 ${g.color}` }}
                >
                  {cols.map(([k]) => (
                    <td key={k} style={td}>
                      {k === "status" ? (
                        <StatusChip status={a.status} />
                      ) : k === "predecessors" ? (
                        a.predecessors.join(", ")
                      ) : k === "plannedPct" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 50, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                            <span style={{ display: "block", width: `${a.plannedPct}%`, height: "100%", background: g.color }} />
                          </span>
                          {a.plannedPct}%
                        </span>
                      ) : (
                        a[k] ?? ""
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
