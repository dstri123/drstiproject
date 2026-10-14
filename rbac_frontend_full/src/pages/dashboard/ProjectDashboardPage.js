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
  X,
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

// Schedules used to live only in this browser's localStorage. They're now
// saved on the server (projects/<id>/schedule/) so every user sees the same
// one; a schedule still found here is uploaded once and then removed.
const legacyStorageKey = (key) => `drsti.projectDashboard.schedule.${key}`;

function takeLegacySchedule(key) {
  try {
    const raw = localStorage.getItem(legacyStorageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function dropLegacySchedule(key) {
  try {
    localStorage.removeItem(legacyStorageKey(key));
  } catch {
    /* storage blocked — nothing to clean up */
  }
}

// Server record -> the shape the dashboard renders.
const fromServer = (d) =>
  d && {
    fileName: d.file_name,
    uploadedAt: d.uploaded_at,
    uploadedBy: d.uploaded_by_name,
    activities: d.activities || [],
    meta: d.meta || {},
  };

const saveErrorMessage = (e) =>
  e.response?.data?.error ||
  e.response?.data?.activities?.[0] ||
  (e.response?.status === 400 || e.response?.status === 413
    ? "The server rejected the schedule (it may be too large)."
    : "Couldn't save the schedule to the server.");

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

// ---------- scan-measured progress (Progress Assessment) ----------

// Actual % within this many points of planned counts as on track.
const ON_TRACK_TOLERANCE = 10;

const PROGRESS_STYLE = {
  Completed: { bg: "#dcfce7", fg: "#15803d" },
  Ahead: { bg: "#dbeafe", fg: "#1d4ed8" },
  "On track": { bg: "#ecfdf5", fg: "#047857" },
  Delayed: { bg: "#fee2e2", fg: "#b91c1c" },
  "Not due": { bg: "#f1f5f9", fg: "#64748b" },
  "No scan data": { bg: "#f1f5f9", fg: "#94a3b8" },
  "Not mapped": { bg: "#f1f5f9", fg: "#94a3b8" },
};

// Compares measured % (latest scan) with planned % *on that scan's date*,
// so an old scan isn't judged against today's plan.
function progressState(a) {
  const act = a.actual;
  if (!act || act.match === "none") return { label: "Not mapped" };
  if (!act.matched) return { label: "No scan data" };
  const planned = plannedPct(a, parseDay(act.scan_date));
  const diff = Math.round(act.actual_pct - planned);
  if (act.actual_pct >= 100) return { label: "Completed", planned, diff };
  if (planned === 0) return { label: act.actual_pct > 0 ? "Ahead" : "Not due", planned, diff };
  if (diff <= -ON_TRACK_TOLERANCE) return { label: "Delayed", planned, diff };
  if (diff >= ON_TRACK_TOLERANCE) return { label: "Ahead", planned, diff };
  return { label: "On track", planned, diff };
}

function ProgressChip({ state }) {
  const st = PROGRESS_STYLE[state.label] || PROGRESS_STYLE["Not mapped"];
  const showDiff = state.diff != null && state.label !== "Completed" && state.label !== "Not due";
  return (
    <span
      title={state.planned != null ? `Planned ${state.planned}% on the scan date` : undefined}
      style={{ background: st.bg, color: st.fg, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}
    >
      {state.label}
      {showDiff && ` (${state.diff > 0 ? "+" : ""}${state.diff}%)`}
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
  const { success: notifySuccess, error: notifyError } = toast;
  const fileRef = useRef(null);
  const ganttRef = useRef(null);

  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState("gantt");
  const [pxPerDay, setPxPerDay] = useState(30);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [progressFilter, setProgressFilter] = useState("all");
  // Scan-measured progress per activity (processing/progress/schedule-status).
  const [progress, setProgress] = useState(null);
  const [missingFor, setMissingFor] = useState(null); // activity whose remaining elements are listed
  const [levelMapOpen, setLevelMapOpen] = useState(false);

  const today = useMemo(utcToday, []);

  useEffect(() => {
    if (!slug) return;
    const leadingId = parseInt(slug, 10);
    setProjectId(null);
    setSchedule(null);
    setScheduleLoading(true);
    API.get("projects/")
      .then((res) => {
        const proj = (res.data || []).find(
          (p) => p.slug === slug || String(p.id) === String(slug) || p.id === leadingId,
        );
        if (proj) {
          setProjectName(proj.project_name);
          setProjectId(proj.id);
        } else {
          setScheduleLoading(false);
        }
      })
      .catch(() => setScheduleLoading(false));
  }, [slug]);

  // Load the project's saved schedule; if the server has none but this
  // browser still holds an old local one, upload it so it isn't lost.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await API.get(`projects/${projectId}/schedule/`);
        if (cancelled) return;
        if (res.data) {
          setSchedule(fromServer(res.data));
          dropLegacySchedule(slug);
          return;
        }
        const legacy = takeLegacySchedule(slug);
        if (legacy?.activities?.length) {
          const saved = await API.put(`projects/${projectId}/schedule/`, {
            file_name: legacy.fileName || "",
            activities: legacy.activities,
            meta: legacy.meta || {},
          });
          if (cancelled) return;
          setSchedule(fromServer(saved.data));
          dropLegacySchedule(slug);
          notifySuccess("Moved this browser's saved schedule to the server.");
        }
      } catch (e) {
        if (!cancelled) notifyError("Couldn't load the project schedule.");
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, slug, notifySuccess, notifyError]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!projectId) {
      toast.error("Project not found — can't save a schedule.");
      return;
    }
    setUploading(true);
    let parsed;
    try {
      parsed = await parseScheduleFile(file);
    } catch (e) {
      toast.error(e.message || "Couldn't read that schedule file.", 6000);
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      const res = await API.put(`projects/${projectId}/schedule/`, {
        file_name: file.name,
        activities: parsed.activities,
        meta: parsed.meta || {},
      });
      setSchedule(fromServer(res.data));
      setCollapsed(new Set());
      setSelectedId(null);
      toast.success(`Saved ${parsed.activities.length} activities from ${file.name}`);
    } catch (e) {
      toast.error(saveErrorMessage(e), 6000);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clearSchedule = async () => {
    if (!window.confirm("Remove the schedule from this project's dashboard for all users?")) return;
    try {
      await API.delete(`projects/${projectId}/schedule/`);
      setSchedule(null);
    } catch (e) {
      toast.error(e.response?.data?.error || "Couldn't remove the schedule.");
    }
  };

  // (Re)load measured progress whenever the schedule is loaded or replaced.
  useEffect(() => {
    if (!projectId || !schedule) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    API.get(`processing/progress/schedule-status/${projectId}/`)
      .then((res) => !cancelled && setProgress(res.data))
      .catch(() => !cancelled && setProgress(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, schedule]);

  const saveLevelMap = async (levelMap) => {
    try {
      const res = await API.patch(`projects/${projectId}/schedule/`, { level_map: levelMap });
      setSchedule(fromServer(res.data)); // triggers a progress reload
      setLevelMapOpen(false);
      toast.success("Level mapping saved.");
    } catch (e) {
      toast.error(e.response?.data?.error || "Couldn't save the level mapping.");
    }
  };

  const activities = useMemo(
    () =>
      (schedule?.activities || []).map((a) => {
        const actual = progress?.activities?.[a.id];
        const withPlan = { ...a, plannedPct: plannedPct(a, today), actual };
        // Once a scan measures the activity, its status comes from the scan;
        // the schedule file's Status column is kept as fileStatus.
        let status = a.status;
        if (actual?.matched) {
          if (actual.completed === actual.matched) status = "Completed";
          else if (actual.completed + actual.in_progress > 0) status = "In Progress";
          else status = "Not Started";
        }
        return { ...withPlan, status, fileStatus: a.status, progress: progressState(withPlan) };
      }),
    [schedule, today, progress],
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
        (progressFilter === "all" || a.progress.label === progressFilter) &&
        (!q ||
          [a.id, a.name, a.level, a.ifcTypes, a.wbs, a.mappingKey].some((v) =>
            String(v || "").toLowerCase().includes(q),
          )),
    );
  }, [activities, search, levelFilter, statusFilter, progressFilter]);

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

  // Project-wide measured progress, weighted by matched element count.
  const actualStats = useMemo(() => {
    const measured = activities.filter((a) => a.actual?.matched);
    if (!range || !measured.length) return null;
    const total = measured.reduce((n, a) => n + a.actual.matched, 0);
    const done = measured.reduce((n, a) => n + a.actual.completed, 0);
    const plannedAtScan = measured.reduce((n, a) => n + a.actual.matched * a.progress.planned, 0);
    const actual = Math.round((done / total) * 100);
    const scanDate = progress.latest_scan_date;
    // Straight-line forecast: finish when 100% at the pace achieved so far.
    let forecast = null;
    const elapsed = (parseDay(scanDate) - range.scheduleStart) / DAY_MS;
    if (actual > 0 && actual < 100 && elapsed > 0) {
      forecast = new Date(range.scheduleStart.getTime() + Math.round((elapsed * 100) / actual) * DAY_MS);
    }
    return {
      actual,
      plannedAtScan: Math.round(plannedAtScan / total),
      scanDate,
      measured: measured.length,
      delayed: measured.filter((a) => a.progress.label === "Delayed").length,
      // Elements not built in activities that should have finished by the scan.
      overdueMissing: measured
        .filter((a) => a.progress.planned === 100)
        .reduce((n, a) => n + a.actual.missing_total, 0),
      forecast,
    };
  }, [activities, range, progress]);

  // Schedule levels (of type+level matched activities) with no matching
  // IFC storey in the latest scan — prompt the user to map them.
  const unmatchedLevels = useMemo(() => {
    if (!progress?.latest_has_levels) return [];
    const ifc = new Set(progress.ifc_levels.map((l) => l.toLowerCase()));
    const mapped = new Set(Object.keys(progress.level_map || {}).map((l) => l.toLowerCase()));
    const out = [];
    activities.forEach((a) => {
      if (a.actual?.match !== "type_level") return;
      const lv = String(a.level || "").trim();
      const key = lv.toLowerCase();
      if (!ifc.has(key) && !mapped.has(key) && !out.includes(lv)) out.push(lv);
    });
    return out;
  }, [activities, progress]);

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
                {schedule?.uploadedAt &&
                  ` · uploaded ${new Date(schedule.uploadedAt).toLocaleDateString()}${
                    schedule.uploadedBy ? ` by ${schedule.uploadedBy}` : ""
                  }`}
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

          {!schedule && scheduleLoading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#64748b", fontSize: 13 }}>
              <Loader size={16} /> Loading schedule...
            </div>
          ) : !schedule ? (
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

              {/* ---------- measured progress (Progress Assessment) ---------- */}
              {actualStats && (
                <div style={{ display: "flex", gap: 10, padding: "10px 18px 0", flexWrap: "wrap", flexShrink: 0 }}>
                  <StatTile
                    label="Actual progress"
                    value={`${actualStats.actual}%`}
                    sub={`Planned ${actualStats.plannedAtScan}% on scan date`}
                  />
                  <StatTile
                    label="Delayed activities"
                    value={actualStats.delayed}
                    sub={`of ${actualStats.measured} measured`}
                  />
                  <StatTile
                    label="Missing elements"
                    value={actualStats.overdueMissing.toLocaleString()}
                    sub="Not built, planned done by scan"
                  />
                  <StatTile
                    label="Latest scan"
                    value={fmtDay(parseDay(actualStats.scanDate))}
                    sub={`${progress.scan_dates.length} scan${progress.scan_dates.length === 1 ? "" : "s"} assessed`}
                  />
                  <StatTile
                    label="Forecast finish"
                    value={
                      actualStats.actual >= 100
                        ? "Done"
                        : actualStats.forecast
                          ? fmtDay(actualStats.forecast)
                          : "—"
                    }
                    sub={
                      actualStats.forecast
                        ? `At current pace · planned ${fmtDay(range.scheduleFinish)}`
                        : "Needs progress on a scan"
                    }
                  />
                </div>
              )}

              {/* ---------- notices ---------- */}
              {progress && (() => {
                const notice = (text, action) => (
                  <div style={{ margin: "10px 18px 0", padding: "8px 12px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ flex: 1 }}>{text}</span>
                    {action}
                  </div>
                );
                if (!progress.scan_dates.length)
                  return notice("No Progress Assessment saved yet — run one under Progress Monitoring to see actual progress here.");
                const usesLevels = activities.some((a) => a.actual?.match === "type_level");
                if (usesLevels && !progress.latest_has_levels)
                  return notice("The latest Progress Assessment was saved before floors were recorded. Re-run it to match activities by level.");
                if (unmatchedLevels.length)
                  return notice(
                    `${unmatchedLevels.length} schedule level${unmatchedLevels.length === 1 ? "" : "s"} (${unmatchedLevels.slice(0, 4).join(", ")}${unmatchedLevels.length > 4 ? "…" : ""}) don't match any floor in the model.`,
                    <ToolbarButton label="Map levels" onClick={() => setLevelMapOpen(true)} />,
                  );
                if (Object.keys(progress.level_map || {}).length)
                  return (
                    <div style={{ margin: "8px 18px 0", fontSize: 12, color: "#64748b", flexShrink: 0 }}>
                      Schedule levels are mapped to model floors.{" "}
                      <button onClick={() => setLevelMapOpen(true)} style={{ border: "none", background: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0 }}>
                        Edit mapping
                      </button>
                    </div>
                  );
                return null;
              })()}

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
                {progress && (
                  <select value={progressFilter} onChange={(e) => setProgressFilter(e.target.value)} style={selectStyle}>
                    <option value="all">All progress</option>
                    {Object.keys(PROGRESS_STYLE).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
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
                  <ScheduleTable
                    groups={groups}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    showProgress={Boolean(progress)}
                    onShowMissing={setMissingFor}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {missingFor && <MissingElementsDialog activity={missingFor} onClose={() => setMissingFor(null)} />}
      {levelMapOpen && progress && (
        <LevelMapDialog
          scheduleLevels={levels}
          ifcLevels={progress.ifc_levels}
          levelMap={progress.level_map || {}}
          onSave={saveLevelMap}
          onClose={() => setLevelMapOpen(false)}
        />
      )}
    </div>
  );
}

function Dialog({ title, subtitle, onClose, children, footer }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, width: "min(760px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(15,23,42,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 18px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} title="Close" style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b", display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}

// Elements of one activity that the latest scan doesn't show as built.
function MissingElementsDialog({ activity, onClose }) {
  const act = activity.actual;
  const th = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", padding: "8px 12px", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, background: "#f8fafc" };
  const td = { fontSize: 12, color: "#1e293b", padding: "7px 12px", borderBottom: "1px solid #f1f5f9" };
  return (
    <Dialog
      title={`${activity.id} · ${activity.name}`}
      subtitle={`${act.missing_total} of ${act.matched} elements not built in the scan of ${act.scan_date}${
        act.missing_total > act.missing.length ? ` — showing first ${act.missing.length}` : ""
      }. Hidden or interior elements may not be visible to the scanner.`}
      onClose={onClose}
    >
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Element", "IFC type", "Level", "Status", "Coverage", "GlobalId"].map((h) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {act.missing.map((e) => (
            <tr key={e.element_id}>
              <td style={td}>{e.name || "—"}</td>
              <td style={td}>{e.element_type}</td>
              <td style={td}>{e.level || "—"}</td>
              <td style={td}>
                <StatusChip status={e.status === "in_progress" ? "In Progress" : "Not Started"} />
              </td>
              <td style={td}>{Math.round(e.completion || 0)}%</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#64748b" }}>{e.element_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

// Map schedule level names to the model's IFC storey names.
function LevelMapDialog({ scheduleLevels, ifcLevels, levelMap, onSave, onClose }) {
  const ifcLower = new Set(ifcLevels.map((l) => l.toLowerCase()));
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(scheduleLevels.map((l) => [l, levelMap[l] || ""])),
  );
  return (
    <Dialog
      title="Map schedule levels to model floors"
      subtitle="Activities are matched to scanned elements by IFC type and floor. Pick the model floor for each schedule level whose name differs."
      onClose={onClose}
      footer={
        <>
          <ToolbarButton label="Cancel" onClick={onClose} />
          <ToolbarButton label="Save mapping" primary onClick={() => onSave(draft)} />
        </>
      }
    >
      <div style={{ padding: "8px 18px 14px" }}>
        {scheduleLevels.map((l) => {
          const exact = ifcLower.has(String(l).toLowerCase());
          return (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ flex: 1, fontSize: 13, color: "#0f172a" }}>{l}</div>
              <select
                value={draft[l] || ""}
                onChange={(e) => setDraft((d) => ({ ...d, [l]: e.target.value }))}
                style={{ height: 30, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, padding: "0 8px", minWidth: 200 }}
              >
                <option value="">{exact ? "Same name (matches)" : "— not mapped —"}</option>
                {ifcLevels.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

function ScheduleTable({ groups, selectedId, onSelect, showProgress, onShowMissing }) {
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
    ...(showProgress
      ? [
          ["actualPct", "Actual %"],
          ["progress", "Progress"],
          ["actualStart", "Actual start"],
          ["actualFinish", "Actual finish"],
          ["remaining", "Not built"],
        ]
      : []),
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
                      ) : k === "actualPct" ? (
                        a.actual?.matched ? (
                          <span
                            title={`${a.actual.completed} of ${a.actual.matched} elements built (scan ${a.actual.scan_date})`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                          >
                            <span style={{ width: 50, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                              <span style={{ display: "block", width: `${a.actual.actual_pct}%`, height: "100%", background: "#0f172a" }} />
                            </span>
                            {Math.round(a.actual.actual_pct)}%
                            {a.elementCount != null && a.elementCount !== a.actual.matched && (
                              <span
                                title={`Schedule expects ${a.elementCount} elements but ${a.actual.matched} were found in the model`}
                                style={{ color: "#d97706", fontWeight: 700 }}
                              >
                                ⚠
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )
                      ) : k === "progress" ? (
                        <ProgressChip state={a.progress} />
                      ) : k === "actualStart" ? (
                        a.actual?.actual_start || ""
                      ) : k === "actualFinish" ? (
                        a.actual?.actual_finish || ""
                      ) : k === "remaining" ? (
                        a.actual?.missing_total ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onShowMissing(a);
                            }}
                            title="List the elements not built yet"
                            style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 999, fontSize: 11, fontWeight: 600, padding: "2px 9px", cursor: "pointer" }}
                          >
                            {a.actual.missing_total} of {a.actual.matched}
                          </button>
                        ) : a.actual?.matched ? (
                          <span style={{ color: "#15803d", fontSize: 12 }}>0</span>
                        ) : (
                          ""
                        )
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
