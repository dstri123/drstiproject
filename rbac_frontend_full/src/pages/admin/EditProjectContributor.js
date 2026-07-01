import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import { useCheckEmail } from "../../hooks/useCheckUsername";

const ROLE_OPTIONS = [
  { value: "project_engineer", label: "Project Engineer" },
  { value: "data_contributor", label: "Data Contributor" },
  { value: "project_manager", label: "Project Manager" },
  { value: "site_engineer", label: "Site Engineer" },
  { value: "admin", label: "Admin" },
];

export default function EditProjectContributor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [contributor, setContributor] = useState(null);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    sub_role: "",
    description: "",
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [originalEmail, setOriginalEmail] = useState("");

  // Check email availability (only if changed)
  const { checking: checkingEmail, isAvailable: emailAvailable, debouncedCheck: debouncedEmailCheck } = useCheckEmail();

  useEffect(() => {
    // Only check if email has changed
    if (formData.email.trim() && formData.email !== originalEmail) {
      debouncedEmailCheck(formData.email);
    }
  }, [formData.email, originalEmail, debouncedEmailCheck]);

  useEffect(() => {
    const fetchContributor = async () => {
      try {
        const res = await API.get("users/");
        const foundContributor = res.data.find((c) => c.id === parseInt(id));

        if (!foundContributor) {
          error("Contributor not found");
          navigate("/admin/project-user");
          return;
        }

        setContributor(foundContributor);
        const email = foundContributor.email || "";
        setOriginalEmail(email);
        setFormData({
          first_name: foundContributor.first_name || "",
          last_name: foundContributor.last_name || "",
          email: email,
          sub_role: foundContributor.sub_role || foundContributor.role || "project_engineer",
          description: foundContributor.description || "",
        });
      } catch (err) {
        error("Failed to load contributor");
        navigate("/admin/project-user");
      } finally {
        setLoading(false);
      }
    };

    fetchContributor();
  }, [id, navigate, error]);

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

  const validateForm = () => {
    const newErrors = {};

    if (!formData.first_name.trim()) {
      newErrors.first_name = "First name is required";
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = "Last name is required";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    } else if (formData.email !== originalEmail && !emailAvailable) {
      newErrors.email = "Email is already in use";
    }

    return newErrors;
  };

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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
      await API.put(`users/${contributor.id}/`, {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        sub_role: formData.sub_role,
        description: formData.description,
      });

      success("Contributor updated successfully!");
      setTimeout(() => {
        navigate("/admin/project-user");
      }, 2000);
    } catch (err) {
      console.error("Update error:", err.response?.data || err.message);
      const errorMsg =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        err.response?.data?.message ||
        Object.values(err.response?.data || {}).flat().join(", ") ||
        "Failed to update contributor";
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

  if (!contributor) {
    return null;
  }

  return (
    <>
      <Topbar />

      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <button
            onClick={() => navigate("/admin/project-user")}
            className="flex items-center gap-2 text-black hover:text-gray-700 mb-6 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Contributors
          </button>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">
              Edit {contributor?.first_name} {contributor?.last_name}
            </h1>
            <p className="text-sm text-gray-600">
              Update {contributor?.username}'s information
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - Contributor Info */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Contributor Details
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Update the contributor's personal information
              </p>

              <div className="space-y-4">
                {/* Username - Read Only */}
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-xs font-semibold text-black">
                    Username (Read Only)
                  </Label>
                  <Input
                    id="username"
                    value={contributor?.username || ""}
                    disabled
                    className="text-sm border-gray-300 bg-gray-100 cursor-not-allowed"
                  />
                </div>

                {/* First Name */}
                <div className="space-y-2">
                  <Label htmlFor="first_name" className="text-xs font-semibold text-black">
                    First Name *
                  </Label>
                  <Input
                    id="first_name"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleInputChange}
                    placeholder="Enter first name"
                    className={`text-sm ${
                      errors.first_name ? "border-red-500" : formData.first_name ? "border-green-500" : ""
                    }`}
                  />
                  {formData.first_name && !errors.first_name && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Valid
                    </p>
                  )}
                  {errors.first_name && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.first_name}
                    </p>
                  )}
                </div>

                {/* Last Name */}
                <div className="space-y-2">
                  <Label htmlFor="last_name" className="text-xs font-semibold text-black">
                    Last Name *
                  </Label>
                  <Input
                    id="last_name"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleInputChange}
                    placeholder="Enter last name"
                    className={`text-sm ${
                      errors.last_name ? "border-red-500" : formData.last_name ? "border-green-500" : ""
                    }`}
                  />
                  {formData.last_name && !errors.last_name && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Valid
                    </p>
                  )}
                  {errors.last_name && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.last_name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Contact Info */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Contact Information
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Update the contributor's email address
              </p>

              <div className="space-y-4">
                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-semibold text-black">
                    Email Address *
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="Enter email address"
                    className={`text-sm ${
                      errors.email ? "border-red-500" : formData.email && isValidEmail(formData.email) ? "border-green-500" : ""
                    }`}
                  />
                  {formData.email && isValidEmail(formData.email) && !errors.email && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Email is valid
                    </p>
                  )}
                  {errors.email && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.email}
                    </p>
                  )}
                </div>

                {/* Role */}
                <div className="space-y-2">
                  <Label htmlFor="sub_role" className="text-xs font-semibold text-black">
                    Role *
                  </Label>
                  <select
                    id="sub_role"
                    name="sub_role"
                    value={formData.sub_role}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-black focus:outline-none focus:ring-1 focus:ring-black"
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-xs font-semibold text-black">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Add notes or description about this contributor..."
                    className="resize-none text-sm border-gray-300 text-black focus:ring-black"
                  />
                </div>
              </div>
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

          {/* Action Buttons */}
          <div className="mt-8 flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-gray-300 text-sm"
              onClick={() => navigate("/admin/project-user")}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-black hover:bg-gray-900 text-white text-sm"
              onClick={handleSubmit}
              disabled={saving || checkingEmail}
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
