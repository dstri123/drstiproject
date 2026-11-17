import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API from "../../api/axios";
import CreateUser from "./CreateUser";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

async function fill({ username = "bob", password = "pw1", confirm = "pw1", role = "project_engineer" } = {}) {
  if (username) await userEvent.type(screen.getByLabelText("Username"), username);
  if (password) await userEvent.type(screen.getByLabelText("Password"), password);
  if (confirm) await userEvent.type(screen.getByLabelText("Confirm Password"), confirm);
  if (role) await userEvent.selectOptions(screen.getByLabelText("Select Role"), role);
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "Create" }));

test("offers exactly the three member roles", () => {
  render(<CreateUser />);
  const values = Array.from(screen.getByLabelText("Select Role").options).map((o) => o.value);
  expect(values).toEqual(["", "project_manager", "project_engineer", "data_contributor"]);
});

test("passwords must match", async () => {
  render(<CreateUser />);
  await fill({ confirm: "other" });
  await submit();
  expect(screen.getByText(/Passwords do not match/)).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test("a role is required", async () => {
  render(<CreateUser />);
  await fill({ role: null });
  await submit();
  expect(screen.getByText(/Please select role/)).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test("creates the user, shows success and resets the form", async () => {
  localStorage.setItem("token", "tok");
  API.post.mockResolvedValue({ data: {} });
  render(<CreateUser />);
  await fill();
  await submit();
  expect(API.post).toHaveBeenCalledWith(
    "create-user-assign/",
    { username: "bob", password: "pw1", sub_role: "project_engineer" },
    { headers: { Authorization: "Bearer tok" } },
  );
  expect(await screen.findByText(/Created Successfully/)).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toHaveValue("");
  expect(screen.getByLabelText("Select Role")).toHaveValue("");
});

test("success message clears itself after 3s", async () => {
  jest.useFakeTimers();
  try {
    API.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<CreateUser />);
    await user.type(screen.getByLabelText("Username"), "bob");
    await user.selectOptions(screen.getByLabelText("Select Role"), "data_contributor");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/Created Successfully/)).toBeInTheDocument();
    jest.advanceTimersByTime(3000);
    await waitFor(() => expect(screen.queryByText(/Created Successfully/)).not.toBeInTheDocument());
  } finally {
    jest.useRealTimers();
  }
});

test("shows the server error, or a fallback", async () => {
  API.post.mockRejectedValueOnce({ response: { data: { error: "Username already exists" } } });
  render(<CreateUser />);
  await fill();
  await submit();
  expect(await screen.findByText("Username already exists")).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toHaveValue("bob"); // kept for correction

  API.post.mockRejectedValueOnce(new Error("network"));
  await submit();
  expect(await screen.findByText(/Error creating user/)).toBeInTheDocument();
});

test("button is disabled while creating", async () => {
  let resolve;
  API.post.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<CreateUser />);
  await fill();
  await submit();
  expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
  resolve({ data: {} });
  expect(await screen.findByRole("button", { name: "Create" })).toBeEnabled();
  expect(API.post).toHaveBeenCalledTimes(1);
});
