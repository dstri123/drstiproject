import { useMemo, useState } from "react";
import API from "../../api/axios";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Zap, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { generateStrongPassword } from "../../utils/passwordGenerator";
import { useCheckUsername, useCheckEmail } from "../../hooks/useCheckUsername";
import { useToast } from "../../components/ToastContainer";

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

export default function Signup() {
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  const {
    checking: checkingUsername,
    isAvailable: usernameAvailable,
    message: usernameMessage,
    debouncedCheck: checkUsername,
  } = useCheckUsername();
  const {
    checking: checkingEmail,
    isAvailable: emailAvailable,
    message: emailMessage,
    debouncedCheck: checkEmail,
  } = useCheckEmail();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordValidation = useMemo(() => {
    return passwordRules.map((rule) => ({
      ...rule,
      valid: rule.test(form.password),
    }));
  }, [form.password]);

  const validPasswordCount = passwordValidation.filter(
    (rule) => rule.valid
  ).length;
  const isPasswordValid = passwordValidation.every((rule) => rule.valid);
  const passwordsMatch = form.password === form.confirmPassword;
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const canSubmit =
    form.username.trim().length > 0 &&
    usernameAvailable === true &&
    isEmailValid &&
    emailAvailable === true &&
    isPasswordValid &&
    passwordsMatch;

  const generatePassword = () => {
    const newPassword = generateStrongPassword();
    setForm({
      ...form,
      password: newPassword,
      confirmPassword: newPassword,
    });
  };

  const signup = async () => {
    if (!form.username.trim()) {
      showError("Username is required");
      return;
    }

    if (!isEmailValid) {
      showError("Please enter a valid email address");
      return;
    }

    if (!isPasswordValid) {
      showError("Password does not meet requirements");
      return;
    }

    if (!passwordsMatch) {
      showError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      await API.post("auth/signup/", {
        username: form.username,
        email: form.email,
        password: form.password,
      });

      success("Account created successfully! Redirecting to login...");
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        "Signup failed. Please try again.";

      showError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && canSubmit) {
      signup();
    }
  };

  return (
    <div className="min-h-screen flex bg-white overflow-hidden">
      {/* Left Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <img src="/distri-logo.png" alt="Distri Logo" className="h-24 mx-auto mb-4 object-contain" />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-black">Distri</h1>
          <p className="text-sm text-gray-600 mt-1">Next Generation Progress Analytics</p>
        </div>

        {/* Signup Form */}
        <div className="bg-white rounded-lg p-8 border border-gray-200 shadow-sm">
          <h2 className="text-lg font-bold text-black mb-2">Create account</h2>
          <p className="text-sm text-gray-600 mb-6">
            Get started with Distri Platform
          </p>

          <div className="space-y-4">
            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium text-black">
                Username
              </Label>
              <Input
                id="username"
                placeholder="Choose a username"
                value={form.username}
                onChange={(e) => {
                  setForm({ ...form, username: e.target.value });
                  checkUsername(e.target.value);
                }}
                className={`text-sm border-gray-300 ${
                  usernameAvailable === false
                    ? "border-red-500"
                    : usernameAvailable === true
                      ? "border-green-500"
                      : ""
                }`}
                disabled={loading}
              />
              {checkingUsername && (
                <p className="text-xs text-gray-600 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Checking availability...
                </p>
              )}
              {usernameAvailable === true && form.username && (
                <p className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {usernameMessage}
                </p>
              )}
              {usernameAvailable === false && (
                <p className="text-xs text-red-700 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {usernameMessage}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-black">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  checkEmail(e.target.value);
                }}
                className={`text-sm border-gray-300 ${
                  emailAvailable === false
                    ? "border-red-500"
                    : emailAvailable === true
                      ? "border-green-500"
                      : ""
                }`}
                disabled={loading}
              />
              {checkingEmail && (
                <p className="text-xs text-gray-600 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Checking availability...
                </p>
              )}
              {emailAvailable === true && form.email && (
                <p className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {emailMessage}
                </p>
              )}
              {emailAvailable === false && (
                <p className="text-xs text-red-700 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {emailMessage}
                </p>
              )}
              {form.email && !isEmailValid && emailAvailable !== false && (
                <p className="text-xs text-red-700">Please enter a valid email address</p>
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
                  onClick={generatePassword}
                  disabled={loading}
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
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  onKeyPress={handleKeyPress}
                  className="text-sm border-gray-300 pr-10"
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

              {form.password && !isPasswordValid && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 font-medium text-xs text-black">
                    Password requirements:
                  </p>
                  <div className="space-y-1">
                    {passwordValidation.map((rule) => (
                      <div key={rule.key} className="flex items-center gap-2">
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold ${
                            rule.valid
                              ? "border-black bg-black text-white"
                              : "border-gray-300 bg-white text-gray-400"
                          }`}
                        >
                          {rule.valid ? "✓" : ""}
                        </div>
                        <span
                          className={`text-xs ${
                            rule.valid ? "text-black" : "text-gray-500"
                          }`}
                        >
                          {rule.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.password && isPasswordValid && (
                <p className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Strong password ✓
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-black">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                onKeyPress={handleKeyPress}
                className={`text-sm border-gray-300 ${
                  form.confirmPassword && !passwordsMatch ? "border-red-500" : ""
                }`}
                disabled={loading}
              />
              {form.confirmPassword && !passwordsMatch && (
                <p className="text-xs text-red-700 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Passwords do not match
                </p>
              )}
              {form.confirmPassword && passwordsMatch && isPasswordValid && (
                <p className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Passwords match
                </p>
              )}
            </div>

            {/* Create Account Button */}
            <Button
              onClick={signup}
              disabled={!canSubmit || loading}
              className="w-full bg-black hover:bg-gray-900 text-white font-semibold text-base py-2.5 rounded-lg transition-all mt-6 disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </div>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => navigate("/")}
                className="text-black font-semibold hover:underline transition-colors"
              >
                Sign in →
              </button>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-6">
          Secure registration with encrypted connection
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
