import React from "react";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { useNavigate } from "react-router-dom";

const DASHBOARD_PATHS = {
  superadmin: "/superadmin",
  admin: "/admin",
  project_manager: "/manager",
  project_engineer: "/engineer",
  data_contributor: "/data",
  viewer: "/",
};

export default function Header() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "viewer";
  const dashboardPath = DASHBOARD_PATHS[role] || "/";

  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px 0 0",
      }}
    >
      {/* LEFT — icon cell aligned with toolbar width */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 44,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRight: "1px solid #e5e7eb",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14 }}>🏗️</span>
        </div>
        <button
          onClick={() => navigate(dashboardPath)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            color: "#374151",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
          title="Back to Dashboard"
        >
          <LayoutDashboard size={14} />
          Dashboard
        </button>
        <div
          style={{
            paddingLeft: 12,
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#111827",
              letterSpacing: "0.02em",
            }}
          >
            C'TWIN
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>
            BIM &amp; Point Cloud Viewer
          </span>
        </div>
      </div>

      {/* CENTER — workspace mode */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#9ca3af",
          background: "#f3f4f6",
          borderRadius: 4,
          padding: "3px 10px",
        }}
      >
        3D Workspace
      </div>

      {/* RIGHT — role pill + back */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "#6b7280",
            background: "#f3f4f6",
            borderRadius: 4,
            padding: "2px 8px",
            letterSpacing: "0.02em",
          }}
        >
          {role}
        </span>

        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            background: "transparent",
            border: "1px solid #e5e7eb",
            borderRadius: 5,
            color: "#9ca3af",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f3f4f6";
            e.currentTarget.style.color = "#374151";
            e.currentTarget.style.borderColor = "#d1d5db";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#9ca3af";
            e.currentTarget.style.borderColor = "#e5e7eb";
          }}
        >
          <ArrowLeft size={12} />
          Back
        </button>
      </div>
    </div>
  );
}
