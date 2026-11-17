import { render, screen } from "@testing-library/react";
import SiteEngineerDashboard from "./SiteEngineerDashboard";

test("renders the site engineer heading", () => {
  render(<SiteEngineerDashboard />);
  expect(screen.getByRole("heading", { name: /site engineer dashboard/i })).toBeInTheDocument();
});
