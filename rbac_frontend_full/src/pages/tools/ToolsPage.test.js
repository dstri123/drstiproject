import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ToolsPage from "./ToolsPage";

test("renders the header and the empty state (no tools registered)", () => {
  render(
    <MemoryRouter>
      <ToolsPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  expect(screen.getByText("No tools available yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /open tool/i })).not.toBeInTheDocument();
});
