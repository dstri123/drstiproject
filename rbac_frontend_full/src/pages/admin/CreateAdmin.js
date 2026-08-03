import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Copy, CheckCircle2, AlertCircle, ArrowLeft, Zap, Loader } from "lucide-react";
import { useNavigate } from "react-router-dom";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import { generateStrongPassword } from "../../utils/passwordGenerator";
import { useCheckUsername, useCheckEmail } from "../../hooks/useCheckUsername";

const passwordRules = [
  {
    key: "length",
    label: "At least 8 characters",
    test: (value) => value.length >= 8,
  },
  {
    key: "uppercase",
    label: "At least one uppercase letter",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    key: "lowercase",
    label: "At least one lowercase letter",
    test: (value) => /[a-z]/.test(value),
  },
  {
    key: "number",
    label: "At least one number",
    test: (value) => /[0-9]/.test(value),
  },
  {
    key: "special",
    label: "At least one special character",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
];

export default function CreateOrganization() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const { checking: checkingUsername, isAvailable: usernameAvailable, message: usernameMessage, debouncedCheck: checkUsername } = useCheckUsername();
  const { checking: checkingEmail, isAvailable: emailAvailable, message: emailMessage, debouncedCheck: checkEmail } = useCheckEmail();

  const [form, setForm] = useState({
    organization_name: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [createdCredentials, setCreatedCredentials] = useState(null);

  const passwordValidation = useMemo(
    () =>
      passwordRules.map((rule) => ({
        ...rule,
        valid: rule.test(form.password),
      })),
    [form.password],
  );

  const isPasswordValid = passwordValidation.every((rule) => rule.valid);
  const passwordsMatch = form.password === form.confirmPassword;

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);

  const canSubmit =
    form.organization_name.trim().length > 0 &&
    form.username.trim().length > 0 &&
    usernameAvailable === true &&
    isEmailValid &&
    emailAvailable === true &&
    isPasswordValid &&
    passwordsMatch &&
    form.confirmPassword.trim().length > 0;

  const copyCredentials = () => {
    if (!createdCredentials) return;
    navigator.clipboard.writeText(
      `Organization: ${createdCredentials.organization}\nUsername: ${createdCredentials.username}\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`,
    );
    success("Credentials copied to clipboard ✓");
  };

  const validateForm = () => {
    const newErrors = {};

    if (!form.organization_name.trim()) {
      newErrors.organization_name = "Organization name is required";
    }

    if (!form.username.trim()) {
      newErrors.username = "Username is required";
    }

    if (!form.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!isEmailValid) {
      newErrors.email = "Invalid email address";
    }

    if (!form.password) {
      newErrors.password = "Password is required";
    } else if (!isPasswordValid) {
      newErrors.password = "Password does not meet complexity requirements";
    }

    if (!form.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const createOrg = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await API.post("auth/create-admin/", {
        organization_name: form.organization_name,
        username: form.username,
        email: form.email,
        password: form.password,
      });

      // Store credentials for display
      setCreatedCredentials({
        organization: form.organization_name,
        username: form.username,
        email: form.email,
        password: form.password,
      });

      // Show success toast
      success("✓ Organization created successfully! Copy your credentials below.");

      // Reset form
      setForm({
        organization_name: "",
        username: "",
        email: "",
        password: "",
        confirmPassword: "",
      });
      setErrors({});
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        "Something went wrong";

      setErrors({ submit: msg });
      error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) {
      setErrors({ ...errors, [field]: "" });
    }

    // Check username/email availability
    if (field === "username") {
      checkUsername(value);
    } else if (field === "email") {
      checkEmail(value);
    }
  };

  const generatePassword = () => {
    const newPassword = generateStrongPassword();
    setForm({
      ...form,
      password: newPassword,
      confirmPassword: newPassword,
    });
    success("Strong password generated!");
  };

  return (
    <>
      <Topbar />

      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => navigate("/superadmin/organizations")}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Organizations
          </button>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">
              Create Organization
            </h1>
            <p className="text-sm text-gray-600">
              Set up your organization with admin credentials to get started
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
                Enter the name for your new organization
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="organization_name" className="text-xs font-semibold text-black">
                    Organization Name
                  </Label>
                  <Input
                    id="organization_name"
                    placeholder="e.g., Acme Corporation"
                    value={form.organization_name}
                    onChange={(e) => handleInputChange("organization_name", e.target.value)}
                    className={`text-sm border-gray-300 ${
                      errors.organization_name ? "border-red-700 focus:border-red-700" : form.organization_name.trim().length > 0 ? "border-green-600" : ""
                    }`}
                  />
                  {form.organization_name.trim().length > 0 && !errors.organization_name && (
                    <p className="text-xs text-green-700 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Organization name is valid
                    </p>
                  )}
                  {errors.organization_name && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.organization_name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Admin Credentials */}
            <div>
              <h2 className="text-base font-semibold text-black mb-3">
                Admin Credentials
              </h2>
              <p className="text-xs text-gray-600 mb-5">
                Create admin login credentials to manage the organization
              </p>

              <div className="space-y-4">
                {/* Admin Username */}
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-xs font-semibold text-black">
                    Admin Username
                  </Label>
                  <Input
                    id="username"
                    placeholder="e.g., john_admin"
                    value={form.username}
                    onChange={(e) => handleInputChange("username", e.target.value)}
                    className={`text-sm border-gray-300 ${
                      errors.username ? "border-red-700 focus:border-red-700" : usernameAvailable === false ? "border-red-700" : usernameAvailable === true ? "border-green-600" : ""
                    }`}
                  />
                  {checkingUsername && (
                    <p className="text-xs text-gray-600 flex items-center gap-1 mt-1">
                      <Loader className="w-3 h-3 animate-spin" />
                      Checking...
                    </p>
                  )}
                  {usernameAvailable === true && form.username && (
                    <p className="text-xs text-green-700 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {usernameMessage}
                    </p>
                  )}
                  {usernameAvailable === false && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {usernameMessage}
                    </p>
                  )}
                  {errors.username && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.username}
                    </p>
                  )}
                </div>

                {/* Email Address */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-semibold text-black">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="e.g., admin@organization.com"
                    value={form.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    className={`text-sm border-gray-300 ${
                      errors.email ? "border-red-700 focus:border-red-700" : emailAvailable === false ? "border-red-700" : emailAvailable === true ? "border-green-600" : ""
                    }`}
                  />
                  {checkingEmail && (
                    <p className="text-xs text-gray-600 flex items-center gap-1 mt-1">
                      <Loader className="w-3 h-3 animate-spin" />
                      Checking...
                    </p>
                  )}
                  {emailAvailable === true && form.email && (
                    <p className="text-xs text-green-700 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {emailMessage}
                    </p>
                  )}
                  {emailAvailable === false && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {emailMessage}
                    </p>
                  )}
                  {form.email && !isEmailValid && emailAvailable !== false && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      Invalid email format. Must include domain (e.g., admin@company.com)
                    </p>
                  )}
                  {errors.email && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.email}
                    </p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs font-semibold text-black">
                      Password
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
                      type={showPassword ? "text" : "password"}
                      placeholder="Create a strong password"
                      value={form.password}
                      onChange={(e) => handleInputChange("password", e.target.value)}
                      className={`text-sm border-gray-300 pr-10 ${
                        errors.password ? "border-red-700 focus:border-red-700" : ""
                      }`}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
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
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.password}
                    </p>
                  )}

                  {/* Password Requirements */}
                  {form.password && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="mb-2 font-semibold text-black text-xs">
                        Password Requirements:
                      </p>
                      <div className="grid gap-1.5">
                        {passwordValidation.map((rule) => (
                          <div key={rule.key} className="flex items-center gap-2">
                            {rule.valid ? (
                              <CheckCircle2 className="w-3 h-3 text-black flex-shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0" />
                            )}
                            <span
                              className={`text-xs ${
                                rule.valid ? "text-black font-medium" : "text-gray-500"
                              }`}
                            >
                              {rule.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-xs font-semibold text-black">
                    Confirm Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter your password"
                    value={form.confirmPassword}
                    onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
                    className={`text-sm border-gray-300 ${
                      errors.confirmPassword ? "border-red-700 focus:border-red-700" : ""
                    }`}
                  />
                  {form.confirmPassword && form.password !== form.confirmPassword && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      Passwords do not match
                    </p>
                  )}
                  {errors.confirmPassword && (
                    <p className="text-xs text-red-700 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.confirmPassword}
                    </p>
                  )}
                  {form.confirmPassword && form.password === form.confirmPassword && (
                    <p className="text-xs text-green-700 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Passwords match ✓
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Submit Error - Full Width */}
          {errors.submit && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 mt-8 mb-4">
              <p className="text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errors.submit}
              </p>
            </div>
          )}

          {/* Submit Button - Full Width */}
          <div className="mt-8 space-y-3">
            <Button
              className="w-full px-4 py-2 bg-black hover:bg-gray-900 text-white rounded-md font-medium text-sm disabled:opacity-50"
              onClick={createOrg}
              disabled={!canSubmit || loading}
            >
              {loading ? "Creating Organization..." : "Create Organization"}
            </Button>

            {!canSubmit && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <p className="text-xs text-yellow-900 font-medium mb-2">
                  ⚠️ Please complete the following:
                </p>
                <ul className="text-xs text-yellow-800 space-y-1">
                  {!form.organization_name.trim() && (
                    <li>• Organization name is required</li>
                  )}
                  {!form.username.trim() && (
                    <li>• Admin username is required</li>
                  )}
                  {form.username.trim() && usernameAvailable === false && (
                    <li>• Choose a different username (already taken)</li>
                  )}
                  {!form.email.trim() && (
                    <li>• Email address is required</li>
                  )}
                  {form.email.trim() && !isEmailValid && (
                    <li>• Enter a valid email (e.g., admin@company.com)</li>
                  )}
                  {form.email.trim() && isEmailValid && emailAvailable === false && (
                    <li>• Choose a different email (already in use)</li>
                  )}
                  {!form.password && (
                    <li>• Password is required</li>
                  )}
                  {form.password && !isPasswordValid && (
                    <li>• Password must meet all requirements</li>
                  )}
                  {form.password && form.confirmPassword && form.password !== form.confirmPassword && (
                    <li>• Passwords must match</li>
                  )}
                  {!form.confirmPassword && form.password && (
                    <li>• Confirm password is required</li>
                  )}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-600 text-center">
              All fields are required and passwords must meet security requirements
            </p>
          </div>
        </div>
      </div>

      {/* Credentials Display (after successful creation) */}
      {createdCredentials && (
        <div className="mt-8 rounded-lg border-2 border-green-200 bg-green-50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-700" />
            <h3 className="text-lg font-bold text-green-900">Organization Created Successfully!</h3>
          </div>

          <p className="text-sm text-green-800 mb-4">
            ✓ Save these credentials securely. You'll need them to manage your organization.
          </p>

          <div className="space-y-3 mb-4">
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Organization</p>
              <p className="text-sm font-medium text-black">{createdCredentials.organization}</p>
            </div>
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Admin Username</p>
              <p className="text-sm font-medium text-black">{createdCredentials.username}</p>
            </div>
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Email Address</p>
              <p className="text-sm font-medium text-black">{createdCredentials.email}</p>
            </div>
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Password</p>
              <p className="text-sm font-mono text-black bg-gray-100 p-2 rounded border border-gray-300">
                {createdCredentials.password}
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              className="flex-1 bg-black hover:bg-gray-900 text-white font-medium"
              onClick={copyCredentials}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy All Credentials
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-green-300 text-green-700 hover:bg-green-100"
              onClick={() => {
                setCreatedCredentials(null);
                navigate("/superadmin/organizations");
              }}
            >
              View Organizations
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
