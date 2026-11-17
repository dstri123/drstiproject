import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import API from "../../api/axios";
import MemberDashboard from "./Dashboard";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

function Viewer() {
  return <div>viewer {useParams().slug}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/member/dashboard"]}>
      <Routes>
        <Route path="/member/dashboard" element={<MemberDashboard />} />
        <Route path="/viewer/:slug" element={<Viewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => jest.restoreAllMocks());

test("lists projects with dash fallbacks", async () => {
  API.get.mockResolvedValue({
    data: [
      { id: 1, project_name: "Tower A", description: "Tall", start: "2026-01-01", end: "2026-12-31" },
      { id: 2, project_name: "Bridge", description: "", start: null, end: null },
    ],
  });
  renderPage();
  expect(await screen.findByText("Tower A")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("/projects/");
  expect(screen.getByText("Tall")).toBeInTheDocument();
  expect(screen.getByText("2026-12-31")).toBeInTheDocument();
  expect(screen.getAllByText("-")).toHaveLength(3);
});

// Regression: the View button passed project.id instead of the project, so
// the slug came out as "_" and the viewer could not resolve the project.
test("View opens the viewer with the project's slug", async () => {
  API.get.mockResolvedValue({ data: [{ id: 7, project_name: "Tower A" }] });
  renderPage();
  await userEvent.click(await screen.findByTitle("View Project"));
  expect(screen.getByText("viewer 7_Tower A")).toBeInTheDocument();
});

test("load error renders the empty state", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await screen.findByText("No projects found.")).toBeInTheDocument();
});

test("null data renders the empty state", async () => {
  API.get.mockResolvedValue({ data: null });
  renderPage();
  expect(await screen.findByText("No projects found.")).toBeInTheDocument();
});
