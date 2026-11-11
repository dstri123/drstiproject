import React, { useMemo, useState } from "react";
import { MapPin, Download, X, Eye, EyeOff } from "lucide-react";
import { ISSUE_STATUS, isOverdue } from "./useIssues";

const FILTERS = [
  { id: "active", label: "Open & in progress", status: "open,in_progress" },
  { id: "all", label: "All issues" },
  ...Object.entries(ISSUE_STATUS).map(([k, v]) => ({
    id: k,
    label: v.label,
    status: k,
  })),
];

/**
 * Sidebar "Issues" panel: start pinning, filter, open an issue (flies the
 * camera to it), and export the filtered issues as BCF.
 */
export default function IssuesPanel({
  issues,
  loading,
  pinMode,
  hasBim,
  onTogglePinMode,
  onOpen,
  onExport,
  hiddenIds,
  onToggleVisible,
}) {
  const [filterId, setFilterId] = useState("active");
  const [exporting, setExporting] = useState(false);
  const filter = FILTERS.find((f) => f.id === filterId);

  const shown = useMemo(() => {
    const allowed = filter.status?.split(",");
    return issues.filter((i) => !allowed || allowed.includes(i.status));
  }, [issues, filter]);

  const exportShown = async () => {
    setExporting(true);
    try {
      await onExport(filter.status ? { status: filter.status } : {});
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <button
        onClick={onTogglePinMode}
        disabled={!hasBim && !pinMode}
        title={hasBim ? "" : "Load a BIM model to pin issues"}
        style={{
          ...btn,
          background: pinMode ? "#4f46e5" : "#eef2ff",
          borderColor: pinMode ? "#4f46e5" : "#c7d2fe",
          color: pinMode ? "#fff" : "#3730a3",
          opacity: !hasBim && !pinMode ? 0.5 : 1,
        }}
      >
        {pinMode ? <X size={12} /> : <MapPin size={12} />}
        {pinMode ? "Cancel pinning" : "Pin new issue"}
      </button>
      {pinMode && (
        <div style={hint}>
          Click a spot on the model to place the issue. Esc cancels.
        </div>
      )}

      <div style={{ display: "flex", gap: 4, margin: "8px 0" }}>
        <select
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
          style={select}
        >
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          onClick={exportShown}
          disabled={!shown.length || exporting}
          title="Export these issues as BCF 2.1 (Revit, Navisworks, Solibri…)"
          style={{
            ...btn,
            width: "auto",
            marginBottom: 0,
            background: "#fff",
            color: "#475569",
            opacity: !shown.length || exporting ? 0.5 : 1,
          }}
        >
          <Download size={12} /> BCF
        </button>
      </div>

      {loading && !issues.length ? (
        <div style={empty}>Loading issues…</div>
      ) : !shown.length ? (
        <div style={empty}>
          {issues.length ? "No issues match this filter." : "No issues yet."}
        </div>
      ) : (
        <ul style={list}>
          {shown.map((i) => {
            const st = ISSUE_STATUS[i.status] || ISSUE_STATUS.open;
            const overdue = isOverdue(i);
            const hidden = hiddenIds?.has(i.id);
            return (
              <li key={i.id} style={{ position: "relative" }}>
                <button
                  onClick={() => onOpen(i)}
                  style={{ ...row, opacity: hidden ? 0.55 : 1 }}
                >
                  <span style={{ ...badge, background: st.color }}>{i.number}</span>
                  <span style={{ minWidth: 0, flex: 1, paddingRight: 20 }}>
                    <span style={title}>{i.title}</span>
                    <span style={meta}>
                      <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>
                      {i.assignee_name && ` · ${i.assignee_name}`}
                      {i.due_date && (
                        <span style={overdue ? { color: "#dc2626", fontWeight: 700 } : null}>
                          {` · ${overdue ? "overdue " : "due "}${i.due_date}`}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onToggleVisible?.(i.id)}
                  title={hidden ? "Show pin in viewer" : "Hide pin in viewer"}
                  style={eyeBtn}
                >
                  {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const btn = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 5,
  border: "1px solid #e5e7eb",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  marginBottom: 4,
};
const hint = {
  fontSize: 10.5,
  color: "#4338ca",
  background: "#eef2ff",
  borderRadius: 5,
  padding: "6px 8px",
  lineHeight: 1.4,
};
const select = {
  flex: 1,
  minWidth: 0,
  fontSize: 11,
  padding: "5px 6px",
  border: "1px solid #e5e7eb",
  borderRadius: 5,
};
const empty = {
  padding: "18px 6px",
  textAlign: "center",
  fontSize: 11,
  color: "#94a3b8",
};
const list = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const row = {
  width: "100%",
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "7px 8px",
  border: "1px solid #eef0f2",
  borderRadius: 6,
  background: "#fafafa",
  cursor: "pointer",
  textAlign: "left",
};
const badge = {
  flexShrink: 0,
  minWidth: 20,
  height: 20,
  borderRadius: 10,
  color: "#fff",
  fontSize: 10,
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
};
const title = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#1f2937",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const eyeBtn = {
  position: "absolute",
  top: 6,
  right: 6,
  border: "none",
  background: "transparent",
  padding: 2,
  cursor: "pointer",
  color: "#64748b",
  display: "flex",
};
const meta = { display: "block", fontSize: 10, color: "#64748b", marginTop: 2 };
