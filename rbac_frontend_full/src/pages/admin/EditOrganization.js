import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, User, Mail, Trash2, Edit2 } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import { useCheckEmail } from "../../hooks/useCheckUsername";

export default function EditOrganization() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [org, setOrg] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [newName, setNewName] = useState("");

  // Modal states for edit
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [editForm, setEditForm] = useState({ email: "", first_name: "", last_name: "", password: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editErrors, setEditErrors] = useState({});
  const [originalAdminEmail, setOriginalAdminEmail] = useState("");

  // Check email availability for admin editing
  const { checking: checkingAdminEmail, isAvailable: adminEmailAvailable, debouncedCheck: debouncedAdminEmailCheck } = useCheckEmail();

  useEffect(() => {
    if (editForm.email.trim() && editForm.email !== originalAdminEmail) {
      debouncedAdminEmailCheck(editForm.email);
    }
  }, [editForm.email, originalAdminEmail, debouncedAdminEmailCheck]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch organization
        const orgRes = await API.get("auth/organizations/");
        const foundOrg = orgRes.data.find((o) => o.id === parseInt(id));
        if (!foundOrg) {
          error("Organization not found");
          navigate("/superadmin/organizations");
          return;
        }
        setOrg(foundOrg);
        setNewName(foundOrg.organization_name);

        // Fetch all admins for this organization
        const adminsRes = await API.get(`auth/organizations/${id}/admins/`);
        setAdmins(adminsRes.data || []);
      } catch (err) {
        error("Failed to load organization");
        navigate("/superadmin/organizations");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, error]);

  const handleSave = async () => {
    if (!newName.trim()) {
      setErrors({ name: "Organization name is required" });
      return;
    }

    setSaving(true);
    try {
      await API.put(`auth/organizations/${id}/update/`, {
        organization_name: newName,
      });
      success("Organization updated successfully!");
      setTimeout(() => navigate("/superadmin/organizations"), 1000);
    } catch (err) {
      error("Failed to update organization");
      setErrors({ submit: "Failed to update organization" });
    } finally {
      setSaving(false);
    }
  };

  const handleEditAdmin = (admin) => {
    setEditingAdmin(admin);
    setOriginalAdminEmail(admin.email);
    setEditForm({
      email: admin.email,
      first_name: admin.first_name,
      last_name: admin.last_name,
      password: "",
    });
    setEditErrors({});
  };

  const handleSaveAdmin = async () => {
    if (!editForm.email.trim() || !editForm.first_name.trim() || !editForm.last_name.trim()) {
      setEditErrors({ form: "All fields are required" });
      return;
    }

    if (editForm.email !== originalAdminEmail && !adminEmailAvailable) {
      setEditErrors({ email: "Email is already in use" });
      return;
    }

    setEditSaving(true);
    try {
      await API.put(`auth/admins/${editingAdmin.id}/`, editForm);
      success("Admin updated successfully!");
      // Update the local admin list
      setAdmins(
        admins.map((a) =>
          a.id === editingAdmin.id
            ? {
                ...a,
                email: editForm.email,
                first_name: editForm.first_name,
                last_name: editForm.last_name,
              }
            : a
        )
      );
      setEditingAdmin(null);
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Failed to update admin";
      setEditErrors({ form: errorMsg });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteAdmin = async (admin) => {
    if (admin.has_dependencies) {
      error(`Cannot delete ${admin.username}. Admin has ${admin.projects_count} project(s)`);
      return;
    }

    if (!window.confirm(`Are you sure you want to delete admin ${admin.username}?`)) {
      return;
    }

    try {
      await API.delete(`auth/admins/${admin.id}/`);
      success("Admin deleted successfully!");
      setAdmins(admins.filter((a) => a.id !== admin.id));
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Failed to delete admin";
      error(errorMsg);
    }
  };

  if (loading) {
    return (
      <>
        <Topbar />
        <div className="flex justify-center items-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-black" />
        </div>
      </>
    );
  }

  if (!org) {
    return null;
  }

  return (
    <>
      <Topbar />

      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <button
            onClick={() => navigate("/superadmin/organizations")}
            className="flex items-center gap-2 text-black hover:text-gray-700 mb-6 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Organizations
          </button>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">
              Edit {org?.organization_name || "Organization"}
            </h1>
            <p className="text-sm text-gray-600">
              Update organization details and manage admin users
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - Organization Details */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Organization Details
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Update the organization name and view key information
              </p>

              <div className="space-y-4">
                {/* Organization Info Card */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-1">
                      Organization ID
                    </p>
                    <p className="text-sm text-black font-medium">#{org.id}</p>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-1">
                      Created Date
                    </p>
                    <p className="text-sm text-black font-medium">
                      {org.created_at
                        ? new Date(org.created_at).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "-"}
                    </p>
                  </div>
                </div>

                {/* Organization Name Edit */}
                <div className="space-y-2 pt-2">
                  <Label htmlFor="org_name" className="text-xs font-semibold text-black">
                    Organization Name
                  </Label>
                  <Input
                    id="org_name"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      if (errors.name) setErrors({ ...errors, name: "" });
                    }}
                    placeholder="Enter organization name"
                    className={`text-sm ${
                      errors.name ? "border-red-700 focus:border-red-700" : newName.trim() ? "border-green-600" : ""
                    }`}
                  />
                  {newName.trim() && !errors.name && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Organization name is valid
                    </p>
                  )}
                  {errors.name && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Admin Users */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Admin Users
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                View and manage admin users for this organization
              </p>

              {/* Admin Users Table */}
              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 border-b border-gray-200">
                      <TableHead className="font-semibold text-black text-sm py-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-500" />
                          Username
                        </div>
                      </TableHead>
                      <TableHead className="font-semibold text-black text-sm py-3">
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-gray-500" />
                          Email
                        </div>
                      </TableHead>
                      <TableHead className="font-semibold text-black text-sm py-3">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {admins.length > 0 ? (
                      admins.map((admin) => (
                        <TableRow key={admin.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <TableCell className="py-3">
                            <p className="font-medium text-black text-sm">
                              {admin.username}
                            </p>
                          </TableCell>
                          <TableCell className="py-3">
                            <p className="text-gray-700 text-sm">
                              {admin.email}
                            </p>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleEditAdmin(admin)}
                                disabled={admin.has_dependencies}
                                title={admin.has_dependencies ? "Cannot edit admin with dependencies" : "Edit admin"}
                                className={`p-1.5 rounded transition-colors ${
                                  admin.has_dependencies
                                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                }`}
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteAdmin(admin)}
                                disabled={admin.has_dependencies}
                                title={admin.has_dependencies ? `Cannot delete: has ${admin.projects_count} project(s)` : "Delete admin"}
                                className={`p-1.5 rounded transition-colors ${
                                  admin.has_dependencies
                                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                    : "bg-red-50 text-red-600 hover:bg-red-100"
                                }`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="h-24 text-center">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <User className="w-6 h-6 text-gray-300" />
                            <p className="text-sm text-gray-500">No admin users</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {admins.length > 0 && (
                <p className="text-xs text-gray-500 mt-3">
                  Note: Admins with projects cannot be edited or deleted.
                </p>
              )}
            </div>
          </div>

          {/* Error Message */}
          {errors.submit && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 mt-8 mb-4">
              <p className="text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errors.submit}
              </p>
            </div>
          )}

          {/* Action Buttons - Full Width */}
          <div className="mt-8 flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-gray-300 text-sm"
              onClick={() => navigate("/superadmin/organizations")}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-black hover:bg-gray-900 text-white text-sm"
              onClick={handleSave}
              disabled={saving || !newName.trim() || newName === org.organization_name}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Edit Admin Modal */}
      {editingAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-black">Edit Admin: {editingAdmin.username}</h3>

            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold text-black">Email</Label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="email@example.com"
                  className="text-sm mt-1"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-black">First Name</Label>
                <Input
                  value={editForm.first_name}
                  onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                  placeholder="First name"
                  className="text-sm mt-1"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-black">Last Name</Label>
                <Input
                  value={editForm.last_name}
                  onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                  placeholder="Last name"
                  className="text-sm mt-1"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-black">Password (Optional)</Label>
                <Input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Leave empty to keep current password"
                  className="text-sm mt-1"
                />
              </div>
            </div>

            {editErrors.form && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3">
                <p className="text-xs text-red-900 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {editErrors.form}
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                className="flex-1 border-gray-300 text-sm"
                onClick={() => setEditingAdmin(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-black hover:bg-gray-900 text-white text-sm"
                onClick={handleSaveAdmin}
                disabled={editSaving || checkingAdminEmail}
              >
                {editSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Admin"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
