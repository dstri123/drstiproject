import React, { useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { getProjectIdFromSlug } from "@/lib/utils";
import {
  Upload,
  Layers,
  Crosshair,
  AlignCenter,
  Camera,
  Table2,
  Download,
  Settings,
  LayoutDashboard,
  BarChart2,
  Boxes,
} from "lucide-react";

const TOOLS = [
  { id: "upload", icon: Upload, label: "Upload Files" },
  { id: "models", icon: Layers, label: "Models" },
  { id: "picking", icon: Crosshair, label: "Picking", adminOnly: true },
  { id: "alignment", icon: AlignCenter, label: "Alignment", adminOnly: true },
  { id: "cameras", icon: Camera, label: "Cameras" },
  { id: "matrix", icon: Table2, label: "Camera Matrix" },
  { id: "export", icon: Download, label: "Export" },
  { id: "settings", icon: Settings, label: "Settings" },
];

const DASHBOARD_PATHS = {
  superadmin: "/superadmin",
  admin: "/admin",
  project_manager: "/manager",
  project_engineer: "/engineer",
  data_contributor: "/data",
};

export default function IconToolbar({ activePanel, onSelectPanel, role }) {
  const [hovered, setHovered] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  // Viewer route param is :projectSlug, Analytics route param is :slug.
  const params = useParams();
  const projectSlug = params.projectSlug || params.slug;
  const projectId = getProjectIdFromSlug(projectSlug);

  const isViewer = role === "viewer";
  const isAnalytics = location.pathname.startsWith("/analytics");
  const isProgress = location.pathname.startsWith("/progress");
  const items = TOOLS.filter((t) => !t.adminOnly || !isViewer);

  const dashboardPath = DASHBOARD_PATHS[role] || "/";

  const NAV_ITEMS = [
    {
      id: "dashboard",
      icon: LayoutDashboard,
      label: "Dashboard",
      path: dashboardPath,
    },
    { id: "analytics", icon: BarChart2, label: "Analytics" },
    { id: "progress", icon: Boxes, label: "Progress Assessment" },
  ];

  const handleNavClick = (item) => {
    if (item.id === "analytics") {
      if (isAnalytics) {
        navigate(projectSlug ? `/viewer/${projectSlug}` : -1);
      } else {
        navigate(projectSlug ? `/analytics/${projectSlug}` : "/analytics/");
      }
    } else if (item.id === "progress") {
      if (isProgress) {
        navigate(projectSlug ? `/viewer/${projectSlug}` : -1);
      } else {
        navigate(projectSlug ? `/progress/${projectSlug}` : "/progress/");
      }
    } else {
      navigate(item.path);
    }
  };

  const renderButton = ({ id, icon: Icon, label, isNav, navItem }) => {
    // Panel tools are active when their panel is open.
    // The Analytics nav item is active while the Analytics page is open.
    const isActive = isNav
      ? (id === "analytics" && isAnalytics) || (id === "progress" && isProgress)
      : activePanel === id;
    const isHovered = hovered === id;

    const handleClick = () => {
      if (isNav) handleNavClick(navItem);
      else onSelectPanel(isActive ? null : id);
    };

    return (
      <div
        key={id}
        style={{ position: "relative", width: "100%" }}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Active left-edge indicator */}
        {isActive && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 2,
              height: 18,
              background: "#3b82f6",
              borderRadius: "0 2px 2px 0",
            }}
          />
        )}

        <button
          onClick={handleClick}
          title={label}
          style={{
            width: "100%",
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isActive
              ? "rgba(59,130,246,0.07)"
              : isHovered
                ? "rgba(0,0,0,0.03)"
                : "transparent",
            border: "none",
            cursor: "pointer",
            color: isActive ? "#3b82f6" : isHovered ? "#4b5563" : "#c4cad4",
            transition: "color 0.12s ease, background 0.12s ease",
            padding: 0,
            borderRadius: 0,
          }}
        >
          <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
        </button>

        {/* Tooltip */}
        {isHovered && (
          <div
            style={{
              position: "absolute",
              left: 50,
              top: "50%",
              transform: "translateY(-50%)",
              background: "#1f2937",
              color: "#f9fafb",
              padding: "4px 10px",
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: "nowrap",
              zIndex: 200,
              boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              pointerEvents: "none",
              letterSpacing: "0.01em",
            }}
          >
            {id === "analytics"
              ? isAnalytics
                ? "Close Analytics"
                : "Open Analytics"
              : id === "progress"
                ? isProgress
                  ? "Close Progress Assessment"
                  : "Open Progress Assessment"
                : label}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        width: 44,
        flexShrink: 0,
        height: "100%",
        background: "#ffffff",
        borderRight: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 6,
        paddingBottom: 6,
        gap: 1,
      }}
    >
      {items.map((item) => renderButton({ ...item, isNav: false }))}

      <div
        style={{
          width: 24,
          height: 1,
          background: "#e5e7eb",
          margin: "6px 0",
          flexShrink: 0,
        }}
      />

      {NAV_ITEMS.map((item) =>
        renderButton({ ...item, isNav: true, navItem: item }),
      )}
    </div>
  );
}
