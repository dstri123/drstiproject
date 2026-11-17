import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import Header from "./Header";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderHeader(role) {
  if (role) localStorage.setItem("role", role);
  render(
    <MemoryRouter initialEntries={["/viewer/7_Tower"]}>
      <Header />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

test.each([
  ["superadmin", "/superadmin"],
  ["admin", "/admin"],
  ["project_manager", "/manager"],
  ["project_engineer", "/engineer"],
  ["data_contributor", "/data"],
  ["site_engineer", "/site-engineer"],
  ["viewer", "/"],
  ["unknown_role", "/"],
])("Dashboard button for %s goes to %s", async (role, path) => {
  renderHeader(role);
  expect(screen.getByText(role)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  expect(screen.getByTestId("where")).toHaveTextContent(new RegExp(`^${path}$`));
});

test("defaults to the viewer role", async () => {
  renderHeader();
  expect(screen.getByText("viewer")).toBeInTheDocument();
  expect(screen.getByText("3D Workspace")).toBeInTheDocument();
  await userEvent.click(screen.getByTitle("Back to Dashboard"));
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
});
