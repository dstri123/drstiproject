import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, User, Mail, Image as ImageIcon, Trash2 } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";

export default function CreateProject() {
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [formData, setFormData] = useState({
    project_name: "",
    description: "",
    start_date: "",
    end_date: "",
    latitude: "",
    longitude: "",
    footprint_area: "",
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [contributors, setContributors] = useState([]);
  const [selectedContributors, setSelectedContributors] = useState([]);
  const [loadingContributors, setLoadingContributors] = useState(true);
  const [projectImage, setProjectImage] = useState(null);
  const [projectImagePreview, setProjectImagePreview] = useState(null);
  const [searchContributor, setSearchContributor] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [tempSelectedContributors, setTempSelectedContributors] = useState([]);
  const [assignedPage, setAssignedPage] = useState(1);
  const [availablePage, setAvailablePage] = useState(1);
  const assignedItemsPerPage = 3;
  const availableItemsPerPage = 10;

  const ROLE_OPTIONS = [
    { value: "all", label: "All Roles" },
    { value: "project_engineer", label: "Project Engineer" },
    { value: "data_contributor", label: "Data Contributor" },
    { value: "project_manager", label: "Project Manager" },
    { value: "site_engineer", label: "Site Engineer" },
    { value: "admin", label: "Admin" },
  ];

  // Fetch contributors on component load
  useEffect(() => {
    const fetchContributors = async () => {
      try {
        const res = await API.get("users/");
        const data = Array.isArray(res.data) ? res.data : [];
        setContributors(data);
      } catch (err) {
        console.error("Failed to load contributors:", err);
        setContributors([]);
      } finally {
        setLoadingContributors(false);
      }
    };

    fetchContributors();
  }, []);

  const toggleTempContributor = (id) => {
    setTempSelectedContributors((prev) =>
      prev.includes(id) ? prev.filter((cid) => cid !== id) : [...prev, id]
    );
  };

  const assignContributors = () => {
    setSelectedContributors((prev) => [...new Set([...prev, ...tempSelectedContributors])]);
    setTempSelectedContributors([]);
    setSearchContributor("");
    setRoleFilter("all");
  };

  const removeAssignedContributor = (id) => {
    setSelectedContributors((prev) => prev.filter((cid) => cid !== id));
  };

  const filteredAvailableContributors = contributors.filter((c) => {
    if (selectedContributors.includes(c.id)) return false;

    const matchesSearch =
      (c.username || "").toLowerCase().includes(searchContributor.toLowerCase()) ||
      ((c.first_name || "") + " " + (c.last_name || ""))
        .toLowerCase()
        .includes(searchContributor.toLowerCase());

    const role = c.sub_role || c.role || "member";
    const matchesRole = roleFilter === "all" || role === roleFilter;

    return matchesSearch && matchesRole;
  });

  // Pagination for available contributors
  const availableTotalPages = Math.ceil(filteredAvailableContributors.length / availableItemsPerPage);
  const availableStartIndex = (availablePage - 1) * availableItemsPerPage;
  const paginatedAvailableContributors = filteredAvailableContributors.slice(
    availableStartIndex,
    availableStartIndex + availableItemsPerPage
  );

  // Reset page when search/filter changes
  useEffect(() => {
    setAvailablePage(1);
  }, [searchContributor, roleFilter]);

  const assignedContributorsList = contributors.filter((c) => selectedContributors.includes(c.id));
  const assignedTotalPages = Math.ceil(assignedContributorsList.length / assignedItemsPerPage);
  const assignedStartIndex = (assignedPage - 1) * assignedItemsPerPage;
  const paginatedAssignedContributors = assignedContributorsList.slice(
    assignedStartIndex,
    assignedStartIndex + assignedItemsPerPage
  );

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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
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

      const res = await API.post("create-project/", formDataToSend, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      // Get the created project ID
      const projectId = res.data.project_id;

      // Assign selected contributors if any
      if (selectedContributors.length > 0 && projectId) {
        await API.post("assign-user/", {
          project_id: projectId,
          user_ids: selectedContributors,
        });
      }

      success("Project created successfully!");

      // Reset form
      setFormData({
        project_name: "",
        description: "",
        start_date: "",
        end_date: "",
        latitude: "",
        longitude: "",
        footprint_area: "",
      });
      setSelectedContributors([]);
      setProjectImage(null);
      setProjectImagePreview(null);

      setTimeout(() => {
        navigate("/admin/projects");
      }, 2000);
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Failed to create project";
      error(errorMsg);
      setErrors({ submit: errorMsg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar />

      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <button
            onClick={() => navigate("/admin/projects")}
            className="flex items-center gap-2 text-black hover:text-gray-700 mb-6 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </button>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">Create Project</h1>
            <p className="text-sm text-gray-600">
              Add a new project with details and location information
            </p>
          </div>

          {/* Project Cover Image Section */}
          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-6">
            <h2 className="text-base font-semibold text-black mb-3">Project Cover Image</h2>
            <p className="text-xs text-gray-600 mb-4">Upload a cover image for your project (optional)</p>

            {projectImagePreview ? (
              <div className="space-y-4">
                <div className="relative w-full h-48 rounded-lg overflow-hidden border border-gray-300 bg-white">
                  <img
                    src={projectImagePreview}
                    alt="Project preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={removeImage}
                  className="border-gray-300 text-black px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap hover:bg-gray-100"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove Image
                </Button>
              </div>
            ) : (
              <label htmlFor="project-image" className="cursor-pointer">
                <input
                  id="project-image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 hover:bg-gray-100 transition-colors">
                  <ImageIcon className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-700 mb-1">Click to upload image</p>
                  <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                </div>
              </label>
            )}
            {errors.image && (
              <p className="text-xs text-red-700 flex items-center gap-1 mt-2">
                <AlertCircle className="w-3 h-3" />
                {errors.image}
              </p>
            )}
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - Project Details */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Project Information
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Enter the basic project details and description
              </p>

              <div className="space-y-4">
                {/* Project Name */}
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
                      errors.project_name ? "border-red-500 focus:border-red-500" : formData.project_name ? "border-green-500 focus:border-green-500" : ""
                    }`}
                  />
                  {formData.project_name && !errors.project_name && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Project name is valid
                    </p>
                  )}
                  {errors.project_name && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.project_name}
                    </p>
                  )}
                </div>

                {/* Description */}
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
                      errors.description ? "border-red-500 focus:border-red-500" : formData.description ? "border-green-500 focus:border-green-500" : "border-gray-300"
                    }`}
                  />
                  {formData.description && !errors.description && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Description is valid
                    </p>
                  )}
                  {errors.description && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.description}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Dates & Geolocation */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Timeline & Location
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Set project dates and geolocation coordinates
              </p>

              <div className="space-y-4">
                {/* Start Date */}
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
                  {formData.start_date && !errors.start_date && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Start date is valid
                    </p>
                  )}
                  {errors.start_date && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.start_date}
                    </p>
                  )}
                </div>

                {/* End Date */}
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
                  {formData.end_date && !errors.end_date && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      End date is valid
                    </p>
                  )}
                  {errors.end_date && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.end_date}
                    </p>
                  )}
                </div>

                {/* Latitude */}
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
                      errors.latitude ? "border-red-500 focus:border-red-500" : formData.latitude ? "border-green-500 focus:border-green-500" : ""
                    }`}
                  />
                  {formData.latitude && !errors.latitude && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Latitude is valid
                    </p>
                  )}
                  {errors.latitude && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.latitude}
                    </p>
                  )}
                </div>

                {/* Longitude */}
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
                      errors.longitude ? "border-red-500 focus:border-red-500" : formData.longitude ? "border-green-500 focus:border-green-500" : ""
                    }`}
                  />
                  {formData.longitude && !errors.longitude && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Longitude is valid
                    </p>
                  )}
                  {errors.longitude && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.longitude}
                    </p>
                  )}
                </div>

                {/* Building Footprint Area */}
                <div className="col-span-2">
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
                    className={`border-gray-300 mt-1 text-sm ${
                      formData.footprint_area && isNaN(parseFloat(formData.footprint_area))
                        ? "border-red-500 focus:border-red-500"
                        : formData.footprint_area
                        ? "border-green-500 focus:border-green-500"
                        : ""
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Assign Contributors Section */}
          <div className="mt-8 space-y-8">
            {/* Available Contributors */}
            <div>
              <h2 className="text-lg font-semibold text-black mb-2">Available Contributors</h2>
              <p className="text-xs text-gray-600 mb-4">
                Search and filter to find contributors, then assign them to the project
              </p>

              {/* Search and Filter */}
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
                        Showing {filteredAvailableContributors.length === 0 ? 0 : availableStartIndex + 1} to{" "}
                        {Math.min(availableStartIndex + availableItemsPerPage, filteredAvailableContributors.length)} of{" "}
                        {filteredAvailableContributors.length} contributor(s)
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
                              } transition-colors`}
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
                                  {((contributor.first_name || "") + " " + (contributor.last_name || "")).trim() ||
                                    "-"}
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

                    {/* Pagination for Available Contributors */}
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

                    {/* Assign Button */}
                    {tempSelectedContributors.length > 0 && (
                      <Button
                        onClick={assignContributors}
                        className="w-full bg-black hover:bg-gray-900 text-white px-4 py-2.5 font-medium rounded-md flex items-center justify-center gap-2"
                      >
                        Assign ({tempSelectedContributors.length}) Contributor
                        {tempSelectedContributors.length !== 1 ? "s" : ""}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Assigned Contributors */}
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

                {/* Pagination */}
                {assignedTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-gray-600">
                      Showing {assignedStartIndex + 1} to {Math.min(assignedStartIndex + assignedItemsPerPage, assignedContributorsList.length)} of {assignedContributorsList.length}
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

          {/* Error Message */}
          {errors.submit && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 mt-8 mb-4">
              <p className="text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errors.submit}
              </p>
            </div>
          )}

          {/* Action Buttons */}
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
              disabled={loading || !formData.project_name.trim() || !formData.description.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
