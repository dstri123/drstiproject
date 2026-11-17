import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import PersistentWorkspace from "./PersistentWorkspace";

// Each page stub counts mounts/unmounts and echoes its props, so the tests can
// tell "hidden" apart from "unmounted and remounted".
const mockLife = { mounts: {}, unmounts: {}, props: {} };
function mockSection(name) {
  const React = require("react");
  return {
    __esModule: true,
    default: function Page(props) {
      mockLife.props[name] = props;
      React.useEffect(() => {
        mockLife.mounts[name] = (mockLife.mounts[name] || 0) + 1;
        return () => {
          mockLife.unmounts[name] = (mockLife.unmounts[name] || 0) + 1;
        };
      }, []);
      return React.createElement(
        "div",
        { "data-testid": name },
        `${name}:${props.projectSlug || props.routeParam}`,
      );
    },
  };
}
jest.mock("../pages/viewer/ViewerPage", () => mockSection("viewer"));
jest.mock("../pages/analytics/AnalyticsPage", () => mockSection("analytics"));
jest.mock("../pages/analytics/ProgressAssessmentPage", () => mockSection("progress"));

let router;
function start(path) {
  router = createMemoryRouter([{ path: "*", element: <PersistentWorkspace /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
const go = (path) => act(() => router.navigate(path));
const wrapper = (name) => screen.getByTestId(name).parentElement;
const visible = (name) => wrapper(name).style.display !== "none";

beforeEach(() => {
  mockLife.mounts = {};
  mockLife.unmounts = {};
  mockLife.props = {};
});

test("renders nothing on non-workspace routes", () => {
  start("/admin/projects");
  for (const n of ["viewer", "analytics", "progress"]) expect(screen.queryByTestId(n)).not.toBeInTheDocument();
});

test("mounts a section on first visit with the slug", () => {
  start("/viewer/7_Tower");
  expect(screen.getByTestId("viewer")).toHaveTextContent("viewer:7_Tower");
  expect(visible("viewer")).toBe(true);
  expect(screen.queryByTestId("analytics")).not.toBeInTheDocument();
});

test("switching section hides (display:none) the old one instead of unmounting it", async () => {
  start("/viewer/7_Tower");
  await go("/analytics/7_Tower");
  expect(visible("viewer")).toBe(false);
  expect(visible("analytics")).toBe(true);
  await go("/progress/7_Tower");
  expect(visible("analytics")).toBe(false);
  expect(visible("progress")).toBe(true);
  await go("/viewer/7_Tower");
  expect(visible("viewer")).toBe(true);
  expect(mockLife.mounts).toEqual({ viewer: 1, analytics: 1, progress: 1 });
  expect(mockLife.unmounts).toEqual({});
});

test("leaving to a normal page keeps everything mounted but hidden", async () => {
  start("/viewer/7_Tower");
  await go("/admin/projects");
  expect(visible("viewer")).toBe(false);
  await go("/viewer/7_Tower");
  expect(visible("viewer")).toBe(true);
  expect(mockLife.mounts.viewer).toBe(1);
  expect(mockLife.unmounts.viewer).toBeUndefined();
});

test("opening a different project remounts only that section", async () => {
  start("/viewer/7_Tower");
  await go("/analytics/7_Tower");
  await go("/viewer/8_Bridge");
  expect(screen.getByTestId("viewer")).toHaveTextContent("viewer:8_Bridge");
  expect(mockLife.mounts.viewer).toBe(2);
  expect(mockLife.unmounts.viewer).toBe(1);
  expect(mockLife.mounts.analytics).toBe(1);
  expect(screen.getByTestId("analytics")).toHaveTextContent("analytics:7_Tower");
});

test("query string and trailing segments don't break slug parsing", async () => {
  start("/progress/7_Tower/extra?x=1");
  expect(screen.getByTestId("progress")).toHaveTextContent("progress:7_Tower");
});

test("analytics gets the viewer's date only for the same project", async () => {
  start("/viewer/7_Tower");
  act(() => mockLife.props.viewer.onDateChange("7_Tower", "2026-11-01"));
  await go("/analytics/7_Tower");
  expect(mockLife.props.analytics.initialDate).toBe("2026-11-01");

  act(() => mockLife.props.viewer.onDateChange("8_Bridge", "2026-10-01"));
  expect(mockLife.props.analytics.initialDate).toBeNull();
});

test("viewer receives an onDateChange callback", () => {
  start("/viewer/7_Tower");
  expect(typeof mockLife.props.viewer.onDateChange).toBe("function");
  expect(mockLife.props.viewer.projectSlug).toBe("7_Tower");
});
