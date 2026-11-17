import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";
import Footer from "./Footer";
import Topbar from "./Topbar";

// Sidebar is covered by its own tests; here we only need to see its props.
jest.mock("./Sidebar", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: ({ isOpen, onClose }) =>
      React.createElement(
        "nav",
        { "aria-label": "sidebar", "data-open": String(isOpen) },
        React.createElement("button", { onClick: onClose }, "close sidebar"),
      ),
  };
});

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderLayout(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="*" element={<div>page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const sidebar = () => screen.queryByRole("navigation", { name: "sidebar" });

describe("DashboardLayout", () => {
  test.each([
    "/superadmin/organizations",
    "/superadmin/organizations/3/edit",
    "/profile",
    "/project/7_Tower/data",
    "/admin",
    "/admin/projects/7_Tower/edit",
    "/manager",
    "/engineer",
    "/data",
    "/tools",
    "/activity/admin/2",
  ])("%s shows the sidebar", (path) => {
    renderLayout(path);
    expect(sidebar()).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  test.each(["/member/dashboard", "/user/dashboard", "/site-engineer", "/photos", "/map-spike"])(
    "%s has no sidebar",
    (path) => {
      renderLayout(path);
      expect(sidebar()).not.toBeInTheDocument();
      expect(screen.getByText("page content")).toBeInTheDocument();
    },
  );

  test("hamburger toggles the sidebar, and the sidebar can close itself", async () => {
    renderLayout("/admin");
    expect(sidebar()).toHaveAttribute("data-open", "false");
    await userEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(sidebar()).toHaveAttribute("data-open", "true");
    await userEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(sidebar()).toHaveAttribute("data-open", "false");
    await userEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    await userEvent.click(screen.getByRole("button", { name: "close sidebar" }));
    expect(sidebar()).toHaveAttribute("data-open", "false");
  });
});

describe("Topbar", () => {
  function renderTopbar(onMenuClick = jest.fn()) {
    render(
      <MemoryRouter>
        <Topbar onMenuClick={onMenuClick} />
      </MemoryRouter>
    );
    return onMenuClick;
  }

  test("shows the brand and logo", () => {
    renderTopbar();
    expect(screen.getByRole("heading", { name: "C Twin" })).toBeInTheDocument();
    expect(screen.getByAltText("C Twin Logo")).toHaveAttribute("src", "/distri-logo.png");
  });

  test("menu button calls onMenuClick", async () => {
    const onMenuClick = renderTopbar();
    await userEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  test("clock shows MM/DD/YY HH:MM:SS and ticks every second", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 12, 9, 5, 7));
    renderTopbar();
    expect(screen.getByText("11/12/26 09:05:07")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText("11/12/26 09:05:08")).toBeInTheDocument();
  });

  test("clock interval is cleared on unmount", () => {
    jest.useFakeTimers();
    const clear = jest.spyOn(window, "clearInterval");
    const { unmount } = render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>
    );
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});

test("Footer shows the credit line", () => {
  render(<Footer />);
  expect(screen.getByRole("contentinfo")).toHaveTextContent("All rights reserved by @C Twin Lab");
});
