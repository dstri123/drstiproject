import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../api/axios";
import Sidebar from "./Sidebar";

// Sidebar fetches the profile on mount; keep that offline.
// (CRA's Jest config uses resetMocks, so implementations are set per test.)
jest.mock("../api/axios", () => ({ __esModule: true, default: { get: jest.fn() } }));

beforeEach(() => {
  API.get.mockResolvedValue({ data: { first_name: "Ada", last_name: "L", email: "a@x.com" } });
});

const EXPECTED_MENU = {
  superadmin: ["Organizations", "Activity Log"],
  admin: ["Project Contributors", "Project Setup", "Activity Log"],
  project_manager: ["Dashboard", "Photo Folders"],
  project_engineer: ["Dashboard", "Photo Folders"],
  data_contributor: ["Projects", "Tools"],
  site_engineer: ["Dashboard"],
  viewer: [],
};

function renderSidebar(role) {
  if (role) localStorage.setItem("role", role);
  render(
    <MemoryRouter initialEntries={["/somewhere"]}>
      <Routes>
        <Route path="/" element={<div>login page</div>} />
        <Route path="*" element={<Sidebar isOpen onClose={() => {}} />} />
      </Routes>
    </MemoryRouter>
  );
}

test.each(Object.entries(EXPECTED_MENU))("%s sees exactly their menu", async (role, labels) => {
  renderSidebar(role);
  const nav = screen.getByRole("navigation");
  const items = within(nav).queryAllByRole("button").map((b) => b.textContent);
  expect(items).toEqual(labels);
  await screen.findByText("Ada L"); // let the profile fetch settle
});

test("logout clears the session and returns to the login page", async () => {
  renderSidebar("admin");
  localStorage.setItem("token", "t");
  localStorage.setItem("refresh", "r");
  await userEvent.click(screen.getByRole("button", { name: /logout/i }));
  expect(screen.getByText("login page")).toBeInTheDocument();
  for (const key of ["token", "refresh", "role"]) expect(localStorage.getItem(key)).toBeNull();
});

describe("navigation and profile card", () => {
  function renderAt(role, path, onClose = jest.fn()) {
    localStorage.setItem("role", role);
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<Sidebar isOpen onClose={onClose} />} />
        </Routes>
      </MemoryRouter>
    );
    return onClose;
  }

  test("clicking a menu item navigates, marks it active and closes the mobile sidebar", async () => {
    const onClose = renderAt("admin", "/admin");
    await screen.findByText("Ada L");
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: "Project Setup" }));
    expect(within(nav).getByRole("button", { name: "Project Setup" })).toHaveClass("bg-black");
    expect(within(nav).getByRole("button", { name: "Project Contributors" })).not.toHaveClass("bg-black");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("fetches the profile and shows name, role and email", async () => {
    renderAt("project_manager", "/manager");
    expect(await screen.findByText("Ada L")).toBeInTheDocument();
    expect(API.get).toHaveBeenCalledWith("profile/");
    expect(screen.getByText("project manager")).toBeInTheDocument();
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument(); // initials avatar
  });

  test("profile fetch failure falls back to 'User'", async () => {
    API.get.mockRejectedValue(new Error("down"));
    renderAt("admin", "/admin");
    await waitFor(() => expect(API.get).toHaveBeenCalled());
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  test("shows the avatar image when the profile has one", async () => {
    API.get.mockResolvedValue({ data: { first_name: "Ada", avatar_url: "/media/a.png" } });
    renderAt("admin", "/admin");
    expect(await screen.findByAltText("Profile avatar")).toHaveAttribute("src", "/media/a.png");
  });

  test("a profileUpdated event refreshes the card", async () => {
    renderAt("admin", "/admin");
    await screen.findByText("Ada L");
    act(() => {
      window.dispatchEvent(new CustomEvent("profileUpdated", { detail: { first_name: "Grace", email: "g@x.com" } }));
    });
    expect(screen.getByText("Grace L")).toBeInTheDocument();
    expect(screen.getByText("g@x.com")).toBeInTheDocument();
  });

  test("Settings goes to /profile", async () => {
    const onClose = renderAt("admin", "/admin");
    await screen.findByText("Ada L");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Settings" })).toHaveClass("bg-black");
    expect(onClose).toHaveBeenCalled();
  });
});
