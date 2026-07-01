import { useState } from "react";
import API from "../../api/axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function CreateUser() {
  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    sub_role: "",
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleChange = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
  };

  const createUser = async () => {
    if (loading) return;

    if (form.password !== form.confirmPassword) {
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
      setMessage({
        type: "error",
        text: err.response?.data?.error || "Error creating user ❌",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center mt-10">
      <Card className="w-[400px] shadow-md border-0 sm:border sm:border-border">
        <CardHeader>
          <CardTitle>Create User</CardTitle>
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
              onClick={createUser}
              disabled={loading}
            >
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
