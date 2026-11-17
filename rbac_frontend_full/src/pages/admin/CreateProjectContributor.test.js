import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import CreateProjectContributor from "./CreateProjectContributor";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));
let mockUsername;
let mockEmail;
jest.mock("../../hooks/useCheckUsername", () => ({
  useCheckUsername: () => mockUsername,
  useCheckEmail: () => mockEmail,
}));
jest.mock("../../utils/passwordGenerator", () => ({ generateStrongPassword: () => "Gen3rated!Pw" }));

beforeEach(() => {
  mockUsername = { checking: false, isAvailable: true, debouncedCheck: jest.fn() };
  mockEmail = { checking: false, isAvailable: true, debouncedCheck: jest.fn() };
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/project-user/create"]}>
      <Routes>
        <Route path="/admin/project-user/create" element={<CreateProjectContributor />} />
        <Route path="/admin/project-user" element={<div>contributors list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const submit = () => screen.getByRole("button", { name: "Create Contributor" });

async function fill(user, v = {}) {
  const d = { username: "eng1", email: "e@x.com", first: "Eve", last: "Eng", password: "Passw0rd!", ...v };
  if (d.username) await user.type(screen.getByLabelText("Username *"), d.username);
  if (d.email) await user.type(screen.getByLabelText("Email Address *"), d.email);
  if (d.first) await user.type(screen.getByLabelText("First Name *"), d.first);
  if (d.last) await user.type(screen.getByLabelText("Last Name *"), d.last);
  if (d.password) await user.type(screen.getByLabelText("Password *"), d.password);
  const confirm = d.confirm ?? d.password;
  if (confirm) await user.type(screen.getByLabelText("Confirm Password *"), confirm);
}

test("empty submit shows all required-field errors", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(submit());
  for (const msg of ["Username is required", "Email is required", "First name is required", "Last name is required", "Password is required"]) {
    expect(screen.getByText(msg)).toBeInTheDocument();
  }
  expect(API.post).not.toHaveBeenCalled();
  // typing clears that field's error
  await user.type(screen.getByLabelText("Username *"), "a");
  expect(screen.queryByText("Username is required")).not.toBeInTheDocument();
});

test("taken username, invalid email, short and mismatched password", async () => {
  mockUsername = { ...mockUsername, isAvailable: false };
  const user = userEvent.setup();
  renderPage();
  await fill(user, { email: "bad@x", password: "short", confirm: "other" });
  await user.click(submit());
  expect(screen.getByText("Username is already taken")).toBeInTheDocument();
  expect(screen.getByText("Please enter a valid email address")).toBeInTheDocument();
  expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
  expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test("availability checks: username only from 3 chars, email on any input", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Username *"), "ab");
  expect(mockUsername.debouncedCheck).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Username *"), "c");
  expect(mockUsername.debouncedCheck).toHaveBeenLastCalledWith("abc");
  await user.type(screen.getByLabelText("Email Address *"), "e");
  expect(mockEmail.debouncedCheck).toHaveBeenLastCalledWith("e");
  expect(screen.getByText("Username is available")).toBeInTheDocument();
});

test("submit disabled while checking", () => {
  mockEmail = { ...mockEmail, checking: true };
  renderPage();
  expect(submit()).toBeDisabled();
});

test("Generate fills both passwords; eye toggles visibility", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: /generate/i }));
  expect(screen.getByLabelText("Password *")).toHaveValue("Gen3rated!Pw");
  expect(screen.getByLabelText("Confirm Password *")).toHaveValue("Gen3rated!Pw");
  expect(screen.getByText("Passwords match")).toBeInTheDocument();
  const pw = screen.getByLabelText("Password *");
  await user.click(pw.parentElement.querySelector("button"));
  expect(pw).toHaveAttribute("type", "text");
});

test("valid form posts trimmed payload with chosen role and redirects after 2s", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  API.post.mockResolvedValue({ data: {} });
  renderPage();
  await fill(user, { username: " eng1 ", email: " e@x.com", first: " Eve", last: "Eng " });
  await user.selectOptions(screen.getByLabelText("Role *"), "site_engineer");
  await user.click(submit());
  expect(API.post).toHaveBeenCalledWith("create-user-assign/", {
    username: "eng1",
    email: "e@x.com",
    password: "Passw0rd!",
    first_name: "Eve",
    last_name: "Eng",
    sub_role: "site_engineer",
  });
  expect(mockToast.success).toHaveBeenCalledWith("Project contributor created successfully!");
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText("contributors list")).toBeInTheDocument();
});

test("role defaults to project_engineer and offers admin", async () => {
  renderPage();
  expect(screen.getByLabelText("Role *")).toHaveValue("project_engineer");
  expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
});

test.each([
  [{ response: { data: { detail: "D" } } }, "D"],
  [{ response: { data: { error: "Username already exists" } } }, "Username already exists"],
  [{ response: { data: { message: "M" } } }, "M"],
  [{ response: { data: { username: ["bad"], email: ["dup"] } } }, "bad, dup"],
  [new Error("x"), "Failed to create contributor"],
])("API error %# is shown", async (err, msg) => {
  const user = userEvent.setup();
  API.post.mockRejectedValue(err);
  renderPage();
  await fill(user);
  await user.click(submit());
  expect(await screen.findByText(msg)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(msg);
});

test("Cancel and Back go to the contributors list", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: /back to contributors/i }));
  expect(screen.getByText("contributors list")).toBeInTheDocument();
});
