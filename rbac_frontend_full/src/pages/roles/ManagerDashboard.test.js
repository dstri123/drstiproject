import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import API from "../../api/axios";
import ManagerDashboard from "./ManagerDashboard";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

function Viewer() {
  return <div>viewer {useParams().slug}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/manager"]}>
      <Routes>
        <Route path="/manager" element={<ManagerDashboard />} />
        <Route path="/viewer/:slug" element={<Viewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => jest.restoreAllMocks());

test("shows project cards with image or placeholder", async () => {
  API.get.mockResolvedValue({
    data: [
      { id: 1, project_name: "Tower A", image: "http://x/a.png" },
      { id: 2, name: "Legacy Name" },
    ],
  });
  renderPage();
  expect(await screen.findByRole("heading", { name: "Tower A" })).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("/projects/");
  expect(screen.getByRole("img", { name: "Tower A" })).toHaveAttribute("src", "http://x/a.png");
  expect(screen.getByRole("img", { name: "Legacy Name" }).getAttribute("src")).toMatch(/placeholder/);
});

test("View opens the viewer for that project", async () => {
  API.get.mockResolvedValue({ data: [{ id: 4, project_name: "Tower A" }] });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /view/i }));
  expect(screen.getByText("viewer 4_Tower A")).toBeInTheDocument();
});

test("a failed load still renders the page with no cards", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await screen.findByRole("heading", { name: "Project Dashboard" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /view/i })).not.toBeInTheDocument();
});
