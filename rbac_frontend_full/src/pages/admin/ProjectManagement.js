import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Edit,
  Trash2,
  UserPlus,
  X,
  Image as ImageIcon,
  Box,
  Eye,
} from "lucide-react";
import API from "../../api/axios";
import { createProjectSlug } from "@/lib/utils";
import { useToast } from "../../components/ToastContainer";

export default function ProjectManagement() {
  const [search, setSearch] = useState("");
  const [data, setData] = useState([]);
  const { error, success } = useToast();
  const [users, setUsers] = useState([]);

  const [selectedProjectId, setSelectedProjectId] = useState(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedProjectForAssign, setSelectedProjectForAssign] =
    useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignRoleFilter, setAssignRoleFilter] = useState("all");

  const [roleOpen, setRoleOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newRole, setNewRole] = useState("project_manager");

  const navigate = useNavigate();

  const normalizeSubRole = (role) => {
    if (!role) return "";
    const normalized = String(role)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    if (normalized === "project_manager" || normalized === "projectmanager") {
      return "project_manager";
    }
    if (normalized === "project_engineer" || normalized === "projectengineer") {
      return "project_engineer";
    }
    if (normalized === "data_contributor" || normalized === "datacontributor") {
      return "data_contributor";
    }

    return normalized;
  };

  const getSubRoleLabel = (role) => {
    const normalized = normalizeSubRole(role);

    if (normalized === "project_manager") return "Project Manager";
    if (normalized === "project_engineer") return "Project Engineer";
    if (normalized === "data_contributor") return "Data Contributor";

    return "No Role";
  };

  const fetchProjects = async () => {
    const res = await API.get("projects/");
    setData(res.data);
  };

  const fetchUsers = async () => {
    const res = await API.get("users/");
    setUsers(res.data);
  };

  useEffect(() => {
    fetchProjects();
    fetchUsers();
  }, []);

  useEffect(() => {
    if (assignOpen) {
      setAssignSearch("");
      setAssignRoleFilter("all");
      setSelectedUsers([]);
    }
  }, [assignOpen]);

  const handleImageUpload = async (event, projectId) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);

    await API.patch(`projects/${projectId}/`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    fetchProjects();
  };

  const updateProject = async () => {
    try {
      await API.put(`projects/${editData.id}/`, {
        project_name: editData.project_name?.trim(),
        description: editData.description || "",
        start: editData.start || "",
        end: editData.end || "",
        start_date: editData.start || "",
        end_date: editData.end || "",
      });

      setEditOpen(false);
      fetchProjects();

      success("Project updated successfully");
    } catch (err) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        "Project update failed";
      console.error("UPDATE ERROR:", err.response?.data || err);
      error(message);
    }
  };

  const deleteProject = async (id) => {
    if (!window.confirm("Delete project?")) return;

    await API.delete(`projects/${id}/delete/`);
    if (selectedProjectId === id) {
      setSelectedProjectId(null);
    }
    fetchProjects();
  };

  const assignUserToProject = async () => {
    await API.post("assign-user/", {
      project_id: selectedProjectForAssign.id,
      user_ids: selectedUsers,
    });

    setAssignOpen(false);
    setSelectedUsers([]);
    fetchProjects();
  };

  const removeUserFromProject = async (projectId, userId) => {
    await API.post("remove-user/", {
      project_id: projectId,
      user_id: userId,
    });

    fetchProjects();
  };

  const updateUserRole = async () => {
    const normalizedRole = normalizeSubRole(newRole || "project_manager");
    if (!normalizedRole) {
      error("Please select a valid role.");
      return;
    }

    await API.put(`update-user-role/${selectedUser.id}/`, {
      sub_role: normalizedRole,
    });

    setRoleOpen(false);
    fetchProjects();
  };

  const handleUserSelect = (e) => {
    const options = Array.from(
      e.target.selectedOptions,
      (option) => option.value,
    );
    setSelectedUsers(options);
  };

  const selectedProjectDetails =
    data.find((p) => p.id === selectedProjectId) || null;
  const filteredData = data.filter((d) =>
    d.project_name?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredAssignUsers = users.filter((user) => {
    const matchesSearch = user.username
      ?.toLowerCase()
      .includes(assignSearch.toLowerCase());
    const matchesRole =
      assignRoleFilter === "all" ||
      normalizeSubRole(user.sub_role) === assignRoleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="p-6 w-full space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Project Management
        </h2>
      </div>

      <Input
        placeholder="Search projects..."
        className="max-w-md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filteredData.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card shadow-sm">
          No projects found.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredData.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 flex flex-col overflow-hidden"
              onClick={() => setSelectedProjectId(project.id)}
            >
              <div className="w-full h-40 bg-muted flex items-center justify-center relative overflow-hidden group">
                {project.image ? (
                  <img
                    src={project.image}
                    alt={project.project_name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
                )}
                {/* Upload overly just in case they want to upload directly from card */}
                <label
                  onClick={(e) => e.stopPropagation()}
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white cursor-pointer transition-opacity text-sm font-medium"
                >
                  Change Image
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, project.id)}
                  />
                </label>
              </div>
              <CardHeader className="pb-2">
                <CardTitle
                  className="text-lg truncate"
                  title={project.project_name}
                >
                  {project.project_name}
                </CardTitle>
                <CardDescription className="line-clamp-2 min-h-[40px]">
                  {project.description || "No description provided."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 flex-1 flex flex-col justify-end">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-11 flex items-center justify-center gap-2 px-4"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProjectId(project.id);
                    }}
                  >
                    <Eye className="h-4 w-4 flex-shrink-0" />
                    <span className="leading-none">View Details</span>
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full flex items-center justify-center px-4 py-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/viewer/${createProjectSlug(project)}`);
                    }}
                  >
                    <Box className="w-4 h-4 mr-2 flex-shrink-0" />
                    <span>3D Viewer</span>
                  </Button>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-4">
                  <span>Users: {project.users?.length || 0}</span>
                  {project.start && <span>Start: {project.start}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* PROJECT DETAILS MODAL */}
      <Dialog
        open={!!selectedProjectId}
        onOpenChange={(open) => !open && setSelectedProjectId(null)}
      >
        <DialogContent className="fixed inset-0 z-50 h-screen w-screen max-w-none max-h-none rounded-none translate-x-0 translate-y-0 overflow-y-auto">
          {selectedProjectDetails && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">
                  {selectedProjectDetails.project_name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                <div className="w-full h-64 bg-muted rounded-md overflow-hidden relative group border">
                  {selectedProjectDetails.image ? (
                    <img
                      src={selectedProjectDetails.image}
                      alt={selectedProjectDetails.project_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full text-muted-foreground">
                      <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                      <span>No Image Available</span>
                    </div>
                  )}
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white cursor-pointer transition-opacity font-medium">
                    Upload New Image
                    <input
                      type="file"
                      hidden
                      accept="image/*"
                      onChange={(e) =>
                        handleImageUpload(e, selectedProjectDetails.id)
                      }
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-muted/50 p-4 rounded-md">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Start Date
                    </p>
                    <p className="text-base font-semibold">
                      {selectedProjectDetails.start || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      End Date
                    </p>
                    <p className="text-base font-semibold">
                      {selectedProjectDetails.end || "-"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Description
                  </p>
                  <p className="text-sm leading-relaxed">
                    {selectedProjectDetails.description ||
                      "No description provided."}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      Assigned Users
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-primary"
                      onClick={() => {
                        setSelectedProjectForAssign(selectedProjectDetails);
                        setAssignOpen(true);
                      }}
                    >
                      <UserPlus className="w-3 h-3 mr-1" /> Add User
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px] bg-background">
                    {selectedProjectDetails.users?.length > 0 ? (
                      selectedProjectDetails.users.map((u) => (
                        <div
                          key={u.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedUser(u);
                            setNewRole(
                              normalizeSubRole(u.sub_role) || "project_manager",
                            );
                            setRoleOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer hover:bg-secondary/80 transition-colors border shadow-sm"
                        >
                          <span>{u.username}</span>
                          <span className="opacity-70 text-[10px]">
                            ({u.sub_role || "No Role"})
                          </span>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm("Remove user from project?")) {
                                removeUserFromProject(
                                  selectedProjectDetails.id,
                                  u.id,
                                );
                              }
                            }}
                            className="ml-1 rounded-full hover:bg-destructive hover:text-white p-0.5 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground self-center w-full text-center">
                        No users assigned to this project.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter className="flex md:justify-between items-center sm:justify-between mt-2 pt-4 border-t">
                <div className="flex gap-2 w-full md:w-auto mb-4 md:mb-0">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditData(selectedProjectDetails);
                      setEditOpen(true);
                    }}
                  >
                    <Edit className="w-4 h-4 mr-2" /> Edit Info
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                    onClick={() => {
                      deleteProject(selectedProjectDetails.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </div>

                <Button
                  className="w-full md:w-auto bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() =>
                    navigate(
                      `/viewer/${createProjectSlug(selectedProjectDetails)}`,
                    )
                  }
                >
                  <Box className="w-4 h-4 mr-2" /> Open 3D Viewer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* EDIT MODAL */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name</label>
              <Input
                value={editData?.project_name || ""}
                onChange={(e) =>
                  setEditData({
                    ...editData,
                    project_name: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Date</label>
                <DatePicker
                  date={editData?.start ? new Date(editData.start) : undefined}
                  onDateChange={(date) =>
                    setEditData({
                      ...editData,
                      start: date ? date.toISOString().split("T")[0] : "",
                    })
                  }
                  placeholder="Pick a start date"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Date</label>
                <DatePicker
                  date={editData?.end ? new Date(editData.end) : undefined}
                  onDateChange={(date) =>
                    setEditData({
                      ...editData,
                      end: date ? date.toISOString().split("T")[0] : "",
                    })
                  }
                  placeholder="Pick an end date"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={editData?.description || ""}
                onChange={(e) =>
                  setEditData({
                    ...editData,
                    description: e.target.value,
                  })
                }
                className="w-full min-h-[100px] rounded-md border border-input bg-background p-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={updateProject}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ASSIGN USER DRAWER */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="fixed inset-y-0 right-0 top-0 left-auto z-50 grid h-screen w-full max-w-md transform translate-x-full translate-y-0 data-[state=open]:translate-x-0 transition-transform duration-300 ease-in-out overflow-y-auto border-l bg-background p-6 shadow-2xl rounded-none sm:rounded-l-lg">
          <DialogHeader>
            <DialogTitle>Assign Users</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm">
              Project:{" "}
              <span className="font-bold">
                {selectedProjectForAssign?.project_name}
              </span>
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search Users</label>
                <Input
                  placeholder="Search by username"
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Filter by Role</label>
                <select
                  value={assignRoleFilter}
                  onChange={(e) => setAssignRoleFilter(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="all">All Roles</option>
                  <option value="project_manager">Project Manager</option>
                  <option value="project_engineer">Project Engineer</option>
                  <option value="data_contributor">Data Contributor</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Select Users (Hold Ctrl/Cmd to select multiple)
              </label>
              <select
                multiple
                value={selectedUsers}
                onChange={handleUserSelect}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[150px]"
              >
                {filteredAssignUsers.length > 0 ? (
                  filteredAssignUsers.map((user) => (
                    <option key={user.id} value={user.id} className="py-1">
                      {user.username} - {user.sub_role || "No Role"}
                    </option>
                  ))
                ) : (
                  <option disabled className="py-1">
                    No users match the search or role filter.
                  </option>
                )}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={assignUserToProject}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ROLE MODAL */}
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm">
              User:{" "}
              <span className="font-bold">
                {selectedUser?.username} - {getSubRoleLabel(newRole)}
              </span>
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select
                value={newRole || "project_manager"}
                onChange={(e) => setNewRole(normalizeSubRole(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="project_manager">Project Manager</option>
                <option value="project_engineer">Project Engineer</option>
                <option value="data_contributor">Data Contributor</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleOpen(false)}>
              Cancel
            </Button>
            <Button onClick={updateUserRole}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
