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
import { Edit, Trash2, Plus, Building2, User, Calendar } from "lucide-react";
import API from "../../api/axios";
import { useToast } from "../../components/ToastContainer";

export default function OrganizationManagement() {
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [orgs, setOrgs] = useState([]);
  const [adminCounts, setAdminCounts] = useState({});
  const [search, setSearch] = useState("");

  const fetchOrgs = async () => {
    const res = await API.get("auth/organizations/");
    setOrgs(res.data);

    // Fetch admin counts for each organization
    const counts = {};
    for (const org of res.data) {
      try {
        const adminsRes = await API.get(`auth/organizations/${org.id}/admins/`);
        counts[org.id] = adminsRes.data.length || 0;
      } catch (err) {
        counts[org.id] = 0;
      }
    }
    setAdminCounts(counts);
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  const deleteOrg = async (id) => {
    if (!window.confirm("Delete this organization?")) return;

    try {
      await API.delete(`auth/organizations/${id}/`);
      success("Organization deleted successfully!");
      fetchOrgs();
    } catch (err) {
      error("Failed to delete organization");
    }
  };

  const handleEdit = (org) => {
    navigate(`/superadmin/organizations/${org.id}/edit`);
  };

  const handleCreateClick = () => {
    try {
      navigate("/superadmin/organizations/create");
    } catch (err) {
      console.error("Navigation error:", err);
      error("Failed to navigate to create organization page");
    }
  };

  const filteredOrgs = orgs.filter((o) =>
    o.organization_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-black mb-1">Organization Management</h1>
          <p className="text-xs sm:text-sm text-gray-600">
            Manage all organizations and their admin users
          </p>
        </div>
        <Button
          onClick={handleCreateClick}
          className="bg-black hover:bg-gray-900 text-white px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap w-full sm:w-auto justify-center sm:justify-start"
        >
          <Plus className="w-4 h-4" />
          Create Organization
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Input
          placeholder="Search organizations..."
          className="border-gray-300 w-full sm:max-w-sm text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <p className="text-xs text-gray-600">
            Found {filteredOrgs.length} result(s)
          </p>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 border-b border-gray-200">
              <TableHead className="font-semibold text-black text-sm py-4">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-gray-500" />
                  Organization Name
                </div>
              </TableHead>
              <TableHead className="font-semibold text-black text-sm py-4">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  Admin User
                </div>
              </TableHead>
              <TableHead className="font-semibold text-black text-sm py-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  Created Date
                </div>
              </TableHead>
              <TableHead className="font-semibold text-black text-sm py-4 text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredOrgs.map((org) => (
              <TableRow key={org.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <TableCell className="py-4">
                  <p className="font-semibold text-black text-sm">
                    {org.organization_name}
                  </p>
                </TableCell>
                <TableCell className="py-4">
                  <div className="flex items-center gap-2">
                    <p className="text-gray-700 text-sm font-medium">
                      {org.username || "-"}
                    </p>
                    {adminCounts[org.id] > 1 && (
                      <span className="inline-flex items-center justify-center gap-0.5 bg-black text-white rounded-full px-1.5 py-0.5 text-xs font-bold h-5">
                        <Plus className="w-3 h-3" />
                        {adminCounts[org.id] - 1}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-4">
                  <p className="text-gray-600 text-sm">
                    {org.created_at
                      ? new Date(org.created_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "-"}
                  </p>
                </TableCell>

                <TableCell className="py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(org)}
                      className="hover:bg-blue-50 hover:text-blue-600"
                    >
                      <Edit className="h-4 w-4" />
                      <span className="ml-1 text-xs font-medium">Edit</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteOrg(org.id)}
                      className="hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="ml-1 text-xs font-medium">Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredOrgs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Building2 className="w-8 h-8 text-gray-300" />
                    <p className="text-gray-500 text-sm font-medium">No organizations yet</p>
                    <p className="text-gray-400 text-xs">Click "Create Organization" to add one</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredOrgs.length > 0 ? (
          filteredOrgs.map((org) => (
            <div key={org.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              {/* Organization Name */}
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Organization</p>
                <p className="font-bold text-black text-sm">{org.organization_name}</p>
              </div>

              {/* Admin User */}
              <div className="border-t border-gray-200 pt-3">
                <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Admin User</p>
                <div className="flex items-center gap-2">
                  <p className="text-gray-700 text-sm font-medium">{org.username || "-"}</p>
                  {adminCounts[org.id] > 1 && (
                    <span className="inline-flex items-center justify-center gap-0.5 bg-black text-white rounded-full px-1.5 py-0.5 text-xs font-bold h-5">
                      <Plus className="w-3 h-3" />
                      {adminCounts[org.id] - 1}
                    </span>
                  )}
                </div>
              </div>

              {/* Created Date */}
              <div className="border-t border-gray-200 pt-3">
                <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Created Date</p>
                <p className="text-gray-600 text-sm">
                  {org.created_at
                    ? new Date(org.created_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "-"}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-gray-200 pt-3 flex gap-2">
                <Button
                  onClick={() => handleEdit(org)}
                  className="flex-1 bg-black hover:bg-gray-900 text-white text-xs font-medium py-1.5 rounded"
                >
                  <Edit className="w-3 h-3 mr-1" />
                  Edit
                </Button>
                <Button
                  onClick={() => deleteOrg(org.id)}
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
            <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm font-medium">No organizations yet</p>
            <p className="text-gray-400 text-xs mt-1">Click "Create Organization" to add one</p>
          </div>
        )}
      </div>
    </div>
  );
}
