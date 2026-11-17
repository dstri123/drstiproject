import { render, screen } from "@testing-library/react";
import EngineerDashboard from "./EngineerDashboard";

test("renders the project engineer heading", () => {
  render(<EngineerDashboard />);
  expect(screen.getByRole("heading", { name: /project engineer dashboard/i })).toBeInTheDocument();
});
