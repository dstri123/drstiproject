import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminDashboard from "./Dashboard";

jest.mock("../../layouts/Topbar", () => () => <div>topbar</div>);
jest.mock("../../layouts/Sidebar", () => () => <div>sidebar</div>);

// Regression: the page used to wrap itself in <DashboardLayout>, which renders
// <Outlet/> (not children) — so the heading was dropped and a second Topbar/Sidebar drawn.
test("renders its heading inside the app layout route, with a single topbar", () => {
  const DashboardLayout = jest.requireActual("../../layouts/DashboardLayout").default;
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/admin" element={<AdminDashboard />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  expect(screen.getByRole("heading", { name: "Admin Dashboard" })).toBeInTheDocument();
  expect(screen.getAllByText("topbar")).toHaveLength(1);
  expect(screen.getAllByText("sidebar")).toHaveLength(1);
});
