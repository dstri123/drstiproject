import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import API from "../../api/axios";
import DataDashboard from "./DataDashboard";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
jest.mock("../../components/ProjectManagementMenu", () => ({ project, open, onToggle }) => (
  <button onClick={onToggle}>
    mgmt {project.id} {open ? "open" : "closed"}
  </button>
));

const PROJECTS = [
  {
    id: 1,
    slug: "tower-a",
    project_name: "Tower A",
    description: "x".repeat(100),
    start: "2026-01-01",
    end: "2026-06-30",
    image: "/media/a.png",
    users: [{ id: 1 }, { id: 2 }],
    bimdata_set: [1],
    pointclouddata_set: [2],
    images_set: [],
  },
  {
    id: 2,
    project_name: "Old Bridge",
    description: "",
    start: "2025-01-01",
    end: "2025-12-31",
    image: "http://cdn/b.png",
  },
  { id: 3, project_name: "No Dates" },
];

function DataPage() {
  const { slug } = useParams();
  const { state } = useLocation();
  return <div>data {slug} {state?.projectName}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/data"]}>
      <Routes>
        <Route path="/data" element={<DataDashboard />} />
        <Route path="/project/:slug/data" element={<DataPage />} />
        <Route path="/viewer/:slug" element={<div>viewer page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const names = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);
afterEach(() => jest.restoreAllMocks());

test("shows project cards with badges, completion count, users and images", async () => {
  API.get.mockResolvedValue({ data: PROJECTS });
  renderPage();
  expect(await screen.findByText("Tower A")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("projects/");
  expect(names()).toEqual(["Tower A", "Old Bridge", "No Dates"]);
  expect(screen.getByText("2/3")).toBeInTheDocument();
  expect(screen.getAllByText("0/3")).toHaveLength(2);
  expect(screen.getByText(`${"x".repeat(80)}...`)).toBeInTheDocument();
  expect(screen.getAllByText("Upload and access project data through the viewer")).toHaveLength(2);
  expect(screen.getByText("Users: 2")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Tower A" })).toHaveAttribute("src", "http://127.0.0.1:8000/media/a.png");
  expect(screen.getByRole("img", { name: "Old Bridge" })).toHaveAttribute("src", "http://cdn/b.png");
});

test("date filters narrow the list and can be cleared", async () => {
  API.get.mockResolvedValue({ data: PROJECTS });
  renderPage();
  await screen.findByText("Tower A");
  const [from, to] = screen.getAllByDisplayValue("");
  fireEvent.change(from, { target: { value: "2026-01-01" } });
  expect(names()).toEqual(["Tower A", "No Dates"]); // undated projects stay visible
  expect(screen.getByText("Showing 2 of 3 project(s)")).toBeInTheDocument();
  fireEvent.change(to, { target: { value: "2026-03-01" } });
  expect(names()).toEqual(["No Dates"]);
  fireEvent.change(from, { target: { value: "" } });
  expect(names()).toEqual(["Old Bridge", "No Dates"]);
  await userEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
  expect(names()).toHaveLength(3);
  expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
});

test("Upload Data opens the project's data page with its name; falls back to a name slug", async () => {
  API.get.mockResolvedValue({ data: PROJECTS });
  renderPage();
  await screen.findByText("Tower A");
  await userEvent.click(screen.getAllByRole("button", { name: "Upload Data" })[0]);
  expect(screen.getByText("data tower-a Tower A")).toBeInTheDocument();
});

test("Upload Data without a slug uses the hyphenated name", async () => {
  API.get.mockResolvedValue({ data: PROJECTS });
  renderPage();
  await screen.findByText("Tower A");
  await userEvent.click(screen.getAllByRole("button", { name: "Upload Data" })[1]);
  expect(screen.getByText("data old-bridge Old Bridge")).toBeInTheDocument();
});

test("3D Viewer opens the viewer", async () => {
  API.get.mockResolvedValue({ data: PROJECTS });
  renderPage();
  await screen.findByText("Tower A");
  await userEvent.click(screen.getAllByRole("button", { name: /3D Viewer/ })[0]);
  expect(screen.getByText("viewer page")).toBeInTheDocument();
});

test("only one project-management menu is open at a time", async () => {
  API.get.mockResolvedValue({ data: PROJECTS });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "mgmt 1 closed" }));
  expect(screen.getByRole("button", { name: "mgmt 1 open" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "mgmt 2 closed" }));
  expect(screen.getByRole("button", { name: "mgmt 1 closed" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "mgmt 2 open" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "mgmt 2 open" }));
  expect(screen.getByRole("button", { name: "mgmt 2 closed" })).toBeInTheDocument();
});

test("empty and failed loads show the empty state", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await screen.findByText("No projects available")).toBeInTheDocument();
});
