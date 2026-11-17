// Note: Signup is not routed in App.js (no public sign-up); these tests cover the
// component as written in case it is wired up again.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import Signup from "./Signup";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../components/AuthHeroPanel", () => () => null);
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
  mockUsername = { checking: false, isAvailable: true, message: "Username is available", debouncedCheck: jest.fn() };
  mockEmail = { checking: false, isAvailable: true, message: "Email is available", debouncedCheck: jest.fn() };
});
afterEach(() => jest.useRealTimers());

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const createBtn = () => screen.getByRole("button", { name: /create account/i });

async function fill(user, { username = "bob", email = "bob@x.com", password = "Abcdef1!", confirm = password } = {}) {
  if (username) await user.type(screen.getByLabelText("Username"), username);
  if (email) await user.type(screen.getByLabelText("Email"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  if (confirm) await user.type(screen.getByLabelText("Confirm Password"), confirm);
}

test("typing triggers debounced availability checks", async () => {
  const user = userEvent.setup();
  renderSignup();
  await user.type(screen.getByLabelText("Username"), "bo");
  await user.type(screen.getByLabelText("Email"), "e");
  expect(mockUsername.debouncedCheck).toHaveBeenLastCalledWith("bo");
  expect(mockEmail.debouncedCheck).toHaveBeenLastCalledWith("e");
});

test("availability messages and checking spinners render", () => {
  mockUsername = { ...mockUsername, isAvailable: false, message: "Username taken" };
  mockEmail = { ...mockEmail, checking: true, isAvailable: null };
  renderSignup();
  expect(screen.getByText("Username taken")).toBeInTheDocument();
  expect(screen.getByText("Checking availability...")).toBeInTheDocument();
});

test("password rules list shows while weak; strong + matching enables submit", async () => {
  const user = userEvent.setup();
  renderSignup();
  await fill(user, { password: "abc", confirm: "" });
  expect(screen.getByText("Password requirements:")).toBeInTheDocument();
  expect(createBtn()).toBeDisabled();
  await user.clear(screen.getByLabelText("Password"));
  await user.type(screen.getByLabelText("Password"), "Abcdef1!");
  expect(screen.getByText(/Strong password/)).toBeInTheDocument();
  await user.type(screen.getByLabelText("Confirm Password"), "Abcdef1?");
  expect(screen.getAllByText("Passwords do not match").length).toBeGreaterThan(0);
  expect(createBtn()).toBeDisabled();
  await user.clear(screen.getByLabelText("Confirm Password"));
  await user.type(screen.getByLabelText("Confirm Password"), "Abcdef1!");
  expect(screen.getByText("Passwords match")).toBeInTheDocument();
  expect(createBtn()).toBeEnabled();
});

test("invalid email shows inline error and blocks submit", async () => {
  const user = userEvent.setup();
  renderSignup();
  await fill(user, { email: "bob@x" });
  expect(screen.getByText("Please enter a valid email address")).toBeInTheDocument();
  expect(createBtn()).toBeDisabled();
});

test("taken username/email keeps submit disabled", async () => {
  mockEmail = { ...mockEmail, isAvailable: false, message: "Email in use" };
  const user = userEvent.setup();
  renderSignup();
  await fill(user);
  expect(createBtn()).toBeDisabled();
});

test("Generate fills both password fields; eye toggles visibility", async () => {
  const user = userEvent.setup();
  renderSignup();
  await user.click(screen.getByRole("button", { name: /generate/i }));
  expect(screen.getByLabelText("Password")).toHaveValue("Gen3rated!Pw");
  expect(screen.getByLabelText("Confirm Password")).toHaveValue("Gen3rated!Pw");
  const pw = screen.getByLabelText("Password");
  await user.click(pw.parentElement.querySelector("button"));
  expect(pw).toHaveAttribute("type", "text");
});

test("successful signup posts and redirects to / after 1.5s", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  API.post.mockResolvedValue({ data: {} });
  renderSignup();
  await fill(user);
  await user.click(createBtn());
  expect(API.post).toHaveBeenCalledWith("auth/signup/", { username: "bob", email: "bob@x.com", password: "Abcdef1!" });
  expect(mockToast.success).toHaveBeenCalledWith("Account created successfully! Redirecting to login...");
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.getByText("login page")).toBeInTheDocument();
});

test("Enter in confirm password submits when the form is valid", async () => {
  const user = userEvent.setup();
  API.post.mockResolvedValue({ data: {} });
  renderSignup();
  await fill(user, { confirm: "" });
  await user.type(screen.getByLabelText("Confirm Password"), "Abcdef1!{Enter}");
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("Enter does nothing while the form is invalid", async () => {
  const user = userEvent.setup();
  renderSignup();
  await user.type(screen.getByLabelText("Password"), "weak{Enter}");
  expect(API.post).not.toHaveBeenCalled();
});

test.each([
  [{ response: { data: { error: "Username exists" } } }, "Username exists"],
  [{ response: { data: { detail: "Bad" } } }, "Bad"],
  [new Error("x"), "Signup failed. Please try again."],
])("signup error %#", async (err, msg) => {
  const user = userEvent.setup();
  API.post.mockRejectedValue(err);
  renderSignup();
  await fill(user);
  await user.click(createBtn());
  expect(mockToast.error).toHaveBeenCalledWith(msg);
  expect(createBtn()).toBeEnabled();
});

test("Sign in link goes to /", async () => {
  const user = userEvent.setup();
  renderSignup();
  await user.click(screen.getByRole("button", { name: /sign in/i }));
  expect(screen.getByText("login page")).toBeInTheDocument();
});
