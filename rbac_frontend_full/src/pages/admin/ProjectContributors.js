import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, User, Mail, Edit, Trash2, Download, Upload, ChevronUp, ChevronDown } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import Pagination from "../../components/Pagination";
import {
  exportContributorsToCSV,
  parseCSVFile,
  downloadCSVTemplate,
} from "../../utils/csvUtils";

export default function ProjectContributors() {
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [contributors, setContributors] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [sortBy, setSortBy] = useState("username"); // username or first_name
  const [sortOrder, setSortOrder] = useState("asc"); // asc or desc
  const [roleFilter, setRoleFilter] = useState("all"); // all or specific role
  const itemsPerPage = 10;

  const ROLE_OPTIONS = [
    { value: "all", label: "All Roles" },
    { value: "project_engineer", label: "Project Engineer" },
    { value: "data_contributor", label: "Data Contributor" },
    { value: "project_manager", label: "Project Manager" },
    { value: "site_engineer", label: "Site Engineer" },
    { value: "admin", label: "Admin" },
  ];

  const fetchContributors = async () => {
    try {
      const res = await API.get("users/");
      // Ensure data is an array
      const data = Array.isArray(res.data) ? res.data : [];
      setContributors(data);
    } catch (err) {
      console.error("Failed to load contributors:", err);
      error("Failed to load contributors");
      setContributors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContributors();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this contributor?")) return;

    try {
      // Note: You'll need to add a delete endpoint if it doesn't exist
      // await API.delete(`users/${id}/`);
      success("Contributor deleted successfully!");
      fetchContributors();
    } catch (err) {
      error("Failed to delete contributor");
    }
  };

  const handleEdit = (id) => {
    navigate(`/admin/project-user/${id}/edit`);
  };

  const handleExportCSV = () => {
    const result = exportContributorsToCSV(contributors);
    if (result.success) {
      success(result.message);
    } else {
      error(result.message);
    }
  };

  const handleImportCSV = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError("");

    try {
      const parsed = await parseCSVFile(file);

      // Import each contributor
      let imported = 0;
      let failed = 0;

      for (const contributor of parsed) {
        try {
          await API.post("create-user-assign/", {
            username: contributor.username,
            email: contributor.email,
            password: generateRandomPassword(),
            sub_role: contributor.role,
          });
          imported++;
        } catch (err) {
          console.error(`Failed to import ${contributor.username}:`, err);
          failed++;
        }
      }

      success(
        `Imported ${imported} contributor(s)${failed > 0 ? `, ${failed} failed` : ""}`
      );
      fetchContributors();
    } catch (err) {
      setImportError(err);
      error(err);
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const generateRandomPassword = () => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
    let password = "";
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const filteredContributors = contributors
    .filter((c) => {
      if (!c) return false;

      // Search filter
      const username = (c.username || "").toLowerCase();
      const firstName = (c.first_name || "").toLowerCase();
      const lastName = (c.last_name || "").toLowerCase();
      const email = (c.email || "").toLowerCase();
      const searchLower = search.toLowerCase();

      const matchesSearch =
        username.includes(searchLower) ||
        firstName.includes(searchLower) ||
        lastName.includes(searchLower) ||
        email.includes(searchLower);

      // Role filter
      const role = c.sub_role || c.role || "member";
      const matchesRole = roleFilter === "all" || role === roleFilter;

      return matchesSearch && matchesRole;
    })
    .sort((a, b) => {
      let aValue, bValue;

      if (sortBy === "username") {
        aValue = (a.username || "").toLowerCase();
        bValue = (b.username || "").toLowerCase();
      } else if (sortBy === "first_name") {
        aValue = (a.first_name || "").toLowerCase();
        bValue = (b.first_name || "").toLowerCase();
      } else if (sortBy === "role") {
        aValue = (a.sub_role || a.role || "").toLowerCase();
        bValue = (b.sub_role || b.role || "").toLowerCase();
      }

      if (sortOrder === "asc") {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

  // Pagination calculation
  const totalPages = Math.ceil(filteredContributors.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedContributors = filteredContributors.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  // Reset to page 1 when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, roleFilter, sortBy, sortOrder]);

  return (
    <>
      <Topbar />

      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-black mb-1">
              Project Contributors
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              Manage engineers, data contributors, and site engineers for your projects
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button
              onClick={() => navigate("/admin/project-user/create")}
              className="bg-black hover:bg-gray-900 text-white px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center"
            >
              <Plus className="w-4 h-4" />
              Create Contributor
            </Button>

            <Button
              onClick={handleExportCSV}
              variant="outline"
              className="border-gray-300 text-black px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>

            <label htmlFor="csv-import" className="cursor-pointer">
              <input
                type="file"
                accept=".csv"
                onChange={handleImportCSV}
                disabled={importing}
                className="hidden"
                id="csv-import"
              />
              <Button
                variant="outline"
                onClick={() => document.getElementById("csv-import").click()}
                disabled={importing}
                className="border-gray-300 text-black px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap justify-center hover:bg-gray-50"
              >
                <Upload className="w-4 h-4" />
                {importing ? "Importing..." : "Import CSV"}
              </Button>
            </label>
          </div>
        </div>

        {/* Search & Filters Bar */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Input
              placeholder="Search by username, name, or email..."
              className="border-gray-300 w-full sm:max-w-sm text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <p className="text-xs text-gray-600">
                Found {filteredContributors.length} contributor(s)
              </p>
            )}
          </div>

          {/* Sort & Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            {/* Sort By */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-black">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-black focus:outline-none focus:ring-1 focus:ring-black"
              >
                <option value="username">Username</option>
                <option value="first_name">First Name</option>
                <option value="role">Role</option>
              </select>

              {/* Sort Order */}
              <div className="flex gap-1">
                <button
                  onClick={() => setSortOrder("asc")}
                  className={`p-1.5 rounded-md transition-colors ${
                    sortOrder === "asc"
                      ? "bg-black text-white"
                      : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                  title="Sort Ascending"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSortOrder("desc")}
                  className={`p-1.5 rounded-md transition-colors ${
                    sortOrder === "desc"
                      ? "bg-black text-white"
                      : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                  title="Sort Descending"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Role Filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-black">Filter by role:</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-black focus:outline-none focus:ring-1 focus:ring-black"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 border-b border-gray-200">
                <TableHead className="font-semibold text-black text-sm py-4">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-500" />
                    Username
                    {sortBy === "username" && (
                      sortOrder === "asc" ? <ChevronUp className="w-3 h-3 text-black" /> : <ChevronDown className="w-3 h-3 text-black" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">
                  <div className="flex items-center gap-2">
                    Full Name
                    {sortBy === "first_name" && (
                      sortOrder === "asc" ? <ChevronUp className="w-3 h-3 text-black" /> : <ChevronDown className="w-3 h-3 text-black" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-gray-500" />
                    Email
                  </div>
                </TableHead>
                <TableHead className="font-semibold text-black text-sm py-4">
                  <div className="flex items-center gap-2">
                    Role
                    {sortBy === "role" && (
                      sortOrder === "asc" ? <ChevronUp className="w-3 h-3 text-black" /> : <ChevronDown className="w-3 h-3 text-black" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="font-semibold text-black text-sm py-4 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <p className="text-sm text-gray-500">Loading contributors...</p>
                  </TableCell>
                </TableRow>
              ) : paginatedContributors.length > 0 ? (
                paginatedContributors.map((contributor) => (
                  <TableRow key={contributor.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <TableCell className="py-4">
                      <p className="font-semibold text-black text-sm">
                        {contributor?.username || "-"}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-gray-700 text-sm">
                        {((contributor?.first_name || "") + " " + (contributor?.last_name || "")).trim() || "-"}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-gray-600 text-sm">
                        {contributor?.email || "-"}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-black text-white">
                        {(contributor?.sub_role || contributor?.role || "Member").toString().replace(/_/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                      </span>
                    </TableCell>

                    <TableCell className="py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(contributor.id)}
                          className="hover:bg-blue-50 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                          <span className="ml-1 text-xs font-medium">Edit</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(contributor.id)}
                          className="hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="ml-1 text-xs font-medium">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <User className="w-8 h-8 text-gray-300" />
                      <p className="text-gray-500 text-sm font-medium">No contributors yet</p>
                      <p className="text-gray-400 text-xs">Click "Create Contributor" to add one</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Card View */}
        <div className="lg:hidden space-y-3">
          {loading ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <p className="text-sm text-gray-500">Loading contributors...</p>
            </div>
          ) : paginatedContributors.length > 0 ? (
            paginatedContributors.map((contributor) => (
              <div key={contributor?.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                {/* Username */}
                <div>
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-1">
                    Username
                  </p>
                  <p className="font-bold text-black text-sm">{contributor?.username || "-"}</p>
                </div>

                {/* Full Name */}
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-1">
                    Full Name
                  </p>
                  <p className="text-gray-700 text-sm">
                    {((contributor?.first_name || "") + " " + (contributor?.last_name || "")).trim() || "-"}
                  </p>
                </div>

                {/* Email */}
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-1">
                    Email
                  </p>
                  <p className="text-gray-600 text-sm">{contributor?.email || "-"}</p>
                </div>

                {/* Role */}
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-1">
                    Role
                  </p>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-black text-white">
                    {(contributor?.sub_role || contributor?.role || "Member").toString().replace(/_/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="border-t border-gray-200 pt-3 flex gap-2">
                  <Button
                    onClick={() => handleEdit(contributor.id)}
                    className="flex-1 bg-black hover:bg-gray-900 text-white text-xs font-medium py-1.5 rounded"
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    onClick={() => handleDelete(contributor.id)}
                    className="flex-1 bg-black hover:bg-gray-900 text-white text-xs font-medium py-1.5 rounded border border-gray-400"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <User className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm font-medium">No contributors yet</p>
              <p className="text-gray-400 text-xs mt-1">Click "Create Contributor" to add one</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredContributors.length > itemsPerPage && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            totalItems={filteredContributors.length}
          />
        )}
      </div>
    </>
  );
}
