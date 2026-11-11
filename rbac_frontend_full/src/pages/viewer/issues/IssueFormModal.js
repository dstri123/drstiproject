import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import { X, Camera, Trash2, MapPin } from "lucide-react";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "./useIssues";

/**
 * Create or edit a pinned issue.
 *  - draft: a new pick from the 3D view {position, viewpoint, element, snapshot}
 *  - issue: an existing issue (edit mode)
 * onSave(fields, files) / onDelete() return promises; errors are shown inline.
 */
export default function IssueFormModal({
  draft,
  issue,
  bimId,
  assignees,
  onSave,
  onDelete,
  onClose,
}) {
  const editing = !!issue;
  const [form, setForm] = useState(() => ({
    title: issue?.title || "",
    description: issue?.description || "",
    status: issue?.status || "open",
    priority: issue?.priority || "normal",
    assignee: issue?.assignee ?? "",
    due_date: issue?.due_date || "",
  }));
  const [photo, setPhoto] = useState(null); // newly chosen File
  const [clearPhoto, setClearPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const snapshotUrl = useMemo(
    () => (draft?.snapshot ? URL.createObjectURL(draft.snapshot) : issue?.snapshot),
    [draft, issue],
  );
  const photoUrl = useMemo(
    () => (photo ? URL.createObjectURL(photo) : clearPhoto ? null : issue?.photo),
    [photo, clearPhoto, issue],
  );
  useEffect(
    () => () => {
      if (draft?.snapshot && snapshotUrl) URL.revokeObjectURL(snapshotUrl);
    },
    [draft, snapshotUrl],
  );
  useEffect(
    () => () => {
      if (photo && photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photo, photoUrl],
  );

  const element = draft?.element || (issue?.element_express_id != null && {
    expressID: issue.element_express_id,
    type: issue.element_type,
    globalId: issue.element_global_id,
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Give the issue a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const fields = {
      ...form,
      title: form.title.trim(),
      assignee: form.assignee === "" ? null : form.assignee,
      due_date: form.due_date || null,
    };
    if (!editing) {
      Object.assign(fields, {
        bim: bimId ?? null,
        position: draft.position,
        viewpoint: draft.viewpoint,
        element_express_id: draft.element?.expressID ?? null,
        element_global_id: draft.element?.globalId || "",
        element_type: draft.element?.type || "",
      });
    } else if (clearPhoto && !photo) {
      fields.clear_photo = true;
    }
    try {
      await onSave(fields, { photo, snapshot: editing ? null : draft.snapshot });
    } catch (err) {
      const data = err.response?.data;
      setError(
        data?.error ||
          (data && typeof data === "object"
            ? Object.entries(data)
                .map(([k, v]) => `${k}: ${[].concat(v).join(" ")}`)
                .join(" · ")
            : err.message) ||
          "Could not save the issue.",
      );
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete issue #${issue.number}?`)) return;
    setSaving(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err.response?.data?.error || "Could not delete the issue.");
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div style={overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} style={dialog}>
        <div style={header}>
          <MapPin size={15} color="#4f46e5" />
          <span style={{ fontWeight: 800, fontSize: 13, color: "#0f172a" }}>
            {editing ? `Issue #${issue.number}` : "New issue"}
          </span>
          {editing && issue.created_by_name && (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              by {issue.created_by_name} · {issue.created_at?.slice(0, 10)}
            </span>
          )}
          <button type="button" onClick={onClose} style={iconBtn} title="Close">
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 16, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <Thumb url={snapshotUrl} label="3D viewpoint" />
            <div style={{ flex: 1, position: "relative" }}>
              <Thumb url={photoUrl} label="Site photo" />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <label style={smallBtn}>
                  <Camera size={12} /> {photoUrl ? "Replace" : "Add photo"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setPhoto(f);
                        setClearPhoto(false);
                      }
                    }}
                  />
                </label>
                {photoUrl && (
                  <button
                    type="button"
                    style={smallBtn}
                    onClick={() => {
                      setPhoto(null);
                      setClearPhoto(true);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {element && (
            <div style={elementBox}>
              Pinned to <b>{element.type || "IFC element"}</b> #{element.expressID}
              {element.globalId && (
                <span style={{ fontFamily: "monospace", marginLeft: 6 }}>
                  {element.globalId}
                </span>
              )}
            </div>
          )}

          <Label text="Title">
            <input
              autoFocus
              value={form.title}
              onChange={set("title")}
              maxLength={255}
              placeholder="e.g. Missing fire stopping at slab penetration"
              style={input}
            />
          </Label>
          <Label text="Description">
            <textarea
              value={form.description}
              onChange={set("description")}
              rows={3}
              style={{ ...input, resize: "vertical" }}
            />
          </Label>
          <div style={grid}>
            <Label text="Status">
              <select value={form.status} onChange={set("status")} style={input}>
                {Object.entries(ISSUE_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Priority">
              <select value={form.priority} onChange={set("priority")} style={input}>
                {Object.entries(ISSUE_PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Assignee">
              <select value={form.assignee} onChange={set("assignee")} style={input}>
                <option value="">Unassigned</option>
                {assignees.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Due date">
              <input
                type="date"
                value={form.due_date}
                onChange={set("due_date")}
                style={input}
              />
            </Label>
          </div>

          {error && <div style={errorBox}>{error}</div>}
        </div>

        <div style={footer}>
          {editing && (
            <button type="button" onClick={remove} disabled={saving} style={dangerBtn}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create issue"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function Thumb({ url, label }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={thumb}>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <img
              src={url}
              alt={label}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </a>
        ) : (
          <span style={{ fontSize: 11, color: "#cbd5e1" }}>None</span>
        )}
      </div>
    </div>
  );
}

function Label({ text, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{text}</span>
      {children}
    </label>
  );
}

const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(15,23,42,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
const dialog = {
  width: 460,
  maxWidth: "100%",
  maxHeight: "92vh",
  display: "flex",
  flexDirection: "column",
  background: "#fff",
  borderRadius: 12,
  boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};
const header = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderBottom: "1px solid #f1f5f9",
};
const footer = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderTop: "1px solid #f1f5f9",
};
const iconBtn = {
  marginLeft: "auto",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#64748b",
  display: "flex",
};
const thumb = {
  height: 110,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const input = {
  fontSize: 12,
  padding: "7px 9px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 10 };
const elementBox = {
  fontSize: 11,
  color: "#3730a3",
  background: "#eef2ff",
  borderRadius: 6,
  padding: "6px 8px",
  marginBottom: 10,
  wordBreak: "break-all",
};
const errorBox = {
  fontSize: 11,
  color: "#b91c1c",
  background: "#fef2f2",
  borderRadius: 6,
  padding: "6px 8px",
};
const baseBtn = {
  fontSize: 12,
  fontWeight: 600,
  padding: "7px 14px",
  borderRadius: 6,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 5,
};
const primaryBtn = { ...baseBtn, border: "none", background: "#4f46e5", color: "#fff" };
const secondaryBtn = { ...baseBtn, border: "1px solid #e5e7eb", background: "#fff", color: "#475569" };
const dangerBtn = { ...baseBtn, border: "1px solid #fecaca", background: "#fff", color: "#dc2626" };
const smallBtn = {
  ...baseBtn,
  fontSize: 11,
  padding: "4px 8px",
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#475569",
};
