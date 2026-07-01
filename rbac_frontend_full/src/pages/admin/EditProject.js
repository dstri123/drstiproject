import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon, Trash2, User, Mail } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";

const ROLE_OPTIONS = [
  { value: "", label: "All Roles" },
  { value: "project_engineer", label: "Project Engineer" },
  { value: "data_contributor", label: "Data Contributor" },
  { value: "project_manager", label: "Project Manager" },
  { value: "site_engineer", label: "Site Engineer" },
  { value: "admin", label: "Admin" },
];

export default function EditProject() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [project, setProject] = useState(null);
  const [formData, setFormData] = useState({
    project_name: "",
    description: "",
    start_date: "",
    end_date: "",
    latitude: "",
    longitude: "",
    footprint_area: "",
  });

  const [projectImage, setProjectImage] = useState(null);
  const [projectImagePreview, setProjectImagePreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [contributors, setContributors] = useState([]);
  const [selectedContributors, setSelectedContributors] = useState([]);
  const [searchContributor, setSearchContributor] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [tempSelectedContributors, setTempSelectedContributors] = useState([]);
  const [loadingContributors, setLoadingContributors] = useState(false);
  const [availablePage, setAvailablePage] = useState(1);
  const [assignedPage, setAssignedPage] = useState(1);
  const availableItemsPerPage = 10;
  const assignedItemsPerPage = 3;

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await API.get("projects/");
        const foundProject = res.data.find((p) => p.slug === slug);

        if (!foundProject) {
          error("Project not found");
          navigate("/admin/projects");
          return;
        }

        setProject(foundProject);
        setFormData({
          project_name: foundProject.project_name || "",
          description: foundProject.description || "",
          start_date: foundProject.start || "",
          end_date: foundProject.end || "",
          latitude: foundProject.latitude || "",
          longitude: foundProject.longitude || "",
          footprint_area: foundProject.footprint_area || "",
        });

        if (foundProject.image) {
          setProjectImagePreview(foundProject.image);
        }

        if (foundProject.users && Array.isArray(foundProject.users)) {
          setSelectedContributors(foundProject.users);
        }
      } catch (err) {
        error("Failed to load project");
        navigate("/admin/projects");
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [slug, navigate, error]);

  useEffect(() => {
    fetchContributors();
  }, []);

  const fetchContributors = async () => {
    setLoadingContributors(true);
    try {
      const res = await API.get("users/");
      setContributors(res.data || []);
    } catch (err) {
      error("Failed to load contributors");
    } finally {
      setLoadingContributors(false);
    }
  };

  const filteredAvailableContributors = contributors.filter(
    (c) =>
      !selectedContributors.some((s) => s.id === c.id) &&
      (c.username?.toLowerCase().includes(searchContributor.toLowerCase()) ||
        c.first_name?.toLowerCase().includes(searchContributor.toLowerCase()) ||
        c.last_name?.toLowerCase().includes(searchContributor.toLowerCase())) &&
      (roleFilter === "" || c.sub_role === roleFilter || c.role === roleFilter)
  );

  const availableTotalPages = Math.ceil(
    filteredAvailableContributors.length / availableItemsPerPage
  );
  const availableStartIndex = (availablePage - 1) * availableItemsPerPage;
  const paginatedAvailableContributors = filteredAvailableContributors.slice(
    availableStartIndex,
    availableStartIndex + availableItemsPerPage
  );

  const assignedTotalPages = Math.ceil(selectedContributors.length / assignedItemsPerPage);
  const assignedStartIndex = (assignedPage - 1) * assignedItemsPerPage;
  const paginatedAssignedContributors = selectedContributors.slice(
    assignedStartIndex,
    assignedStartIndex + assignedItemsPerPage
  );

  const toggleTempContributor = (id) => {
    setTempSelectedContributors((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const assignContributors = () => {
    const newAssignedContributors = contributors.filter((c) =>
      tempSelectedContributors.includes(c.id)
    );
    setSelectedContributors((prev) => [...prev, ...newAssignedContributors]);
    setTempSelectedContributors([]);
    setSearchContributor("");
    setRoleFilter("");
    setAvailablePage(1);
  };

  const removeAssignedContributor = (id) => {
    setSelectedContributors((prev) => prev.filter((c) => c.id !== id));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        setErrors((prev) => ({
          ...prev,
          image: "Please upload a valid image file",
        }));
        return;
      }

      setProjectImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProjectImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
      setErrors((prev) => ({
        ...prev,
        image: "",
      }));
    }
  };

  const removeImage = () => {
    setProjectImage(null);
    setProjectImagePreview(null);
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.project_name.trim()) {
      newErrors.project_name = "Project name is required";
    }

    if (!formData.description.trim()) {
      newErrors.description = "Description is required";
    }

    if (!formData.start_date) {
      newErrors.start_date = "Start date is required";
    }

    if (!formData.end_date) {
      newErrors.end_date = "End date is required";
    }

    if (formData.start_date && formData.end_date) {
      if (new Date(formData.start_date) > new Date(formData.end_date)) {
        newErrors.end_date = "End date must be after start date";
      }
    }

    if (formData.latitude && isNaN(parseFloat(formData.latitude))) {
      newErrors.latitude = "Latitude must be a valid number";
    }

    if (formData.longitude && isNaN(parseFloat(formData.longitude))) {
      newErrors.longitude = "Longitude must be a valid number";
    }

    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const formDataToSend = new FormData();
      formDataToSend.append("project_name", formData.project_name);
      formDataToSend.append("description", formData.description);
      formDataToSend.append("start", formData.start_date);
      formDataToSend.append("end", formData.end_date);
      if (formData.latitude) formDataToSend.append("latitude", formData.latitude);
      if (formData.longitude) formDataToSend.append("longitude", formData.longitude);
      if (formData.footprint_area) formDataToSend.append("footprint_area", formData.footprint_area);
      if (projectImage) formDataToSend.append("image", projectImage);

      const response = await API.put(`projects/${project.id}/`, formDataToSend, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      // Update contributors if any are assigned
      if (selectedContributors.length > 0) {
        try {
          const contributorIds = selectedContributors.map((c) => c.id);
          await API.post(`projects/${project.id}/assign-contributors/`, {
            user_ids: contributorIds,
          });
        } catch (contributorErr) {
          console.warn("Contributor assignment failed, but project was updated:", contributorErr);
        }
      }

      success("Project updated successfully!");
      setTimeout(() => {
        navigate("/admin/projects");
      }, 2000);
    } catch (err) {
      console.error("Update error:", err);
      const errorMsg = err.response?.data?.detail || err.response?.data?.error || err.message || "Failed to update project";
      error(errorMsg);
      setErrors({ submit: errorMsg });
    } finally {
      setSaving(false);
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

  if (!project) {
    return null;
  }

  return (
    <>
      <Topbar />

      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/admin/projects")}
            className="flex items-center gap-2 text-black hover:text-gray-700 mb-6 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </button>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">
              Edit {project?.project_name || "Project"}
            </h1>
            <p className="text-sm text-gray-600">
              Update project details, location, image, and contributors
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Project Image
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Upload a cover image for your project
              </p>

              <div className="space-y-4">
                <div className="w-full aspect-video rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden">
                  {projectImagePreview ? (
                    <img
                      src={projectImagePreview}
                      alt="Project"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">No image selected</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="image" className="text-xs font-semibold text-black">
                    Upload Image
                  </Label>
                  <Input
                    id="image"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="text-sm"
                  />
                  {errors.image && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.image}
                    </p>
                  )}
                </div>

                {projectImagePreview && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-red-300 text-red-600 hover:bg-red-50"
                    onClick={removeImage}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remove Image
                  </Button>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Project Information
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Update project details and location
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="project_name" className="text-xs font-semibold text-black">
                    Project Name *
                  </Label>
                  <Input
                    id="project_name"
                    name="project_name"
                    value={formData.project_name}
                    onChange={handleInputChange}
                    placeholder="Enter project name"
                    className={`text-sm ${
                      errors.project_name ? "border-red-500" : formData.project_name ? "border-green-500" : ""
                    }`}
                  />
                  {formData.project_name && !errors.project_name && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Valid
                    </p>
                  )}
                  {errors.project_name && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.project_name}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="text-xs font-semibold text-black">
                    Description *
                  </Label>
                  <textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Enter project description..."
                    rows="4"
                    className={`w-full px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-0 font-normal ${
                      errors.description ? "border-red-500" : formData.description ? "border-green-500" : "border-gray-300"
                    }`}
                  />
                  {errors.description && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.description}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="start_date" className="text-xs font-semibold text-black">
                      Start Date *
                    </Label>
                    <DatePicker
                      date={formData.start_date ? new Date(formData.start_date) : undefined}
                      onDateChange={(date) =>
                        setFormData((prev) => ({
                          ...prev,
                          start_date: date ? date.toISOString().split("T")[0] : "",
                        }))
                      }
                      placeholder="Pick a start date"
                      className={`text-sm ${
                        errors.start_date ? "border-red-500" : formData.start_date ? "border-green-500" : ""
                      }`}
                    />
                    {errors.start_date && (
                      <p className="text-xs text-red-700">{errors.start_date}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="end_date" className="text-xs font-semibold text-black">
                      End Date *
                    </Label>
                    <DatePicker
                      date={formData.end_date ? new Date(formData.end_date) : undefined}
                      onDateChange={(date) =>
                        setFormData((prev) => ({
                          ...prev,
                          end_date: date ? date.toISOString().split("T")[0] : "",
                        }))
                      }
                      placeholder="Pick an end date"
                      className={`text-sm ${
                        errors.end_date ? "border-red-500" : formData.end_date ? "border-green-500" : ""
                      }`}
                    />
                    {errors.end_date && (
                      <p className="text-xs text-red-700">{errors.end_date}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="latitude" className="text-xs font-semibold text-black">
                      Latitude (Optional)
                    </Label>
                    <Input
                      id="latitude"
                      name="latitude"
                      type="number"
                      step="0.000001"
                      placeholder="e.g., 40.712776"
                      value={formData.latitude}
                      onChange={handleInputChange}
                      className={`text-sm ${
                        errors.latitude ? "border-red-500" : formData.latitude ? "border-green-500" : ""
                      }`}
                    />
                    {errors.latitude && (
                      <p className="text-xs text-red-700">{errors.latitude}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="longitude" className="text-xs font-semibold text-black">
                      Longitude (Optional)
                    </Label>
                    <Input
                      id="longitude"
                      name="longitude"
                      type="number"
                      step="0.000001"
                      placeholder="e.g., -74.005974"
                      value={formData.longitude}
                      onChange={handleInputChange}
                      className={`text-sm ${
                        errors.longitude ? "border-red-500" : formData.longitude ? "border-green-500" : ""
                      }`}
                    />
                    {errors.longitude && (
                      <p className="text-xs text-red-700">{errors.longitude}</p>
                    )}
                  </div>
                </div>

                {/* Building Footprint Area */}
                <div className="col-span-2 mt-2">
                  <Label htmlFor="footprint_area" className="text-xs font-semibold text-black">
                    Building Footprint Area (m²)
                  </Label>
                  <Input
                    id="footprint_area"
                    name="footprint_area"
                    type="number"
                    placeholder="e.g. 2500"
                    value={formData.footprint_area}
                    onChange={handleInputChange}
                    className={`mt-1 text-sm ${
                      formData.footprint_area ? "border-green-500" : ""
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-8">
            <div>
              <h2 className="text-lg font-semibold text-black mb-2">Available Contributors</h2>
              <p className="text-xs text-gray-600 mb-4">
                Search and filter to find contributors, then assign them to the project
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <Input
                  placeholder="Search by name or username..."
                  className="border-gray-300 flex-1 text-sm"
                  value={searchContributor}
                  onChange={(e) => setSearchContributor(e.target.value)}
                />
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-black focus:outline-none focus:ring-1 focus:ring-black"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              {loadingContributors ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-black" />
                </div>
              ) : filteredAvailableContributors.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
                  <User className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    {contributors.length === 0 ? "No contributors available" : "No matching contributors"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-600">
                        Showing {availableStartIndex + 1} to{" "}
                        {Math.min(availableStartIndex + availableItemsPerPage, filteredAvailableContributors.length)} of{" "}
                        {filteredAvailableContributors.length}
                      </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50 border-b border-gray-200">
                            <TableHead className="w-12 py-4">
                              <input
                                type="checkbox"
                                checked={
                                  paginatedAvailableContributors.length > 0 &&
                                  paginatedAvailableContributors.every((c) => tempSelectedContributors.includes(c.id))
                                }
                                onChange={(e) =>
                                  setTempSelectedContributors(
                                    e.target.checked
                                      ? [
                                          ...tempSelectedContributors.filter(
                                            (id) => !paginatedAvailableContributors.map((c) => c.id).includes(id)
                                          ),
                                          ...paginatedAvailableContributors.map((c) => c.id),
                                        ]
                                      : tempSelectedContributors.filter(
                                          (id) => !paginatedAvailableContributors.map((c) => c.id).includes(id)
                                        )
                                  )
                                }
                                className="cursor-pointer"
                              />
                            </TableHead>
                            <TableHead className="font-semibold text-black text-sm">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-500" />
                                Username
                              </div>
                            </TableHead>
                            <TableHead className="font-semibold text-black text-sm">
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-gray-500" />
                                Email
                              </div>
                            </TableHead>
                            <TableHead className="font-semibold text-black text-sm">Full Name</TableHead>
                            <TableHead className="font-semibold text-black text-sm">Role</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedAvailableContributors.map((contributor) => (
                            <TableRow
                              key={contributor.id}
                              className={`border-b border-gray-100 ${
                                tempSelectedContributors.includes(contributor.id) ? "bg-green-50" : "hover:bg-gray-50"
                              }`}
                            >
                              <TableCell className="py-3">
                                <input
                                  type="checkbox"
                                  checked={tempSelectedContributors.includes(contributor.id)}
                                  onChange={() => toggleTempContributor(contributor.id)}
                                  className="cursor-pointer"
                                />
                              </TableCell>
                              <TableCell className="py-3">
                                <p className="font-semibold text-black text-sm">{contributor.username || "-"}</p>
                              </TableCell>
                              <TableCell className="py-3">
                                <p className="text-gray-600 text-sm">{contributor.email || "-"}</p>
                              </TableCell>
                              <TableCell className="py-3">
                                <p className="text-gray-700 text-sm">
                                  {((contributor.first_name || "") + " " + (contributor.last_name || "")).trim() || "-"}
                                </p>
                              </TableCell>
                              <TableCell className="py-3">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-black text-white">
                                  {(contributor.sub_role || contributor.role || "Member")
                                    .toString()
                                    .replace(/_/g, " ")
                                    .split(" ")
                                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                                    .join(" ")}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {availableTotalPages > 1 && (
                      <div className="flex items-center justify-between">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAvailablePage((p) => Math.max(1, p - 1))}
                          disabled={availablePage === 1}
                          className="border-gray-300 text-black text-xs hover:bg-gray-50"
                        >
                          Previous
                        </Button>
                        <div className="flex gap-1">
                          {Array.from({ length: Math.min(availableTotalPages, 5) }, (_, i) => {
                            if (availableTotalPages <= 5) return i + 1;
                            if (availablePage <= 3) return i + 1;
                            if (availablePage >= availableTotalPages - 2) return availableTotalPages - 4 + i;
                            return availablePage - 2 + i;
                          }).map((page) => (
                            <Button
                              key={page}
                              variant={availablePage === page ? "default" : "outline"}
                              size="sm"
                              onClick={() => setAvailablePage(page)}
                              className={`text-xs ${
                                availablePage === page
                                  ? "bg-black text-white"
                                  : "border-gray-300 text-black hover:bg-gray-50"
                              }`}
                            >
                              {page}
                            </Button>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAvailablePage((p) => Math.min(availableTotalPages, p + 1))}
                          disabled={availablePage === availableTotalPages}
                          className="border-gray-300 text-black text-xs hover:bg-gray-50"
                        >
                          Next
                        </Button>
                      </div>
                    )}

                    {tempSelectedContributors.length > 0 && (
                      <Button
                        onClick={assignContributors}
                        className="w-full bg-black hover:bg-gray-900 text-white px-4 py-2.5 font-medium rounded-md"
                      >
                        Assign ({tempSelectedContributors.length}) Contributor
                        {tempSelectedContributors.length !== 1 ? "s" : ""}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>

            {selectedContributors.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-black mb-2">Assigned Contributors</h2>
                <p className="text-xs text-gray-600 mb-4">
                  {selectedContributors.length} contributor(s) assigned to this project
                </p>

                <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 border-b border-gray-200">
                        <TableHead className="font-semibold text-black text-sm">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-500" />
                            Username
                          </div>
                        </TableHead>
                        <TableHead className="font-semibold text-black text-sm">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-gray-500" />
                            Email
                          </div>
                        </TableHead>
                        <TableHead className="font-semibold text-black text-sm">Full Name</TableHead>
                        <TableHead className="font-semibold text-black text-sm">Role</TableHead>
                        <TableHead className="font-semibold text-black text-sm">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedAssignedContributors.map((contributor) => (
                        <TableRow key={contributor.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <TableCell className="py-3">
                            <p className="font-semibold text-black text-sm">{contributor.username || "-"}</p>
                          </TableCell>
                          <TableCell className="py-3">
                            <p className="text-gray-600 text-sm">{contributor.email || "-"}</p>
                          </TableCell>
                          <TableCell className="py-3">
                            <p className="text-gray-700 text-sm">
                              {((contributor.first_name || "") + " " + (contributor.last_name || "")).trim() || "-"}
                            </p>
                          </TableCell>
                          <TableCell className="py-3">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-black text-white">
                              {(contributor.sub_role || contributor.role || "Member")
                                .toString()
                                .replace(/_/g, " ")
                                .split(" ")
                                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                                .join(" ")}
                            </span>
                          </TableCell>
                          <TableCell className="py-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAssignedContributor(contributor.id)}
                              className="hover:bg-red-50 hover:text-red-600 text-xs"
                            >
                              <Trash2 className="w-4 h-4" />
                              Unassign
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {assignedTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-gray-600">
                      Showing {assignedStartIndex + 1} to {Math.min(assignedStartIndex + assignedItemsPerPage, selectedContributors.length)} of {selectedContributors.length}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAssignedPage((p) => Math.max(1, p - 1))}
                        disabled={assignedPage === 1}
                        className="border-gray-300 text-black text-xs hover:bg-gray-50"
                      >
                        Previous
                      </Button>
                      {Array.from({ length: assignedTotalPages }, (_, i) => i + 1).map((page) => (
                        <Button
                          key={page}
                          variant={assignedPage === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setAssignedPage(page)}
                          className={`text-xs ${
                            assignedPage === page
                              ? "bg-black text-white"
                              : "border-gray-300 text-black hover:bg-gray-50"
                          }`}
                        >
                          {page}
                        </Button>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAssignedPage((p) => Math.min(assignedTotalPages, p + 1))}
                        disabled={assignedPage === assignedTotalPages}
                        className="border-gray-300 text-black text-xs hover:bg-gray-50"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {errors.submit && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 mt-8 mb-4">
              <p className="text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errors.submit}
              </p>
            </div>
          )}

          <div className="mt-8 flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-gray-300 text-sm"
              onClick={() => navigate("/admin/projects")}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-black hover:bg-gray-900 text-white text-sm"
              onClick={handleSubmit}
              disabled={saving}
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
    </>
  );
}
