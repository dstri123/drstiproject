import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import CreateOrganization from "./CreateAdmin";

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
  mockUsername = { checking: false, isAvailable: true, message: "Username available", debouncedCheck: jest.fn() };
  mockEmail = { checking: false, isAvailable: true, message: "Email available", debouncedCheck: jest.fn() };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/superadmin/organizations/create"]}>
      <Routes>
        <Route path="/superadmin/organizations/create" element={<CreateOrganization />} />
        <Route path="/superadmin/organizations" element={<div>orgs list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const submitBtn = () => screen.getByRole("button", { name: /^create organization$/i });

async function fill(user, v = {}) {
  const d = { org: "Acme", username: "acme_admin", email: "a@acme.com", password: "Abcdef1!", confirm: undefined, ...v };
  if (d.org) await user.type(screen.getByLabelText("Organization Name"), d.org);
  if (d.username) await user.type(screen.getByLabelText("Admin Username"), d.username);
  if (d.email) await user.type(screen.getByLabelText("Email address"), d.email);
  if (d.password) await user.type(screen.getByLabelText("Password"), d.password);
  const confirm = d.confirm === undefined ? d.password : d.confirm;
  if (confirm) await user.type(screen.getByLabelText("Confirm Password"), confirm);
}

test("empty form: submit disabled and checklist lists what's missing", () => {
  renderPage();
  expect(submitBtn()).toBeDisabled();
  expect(screen.getByText("• Organization name is required")).toBeInTheDocument();
  expect(screen.getByText("• Admin username is required")).toBeInTheDocument();
  expect(screen.getByText("• Email address is required")).toBeInTheDocument();
  expect(screen.getByText("• Password is required")).toBeInTheDocument();
});

test("checklist reflects invalid email, taken username/email, weak and mismatched password", async () => {
  mockUsername = { ...mockUsername, isAvailable: false, message: "Username taken" };
  const user = userEvent.setup();
  renderPage();
  await fill(user, { email: "bad@x", password: "weak", confirm: "" });
  expect(screen.getByText("• Choose a different username (already taken)")).toBeInTheDocument();
  expect(screen.getByText("• Enter a valid email (e.g., admin@company.com)")).toBeInTheDocument();
  expect(screen.getByText(/Invalid email format/)).toBeInTheDocument();
  expect(screen.getByText("• Password must meet all requirements")).toBeInTheDocument();
  expect(screen.getByText("• Confirm password is required")).toBeInTheDocument();
  expect(screen.getByText("Username taken")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Confirm Password"), "other");
  expect(screen.getByText("• Passwords must match")).toBeInTheDocument();
  expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
});

test("email already in use blocks submit", async () => {
  mockEmail = { ...mockEmail, isAvailable: false, message: "Email in use" };
  const user = userEvent.setup();
  renderPage();
  await fill(user);
  expect(screen.getByText("• Choose a different email (already in use)")).toBeInTheDocument();
  expect(submitBtn()).toBeDisabled();
});

test("checking spinners show while availability is being checked", () => {
  mockUsername = { ...mockUsername, checking: true, isAvailable: null };
  mockEmail = { ...mockEmail, checking: true, isAvailable: null };
  renderPage();
  expect(screen.getAllByText("Checking...")).toHaveLength(2);
});

test("typing username/email triggers availability checks", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Admin Username"), "ab");
  await user.type(screen.getByLabelText("Email address"), "c");
  expect(mockUsername.debouncedCheck).toHaveBeenLastCalledWith("ab");
  expect(mockEmail.debouncedCheck).toHaveBeenLastCalledWith("c");
});

test("password requirements list and generate/eye buttons", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Password"), "a");
  expect(screen.getByText("Password Requirements:")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /generate/i }));
  expect(screen.getByLabelText("Password")).toHaveValue("Gen3rated!Pw");
  expect(screen.getByLabelText("Confirm Password")).toHaveValue("Gen3rated!Pw");
  expect(mockToast.success).toHaveBeenCalledWith("Strong password generated!");
  const pw = screen.getByLabelText("Password");
  await user.click(pw.parentElement.querySelector("button"));
  expect(pw).toHaveAttribute("type", "text");
});

test("valid form posts to auth/create-admin/, shows credentials, resets the form", async () => {
  const user = userEvent.setup();
  const writeText = jest.fn();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  API.post.mockResolvedValue({ data: {} });
  renderPage();
  await fill(user);
  expect(screen.getByText("Organization name is valid")).toBeInTheDocument();
  await user.click(submitBtn());
  expect(API.post).toHaveBeenCalledWith("auth/create-admin/", {
    organization_name: "Acme",
    username: "acme_admin",
    email: "a@acme.com",
    password: "Abcdef1!",
  });
  expect(await screen.findByText("Organization Created Successfully!")).toBeInTheDocument();
  expect(screen.getByText("Abcdef1!")).toBeInTheDocument();
  expect(screen.getByLabelText("Organization Name")).toHaveValue("");

  await user.click(screen.getByRole("button", { name: /copy all credentials/i }));
  expect(writeText).toHaveBeenCalledWith(
    "Organization: Acme\nUsername: acme_admin\nEmail: a@acme.com\nPassword: Abcdef1!"
  );
  await user.click(screen.getByRole("button", { name: /view organizations/i }));
  expect(screen.getByText("orgs list")).toBeInTheDocument();
});

test.each([
  [{ response: { data: { error: "Organization already exists" } } }, "Organization already exists"],
  [{ response: { data: { detail: "Forbidden" } } }, "Forbidden"],
  [new Error("x"), "Something went wrong"],
])("API error %# is shown inline and as a toast", async (err, msg) => {
  const user = userEvent.setup();
  API.post.mockRejectedValue(err);
  renderPage();
  await fill(user);
  await user.click(submitBtn());
  expect(await screen.findByText(msg)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(msg);
  expect(screen.getByLabelText("Organization Name")).toHaveValue("Acme");
});

test("Back to Organizations navigates", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: /back to organizations/i }));
  expect(screen.getByText("orgs list")).toBeInTheDocument();
});
