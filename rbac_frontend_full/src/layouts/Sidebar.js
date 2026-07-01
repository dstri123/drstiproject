import { useNavigate, useLocation } from "react-router-dom";
import {
  Building2,
  Briefcase,
  FolderOpen,
  Users,
  LayoutDashboard,
  Settings,
  LogOut,
  X,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState({ first_name: "", last_name: "", email: "" });

  const role = localStorage.getItem("role");

  const menuItems = {
    superadmin: [
      {
        label: "Organizations",
        path: "/superadmin/organizations",
        icon: <Building2 className="w-5 h-5" />,
      },
    ],

    admin: [
      {
        label: "Dashboard",
        path: "/admin",
        icon: <LayoutDashboard className="w-5 h-5" />,
      },
      {
        label: "Project Contributors",
        path: "/admin/project-user",
        icon: <Users className="w-5 h-5" />,
      },
      {
        label: "Project Setup",
        path: "/admin/projects",
        icon: <FolderOpen className="w-5 h-5" />,
      },
    ],
    project_manager: [
      {
        label: "Dashboard",
        path: "/manager",
        icon: <LayoutDashboard className="w-5 h-5" />,
      },
      {
        label: "Photo Folders",
        path: "/photos",
        icon: <FolderOpen className="w-5 h-5" />,
      },
    ],
    project_engineer: [
      {
        label: "Dashboard",
        path: "/engineer",
        icon: <LayoutDashboard className="w-5 h-5" />,
      },
      {
        label: "Photo Folders",
        path: "/photos",
        icon: <FolderOpen className="w-5 h-5" />,
      },
    ],
    data_contributor: [
      {
        label: "Projects",
        path: "/data",
        icon: <LayoutDashboard className="w-5 h-5" />,
      },
      {
        label: "Tools",
        path: "/tools",
        icon: <Wrench className="w-5 h-5" />,
      },
    ],
  };

  const currentMenu = menuItems[role] || [];

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const API = (await import("../api/axios")).default;
        const res = await API.get("profile/");

        setProfile({
          first_name: res.data?.first_name || "",
          last_name: res.data?.last_name || "",
          email: res.data?.email || "",
          avatar_url: res.data?.avatar_url || "",
        });
      } catch (err) {
        // Silently fail - profile card will show basic info
      }
    };

    fetchProfile();

    // Listen for profile updates from the Profile page
    const handleProfileUpdate = (event) => {
      setProfile((prev) => ({
        ...prev,
        first_name: event.detail?.first_name || prev.first_name,
        last_name: event.detail?.last_name || prev.last_name,
        bio: event.detail?.bio || prev.bio,
      }));
    };

    window.addEventListener("profileUpdated", handleProfileUpdate);

    return () => {
      window.removeEventListener("profileUpdated", handleProfileUpdate);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    localStorage.removeItem("role");
    navigate("/");
  };

  const handleNavigation = (path) => {
    navigate(path);
    onClose?.(); // Close sidebar on mobile after navigation
  };

  const initials = `${(profile.first_name || "?").charAt(0)}${(profile.last_name || "").charAt(0)}`;
  const fullName = `${profile.first_name} ${profile.last_name}`.trim() || "User";

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 md:hidden cursor-pointer"
          onClick={onClose}
          style={{ zIndex: 39, pointerEvents: "auto" }}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-16 w-60 h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto px-4 py-6 shadow-sm flex flex-col justify-between md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{
          zIndex: 40,
          transition: "transform 300ms ease-in-out"
        }}
      >
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 md:hidden p-1 hover:bg-gray-100 rounded-md"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>

        {/* Main Navigation */}
        <div>
          <nav className="space-y-1">
            {currentMenu.map((item) => {
              const isActive = location.pathname === item.path;

              return (
                <button
                  key={item.path}
                  onClick={() => handleNavigation(item.path)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium",
                    isActive
                      ? "bg-black text-white shadow-sm"
                      : "text-gray-700 hover:bg-gray-100",
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Profile Card at Bottom */}
        <div className="border-t border-gray-200 pt-4 space-y-3">
          {/* Profile Card */}
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-black to-gray-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-black truncate">
                  {fullName}
                </p>
                <p className="text-xs text-gray-500 truncate uppercase">
                  {role?.replace(/_/g, " ") || "User"}
                </p>
                <p className="text-xs text-gray-600 truncate">
                  {profile.email}
                </p>
              </div>
            </div>

            <button
              onClick={() => handleNavigation("/profile")}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-colors text-xs font-medium mb-2",
                location.pathname === "/profile"
                  ? "bg-black text-white shadow-sm"
                  : "bg-white hover:bg-gray-100 text-black border border-gray-300",
              )}
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-colors text-xs font-medium bg-gray-100 hover:bg-gray-200 text-black border border-gray-300"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>

          {/* Copyright */}
          <div className="pt-4 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-600">
              All rights reserved by{" "}
              <span className="font-semibold text-black">@Distri Lab</span>
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
