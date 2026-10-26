import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, Mail, UserX } from "lucide-react";
import API from "../../api/axios";
import ActivityLogPage from "./ActivityLogPage";
import { initialsOf } from "./activityFormat";

// Superadmin page for one admin: their own actions in one tab, the actions
// of the users they created in the other. /activity/admin/unlinked shows the
// users who aren't linked to any admin.
export default function AdminActivityDetailPage() {
  const { adminId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [admin, setAdmin] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const isUnlinked = adminId === "unlinked";
  const tab = isUnlinked ? "users" : searchParams.get("tab") === "users" ? "users" : "own";
  const preselectedUser = searchParams.get("user") || "";

  useEffect(() => {
    if (isUnlinked) return;
    let cancelled = false;
    API.get("activity/admins/")
      .then((res) => {
        if (cancelled) return;
        const found = (res.data.admins || []).find((a) => String(a.id) === String(adminId));
        found ? setAdmin(found) : setNotFound(true);
      })
      .catch((err) => {
        console.error("Failed to load admin", err);
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [adminId, isUnlinked]);

  const setTab = (next) => setSearchParams(next === "users" ? { tab: "users" } : {});

  const name = admin ? admin.full_name || admin.username : "";
  const tabs = isUnlinked
    ? []
    : [
        { key: "own", label: admin ? `${admin.username}'s own activity` : "Own activity", count: admin?.own_log_count },
        { key: "users", label: "Their users' activity", count: admin?.users_log_count },
      ];

  return (
    <div className="-mt-4 -mx-4 sm:-mx-6 -mb-6 px-4 sm:px-6 py-8 min-h-[calc(100vh-4rem)] bg-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <button
          onClick={() => navigate("/activity")}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-black"
        >
          <ArrowLeft className="w-4 h-4" />
          All admins
        </button>

        {/* Admin header */}
        {isUnlinked ? (
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <UserX className="w-6 h-6 text-gray-500" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-black">Users not linked to an admin</h1>
              <p className="text-xs sm:text-sm text-gray-600">
                Created before creators were recorded, or created by a super admin
              </p>
            </div>
          </div>
        ) : notFound ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Admin not found.
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-black to-gray-800 flex items-center justify-center text-sm font-bold text-white">
              {admin ? initialsOf(name) : ""}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-black truncate">
                {admin ? name : "Loading..."}
              </h1>
              {admin && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 mt-1">
                  <span>@{admin.username} · Admin</span>
                  {admin.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {admin.email}
                    </span>
                  )}
                  {admin.organization && (
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {admin.organization}
                    </span>
                  )}
                  <span>
                    {admin.users.length} user{admin.users.length === 1 ? "" : "s"} created
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {!notFound && (
          <>
            {tabs.length > 0 && (
              <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                      tab === t.key ? "border-black text-black" : "border-transparent text-gray-500 hover:text-black"
                    }`}
                  >
                    {t.label}
                    {t.count !== undefined && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-100 text-[11px] text-gray-700">
                        {t.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {isUnlinked ? (
              <ActivityLogPage
                key="unlinked"
                embedded
                title="Activity"
                description="Everything these users did"
                scopeParams={{ unlinked: 1 }}
                initialFilters={{ user: preselectedUser }}
              />
            ) : tab === "own" ? (
              <ActivityLogPage
                key={`own-${adminId}`}
                embedded
                title="Admin's own activity"
                description="Everything this admin did — uploads, user management, logins and log edits"
                scopeParams={{ user: adminId }}
                hideUserFilter
              />
            ) : (
              <ActivityLogPage
                key={`users-${adminId}-${preselectedUser}`}
                embedded
                title="Their users' activity"
                description="Everything done by the users this admin created — pick a user to narrow it down"
                scopeParams={{ owner_admin: adminId }}
                initialFilters={{ user: preselectedUser }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
