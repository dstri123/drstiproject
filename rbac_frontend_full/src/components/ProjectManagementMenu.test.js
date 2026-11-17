import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ProjectManagementMenu from "./ProjectManagementMenu";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderMenu(open, onToggle = jest.fn()) {
  render(
    <MemoryRouter initialEntries={["/admin/projects"]}>
      <Routes>
        <Route
          path="/admin/projects"
          element={<ProjectManagementMenu project={{ id: 7, project_name: "Tower A" }} open={open} onToggle={onToggle} />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return onToggle;
}

test("closed: only the toggle is shown", () => {
  renderMenu(false);
  expect(screen.getByRole("button", { name: /project management/i })).toBeInTheDocument();
  expect(screen.queryByText("Project Overview")).not.toBeInTheDocument();
});

test("toggle button calls onToggle", async () => {
  const onToggle = renderMenu(false);
  await userEvent.click(screen.getByRole("button", { name: /project management/i }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test("open: shows both entries", () => {
  renderMenu(true);
  expect(screen.getByText("Project Overview")).toBeInTheDocument();
  expect(screen.getByText("Progress Monitoring")).toBeInTheDocument();
});

test("Project Overview opens the project dashboard", async () => {
  renderMenu(true);
  await userEvent.click(screen.getByRole("button", { name: /project overview/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/project-dashboard/7_Tower A");
});

test("Progress Monitoring opens the progress page", async () => {
  renderMenu(true);
  await userEvent.click(screen.getByRole("button", { name: /progress monitoring/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/progress/7_Tower A");
});
