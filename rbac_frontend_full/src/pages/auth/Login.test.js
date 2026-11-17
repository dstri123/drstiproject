import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import Login from "./Login";

jest.mock("../../api/axios", () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));
jest.mock("../../components/AuthHeroPanel", () => () => null);
jest.mock("../../components/ToastContainer", () => ({
  useToast: () => ({ error: jest.fn(), success: jest.fn() }),
}));

const LANDING = {
  "/admin/projects": "admin home",
  "/manager": "manager home",
  "/engineer": "engineer home",
  "/data": "data home",
  "/site-engineer": "site home",
  "/superadmin/organizations": "orgs",
  "/superadmin/organizations/create": "create first org",
};

function renderLogin() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {Object.entries(LANDING).map(([path, text]) => (
          <Route key={path} path={path} element={<div>{text}</div>} />
        ))}
      </Routes>
    </MemoryRouter>
  );
}

async function submit(username, password) {
  if (username) await userEvent.type(screen.getByPlaceholderText("Enter your username"), username);
  if (password) await userEvent.type(screen.getByPlaceholderText("Enter your password"), password);
  await userEvent.click(screen.getByRole("button", { name: /sign in to account/i }));
}

function loginReturns(user) {
  API.post.mockResolvedValue({ data: { access: "acc", refresh: "ref", user } });
}

afterEach(() => jest.clearAllMocks());

test("username and password are required", async () => {
  renderLogin();
  await submit("", "");
  expect(screen.getByText("Username is required")).toBeInTheDocument();
  await submit("bob", "");
  expect(screen.getByText("Password is required")).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test.each([
  [{ role: "admin", sub_role: null }, "admin", "admin home"],
  [{ role: "member", sub_role: "project_manager" }, "project_manager", "manager home"],
  [{ role: "member", sub_role: "project_engineer" }, "project_engineer", "engineer home"],
  [{ role: "member", sub_role: "data_contributor" }, "data_contributor", "data home"],
  [{ role: "member", sub_role: "site_engineer" }, "site_engineer", "site home"],
])("%o lands on the right page and stores its role", async (user, storedRole, landing) => {
  loginReturns(user);
  renderLogin();
  await submit("bob", "pw");
  expect(API.post).toHaveBeenCalledWith("auth/login/", { username: "bob", password: "pw" });
  expect(await screen.findByText(landing)).toBeInTheDocument();
  expect(localStorage.getItem("role")).toBe(storedRole);
  expect(localStorage.getItem("token")).toBe("acc");
  expect(localStorage.getItem("refresh")).toBe("ref");
});

test.each([
  [true, "orgs"],
  [false, "create first org"],
])("superadmin goes to organizations (admin_exists=%s)", async (exists, landing) => {
  loginReturns({ role: "superadmin" });
  API.get.mockResolvedValue({ data: { admin_exists: exists } });
  renderLogin();
  await submit("root", "pw");
  expect(await screen.findByText(landing)).toBeInTheDocument();
});

test("viewer sub_role has no landing page and stays on login", async () => {
  loginReturns({ role: "member", sub_role: "viewer" });
  renderLogin();
  await submit("v", "pw");
  await new Promise((r) => setTimeout(r, 700));
  expect(screen.getByRole("button", { name: /sign in to account/i })).toBeInTheDocument();
});

test("server error message is shown", async () => {
  API.post.mockRejectedValue({ response: { data: { error: "Invalid credentials" } } });
  renderLogin();
  await submit("bob", "bad");
  expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
  expect(localStorage.getItem("token")).toBeNull();
});

describe("extra login behaviour", () => {
  test("member without sub_role lands on the member dashboard", async () => {
    loginReturns({ role: "member", sub_role: null });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/member/dashboard" element={<div>member home</div>} />
        </Routes>
      </MemoryRouter>
    );
    await submit("m", "pw");
    expect(await screen.findByText("member home")).toBeInTheDocument();
    expect(localStorage.getItem("role")).toBe("member");
  });

  test("username is trimmed before sending; password is sent as typed", async () => {
    loginReturns({ role: "admin" });
    renderLogin();
    await submit("  bob  ", " pw ");
    expect(API.post).toHaveBeenCalledWith("auth/login/", { username: "bob", password: " pw " });
  });

  test("whitespace-only password is rejected", async () => {
    renderLogin();
    await submit("bob", "   ");
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("Enter in the password field submits", async () => {
    loginReturns({ role: "admin" });
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Enter your username"), "bob");
    await userEvent.type(screen.getByPlaceholderText("Enter your password"), "pw{Enter}");
    expect(API.post).toHaveBeenCalledWith("auth/login/", { username: "bob", password: "pw" });
    expect(await screen.findByText("admin home")).toBeInTheDocument();
  });

  test("Enter in the username field submits (and validates)", async () => {
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Enter your username"), "bob{Enter}");
    expect(screen.getByText("Password is required")).toBeInTheDocument();
  });

  test("show/hide password toggles the input type", async () => {
    renderLogin();
    const pw = screen.getByPlaceholderText("Enter your password");
    const toggle = pw.parentElement.querySelector("button");
    expect(pw).toHaveAttribute("type", "password");
    await userEvent.click(toggle);
    expect(pw).toHaveAttribute("type", "text");
    await userEvent.click(toggle);
    expect(pw).toHaveAttribute("type", "password");
  });

  test("Forgot password? navigates to /forgot-password", async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<div>forgot page</div>} />
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByText("forgot page")).toBeInTheDocument();
  });

  test("detail takes priority over error; network failure uses fallback", async () => {
    API.post.mockRejectedValueOnce({ response: { data: { detail: "Account disabled", error: "x" } } });
    renderLogin();
    await submit("bob", "pw");
    expect(await screen.findByText("Account disabled")).toBeInTheDocument();
    API.post.mockRejectedValueOnce(new Error("Network Error"));
    await userEvent.click(screen.getByRole("button", { name: /sign in to account/i }));
    expect(await screen.findByText("Login failed. Please check your credentials.")).toBeInTheDocument();
  });
});
