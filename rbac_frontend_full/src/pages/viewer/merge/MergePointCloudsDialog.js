import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Merge, X, LoaderCircle, Eye, RefreshCw } from "lucide-react";
import { formatCount, isActiveMerge, monthLabel } from "./useMonthlyMerge";

// Confirmation + progress dialog for the calendar's "Merge Point Clouds"
// button. Shows the project, month and the files that will be merged, then
// tracks the background job and offers to open the result. Styled to match
// the calendar popup (inline styles, same palette).

const ACCENT = "#3b82f6";
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const box = (bg, border, color) => ({
  background: bg,
  border: `1px solid ${border}`,
  color,
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 12,
  lineHeight: 1.45,
  marginTop: 12,
});

const buttonStyle = (variant, disabled) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 34,
  padding: "6px 14px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  whiteSpace: "nowrap",
  ...(variant === "primary"
    ? { background: ACCENT, color: "#fff", border: `1px solid ${ACCENT}` }
    : { background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1" }),
});

const formatMeters = (m) => {
  if (typeof m !== "number" || !Number.isFinite(m)) return "—";
  if (m < 0.01) return `${(m * 1000).toFixed(1)} mm`;
  if (m < 1) return `${(m * 100).toFixed(1)} cm`;
  return `${m.toFixed(2)} m`;
};

const formatDateTime = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

function FileList({ items, tone }) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: "6px 0 0",
        padding: 0,
        maxHeight: 150,
        overflowY: "auto",
      }}
    >
      {items.map((f) => (
        <li
          key={f.id}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            padding: "4px 0",
            borderTop: "1px solid rgba(148,163,184,0.25)",
            minWidth: 0,
          }}
        >
          <span style={{ color: "#64748b", flexShrink: 0 }}>{f.date || "—"}</span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 600,
            }}
            title={f.name}
          >
            {f.name}
          </span>
          {tone === "source" ? (
            <span
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 700,
                color: f.has_saved_alignment ? "#047857" : "#64748b",
              }}
            >
              {f.format} ·{" "}
              {f.has_saved_alignment ? "saved alignment" : "auto-register"}
            </span>
          ) : (
            <span style={{ flexShrink: 0, fontSize: 11 }}>{f.reason}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function MergePointCloudsDialog({
  year,
  month,
  projectName,
  job,
  starting,
  loadPreview,
  onStart,
  onView,
  onClose,
}) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [startError, setStartError] = useState(null);
  const primaryRef = useRef(null);
  const label = monthLabel(year, month);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPreview(await loadPreview(year, month));
    } catch (err) {
      setLoadError(
        err?.response?.data?.error ||
          "Could not load the point clouds for this month.",
      );
    } finally {
      setLoading(false);
    }
  }, [loadPreview, year, month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Once a tracked job finishes, re-read the preview so the "latest result"
  // and out-of-date flags reflect it.
  const jobStatus = job?.status;
  useEffect(() => {
    if (jobStatus === "completed" || jobStatus === "failed") refresh();
  }, [jobStatus, refresh]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!loading) primaryRef.current?.focus();
  }, [loading]);

  // Most recent job for the month: the one this session tracks, else what
  // the server reports.
  const current = job || preview?.running || preview?.latest || null;
  const running = isActiveMerge(current) ? current : null;
  const failed = current?.status === "failed" ? current : null;
  const completed =
    current?.status === "completed" ? current : preview?.latest_completed || null;
  const stale = Boolean(completed?.is_stale);

  const sources = preview?.sources || [];
  const excluded = preview?.excluded_sources || [];
  const missing = preview?.missing_sources || [];
  const canMerge = preview?.can_merge !== false;
  const busy = Boolean(running) || starting;
  const blocked = loading || !!loadError || !sources.length || missing.length > 0;
  const upToDate = completed && !stale;

  const start = async (force) => {
    if (busy) return;
    setStartError(null);
    const res = await onStart({ force });
    if (res?.error) setStartError(res);
  };

  const primaryLabel = running
    ? `Merging… ${Math.round((running.progress || 0) * 100)}%`
    : starting
      ? "Starting…"
      : completed
        ? "Regenerate"
        : `Merge ${sources.length || ""} point cloud${sources.length === 1 ? "" : "s"}`;

  return ReactDOM.createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: FONT,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-pc-title"
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.16)",
          width: "min(460px, 100%)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          padding: "16px 16px 14px",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Merge size={16} color={ACCENT} />
          <h2
            id="merge-pc-title"
            style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1 }}
          >
            Merge Point Clouds
          </h2>
          <button
            onClick={onClose}
            title="Close dialog"
            aria-label="Close dialog"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
              display: "flex",
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 12px",
            margin: "12px 0 0",
            fontSize: 12,
          }}
        >
          <dt style={{ color: "#64748b" }}>Project</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>
            {preview?.project_name || projectName || "—"}
          </dd>
          <dt style={{ color: "#64748b" }}>Month</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{label}</dd>
          <dt style={{ color: "#64748b" }}>Files</dt>
          <dd style={{ margin: 0, fontWeight: 600 }} data-testid="merge-file-count">
            {loading ? "…" : `${sources.length} point cloud file${sources.length === 1 ? "" : "s"}`}
          </dd>
        </dl>

        {loading && !preview && (
          <div style={{ ...box("#f8fafc", "#e2e8f0", "#475569"), display: "flex", gap: 8 }}>
            <LoaderCircle size={14} className="animate-spin" />
            Checking point clouds for {label}…
          </div>
        )}

        {loadError && (
          <div style={box("#fef2f2", "#fecaca", "#b91c1c")}>
            {loadError}{" "}
            <button
              onClick={refresh}
              style={{ ...buttonStyle("secondary"), minHeight: 26, marginLeft: 6 }}
            >
              Retry
            </button>
          </div>
        )}

        {preview && !sources.length && !missing.length && (
          <div style={box("#f8fafc", "#e2e8f0", "#475569")}>
            No readable point cloud files were uploaded in {label}.
          </div>
        )}

        {sources.length > 0 && (
          <div style={box("#f8fafc", "#e2e8f0", "#0f172a")}>
            These files will be registered into one coordinate system and merged
            into <strong>{preview.output_name}</strong>. The original uploads and
            their saved alignments are not changed.
            <FileList items={sources} tone="source" />
          </div>
        )}

        {excluded.length > 0 && (
          <div style={box("#fffbeb", "#fde68a", "#92400e")}>
            <strong>Left out ({excluded.length}):</strong> the server cannot read
            these formats.
            <FileList items={excluded} />
          </div>
        )}

        {missing.length > 0 && (
          <div style={box("#fef2f2", "#fecaca", "#b91c1c")}>
            <strong>Missing files ({missing.length}):</strong> re-upload or delete
            them before merging.
            <FileList items={missing} />
          </div>
        )}

        {running && (
          <div style={box("#eff6ff", "#bfdbfe", "#1e3a8a")} aria-live="polite">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <LoaderCircle size={13} className="animate-spin" />
                {running.stage_label || "Queued"}
              </span>
              <strong>{Math.round((running.progress || 0) * 100)}%</strong>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((running.progress || 0) * 100)}
              style={{
                height: 6,
                borderRadius: 3,
                background: "#dbeafe",
                marginTop: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(2, (running.progress || 0) * 100)}%`,
                  background: ACCENT,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <div style={{ marginTop: 6, color: "#475569" }}>
              You can close this dialog; the merge keeps running on the server.
            </div>
          </div>
        )}

        {(failed || startError) && !running && (
          <div style={box("#fef2f2", "#fecaca", "#b91c1c")} role="alert">
            <strong>Merge failed.</strong>{" "}
            {startError?.error || failed?.error_message}
            {(startError?.failed_sources || failed?.failed_sources || []).length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                {(startError?.failed_sources || failed.failed_sources).map((f) => (
                  <li key={f.id} style={{ marginTop: 4 }}>
                    <strong>{f.name}</strong>
                    {f.date ? ` (${f.date})` : ""}: {f.reason}
                    {typeof f.fitness === "number" &&
                      ` [overlap ${(f.fitness * 100).toFixed(0)}%${
                        typeof f.rmse === "number" ? `, RMSE ${formatMeters(f.rmse)}` : ""
                      }]`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {completed && !running && (
          <div
            style={
              stale
                ? box("#fffbeb", "#fde68a", "#92400e")
                : box("#ecfdf5", "#a7f3d0", "#065f46")
            }
          >
            <strong>
              {stale ? "Merged point cloud is out of date." : "Merged point cloud ready."}
            </strong>{" "}
            {formatCount(completed.point_count)} points from{" "}
            {completed.total_source_files} file
            {completed.total_source_files === 1 ? "" : "s"} · voxel{" "}
            {formatMeters(completed.voxel_size)}
            {typeof completed.min_fitness === "number" &&
              completed.total_source_files > 1 &&
              ` · min overlap ${(completed.min_fitness * 100).toFixed(0)}%, max RMSE ${formatMeters(
                completed.max_rmse,
              )}`}
            {completed.completed_at && (
              <div style={{ color: "#475569", marginTop: 2 }}>
                Created {formatDateTime(completed.completed_at)}
                {completed.created_by ? ` by ${completed.created_by}` : ""}
              </div>
            )}
            {stale && (
              <div style={{ marginTop: 4 }}>
                Point clouds for {label} were added, replaced or re-aligned after
                this merge. Regenerate to include the changes.
              </div>
            )}
          </div>
        )}

        {!canMerge && (
          <div style={box("#f8fafc", "#e2e8f0", "#475569")}>
            Your role can open merged point clouds but cannot create them.
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button onClick={onClose} style={buttonStyle("secondary")}>
            {running ? "Close" : "Cancel"}
          </button>
          {completed?.file_url && !running && (
            <button
              onClick={() => onView(completed)}
              style={buttonStyle(upToDate ? "primary" : "secondary")}
              ref={upToDate ? primaryRef : undefined}
            >
              <Eye size={14} />
              View merged
            </button>
          )}
          {canMerge && (
            <button
              ref={upToDate ? undefined : primaryRef}
              onClick={() => start(Boolean(completed))}
              disabled={busy || blocked}
              aria-busy={busy}
              style={buttonStyle(upToDate ? "secondary" : "primary", busy || blocked)}
            >
              {busy ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : completed ? (
                <RefreshCw size={14} />
              ) : (
                <Merge size={14} />
              )}
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
