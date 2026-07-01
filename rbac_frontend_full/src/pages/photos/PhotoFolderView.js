import React from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function PhotoFolderView() {
  const { id } = useParams();
  const navigate = useNavigate();

  const foldersRaw = localStorage.getItem("photoFolders");
  const folders = foldersRaw ? JSON.parse(foldersRaw) : [];
  const folder = folders.find((f) => String(f.id) === String(id));

  if (!folder) {
    return (
      <div>
        <h2>Folder not found</h2>
        <button onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => navigate(-1)}>Back</button>
        <h2 style={{ margin: 0 }}>{folder.name}</h2>
      </div>

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Uploaded: {new Date(folder.uploadedAt).toLocaleString()}
        </div>
        <div style={{ fontSize: 12 }}>
          Camera Matrix: {folder.cameraMatrixFileName || "—"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {folder.images.map((img) => (
          <div key={img.name} style={{ borderRadius: 6, overflow: "hidden" }}>
            <img
              src={img.url}
              alt={img.name}
              style={{
                width: "100%",
                height: 200,
                objectFit: "cover",
                display: "block",
              }}
            />
            <div style={{ padding: 8, fontSize: 13 }}>{img.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
