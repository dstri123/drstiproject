import React from "react";

function ElementMetadata({
  selectedElement,
  bimElementCount,
  overlapElementCount,
  overlappingPoints, // NEW — computed in the parent from overlapCounts
  // (byUuid / byExpressID maps kept in React state, populated by useOverlap's
  // setOverlapCounts callback) and looked up for the currently selected
  // element. Replaces the old selectedElement.overlappingPoints, which was
  // never actually set anywhere.
  highlightOverlap,
  setHighlightOverlap,
  onSaveOverlapData, // NEW — saves the current overlap data to the backend
  // so the BIM<->PointCloud pair shows up on the Progress Assessment page.
}) {
  if (!selectedElement) return null;

  return (
    <>
      <h3>🧩 Element Metadata</h3>

      <div>📦 BIM Elements: {bimElementCount}</div>
      <div>🟢 Overlapping Elements: {overlapElementCount}</div>

      <div
        style={{
          background: "#f3f4f6",
          padding: "12px",
          borderRadius: "8px",
          fontSize: "13px",
          border: "1px solid #d1d5db",
          marginTop: "8px",
        }}
      >
        <div>
          <b>Name:</b> {selectedElement.name || "—"}
        </div>

        {/* CHANGED — defensive fallbacks so a not-yet-populated selectedElement
            renders "—" instead of blank/undefined. */}
        <div>
          <b>Type:</b> {selectedElement.type || "—"}
        </div>

        <div>
          <b>Position:</b> [
          {Array.isArray(selectedElement.position)
            ? selectedElement.position.map((n) => n.toFixed(2)).join(", ")
            : "—"}
          ]
        </div>

        <div>
          <b>Rotation:</b> [
          {Array.isArray(selectedElement.rotation)
            ? selectedElement.rotation.map((n) => n.toFixed(2)).join(", ")
            : "—"}
          , "XYZ"]
        </div>

        <div>
          <b>Scale:</b> [
          {Array.isArray(selectedElement.scale)
            ? selectedElement.scale.map((n) => n.toFixed(2)).join(", ")
            : "—"}
          ]
        </div>

        <div>
          <b>Visible:</b>{" "}
          {typeof selectedElement.visible === "boolean"
            ? String(selectedElement.visible)
            : "—"}
        </div>

        {/* Overlap Section */}
        <div
          style={{
            background: "#f9fafb",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
            marginTop: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <b>Overlapping PointCloud Points:</b>

            <button
              onClick={() => setHighlightOverlap((prev) => !prev)}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                backgroundColor: highlightOverlap ? "#22c55e" : "#9ca3af",
                color: "white",
              }}
            >
              {highlightOverlap ? "ON" : "OFF"}
            </button>
          </div>

          {/* CHANGED — was selectedElement?.overlappingPoints ?? 0, which was
              always 0 because nothing ever set that field. Now reads the
              overlappingPoints prop computed by the parent from the
              byUuid/byExpressID count maps produced in useOverlap.js. */}
          <div
            style={{
              marginTop: "6px",
              fontWeight: "bold",
              color:
                highlightOverlap && overlappingPoints > 0 ? "#16a34a" : "black",
            }}
          >
            {overlappingPoints ?? 0}
          </div>

          {/* NEW — saves the current overlap data (per-element overlapping
              point counts) to the backend, so Progress Assessment can use it
              instead of re-deriving overlap from the saved alignment. */}
          <button
            onClick={() => onSaveOverlapData?.()}
            style={{
              marginTop: "10px",
              width: "100%",
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: "bold",
              borderRadius: "6px",
              border: "1px solid #4f46e5",
              cursor: "pointer",
              backgroundColor: "#4f46e5",
              color: "white",
            }}
          >
            Save Data
          </button>
        </div>
      </div>

      <hr style={{ margin: "20px 0", borderColor: "#ddd" }} />
    </>
  );
}

export default ElementMetadata;