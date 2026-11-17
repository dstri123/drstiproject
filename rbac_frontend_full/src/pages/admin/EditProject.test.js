import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import EditProject from "./EditProject";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const PROJECT = {
  id: 5,
  slug: "tower-a",
  project_name: "Tower A",
  description: "Main tower",
  start: "2026-01-01",
  end: "2026-12-31",
  latitude: "12.5",
  longitude: "77.2",
  footprint_area: 2500,
  image: "http://host/media/a.png",
  users: [{ id: 1, username: "eng1" }],
};
const USERS = [
  { id: 1, username: "eng1", first_name: "Eve", last_name: "Eng", sub_role: "project_engineer" },
  { id: 2, username: "data1", first_name: "Dan", last_name: "Data", sub_role: "data_contributor" },
  { id: 3, username: "boss", first_name: "Bo", last_name: "Boss", role: "admin", sub_role: null },
];

function mockApi({ projects = [PROJECT], users = USERS, failProjects = false, failUsers = false } = {}) {
  API.get.mockImplementation((url) => {
    if (url === "projects/") return failProjects ? Promise.reject(new Error("x")) : Promise.resolve({ data: projects });
    if (url === "users/") return failUsers ? Promise.reject(new Error("x")) : Promise.resolve({ data: users });
    return Promise.reject(new Error(url));
  });
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderPage(slug = "tower-a") {
  render(
    <MemoryRouter initialEntries={[`/admin/projects/${slug}/edit`]}>
      <Routes>
        <Route path="/admin/projects/:slug/edit" element={<EditProject />} />
        <Route path="/admin/projects" element={<div>projects list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const saveBtn = () => screen.getByRole("button", { name: "Save Changes" });
const availableSection = () => screen.getByText("Available Contributors").parentElement;
const assignedSection = () => screen.getByText("Assigned Contributors").parentElement;

test("loads the project by slug and prefills the form, image and assigned users", async () => {
  mockApi();
  renderPage();
  expect(await screen.findByRole("heading", { name: "Edit Tower A" })).toBeInTheDocument();
  expect(screen.getByLabelText("Project Name *")).toHaveValue("Tower A");
  expect(screen.getByLabelText("Description *")).toHaveValue("Main tower");
  expect(screen.getByPlaceholderText("Pick a start date")).toHaveValue("2026-01-01");
  expect(screen.getByPlaceholderText("Pick an end date")).toHaveValue("2026-12-31");
  expect(screen.getByAltText("Project")).toHaveAttribute("src", PROJECT.image);
  expect(within(assignedSection()).getByText("eng1")).toBeInTheDocument();
  // already-assigned users are excluded from the available list
  expect(await within(availableSection()).findByText("data1")).toBeInTheDocument();
  expect(within(availableSection()).queryByText("eng1")).not.toBeInTheDocument();
});

test("unknown slug: toast + redirect", async () => {
  mockApi();
  renderPage("nope");
  expect(await screen.findByText("projects list")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Project not found");
});

test("project load failure: toast + redirect", async () => {
  mockApi({ failProjects: true });
  renderPage();
  expect(await screen.findByText("projects list")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Failed to load project");
});

test("contributor load failure toasts", async () => {
  mockApi({ failUsers: true });
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to load contributors"));
});

test("project with no image/users/optional fields renders placeholders", async () => {
  mockApi({ projects: [{ id: 6, slug: "s", project_name: "S" }] });
  renderPage("s");
  expect(await screen.findByText("No image selected")).toBeInTheDocument();
  expect(screen.getByLabelText("Project Name *")).toHaveValue("S");
  expect(screen.queryByText("Assigned Contributors")).not.toBeInTheDocument();
});

test("validation: required fields and end-before-start", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await user.clear(screen.getByLabelText("Project Name *"));
  await user.clear(screen.getByLabelText("Description *"));
  fireEvent.change(screen.getByPlaceholderText("Pick a start date"), { target: { value: "" } });
  fireEvent.change(screen.getByPlaceholderText("Pick an end date"), { target: { value: "" } });
  await user.click(saveBtn());
  for (const msg of ["Project name is required", "Description is required", "Start date is required", "End date is required"]) {
    expect(screen.getByText(msg)).toBeInTheDocument();
  }
  await user.type(screen.getByLabelText("Project Name *"), "X");
  expect(screen.queryByText("Project name is required")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Description *"), "Y");
  fireEvent.change(screen.getByPlaceholderText("Pick a start date"), { target: { value: "2026-06-01" } });
  fireEvent.change(screen.getByPlaceholderText("Pick an end date"), { target: { value: "2026-05-01" } });
  await user.click(saveBtn());
  expect(screen.getByText("End date must be after start date")).toBeInTheDocument();
  expect(API.put).not.toHaveBeenCalled();
});

test("save PUTs multipart to projects/<id>/, syncs contributor adds/removes, then redirects", async () => {
  mockApi();
  API.put.mockResolvedValue({ data: {} });
  API.post.mockResolvedValue({ data: {} });
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await within(availableSection()).findByText("data1");

  await user.clear(screen.getByLabelText("Project Name *"));
  await user.type(screen.getByLabelText("Project Name *"), "Tower B");
  // add data1 + boss, remove eng1
  const rows = within(availableSection()).getAllByRole("row");
  await user.click(within(rows[1]).getByRole("checkbox"));
  await user.click(within(rows[2]).getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Assign (2) Contributors" }));
  const engRow = within(assignedSection()).getByText("eng1").closest("tr");
  await user.click(within(engRow).getByRole("button", { name: /unassign/i }));

  await user.click(saveBtn());
  const [url, fd, cfg] = API.put.mock.calls[0];
  expect(url).toBe("projects/5/");
  expect(cfg.headers["Content-Type"]).toBe("multipart/form-data");
  expect(Object.fromEntries(fd.entries())).toEqual({
    project_name: "Tower B",
    description: "Main tower",
    start: "2026-01-01",
    end: "2026-12-31",
    latitude: "12.5",
    longitude: "77.2",
    footprint_area: "2500",
  });
  expect(API.post).toHaveBeenCalledWith("assign-user/", { project_id: 5, user_ids: [2, 3] });
  expect(API.post).toHaveBeenCalledWith("remove-user/", { project_id: 5, user_id: 1 });
  expect(mockToast.success).toHaveBeenCalledWith("Project updated successfully!");
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText("projects list")).toBeInTheDocument();
});

test("no contributor changes: no assign/remove calls", async () => {
  mockApi();
  API.put.mockResolvedValue({ data: {} });
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await user.click(saveBtn());
  await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  expect(API.post).not.toHaveBeenCalled();
});

test("contributor sync failure still reports project saved", async () => {
  mockApi();
  API.put.mockResolvedValue({ data: {} });
  API.post.mockRejectedValue(new Error("x"));
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  const engRow = within(assignedSection()).getByText("eng1").closest("tr");
  await user.click(within(engRow).getByRole("button", { name: /unassign/i }));
  await user.click(saveBtn());
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Project details saved, but updating contributors failed"));
  expect(mockToast.success).toHaveBeenCalledWith("Project updated successfully!");
});

test.each([
  [{ response: { data: { detail: "Denied" } } }, "Denied"],
  [{ response: { data: { error: "Bad date" } } }, "Bad date"],
  [new Error("Network Error"), "Network Error"],
  [{}, "Failed to update project"],
])("save error %# is shown", async (err, msg) => {
  mockApi();
  API.put.mockRejectedValue(err);
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await user.click(saveBtn());
  expect(await screen.findByText(msg)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(msg);
});

test("image: rejects non-images, previews and sends new image, Remove Image clears preview", async () => {
  mockApi();
  API.put.mockResolvedValue({ data: {} });
  const user = userEvent.setup({ applyAccept: false });
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await user.upload(screen.getByLabelText("Upload Image"), new File(["x"], "a.txt", { type: "text/plain" }));
  expect(screen.getByText("Please upload a valid image file")).toBeInTheDocument();
  const img = new File(["png"], "b.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Upload Image"), img);
  await waitFor(() => expect(screen.getByAltText("Project").getAttribute("src")).toMatch(/^data:/));
  await user.click(saveBtn());
  expect(API.put.mock.calls[0][1].get("image")).toBe(img);

  await user.click(screen.getByRole("button", { name: /remove image/i }));
  expect(screen.getByText("No image selected")).toBeInTheDocument();
});

test("contributor search and role filter", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Tower A" });
  await within(availableSection()).findByText("data1");
  await user.type(screen.getByPlaceholderText("Search by name or username..."), "bo");
  expect(within(availableSection()).queryByText("data1")).not.toBeInTheDocument();
  expect(within(availableSection()).getByText("boss")).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText("Search by name or username..."));
  await user.selectOptions(within(availableSection()).getByRole("combobox"), "admin");
  expect(within(availableSection()).getByText("boss")).toBeInTheDocument();
  expect(within(availableSection()).queryByText("data1")).not.toBeInTheDocument();
});

test("Cancel navigates back", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(screen.getByText("projects list")).toBeInTheDocument();
});
