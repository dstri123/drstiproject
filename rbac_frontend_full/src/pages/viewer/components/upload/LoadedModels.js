import React from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";

export default function LoadedModels({
  bimFile,
  pointFile,
  onToggleBim,
  onTogglePc,
  onDeleteBim,
  onDeletePc,
  bimVisible,
  pcVisible,
}) {
  return (
    <div style={{ marginTop: "20px" }}>
      <h3 style={{ marginBottom: "12px", fontSize: "15px" }}>
        📦 Loaded Models
      </h3>

      {bimFile && (
        <ModelRow
          file={bimFile}
          type="BIM"
          visible={bimVisible}
          onToggle={onToggleBim}
          onDelete={onDeleteBim}
        />
      )}

      {pointFile && (
        <ModelRow
          file={pointFile}
          type="PointCloud"
          visible={pcVisible}
          onToggle={onTogglePc}
          onDelete={onDeletePc}
        />
      )}
    </div>
  );
}

/* -----------------------------
   Reusable Model Row Component
------------------------------ */
function ModelRow({ file, type, visible, onToggle, onDelete }) {
  return (
    <div style={styles.box}>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "14px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "180px",
          }}
        >
          {file.name}
        </div>

        <div
          style={{
            fontSize: "12px",
            color: "#6b7280",
            marginTop: "2px",
          }}
        >
          {type}
        </div>
      </div>

      <div style={styles.iconContainer}>
        {/* Visibility Toggle */}
        {visible ? (
          <Eye size={20} onClick={onToggle} style={styles.visibleIcon} />
        ) : (
          <EyeOff size={20} onClick={onToggle} style={styles.hiddenIcon} />
        )}

        {/* Delete */}
        <Trash2 size={20} onClick={onDelete} style={styles.deleteIcon} />
      </div>
    </div>
  );
}

/* -----------------------------
   Styles
------------------------------ */
const styles = {
  box: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "12px 14px",
    marginBottom: "10px",
    transition: "0.2s ease",
  },

  iconContainer: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
  },

  visibleIcon: {
    color: "#10b981",
    cursor: "pointer",
  },

  hiddenIcon: {
    color: "#9ca3af",
    cursor: "pointer",
  },

  deleteIcon: {
    color: "#ef4444",
    cursor: "pointer",
  },
};
