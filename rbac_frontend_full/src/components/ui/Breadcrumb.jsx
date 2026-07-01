import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, ChevronRight } from "lucide-react";

const segmentLabels = {
  superadmin: "Super Admin",
  "create-admin": "Create Admin",
  organizations: "Organizations",
  admin: "Admin",
  projects: "Projects",
  "project-user": "Project Users",
  "project-management": "Project Management",
  users: "Users",
  profile: "Profile",
  member: "Member",
  dashboard: "Dashboard",
  "create-user": "Create User",
  user: "User",
  manager: "Manager",
  engineer: "Engineer",
  data: "Data",
  "project-details": "Project Details",
  viewer: "Viewer",
  analytics: "Analytics",
};

const formatLabel = (segment) => {
  if (!segment) return "";
  if (/^\d+$/.test(segment)) return segment;
  return (
    segmentLabels[segment] ||
    segment
      .split("-")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  );
};

const getHomePath = (location) => {
  const role = localStorage.getItem("role")?.toLowerCase();
  if (role) {
    switch (role) {
      case "superadmin":
        return "/superadmin";
      case "admin":
        return "/admin";
      case "member":
        return "/member/dashboard";
      case "user":
        return "/user/dashboard";
      case "manager":
        return "/manager";
      case "engineer":
        return "/engineer";
      case "data":
        return "/data";
      default:
        return "/";
    }
  }

  const path = location.pathname;
  if (path.startsWith("/superadmin")) return "/superadmin";
  if (path.startsWith("/admin")) return "/admin";
  if (path.startsWith("/member")) return "/member/dashboard";
  if (path.startsWith("/user")) return "/user/dashboard";
  if (path.startsWith("/manager")) return "/manager";
  if (path.startsWith("/engineer")) return "/engineer";
  if (path.startsWith("/data")) return "/data";
  return "/";
};

export default function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();

  const segments = location.pathname.split("/").filter(Boolean);
  const crumbs = [
    { label: "Home", path: getHomePath(location) },
    ...segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join("/")}`;
      let label = formatLabel(segment);

      if (
        index > 0 &&
        segments[index - 1] === "project-details" &&
        /^\d+$/.test(segment) &&
        location.state?.projectName
      ) {
        label = `${segment}_${location.state.projectName}`;
      }

      return { label, path };
    }),
  ];

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <div className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;

            return (
              <li key={crumb.path} className="flex items-center gap-2">
                {index === 0 ? (
                  <button
                    type="button"
                    onClick={() => navigate(crumb.path)}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-slate-700 transition hover:bg-slate-100"
                  >
                    <Home className="h-4 w-4" />
                    <span className="font-medium">{crumb.label}</span>
                  </button>
                ) : (
                  <>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                    {isLast ? (
                      <span className="font-medium text-slate-900">
                        {crumb.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate(crumb.path)}
                        className="rounded-full px-3 py-1 text-slate-700 transition hover:bg-slate-100"
                      >
                        {crumb.label}
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
