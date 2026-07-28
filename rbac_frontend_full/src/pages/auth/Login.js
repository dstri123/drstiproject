import { useState } from "react";
import API from "../../api/axios";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import { useToast } from "../../components/ToastContainer";

export default function Login() {
  const [form, setForm] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const navigate = useNavigate();
  const { error: showError, success } = useToast();

  const login = async () => {
    setErrors({});

    if (!form.username?.trim()) {
      setErrors({ username: "Username is required" });
      return;
    }

    if (!form.password?.trim()) {
      setErrors({ password: "Password is required" });
      return;
    }

    setLoading(true);

    try {
      const res = await API.post("auth/login/", {
        username: form.username,
        password: form.password,
      });

      localStorage.setItem("token", res.data.access);
      localStorage.setItem("refresh", res.data.refresh);

      // Extract role from user object or fallback to top-level
      const userRole = res.data.user?.role || res.data.role || "";
      const role = userRole.toString().toLowerCase();

      localStorage.setItem("role", role);

      const roleRoutes = {
        superadmin: "/superadmin/organizations",
        admin: "/admin/projects",
        member: "/member/dashboard",
        project_manager: "/manager",
        project_engineer: "/engineer",
        data_contributor: "/data",
      };

      if (!roleRoutes[role]) {
        showError("Unauthorized role");
        return;
      }

      if (role === "superadmin") {
        const check = await API.get("check-admin/");
        navigate(
          check.data.admin_exists
            ? "/superadmin/organizations"
            : "/superadmin/organizations/create"
        );
        return;
      }

      success("Login successful! Redirecting...");
      setTimeout(() => navigate(roleRoutes[role]), 500);
    } catch (err) {
      const errorMsg =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        "Login failed. Please check your credentials.";

      showError(errorMsg);
      setErrors({ submit: errorMsg });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      login();
    }
  };

  return (
    <div className="min-h-screen flex bg-white overflow-hidden">
      {/* Left Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <img src="/distri-logo.png" alt="Distri Logo" className="h-24 mx-auto mb-4 object-contain" />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-black">Distri</h1>
          <p className="text-sm text-gray-600 mt-1">Next Generation Progress Analytics</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-lg p-8 border border-gray-200 shadow-sm">
          <h2 className="text-lg font-bold text-black mb-2">Sign in to account</h2>
          <p className="text-sm text-gray-600 mb-6">
            Enter your username and password below
          </p>

          {/* Error Message */}
          {errors.submit && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 mb-4">
              <p className="text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errors.submit}
              </p>
            </div>
          )}

          <div className="space-y-4">
            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium text-black">
                Username or Email
              </Label>
              <Input
                id="username"
                placeholder="Enter your username"
                value={form.username || ""}
                onChange={(e) => {
                  setForm({ ...form, username: e.target.value });
                  if (errors.username) setErrors({ ...errors, username: "" });
                }}
                onKeyPress={handleKeyPress}
                className={`text-sm border-gray-300 ${
                  errors.username ? "border-red-500" : ""
                }`}
                disabled={loading}
              />
              {errors.username && (
                <p className="text-xs text-red-600">{errors.username}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-black">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-xs text-gray-600 hover:text-black transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={form.password || ""}
                  onChange={(e) => {
                    setForm({ ...form, password: e.target.value });
                    if (errors.password) setErrors({ ...errors, password: "" });
                  }}
                  onKeyPress={handleKeyPress}
                  className={`text-sm border-gray-300 pr-10 ${
                    errors.password ? "border-red-500" : ""
                  }`}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password}</p>
              )}
            </div>

            {/* Sign In Button */}
            <Button
              onClick={login}
              disabled={loading}
              className="w-full bg-black hover:bg-gray-900 text-white font-semibold text-base py-2.5 rounded-lg transition-all mt-6"
            >
              {loading ? "Signing in..." : "Sign in to account"}
            </Button>
          </div>

        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-6">
          Secure login with encrypted connection
        </p>
      </div>
      </div>

      {/* Right Side - BIM Image HD (Hidden on Mobile) */}
      <div className="hidden lg:flex w-1/2 bg-white items-center justify-center relative overflow-auto p-6">
        <img
          src="/bim-layers.png"
          alt="BIM Layers - Distri"
          className="w-4/5 h-auto object-contain"
          loading="lazy"
        />
      </div>
    </div>
  );
}
