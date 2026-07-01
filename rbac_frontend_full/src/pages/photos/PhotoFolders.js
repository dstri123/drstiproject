import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function PhotoFolders() {
  const [folders, setFolders] = useState(() => {
    try {
      const raw = localStorage.getItem("photoFolders");
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("photoFolders", JSON.stringify(folders));
  }, [folders]);

  const handleDeleteFolder = (id) => {
    const f = folders.find((x) => x.id === id);
    if (f) {
      // revoke object URLs
      f.images.forEach((img) => URL.revokeObjectURL(img.url));
      if (f.cameraMatrixUrl) URL.revokeObjectURL(f.cameraMatrixUrl);
    }
    setFolders((prev) => prev.filter((x) => x.id !== id));
  };

  const handleEditFolderName = (id) => {
    const name = prompt("Enter new folder name:");
    if (!name) return;
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  };

  const navigate = useNavigate();

  const openFolder = (id) => {
    navigate(`/photos/${id}`);
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        Photo Folders
      </h2>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div />
        <div>
          <button onClick={() => navigate("/photos/upload")}>Upload</button>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 8 }}>Folders</h3>
        <div style={{ display: "grid", gap: 12 }}>
          {folders.length === 0 && <div>No folders uploaded yet.</div>}
          {folders.map((f) => (
            <div
              key={f.id}
              style={{
                border: "1px solid #e5e7eb",
                padding: 12,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div>
                  <strong>{f.name}</strong>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Uploaded: {new Date(f.uploadedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleEditFolderName(f.id)}>
                    Edit
                  </button>
                  <button onClick={() => handleDeleteFolder(f.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div style={{ fontSize: 12, color: "#374151" }}>
                  Camera Matrix:
                </div>
                <div style={{ fontSize: 12 }}>
                  {f.cameraMatrixFileName || "—"}
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    color: f.isLatest ? "#059669" : "#6b7280",
                  }}
                >
                  {f.isLatest ? "Latest" : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button onClick={() => openFolder(f.id)}>Open Folder</button>
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      window.location.origin + `/photos/${f.id}`,
                    )
                  }
                >
                  Copy Link
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 8,
                }}
              >
                {f.images.map((img) => (
                  <div
                    key={img.name}
                    style={{
                      borderRadius: 4,
                      overflow: "hidden",
                      border: "1px solid #e6eef8",
                      background: "#fff",
                    }}
                  >
                    <img
                      src={img.url}
                      alt={img.name}
                      style={{
                        width: "100%",
                        height: 110,
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    <div style={{ padding: 6, fontSize: 12 }}>{img.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
