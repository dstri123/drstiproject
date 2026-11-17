import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import API from "../../api/axios";
import Projects from "./Projects";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/projects"]}>
      <Routes>
        <Route path="/admin/projects" element={<Projects />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const mk = (i, extra = {}) => ({ id: i, slug: `p-${i}`, project_name: `Project ${i}`, description: "", users: [], ...extra });

test("shows a spinner then the project cards", async () => {
  API.get.mockResolvedValue({
    data: [
      mk(1, { description: "Tower", users: [{ id: 1 }, { id: 2 }], start: "2026-02-03", image: "/media/a.png" }),
      mk(2, { image: "https://cdn/x.png" }),
    ],
  });
  renderPage();
  expect(await screen.findByText("Project 1")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("projects/");
  expect(document.title).toBe("Projects - C Twin");
  expect(screen.getByText("Tower")).toBeInTheDocument();
  expect(screen.getByText("Users: 2")).toBeInTheDocument();
  expect(screen.getByText("Users: 0")).toBeInTheDocument();
  expect(screen.getByAltText("Project 1")).toHaveAttribute("src", "http://127.0.0.1:8000/media/a.png");
  expect(screen.getByAltText("Project 2")).toHaveAttribute("src", "https://cdn/x.png");
});

test("broken image hides itself", async () => {
  API.get.mockResolvedValue({ data: [mk(1, { image: "/bad.png" })] });
  renderPage();
  const img = await screen.findByAltText("Project 1");
  fireEvent.error(img);
  expect(img.style.display).toBe("none");
});

test("empty list and load failure show the empty state", async () => {
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Failed to load projects");
});

test("null data is treated as empty", async () => {
  API.get.mockResolvedValue({ data: null });
  renderPage();
  expect(await screen.findByText("No projects yet")).toBeInTheDocument();
});

test("search filters cards and shows a count", async () => {
  API.get.mockResolvedValue({ data: [mk(1), mk(2, { project_name: "Bridge" })] });
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Project 1");
  await user.type(screen.getByPlaceholderText("Search projects by name..."), "bri");
  expect(screen.getByText("Found 1 project(s)")).toBeInTheDocument();
  expect(screen.queryByText("Project 1")).not.toBeInTheDocument();
});

test("paginates 10 per page", async () => {
  API.get.mockResolvedValue({ data: Array.from({ length: 12 }, (_, i) => mk(i + 1)) });
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Project 1");
  expect(screen.queryByText("Project 11")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "2" }));
  expect(screen.getByText("Project 11")).toBeInTheDocument();
  expect(screen.queryByText("Project 1")).not.toBeInTheDocument();
  // search resets to page 1
  await user.type(screen.getByPlaceholderText("Search projects by name..."), "Project");
  expect(screen.getByText("Project 1")).toBeInTheDocument();
});

test.each([
  ["View Details", mk(5), "/admin/projects/p-5/edit"],
  ["View Details", mk(5, { slug: null, project_name: "My Big Site" }), "/admin/projects/my-big-site/edit"],
  ["3D Viewer", mk(5), "/viewer/p-5"],
  ["3D Viewer", mk(5, { slug: "", project_name: "A B" }), "/viewer/a-b"],
])("%s navigates for %o", async (btn, project, path) => {
  API.get.mockResolvedValue({ data: [project] });
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: btn }));
  expect(screen.getByTestId("where")).toHaveTextContent(path);
});

test("Create Project navigates to the create page", async () => {
  API.get.mockResolvedValue({ data: [] });
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: /create project/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/projects/create");
});

test("Project Management menu toggles per card", async () => {
  API.get.mockResolvedValue({ data: [mk(1), mk(2)] });
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Project 1");
  const toggles = screen.getAllByRole("button", { name: /project management/i });
  await user.click(toggles[0]);
  expect(screen.getAllByText("Project Overview")).toHaveLength(1);
  await user.click(toggles[1]); // opening another closes the first
  expect(screen.getAllByText("Project Overview")).toHaveLength(1);
  await user.click(toggles[1]);
  await waitFor(() => expect(screen.queryByText("Project Overview")).not.toBeInTheDocument());
});
