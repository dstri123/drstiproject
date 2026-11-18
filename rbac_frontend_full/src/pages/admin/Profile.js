import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Loader2, Camera } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB

const initialForm = {
  username: "",
  email: "",
  first_name: "",
  last_name: "",
  bio: "",
  avatar_url: "",
};

export default function AdminProfile() {
  const { success, error } = useToast();

  const [form, setForm] = useState(initialForm);
  const [roleLabel, setRoleLabel] = useState("");
  // Only the Super Admin may change their email address (also enforced by the API).
  const [canEditEmail, setCanEditEmail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const fileInputRef = useRef(null);

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
        setCanEditEmail(String(rawRole).toLowerCase() === "superadmin");
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
          avatar_url: res.data?.avatar_url || "",
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

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      error("Please upload a valid image file.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      error("Image must be smaller than 5MB.");
      e.target.value = "";
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setAvatarPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const isEmailValid = useMemo(
    () => !canEditEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()),
    [canEditEmail, form.email],
  );

  const isFormValid = useMemo(
    () =>
      Boolean(form.first_name.trim()) &&
      Boolean(form.last_name.trim()) &&
      isEmailValid,
    [form.first_name, form.last_name, isEmailValid],
  );

  const handleSubmit = async () => {
    setErrors({});
    setSuccessMessage("");

    if (!isFormValid) {
      const newErrors = {};
      if (!form.first_name.trim()) newErrors.first_name = "First name is required";
      if (!form.last_name.trim()) newErrors.last_name = "Last name is required";
      if (!isEmailValid) {
        newErrors.email = form.email.trim() ? "Enter a valid email address" : "Email is required";
      }
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("first_name", form.first_name.trim());
      formData.append("last_name", form.last_name.trim());
      formData.append("bio", form.bio.trim());
      if (canEditEmail) {
        formData.append("email", form.email.trim());
      }
      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }

      const res = await API.put("profile/update/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.data?.access) {
        localStorage.setItem("token", res.data.access);
      }
      if (res.data?.refresh) {
        localStorage.setItem("refresh", res.data.refresh);
      }

      const newAvatarUrl = res.data?.avatar_url || form.avatar_url;

      // Update localStorage with new profile data and trigger sidebar refresh
      localStorage.setItem("profileUpdated", JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        bio: form.bio.trim(),
        avatar_url: newAvatarUrl,
        timestamp: new Date().getTime(),
      }));

      // Dispatch event to trigger sidebar profile refresh
      window.dispatchEvent(new CustomEvent("profileUpdated", {
        detail: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          bio: form.bio.trim(),
          avatar_url: newAvatarUrl,
          email: res.data?.email,
        }
      }));

      setForm((prev) => ({
        ...prev,
        email: res.data?.email ?? prev.email,
        avatar_url: newAvatarUrl,
      }));
      setAvatarFile(null);
      setAvatarPreview("");

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

      <div className="-mt-4 -mx-4 sm:-mx-6 -mb-6 px-4 sm:px-6 py-8 min-h-[calc(100vh-4rem)] bg-white">
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
                  <div className="relative w-full min-h-80 rounded-lg overflow-hidden shadow-lg">
                    {avatarPreview || form.avatar_url ? (
                      <img
                        src={avatarPreview || form.avatar_url}
                        alt="Profile avatar"
                        className="w-full h-80 object-cover"
                      />
                    ) : (
                      <div className="w-full min-h-80 bg-gradient-to-br from-black to-gray-800 flex items-center justify-center text-9xl font-bold text-white">
                        {initials}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-white/95 px-3 py-1.5 text-xs font-semibold text-black shadow-md hover:bg-white transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Change photo
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-600 font-medium">
                      {form.first_name} {form.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      @{form.username}
                    </p>
                    {avatarFile && (
                      <p className="text-xs text-gray-700 mt-1">
                        New photo selected — click "Save Changes" to apply.
                      </p>
                    )}
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

                    {/* Email - editable by Super Admin only */}
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-xs font-semibold text-black">
                        Email address{canEditEmail ? " *" : ""}
                      </Label>
                      {canEditEmail ? (
                        <Input
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@company.com"
                          value={form.email || ""}
                          onChange={(e) => handleChange("email", e.target.value)}
                          className={`text-sm border-gray-300 ${errors.email ? "border-red-700" : ""}`}
                        />
                      ) : (
                        <Input
                          id="email"
                          type="email"
                          value={form.email || ""}
                          disabled
                          title="Only the Super Admin can change the email address"
                          className="text-sm border-gray-300 bg-gray-100 cursor-not-allowed"
                        />
                      )}
                      {errors.email && <p className="text-xs text-red-700">{errors.email}</p>}
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
