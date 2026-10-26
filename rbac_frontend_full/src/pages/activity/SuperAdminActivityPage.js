import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  UserX,
  Users,
} from "lucide-react";
import API from "../../api/axios";
import { useToast } from "../../components/ToastContainer";
import ActivityLogPage from "./ActivityLogPage";
import { formatDateTime, formatRole, initialsOf } from "./activityFormat";

const TABS = [
  { key: "admins", label: "By admin" },
  { key: "all", label: "All activity" },
];

// Superadmin landing page for the activity log: every admin, expandable to
// the users they created, each linking to a dedicated per-admin log page.
export default function SuperAdminActivityPage() {
  const navigate = useNavigate();
  const { error } = useToast();
  const [tab, setTab] = useState("admins");
  const [data, setData] = useState({ admins: [], unlinked: null });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get("activity/admins/");
      setData(res.data);
    } catch (err) {
      console.error("Failed to load admins", err);
      error("Failed to load admins");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const unlinked = data.unlinked;
  const showUnlinked = unlinked && (unlinked.users.length > 0 || unlinked.log_count > 0);

  const renderGroup = ({ key, title, subtitle, badge, icon, users, stats, lastActivity, openPath }) => {
    const isOpen = expanded.has(key);
    return (
      <div key={key} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
          <button
            onClick={() => toggle(key)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
            aria-expanded={isOpen}
            title={isOpen ? "Hide users" : "Show users"}
          >
            <span className="p-1 rounded-md hover:bg-gray-100 text-gray-600 flex-shrink-0">
              {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </span>
            {icon}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-black truncate">{title}</p>
                {badge}
              </div>
              {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
            </div>
          </button>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-600 sm:justify-end">
            {stats.map((s) => (
              <span key={s.label}>
                <span className="font-semibold text-black">{s.value}</span> {s.label}
              </span>
            ))}
            <span className="text-gray-500">Last active: {formatDateTime(lastActivity)}</span>
          </div>

          <Button
            onClick={() => navigate(openPath)}
            className="bg-black hover:bg-gray-900 text-white text-xs px-3 py-2 rounded-md flex items-center gap-1 whitespace-nowrap"
          >
            Open activity
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {isOpen && (
          <div className="border-t border-gray-200 bg-gray-50">
            {users.length === 0 ? (
              <p className="px-6 py-4 text-xs text-gray-500">No users created yet.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {users.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => navigate(`${openPath}?tab=users&user=${u.id}`)}
                      className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-6 py-3 text-left hover:bg-white transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-700 flex-shrink-0">
                          {initialsOf(u.full_name || u.username)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-black truncate">
                            {u.username}
                            {!u.is_active && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {[u.full_name, formatRole(u.role)].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-600 sm:justify-end">
                        <span>
                          <span className="font-semibold text-black">{u.log_count}</span> entries
                        </span>
                        <span className="text-gray-500">Last active: {formatDateTime(u.last_activity)}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="-mt-4 -mx-4 sm:-mx-6 -mb-6 px-4 sm:px-6 py-8 min-h-[calc(100vh-4rem)] bg-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-black mb-1">Activity Log</h1>
            <p className="text-xs sm:text-sm text-gray-600">
              Each admin and the users they created — open an admin to see their activity and their users'
            </p>
          </div>
          {tab === "admins" && (
            <Button
              onClick={fetchAdmins}
              variant="outline"
              className="border-gray-300 text-black px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center hover:bg-gray-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </div>

        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key ? "border-black text-black" : "border-transparent text-gray-500 hover:text-black"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "all" ? (
          <ActivityLogPage
            embedded
            title="All activity"
            description="Every entry from every admin and user"
          />
        ) : loading && data.admins.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Loading admins...
          </div>
        ) : (
          <div className="space-y-3">
            {data.admins.length === 0 && !showUnlinked && (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                <ShieldCheck className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No admins yet</p>
              </div>
            )}

            {data.admins.map((a) =>
              renderGroup({
                key: a.id,
                title: a.full_name ? `${a.full_name} (${a.username})` : a.username,
                subtitle: a.email,
                badge: a.organization && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700">
                    <Building2 className="w-3 h-3" />
                    {a.organization}
                  </span>
                ),
                icon: (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-black to-gray-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {initialsOf(a.full_name || a.username)}
                  </div>
                ),
                users: a.users,
                stats: [
                  { label: a.users.length === 1 ? "user" : "users", value: a.users.length },
                  { label: "own entries", value: a.own_log_count },
                  { label: "users' entries", value: a.users_log_count },
                ],
                lastActivity: a.last_activity,
                openPath: `/activity/admin/${a.id}`,
              }),
            )}

            {showUnlinked &&
              renderGroup({
                key: "unlinked",
                title: "Not linked to an admin",
                subtitle: "Users created before creators were recorded, or by a super admin",
                icon: (
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <UserX className="w-5 h-5 text-gray-500" />
                  </div>
                ),
                badge: (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
                    <Users className="w-3 h-3" />
                    Unassigned
                  </span>
                ),
                users: unlinked.users,
                stats: [
                  { label: unlinked.users.length === 1 ? "user" : "users", value: unlinked.users.length },
                  { label: "entries", value: unlinked.log_count },
                ],
                lastActivity: unlinked.last_activity,
                openPath: "/activity/admin/unlinked",
              })}
          </div>
        )}
      </div>
    </div>
  );
}
