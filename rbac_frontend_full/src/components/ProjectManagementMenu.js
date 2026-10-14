import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  Briefcase,
  ChartGantt,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createProjectSlug } from "@/lib/utils";

// "Project Management" toggle for a project card — reveals Project Overview
// (schedule & Gantt) and Progress Monitoring (scan vs BIM). Shared by the
// data contributor and admin project lists.
export default function ProjectManagementMenu({ project, open, onToggle }) {
  const navigate = useNavigate();
  const slug = createProjectSlug(project);

  const items = [
    {
      key: "overview",
      icon: ChartGantt,
      title: "Project Overview",
      subtitle: "Schedule & Gantt",
      path: `/project-dashboard/${slug}`,
    },
    {
      key: "progress",
      icon: Boxes,
      title: "Progress Monitoring",
      subtitle: "Scan vs BIM progress",
      path: `/progress/${slug}`,
    },
  ];

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onToggle}
        className={`w-full text-xs border-gray-300 ${
          open
            ? "bg-black text-white hover:bg-gray-800 hover:text-white"
            : "text-black hover:bg-gray-50"
        }`}
      >
        <Briefcase className="w-3 h-3 mr-1" />
        Project Management
        <ChevronDown
          className={`w-3 h-3 ml-1 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </Button>

      {open && (
        <div className="grid grid-cols-2 gap-2">
          {items.map(({ key, icon: Icon, title, subtitle, path }) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(path)}
              className="group flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-900 hover:shadow-md"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white transition-colors group-hover:bg-blue-600">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-900">
                  {title}
                </span>
                <span className="block truncate text-[10px] text-gray-500">
                  {subtitle}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-900" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
