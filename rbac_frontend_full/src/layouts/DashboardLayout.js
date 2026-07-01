import { useLocation, Outlet } from "react-router-dom";
import { useState } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import Breadcrumb from "../components/Breadcrumb";

export default function DashboardLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sidebarRoutes = [
    "/superadmin",
    "/superadmin/organizations",
    "/superadmin/organizations/create",
    "/profile",
    "/project",
    "/admin",
    "/admin/projects",
    "/admin/projects/create",
    "/admin/project-user",
    "/admin/project-user/create",
    "/admin/project-management",
    "/admin/users",
    "/manager",
    "/engineer",
    "/data",
    "/tools",
  ];

  // Keep the sidebar visible for listed base routes and any nested paths
  const showSidebar = sidebarRoutes.some((base) =>
    location.pathname.startsWith(base),
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Topbar onMenuClick={() => {
        console.log("Menu clicked, sidebar was:", sidebarOpen, "now:", !sidebarOpen);
        setSidebarOpen(!sidebarOpen);
      }} />

      {showSidebar && (
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => {
            console.log("Closing sidebar");
            setSidebarOpen(false);
          }}
        />
      )}

      <main
        className={`pt-20 px-4 sm:px-6 pb-6 transition-all duration-300 ${
          showSidebar ? "md:ml-60" : "ml-0"
        }`}
      >
        <Breadcrumb />
        <Outlet />
      </main>
    </div>
  );
}
