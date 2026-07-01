import { ChevronRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

export default function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();

  const breadcrumbMap = {
    "/superadmin/organizations": [
      { label: "Organizations", path: "/superadmin/organizations" },
    ],
    "/superadmin/organizations/create": [
      { label: "Organizations", path: "/superadmin/organizations" },
      { label: "Create Organization", path: "/superadmin/organizations/create" },
    ],
    "/organizations": [
      { label: "Organizations", path: "/organizations" },
    ],
  };

  // Handle dynamic routes like /superadmin/organizations/:id/edit
  let breadcrumbs = breadcrumbMap[location.pathname];

  if (!breadcrumbs) {
    const editOrgMatch = location.pathname.match(/^\/superadmin\/organizations\/(\d+)\/edit$/);
    if (editOrgMatch) {
      breadcrumbs = [
        { label: "Organizations", path: "/superadmin/organizations" },
        { label: "Edit Organization", path: location.pathname },
      ];
    } else {
      breadcrumbs = [];
    }
  }

  if (!breadcrumbs || breadcrumbs.length === 0) {
    return null;
  }

  return (
    <>
      {breadcrumbs.map((crumb, index) => (
        <div key={crumb.path} className="flex items-center gap-2">
          {index === breadcrumbs.length - 1 ? (
            <span className="text-sm text-black font-medium">
              {crumb.label}
            </span>
          ) : (
            <>
              <button
                onClick={() => navigate(crumb.path)}
                className="text-sm text-black hover:text-gray-700 hover:underline transition-colors font-medium"
              >
                {crumb.label}
              </button>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </>
          )}
        </div>
      ))}
    </>
  );
}
