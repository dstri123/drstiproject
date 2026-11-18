import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import IconToolbar from "./IconToolbar";

const ROLES = ["admin", "project_manager", "project_engineer", "data_contributor", "site_engineer", "viewer"];

function renderToolbar(props = {}) {
  const onSelectPanel = jest.fn();
  render(
    <MemoryRouter initialEntries={["/viewer/7_Tower"]}>
      <IconToolbar activePanel={null} onSelectPanel={onSelectPanel} projectSlug="7_Tower" {...props} />
    </MemoryRouter>
  );
  return { onSelectPanel };
}

describe.each(ROLES)("viewer toolbar for %s", (role) => {
  test("Picking and Alignment are hidden only for the viewer role", () => {
    renderToolbar({ role });
    const hidden = role === "viewer";
    for (const label of ["Picking", "Alignment"]) {
      if (hidden) expect(screen.queryByTitle(label)).not.toBeInTheDocument();
      else expect(screen.getByTitle(label)).toBeInTheDocument();
    }
    for (const label of ["Upload Files", "Models", "Cameras", "Issues"]) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
  });
});

test("clicking a tool opens its panel", async () => {
  const { onSelectPanel } = renderToolbar({ role: "admin" });
  await userEvent.click(screen.getByTitle("Models"));
  expect(onSelectPanel).toHaveBeenLastCalledWith("models");
});

test("clicking the active tool closes it", async () => {
  const { onSelectPanel } = renderToolbar({ role: "admin", activePanel: "models" });
  await userEvent.click(screen.getByTitle("Models"));
  expect(onSelectPanel).toHaveBeenLastCalledWith(null);
});

describe("navigation buttons", () => {
  const { Routes, Route, useLocation } = require("react-router-dom");
  function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>;
  }
  function renderAt(path, props = {}) {
    render(
      <MemoryRouter initialEntries={["/admin", path]} initialIndex={1}>
        <IconToolbar activePanel={null} onSelectPanel={jest.fn()} role="admin" {...props} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
  }

  test("Viewer button opens the project viewer from elsewhere", async () => {
    renderAt("/analytics/7_Tower", { projectSlug: "7_Tower" });
    await userEvent.click(screen.getByTitle("Open Viewer"));
    expect(screen.getByTestId("where")).toHaveTextContent("/viewer/7_Tower");
  });

  test("Viewer button on the viewer page goes back", async () => {
    renderAt("/viewer/7_Tower", { projectSlug: "7_Tower" });
    await userEvent.click(screen.getByTitle("Close Viewer"));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/admin$/);
  });

  test("Analytics opens the project's analytics page", async () => {
    renderAt("/viewer/7_Tower", { projectSlug: "7_Tower" });
    await userEvent.click(screen.getByTitle("Open Analytics"));
    expect(screen.getByTestId("where")).toHaveTextContent("/analytics/7_Tower");
  });

  test("Analytics on the analytics page returns to the viewer", async () => {
    renderAt("/analytics/7_Tower", { projectSlug: "7_Tower" });
    await userEvent.click(screen.getByTitle("Close Analytics"));
    expect(screen.getByTestId("where")).toHaveTextContent("/viewer/7_Tower");
  });

  test("without a slug Analytics goes to the bare analytics route", async () => {
    renderAt("/tools");
    await userEvent.click(screen.getByTitle("Open Analytics"));
    expect(screen.getByTestId("where")).toHaveTextContent("/analytics/");
  });

  test("every icon carries its tooltip text as title + accessible name", () => {
    renderAt("/viewer/7_Tower", { projectSlug: "7_Tower" });
    for (const name of ["Close Viewer", "Upload Files", "Models", "Cameras", "Issues", "Open Analytics"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("title", name);
    }
  });
});
