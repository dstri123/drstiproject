import { render, screen } from "@testing-library/react";
import UserDashboard from "./Dashboard";

test("renders the view-only dashboard", () => {
  render(<UserDashboard />);
  expect(screen.getByRole("heading", { name: /user dashboard/i })).toBeInTheDocument();
  expect(screen.getByText("View only access")).toBeInTheDocument();
});
