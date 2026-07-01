import React from "react";

function ElementMetadata({
  selectedElement,
  bimElementCount,
  overlapElementCount,
  highlightOverlap,
  setHighlightOverlap,
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
          <b>Name:</b> {selectedElement.name}
        </div>

        <div>
          <b>Type:</b> {selectedElement.type}
        </div>

        <div>
          <b>Position:</b> [{selectedElement.position?.join(", ")}]
        </div>

        <div>
          <b>Rotation:</b> [{selectedElement.rotation?.join(", ")}, "XYZ"]
        </div>

        <div>
          <b>Scale:</b> [{selectedElement.scale?.join(", ")}]
        </div>

        <div>
          <b>Visible:</b> {String(selectedElement.visible)}
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

          <div
            style={{
              marginTop: "6px",
              fontWeight: "bold",
              color:
                highlightOverlap && selectedElement?.overlappingPoints > 0
                  ? "#16a34a"
                  : "black",
            }}
          >
            {selectedElement?.overlappingPoints ?? 0}
          </div>
        </div>
      </div>

      <hr style={{ margin: "20px 0", borderColor: "#ddd" }} />
    </>
  );
}

export default ElementMetadata;
