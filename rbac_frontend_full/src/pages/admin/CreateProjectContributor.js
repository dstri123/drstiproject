import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Zap } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import { generateStrongPassword } from "../../utils/passwordGenerator";
import { useCheckUsername, useCheckEmail } from "../../hooks/useCheckUsername";

export default function CreateProjectContributor() {
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [formData, setFormData] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    password: "",
    confirmPassword: "",
    sub_role: "project_engineer",
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Check username availability
  const { checking: checkingUsername, isAvailable: usernameAvailable, debouncedCheck } = useCheckUsername();

  // Check email availability
  const { checking: checkingEmail, isAvailable: emailAvailable, debouncedCheck: debouncedEmailCheck } = useCheckEmail();

  useEffect(() => {
    if (formData.username.trim().length >= 3) {
      debouncedCheck(formData.username);
    }
  }, [formData.username, debouncedCheck]);

  useEffect(() => {
    if (formData.email.trim().length > 0) {
      debouncedEmailCheck(formData.email);
    }
  }, [formData.email, debouncedEmailCheck]);

  const roles = [
    { value: "admin", label: "Admin" },
    { value: "project_engineer", label: "Project Engineer" },
    { value: "data_contributor", label: "Data Contributor" },
    { value: "project_manager", label: "Project Manager" },
    { value: "site_engineer", label: "Site Engineer" },
  ];

  const validateForm = () => {
    const newErrors = {};

    if (!formData.username.trim()) {
      newErrors.username = "Username is required";
    } else if (usernameAvailable === false) {
      newErrors.username = "Username is already taken";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!formData.first_name.trim()) {
      newErrors.first_name = "First name is required";
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = "Last name is required";
    }

    if (!formData.password.trim()) {
      newErrors.password = "Password is required";
    } else if (formData.password.length < 8) {
      newErrors.password = "Password must be at least 8 characters";
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (!formData.sub_role) {
      newErrors.sub_role = "Role is required";
    }

    return newErrors;
  };

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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

  const generatePassword = () => {
    const newPassword = generateStrongPassword();
    setFormData((prev) => ({
      ...prev,
      password: newPassword,
      confirmPassword: newPassword,
    }));
    success("Strong password generated!");
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
      await API.post("create-user-assign/", {
        username: formData.username.trim(),
        email: formData.email.trim(),
        password: formData.password,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        sub_role: formData.sub_role,
      });

      success("Project contributor created successfully!");

      // Reset form
      setFormData({
        username: "",
        email: "",
        first_name: "",
        last_name: "",
        password: "",
        confirmPassword: "",
        sub_role: "project_engineer",
      });

      setTimeout(() => {
        navigate("/admin/project-user");
      }, 2000);
    } catch (err) {
      console.error("Create error:", err.response?.data || err.message);
      const errorMsg =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        err.response?.data?.message ||
        Object.values(err.response?.data || {}).flat().join(", ") ||
        "Failed to create contributor";
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
            onClick={() => navigate("/admin/project-user")}
            className="flex items-center gap-2 text-black hover:text-gray-700 mb-6 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Contributors
          </button>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">Create Project Contributor</h1>
            <p className="text-sm text-gray-600">
              Add a new team member (engineer, data contributor, or site engineer)
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - User Credentials */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                User Credentials
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Username and password for account access
              </p>

              <div className="space-y-4">
                {/* Username */}
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-xs font-semibold text-black">
                    Username *
                  </Label>
                  <Input
                    id="username"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    placeholder="Enter username"
                    className={`text-sm ${
                      errors.username ? "border-red-500" :
                      formData.username && usernameAvailable ? "border-green-500" : ""
                    }`}
                  />
                  {formData.username && usernameAvailable && !checkingUsername && !errors.username && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Username is available
                    </p>
                  )}
                  {errors.username && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.username}
                    </p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs font-semibold text-black">
                      Password *
                    </Label>
                    <button
                      type="button"
                      onClick={generatePassword}
                      className="text-xs flex items-center gap-1 text-black hover:text-gray-700 font-medium transition-colors"
                    >
                      <Zap className="w-3 h-3" />
                      Generate
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={handleInputChange}
                      placeholder="Enter password"
                      className={`text-sm pr-10 ${
                        errors.password ? "border-red-500" : formData.password ? "border-green-500" : ""
                      }`}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.password}
                    </p>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-xs font-semibold text-black">
                    Confirm Password *
                  </Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="Re-enter password"
                    className={`text-sm ${
                      errors.confirmPassword ? "border-red-500" :
                      formData.password && formData.confirmPassword === formData.password ? "border-green-500" : ""
                    }`}
                  />
                  {formData.password && formData.confirmPassword === formData.password && !errors.confirmPassword && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Passwords match
                    </p>
                  )}
                  {errors.confirmPassword && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Personal Information */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Personal Information
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Enter contributor details and assign role
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

                {/* First & Last Name */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="first_name" className="text-xs font-semibold text-black">
                      First Name *
                    </Label>
                    <Input
                      id="first_name"
                      name="first_name"
                      value={formData.first_name}
                      onChange={handleInputChange}
                      placeholder="First name"
                      className={`text-sm ${
                        errors.first_name ? "border-red-500" : formData.first_name ? "border-green-500" : ""
                      }`}
                    />
                    {errors.first_name && (
                      <p className="text-xs text-red-700">{errors.first_name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="last_name" className="text-xs font-semibold text-black">
                      Last Name *
                    </Label>
                    <Input
                      id="last_name"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleInputChange}
                      placeholder="Last name"
                      className={`text-sm ${
                        errors.last_name ? "border-red-500" : formData.last_name ? "border-green-500" : ""
                      }`}
                    />
                    {errors.last_name && (
                      <p className="text-xs text-red-700">{errors.last_name}</p>
                    )}
                  </div>
                </div>

                {/* Role Selection */}
                <div className="space-y-2">
                  <Label htmlFor="sub_role" className="text-xs font-semibold text-black">
                    Role *
                  </Label>
                  <select
                    id="sub_role"
                    name="sub_role"
                    value={formData.sub_role}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-0"
                  >
                    {roles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  {errors.sub_role && (
                    <p className="text-xs text-red-700">{errors.sub_role}</p>
                  )}
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
              disabled={loading || checkingUsername || checkingEmail}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Contributor"
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
