import React, { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";

// ─── Status helpers ─────────────────────────────────────────────────────────
const STATUS_META = {
  completed: { label: "Completed", color: "#16a34a", bg: "#f0fdf4" },
  in_progress: { label: "In Progress", color: "#d97706", bg: "#fffbeb" },
  not_started: { label: "Not Started", color: "#dc2626", bg: "#fef2f2" },
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

export default function ProgressAssessmentPage() {
  const { slug: routeParam } = useParams();
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
  const [statusFilter, setStatusFilter] = useState("ALL"); // "ALL" | "completed" | "in_progress" | "not_started"

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
      const statusOk = statusFilter === "ALL" || e.status === statusFilter;
      return typeOk && statusOk;
    });
  }, [result, typeFilter, statusFilter]);
  const maxHist = Math.max(1, ...history.map((h) => h.overall_completion || 0));

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
        <IconToolbar activePanel={null} onSelectPanel={() => {}} role={role} />

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
                  " Align a BIM + point cloud and Save Position in the viewer to create a pair."}
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
                  Extracting BIM elements → loading the point cloud → matching
                  surface coverage per element. Large clouds / many elements
                  take longer.
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
                            "BIM Area (m²)",
                            "Overlap (m²)",
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
                            <td style={tdStyle}>{c.bim_area}</td>
                            <td style={tdStyle}>{c.overlap_area}</td>
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

                {/* Element table */}
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
                            "BIM Area",
                            "Overlap",
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
                              <td style={tdStyle}>{e.bim_area}</td>
                              <td style={tdStyle}>{e.overlap_area}</td>
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
              </>
            )}

            {/* Progress over time */}
            {history.length > 0 && (
              <Section title="Progress Over Time">
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 10,
                    height: 140,
                    padding: "8px 4px",
                  }}
                >
                  {history
                    .slice()
                    .reverse()
                    .map((h) => (
                      <div
                        key={h.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 4,
                          flex: 1,
                          minWidth: 36,
                        }}
                        title={`${h.overall_completion}% on ${fmtDate(h.pointcloud_date)}`}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          {Math.round(h.overall_completion)}%
                        </span>
                        <div
                          style={{
                            width: "70%",
                            height: `${(h.overall_completion / maxHist) * 100}%`,
                            minHeight: 3,
                            background: "#4f46e5",
                            borderRadius: 4,
                          }}
                        />
                        <span style={{ fontSize: 9, color: "#94a3b8" }}>
                          {fmtDate(h.pointcloud_date)}
                        </span>
                      </div>
                    ))}
                </div>
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
