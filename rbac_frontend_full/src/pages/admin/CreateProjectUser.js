import { useMemo, useState } from "react";
import API from "../../api/axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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

export default function CreateProjectUser() {
  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    sub_role: "",
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

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
  const canSubmit =
    !loading &&
    form.username.trim().length > 0 &&
    isPasswordValid &&
    passwordsMatch &&
    form.sub_role;

  const handleChange = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
  };

  const handleCreateUser = async () => {
    if (loading) return;

    if (!isPasswordValid) {
      return setMessage({
        type: "error",
        text: "Please enter a strong password before creating the user ❌",
      });
    }

    if (!passwordsMatch) {
      return setMessage({ type: "error", text: "Passwords do not match ❌" });
    }

    if (!form.sub_role) {
      return setMessage({ type: "warning", text: "Please select role ⚠️" });
    }

    try {
      setLoading(true);
      setMessage(null);

      await API.post(
        "create-user-assign/",
        {
          username: form.username,
          password: form.password,
          sub_role: form.sub_role,
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );

      setMessage({ type: "success", text: "Created Successfully ✅" });

      setForm({
        username: "",
        password: "",
        confirmPassword: "",
        sub_role: "",
      });

      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: "error", text: "Error ❌" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center mt-10">
      <Card className="w-[400px] shadow-md border-0 sm:border sm:border-border">
        <CardHeader>
          <CardTitle>Add Project Contributor</CardTitle>
        </CardHeader>
        <CardContent>
          {message && (
            <div
              className={`mb-4 px-4 py-3 rounded-md text-sm font-medium ${
                message.type === "error"
                  ? "bg-destructive/10 text-destructive"
                  : message.type === "warning"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-green-100 text-green-800"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={form.username}
                onChange={handleChange("username")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={handleChange("password")}
              />

              {!isPasswordValid ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 shadow-sm sm:text-base">
                  <p className="mb-3 font-medium text-slate-900">
                    Password must contain:
                  </p>
                  <div className="grid gap-2">
                    {passwordValidation.map((rule) => (
                      <div key={rule.key} className="flex items-center gap-2">
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold ${
                            rule.valid
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-slate-300 bg-white text-slate-400"
                          }`}
                        >
                          {rule.valid ? "✓" : ""}
                        </span>
                        <span
                          className={
                            rule.valid ? "text-slate-900" : "text-slate-500"
                          }
                        >
                          {rule.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                  Strong Password ✅
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={form.confirmPassword}
                onChange={handleChange("confirmPassword")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Select Role</Label>
              <select
                id="role"
                value={form.sub_role}
                onChange={handleChange("sub_role")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  Select a role...
                </option>
                <option value="project_manager">Project Manager</option>
                <option value="project_engineer">Project Engineer</option>
                <option value="data_contributor">Data Contributor</option>
              </select>
            </div>

            <Button
              className="w-full mt-2"
              onClick={handleCreateUser}
              disabled={!canSubmit}
            >
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
