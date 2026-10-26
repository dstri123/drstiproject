import { useCallback, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  Eye,
  History,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import API from "../../api/axios";
import { useToast } from "../../components/ToastContainer";
import { formatDateTime, formatRole } from "./activityFormat";

// Superadmins see every entry; admins see entries made by sub-role users
// (managers, engineers, data contributors, ...). The server applies that
// scoping and returns 403 to everyone else.

const ACTION_STYLES = {
  create: "bg-green-100 text-green-800",
  upload: "bg-blue-100 text-blue-800",
  update: "bg-amber-100 text-amber-800",
  delete: "bg-red-100 text-red-800",
  assign: "bg-indigo-100 text-indigo-800",
  unassign: "bg-indigo-100 text-indigo-800",
  process: "bg-purple-100 text-purple-800",
  login: "bg-gray-100 text-gray-800",
  login_failed: "bg-red-50 text-red-700",
  password_reset: "bg-gray-100 text-gray-800",
  other: "bg-gray-100 text-gray-700",
};

const EMPTY_FILTERS = {
  search: "",
  action: "",
  user: "",
  project: "",
  dateFrom: "",
  dateTo: "",
};

const selectClass =
  "px-3 py-2 text-xs border border-gray-300 rounded-md bg-white text-black focus:outline-none focus:ring-1 focus:ring-black";

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// The date inputs give a local calendar day; send the exact start/end
// instants so the server doesn't have to guess the user's timezone.
function toQueryParams(filters, page, pageSize) {
  const params = { page, page_size: pageSize };
  if (filters.search.trim()) params.search = filters.search.trim();
  if (filters.action) params.action = filters.action;
  if (filters.user) params.user = filters.user;
  if (filters.project) params.project = filters.project;
  if (filters.dateFrom)
    params.date_from = new Date(`${filters.dateFrom}T00:00:00`).toISOString();
  if (filters.dateTo)
    params.date_to = new Date(`${filters.dateTo}T23:59:59.999`).toISOString();
  return params;
}

function ActionBadge({ log }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
        ACTION_STYLES[log.action] || ACTION_STYLES.other
      }`}
    >
      {log.action_label}
    </span>
  );
}

/**
 * The activity log table with filters, details, edit/delete and CSV export.
 *
 * Used on its own at /activity (admins), as the superadmin's "All activity"
 * tab, and on the superadmin's per-admin page, where `scopeParams` pins it to
 * one admin's entries (e.g. {owner_admin: 3} or {user: 3}).
 */
export default function ActivityLogPage({
  title = "Activity Log",
  description = "Every upload, change, deletion and login — who did it and when",
  scopeParams,
  initialFilters,
  hideUserFilter = false,
  embedded = false,
}) {
  const { success, error } = useToast();

  const [logs, setLogs] = useState([]);
  const [count, setCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, ...initialFilters }));
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [options, setOptions] = useState({ users: [], projects: [], actions: [] });

  const [selected, setSelected] = useState(new Set());
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ description: "", note: "" });
  const [saving, setSaving] = useState(false);

  // Don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 350);
    return () => clearTimeout(t);
  }, [filters.search]);

  const activeFilters = { ...filters, search: debouncedSearch };
  // Serialised so effects re-run only when the scope actually changes.
  const scopeKey = JSON.stringify(scopeParams || {});
  const queryKey = JSON.stringify({
    ...(scopeParams || {}),
    ...toQueryParams(activeFilters, page, pageSize),
  });

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get("activity/", { params: JSON.parse(queryKey) });
      setLogs(res.data.results || []);
      setCount(res.data.count || 0);
      setTotalPages(res.data.total_pages || 1);
      setCanEdit(!!res.data.can_edit);
      setSelected(new Set());
      if (res.data.page && res.data.page !== page) setPage(res.data.page);
    } catch (err) {
      if (err.response?.status === 403) {
        setForbidden(true);
        return;
      }
      console.error("Failed to load activity log", err);
      error("Failed to load activity log");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const fetchOptions = useCallback(async () => {
    try {
      const res = await API.get("activity/filters/", { params: JSON.parse(scopeKey) });
      setOptions(res.data);
    } catch (err) {
      console.error("Failed to load activity filters", err);
    }
  }, [scopeKey]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const hasFilters = Object.values(filters).some(Boolean);

  // ── selection ─────────────────────────────────────────────────────────────
  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allOnPageSelected = logs.length > 0 && logs.every((l) => selected.has(l.id));
  const toggleAll = () =>
    setSelected(allOnPageSelected ? new Set() : new Set(logs.map((l) => l.id)));

  // ── actions ───────────────────────────────────────────────────────────────
  const handleDelete = async (log) => {
    if (!window.confirm("Delete this activity log entry? This cannot be undone.")) return;
    try {
      await API.delete(`activity/${log.id}/`);
      success("Log entry deleted");
      setViewing(null);
      fetchLogs();
    } catch (err) {
      error(err.response?.data?.detail || "Failed to delete log entry");
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected log entr${ids.length === 1 ? "y" : "ies"}? This cannot be undone.`))
      return;
    try {
      const res = await API.post("activity/bulk-delete/", { ids });
      success(`Deleted ${res.data.deleted} log entr${res.data.deleted === 1 ? "y" : "ies"}`);
      fetchLogs();
    } catch (err) {
      error(err.response?.data?.detail || err.response?.data?.error || "Failed to delete log entries");
    }
  };

  const openEdit = (log) => {
    setEditing(log);
    setEditForm({ description: log.description || "", note: log.note || "" });
  };

  const handleSave = async () => {
    if (!editForm.description.trim()) {
      error("Description cannot be empty");
      return;
    }
    setSaving(true);
    try {
      await API.patch(`activity/${editing.id}/`, {
        description: editForm.description.trim(),
        note: editForm.note,
      });
      success("Log entry updated");
      setEditing(null);
      fetchLogs();
    } catch (err) {
      error(err.response?.data?.detail || "Failed to update log entry");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = { ...JSON.parse(scopeKey), ...toQueryParams(activeFilters, 1, pageSize) };
      delete params.page;
      delete params.page_size;
      const res = await API.get("activity/export/", { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity_log_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      error("Failed to export activity log");
    } finally {
      setExporting(false);
    }
  };

  // ── render helpers ────────────────────────────────────────────────────────
  const rowActions = (log) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setViewing(log)}
        className="hover:bg-gray-100"
        title="View details"
      >
        <Eye className="h-4 w-4" />
      </Button>
      {canEdit && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEdit(log)}
            className="hover:bg-blue-50 hover:text-blue-600"
            title="Edit"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(log)}
            className="hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-2 py-6">
      <History className="w-8 h-8 text-gray-300" />
      <p className="text-gray-500 text-sm font-medium">
        {hasFilters ? "No activity matches these filters" : "No activity recorded yet"}
      </p>
    </div>
  );

  const changes = viewing?.details?.changes;

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
        <History className="w-10 h-10 text-gray-300" />
        <p className="text-lg font-semibold text-black">No access</p>
        <p className="text-sm text-gray-500">Only admins and super admins can view the activity log.</p>
      </div>
    );
  }

  return (
    <div
      className={
        embedded
          ? ""
          : "-mt-4 -mx-4 sm:-mx-6 -mb-6 px-4 sm:px-6 py-8 min-h-[calc(100vh-4rem)] bg-white"
      }
    >
      <div className={embedded ? "space-y-6" : "max-w-7xl mx-auto space-y-6"}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div>
            {embedded ? (
              <h2 className="text-lg font-semibold text-black mb-1">{title}</h2>
            ) : (
              <h1 className="text-2xl sm:text-3xl font-bold text-black mb-1">{title}</h1>
            )}
            <p className="text-xs sm:text-sm text-gray-600">{description}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {canEdit && selected.size > 0 && (
              <Button
                onClick={handleBulkDelete}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center"
              >
                <Trash2 className="w-4 h-4" />
                Delete selected ({selected.size})
              </Button>
            )}
            <Button
              onClick={() => {
                fetchLogs();
                fetchOptions();
              }}
              variant="outline"
              className="border-gray-300 text-black px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center hover:bg-gray-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              onClick={handleExport}
              disabled={exporting || count === 0}
              variant="outline"
              className="border-gray-300 text-black px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Search by user, description, file, project or note..."
            className="border-gray-300 w-full sm:max-w-md text-sm"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
          />
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={filters.action}
              onChange={(e) => updateFilter("action", e.target.value)}
              className={selectClass}
            >
              <option value="">All actions</option>
              {options.actions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            {!hideUserFilter && (
              <select
                value={filters.user}
                onChange={(e) => updateFilter("user", e.target.value)}
                className={selectClass}
              >
                <option value="">All users</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </select>
            )}
            <select
              value={filters.project}
              onChange={(e) => updateFilter("project", e.target.value)}
              className={selectClass}
            >
              <option value="">All projects</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              From
              <input
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(e) => updateFilter("dateFrom", e.target.value)}
                className={selectClass}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              To
              <input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(e) => updateFilter("dateTo", e.target.value)}
                className={selectClass}
              />
            </label>
            {hasFilters && (
              <button
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setPage(1);
                }}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:text-black"
              >
                <X className="w-3 h-3" />
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 border-b border-gray-200">
                {canEdit && (
                  <TableHead className="w-10 py-4">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      aria-label="Select all on this page"
                    />
                  </TableHead>
                )}
                <TableHead className="font-semibold text-black text-sm py-4 whitespace-nowrap">Date & time</TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">User</TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">Action</TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">Description</TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">Project</TableHead>
                <TableHead className="py-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-sm text-gray-500">
                    Loading activity...
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>{emptyState}</TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                    {canEdit && (
                      <TableCell className="py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(log.id)}
                          onChange={() => toggleOne(log.id)}
                          aria-label="Select entry"
                        />
                      </TableCell>
                    )}
                    <TableCell className="py-3 text-xs text-gray-600 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </TableCell>
                    <TableCell className="py-3">
                      <p className="text-sm font-medium text-black">{log.username || "—"}</p>
                      <p className="text-xs text-gray-500">{formatRole(log.user_role)}</p>
                    </TableCell>
                    <TableCell className="py-3">
                      <ActionBadge log={log} />
                    </TableCell>
                    <TableCell className="py-3 max-w-md">
                      <p className="text-sm text-gray-800 break-words">{log.description}</p>
                      {log.note && (
                        <p className="text-xs text-gray-500 mt-1 italic break-words">Note: {log.note}</p>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-sm text-gray-700">{log.project_name || "—"}</TableCell>
                    <TableCell className="py-3">{rowActions(log)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <div className="lg:hidden space-y-3">
          {loading && logs.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              Loading activity...
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-4">{emptyState}</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={selected.has(log.id)}
                        onChange={() => toggleOne(log.id)}
                        aria-label="Select entry"
                      />
                    )}
                    <ActionBadge log={log} />
                  </div>
                  <span className="text-xs text-gray-500">{formatDateTime(log.created_at)}</span>
                </div>
                <p className="text-sm text-gray-800 break-words">{log.description}</p>
                {log.note && <p className="text-xs text-gray-500 italic break-words">Note: {log.note}</p>}
                <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                  <p className="text-xs text-gray-600">
                    <span className="font-medium text-black">{log.username || "—"}</span>
                    {log.project_name ? ` · ${log.project_name}` : ""}
                  </p>
                  {rowActions(log)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {count > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span>
                {count} entr{count === 1 ? "y" : "ies"} · Page {page} of {totalPages}
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className={selectClass}
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="text-xs">Previous</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages || loading}
              >
                <span className="text-xs">Next</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Details dialog */}
      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="bg-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity details</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <ActionBadge log={viewing} />
                <span className="text-gray-500 text-xs">{formatDateTime(viewing.created_at)}</span>
              </div>
              <p className="text-gray-900 break-words">{viewing.description}</p>
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-xs">
                <dt className="text-gray-500">User</dt>
                <dd className="text-black">
                  {viewing.username || "—"} {viewing.user_role && `(${formatRole(viewing.user_role)})`}
                </dd>
                <dt className="text-gray-500">Item</dt>
                <dd className="text-black break-words">
                  {[viewing.target_type, viewing.target_name].filter(Boolean).join(": ") || "—"}
                </dd>
                <dt className="text-gray-500">Project</dt>
                <dd className="text-black">{viewing.project_name || "—"}</dd>
                <dt className="text-gray-500">IP address</dt>
                <dd className="text-black">{viewing.ip_address || "—"}</dd>
                <dt className="text-gray-500">Request</dt>
                <dd className="text-black font-mono break-all">
                  {viewing.method ? `${viewing.method} ${viewing.path}` : "—"}
                </dd>
                {viewing.note && (
                  <>
                    <dt className="text-gray-500">Note</dt>
                    <dd className="text-black whitespace-pre-wrap break-words">{viewing.note}</dd>
                  </>
                )}
                {viewing.edited_at && (
                  <>
                    <dt className="text-gray-500">Edited</dt>
                    <dd className="text-black">
                      {formatDateTime(viewing.edited_at)} by {viewing.edited_by_username || "—"}
                    </dd>
                  </>
                )}
              </dl>

              {changes && Object.keys(changes).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-black mb-2">Changes</p>
                  <div className="rounded-md border border-gray-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Field</th>
                          <th className="text-left px-3 py-2 font-medium">Before</th>
                          <th className="text-left px-3 py-2 font-medium">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(changes).map(([field, [before, after]]) => (
                          <tr key={field} className="border-t border-gray-100 align-top">
                            <td className="px-3 py-2 font-medium text-black">{field.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-gray-600 break-all">{formatValue(before)}</td>
                            <td className="px-3 py-2 text-gray-900 break-all">{formatValue(after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {viewing.details?.deleted && (
                <div>
                  <p className="text-xs font-semibold text-black mb-2">Deleted entries</p>
                  <ul className="space-y-1 text-xs text-gray-700">
                    {viewing.details.deleted.map((d) => (
                      <li key={d.id} className="break-words">
                        <span className="text-gray-500">{formatDateTime(d.created_at)}</span> · {d.username || "—"} ·{" "}
                        {d.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {viewing && canEdit && (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const log = viewing;
                  setViewing(null);
                  openEdit(log);
                }}
              >
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => handleDelete(viewing)}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit log entry</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500">
            Who did it, what happened and when stay as recorded. Only the description and note can be changed.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-black">Description</label>
              <Input
                value={editForm.description}
                maxLength={500}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-black">Note</label>
              <Textarea
                value={editForm.note}
                rows={4}
                placeholder="Add context, e.g. why this change was made"
                onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-black hover:bg-gray-900 text-white">
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
