import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Zap } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import { generateStrongPassword } from "../../utils/passwordGenerator";

const initialForm = {
  username: "",
  email: "",
  first_name: "",
  last_name: "",
  bio: "",
  password: "",
  confirmPassword: "",
};

export default function AdminProfile() {
  const { success, error } = useToast();

  const [form, setForm] = useState(initialForm);
  const [roleLabel, setRoleLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setErrors({});
      try {
        const res = await API.get("profile/");

        const rawRole =
          res.data?.sub_role ||
          res.data?.role ||
          localStorage.getItem("role") ||
          "";
        const normalizedRole = String(rawRole).replaceAll("_", " ").trim();
        setRoleLabel(
          normalizedRole
            ? normalizedRole.replace(/\b\w/g, (char) => char.toUpperCase())
            : "User",
        );
        setForm((prev) => ({
          ...prev,
          username: res.data?.username || "",
          email: res.data?.email || "",
          first_name: res.data?.first_name || "",
          last_name: res.data?.last_name || "",
          bio: res.data?.bio || "",
          password: "",
          confirmPassword: "",
        }));
      } catch (err) {
        setErrors({
          submit: err?.response?.data?.error || err?.response?.data?.detail || "Failed to load profile. Please log in again.",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const generatePassword = () => {
    const newPassword = generateStrongPassword();
    setForm((prev) => ({
      ...prev,
      password: newPassword,
      confirmPassword: newPassword,
    }));
    success("Strong password generated!");
  };

  const passwordMismatch = useMemo(
    () =>
      form.password &&
      form.confirmPassword &&
      form.password !== form.confirmPassword,
    [form.password, form.confirmPassword],
  );

  const isPasswordPairValid = useMemo(() => {
    if (!form.password && !form.confirmPassword) return true;
    return (
      Boolean(form.password) &&
      Boolean(form.confirmPassword) &&
      !passwordMismatch
    );
  }, [form.password, form.confirmPassword, passwordMismatch]);

  const isFormValid = useMemo(
    () =>
      Boolean(form.first_name.trim()) &&
      Boolean(form.last_name.trim()) &&
      isPasswordPairValid,
    [form.first_name, form.last_name, isPasswordPairValid],
  );

  const handleSubmit = async () => {
    setErrors({});
    setSuccessMessage("");

    if (!isFormValid) {
      const newErrors = {};
      if (!form.first_name.trim()) newErrors.first_name = "First name is required";
      if (!form.last_name.trim()) newErrors.last_name = "Last name is required";
      if (passwordMismatch) newErrors.confirmPassword = "Passwords do not match";
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const res = await API.put("profile/update/", {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        bio: form.bio.trim(),
        password: form.password || "",
      });

      if (res.data?.access) {
        localStorage.setItem("token", res.data.access);
      }

      // Update localStorage with new profile data and trigger sidebar refresh
      localStorage.setItem("profileUpdated", JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        bio: form.bio.trim(),
        timestamp: new Date().getTime(),
      }));

      // Dispatch event to trigger sidebar profile refresh
      window.dispatchEvent(new CustomEvent("profileUpdated", {
        detail: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          bio: form.bio.trim(),
        }
      }));

      setForm((prev) => ({
        ...prev,
        password: "",
        confirmPassword: "",
      }));

      success("Profile updated successfully!");
      setSuccessMessage("");
    } catch (err) {
      const backendData = err?.response?.data;
      const message =
        backendData?.error ||
        backendData?.detail ||
        (typeof backendData === "string" ? backendData : "") ||
        "Failed to update profile.";
      setErrors({ submit: message });
      error(message);
    } finally {
      setSaving(false);
    }
  };

  const initials = `${(form.first_name || "?").charAt(0)}${(form.last_name || "").charAt(0)}`;

  return (
    <>
      <Topbar />

      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">
              {form.first_name} Profile Settings
            </h1>
            <p className="text-sm text-gray-600">
              Update your personal information and manage your account
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-black" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column - Avatar */}
              <div className="lg:col-span-1">
                <h2 className="text-base font-semibold text-black mb-4">
                  Profile Avatar
                </h2>
                <div className="space-y-4">
                  <div className="w-full min-h-80 rounded-lg bg-gradient-to-br from-black to-gray-800 flex items-center justify-center text-9xl font-bold text-white shadow-lg">
                    {initials}
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-600 font-medium">
                      {form.first_name} {form.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      @{form.username}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Column - Form Fields */}
              <div className="lg:col-span-2 space-y-6">
                {/* Personal Information Section */}
                <div>
                  <h2 className="text-base font-semibold text-black mb-4">
                    Personal Information
                  </h2>
                  <p className="text-xs text-gray-600 mb-4">
                    Update your name and bio information
                  </p>

                  <div className="space-y-4">
                    {/* Username - Read Only */}
                    <div className="space-y-2">
                      <Label htmlFor="username" className="text-xs font-semibold text-black">
                        Username
                      </Label>
                      <Input
                        id="username"
                        value={form.username || ""}
                        disabled
                        className="text-sm border-gray-300 bg-gray-100 cursor-not-allowed"
                      />
                    </div>

                    {/* Email - Read Only */}
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-xs font-semibold text-black">
                        Email address
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={form.email || ""}
                        disabled
                        className="text-sm border-gray-300 bg-gray-100 cursor-not-allowed"
                      />
                    </div>

                    {/* First & Last Name */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="first_name" className="text-xs font-semibold text-black">
                          First name *
                        </Label>
                        <Input
                          id="first_name"
                          placeholder="John"
                          value={form.first_name}
                          onChange={(e) => handleChange("first_name", e.target.value)}
                          className={`text-sm border-gray-300 ${
                            errors.first_name ? "border-red-700" : ""
                          }`}
                        />
                        {errors.first_name && (
                          <p className="text-xs text-red-700">{errors.first_name}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="last_name" className="text-xs font-semibold text-black">
                          Last name *
                        </Label>
                        <Input
                          id="last_name"
                          placeholder="Doe"
                          value={form.last_name}
                          onChange={(e) => handleChange("last_name", e.target.value)}
                          className={`text-sm border-gray-300 ${
                            errors.last_name ? "border-red-700" : ""
                          }`}
                        />
                        {errors.last_name && (
                          <p className="text-xs text-red-700">{errors.last_name}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio" className="text-xs font-semibold text-black">
                      Bio / Description
                    </Label>
                    <textarea
                      id="bio"
                      placeholder="Tell us about yourself..."
                      value={form.bio}
                      onChange={(e) => handleChange("bio", e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:border-black focus:outline-none focus:ring-1 focus:ring-black/20"
                      rows="3"
                    />
                  </div>
                </div>

                {/* Security Section */}
                <div className="border-t border-gray-200 pt-6">
                  <h2 className="text-base font-semibold text-black mb-4">
                    Security
                  </h2>
                  <p className="text-xs text-gray-600 mb-4">
                    Change your password to keep your account secure
                  </p>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password" className="text-xs font-semibold text-black">
                          New Password
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
                          placeholder="Leave blank to keep existing password"
                          value={form.password}
                          onChange={(e) => handleChange("password", e.target.value)}
                          className="text-sm border-gray-300 pr-10"
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
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword" className="text-xs font-semibold text-black">
                        Confirm Password
                      </Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="Re-enter your password"
                        value={form.confirmPassword}
                        onChange={(e) => handleChange("confirmPassword", e.target.value)}
                        className={`text-sm border-gray-300 ${
                          errors.confirmPassword ? "border-red-700" : ""
                        }`}
                      />
                      {errors.confirmPassword && (
                        <p className="text-xs text-red-700">{errors.confirmPassword}</p>
                      )}
                      {form.password &&
                        form.confirmPassword &&
                        form.password === form.confirmPassword && (
                          <p className="text-xs text-gray-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-black" />
                            Passwords match
                          </p>
                        )}
                    </div>
                  </div>
                </div>

                {/* Messages and Submit */}
                <div>
                          {errors.submit && (
                    <div className="rounded-lg border border-red-300 bg-red-50 p-3 mb-4">
                      <p className="text-xs text-red-900 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {errors.submit}
                      </p>
                    </div>
                  )}

                  {successMessage && (
                    <div className="rounded-lg border border-gray-300 bg-gray-100 p-3 mb-4">
                      <p className="text-xs text-black flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-black" />
                        {successMessage}
                      </p>
                    </div>
                  )}

                  <Button
                    className="px-4 py-2 bg-black hover:bg-gray-900 text-white rounded-md font-medium text-sm w-full"
                    onClick={handleSubmit}
                    disabled={!isFormValid || saving || loading}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
