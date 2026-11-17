import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import API from "../../api/axios";
import ProjectManagement from "./ProjectManagement";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const PROJECTS = [
  {
    id: 5,
    project_name: "Tower A",
    description: "Main tower",
    start: "2026-01-01",
    end: "2026-12-31",
    image: "http://x/a.png",
    users: [{ id: 1, username: "eng1", sub_role: "project_engineer" }, { id: 2, username: "plain" }],
  },
  { id: 6, project_name: "Bridge", description: "", users: [] },
];
const USERS = [
  { id: 1, username: "eng1", sub_role: "project_engineer" },
  { id: 2, username: "dc", sub_role: "Data Contributor" },
  { id: 3, username: "pm", sub_role: "project-manager" },
];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function mockApi(projects = PROJECTS) {
  API.get.mockImplementation((url) =>
    Promise.resolve({ data: url === "projects/" ? projects : USERS })
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/project-management"]}>
      <Routes>
        <Route path="/admin/project-management" element={<ProjectManagement />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => jest.restoreAllMocks());

async function openDetails(user, name = "Tower A") {
  const card = (await screen.findByText(name)).closest(".cursor-pointer");
  await user.click(within(card).getByRole("button", { name: /view details/i }));
  return screen.findByRole("dialog");
}

test("lists project cards with user counts and start date", async () => {
  mockApi();
  renderPage();
  expect(await screen.findByText("Tower A")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("projects/");
  expect(API.get).toHaveBeenCalledWith("users/");
  expect(screen.getByText("Users: 2")).toBeInTheDocument();
  expect(screen.getByText("Start: 2026-01-01")).toBeInTheDocument();
  expect(screen.getByText("No description provided.")).toBeInTheDocument();
});

test("search filters; no match shows empty state", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Tower A");
  await user.type(screen.getByPlaceholderText("Search projects..."), "brid");
  expect(screen.queryByText("Tower A")).not.toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("Search projects..."), "zzz");
  expect(screen.getByText("No projects found.")).toBeInTheDocument();
});

test("3D Viewer navigates with the id_name slug", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  const card = (await screen.findByText("Tower A")).closest(".cursor-pointer");
  await user.click(within(card).getByRole("button", { name: /3d viewer/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/viewer/5_Tower A");
});

test("card image upload PATCHes projects/<id>/ and refetches", async () => {
  mockApi();
  API.patch.mockResolvedValue({});
  renderPage();
  const card = (await screen.findByText("Tower A")).closest(".cursor-pointer");
  const input = card.querySelector('input[type="file"]');
  const img = new File(["p"], "a.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [img] } });
  await waitFor(() => expect(API.patch).toHaveBeenCalled());
  const [url, fd] = API.patch.mock.calls[0];
  expect(url).toBe("projects/5/");
  expect(fd.get("image")).toBe(img);
  await waitFor(() => expect(API.get.mock.calls.filter(([u]) => u === "projects/").length).toBe(2));
  // empty selection does nothing
  fireEvent.change(input, { target: { files: [] } });
  expect(API.patch).toHaveBeenCalledTimes(1);
});

test("details dialog shows dates, description and assigned users", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  const dialog = await openDetails(user);
  expect(within(dialog).getByRole("heading", { name: "Tower A" })).toBeInTheDocument();
  expect(within(dialog).getByText("2026-12-31")).toBeInTheDocument();
  expect(within(dialog).getByText("eng1")).toBeInTheDocument();
  expect(within(dialog).getByText("(No Role)")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: /open 3d viewer/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/viewer/5_Tower A");
});

test("details for a project with no users/image", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  const dialog = await openDetails(user, "Bridge");
  expect(within(dialog).getByText("No users assigned to this project.")).toBeInTheDocument();
  expect(within(dialog).getByText("No Image Available")).toBeInTheDocument();
  expect(within(dialog).getAllByText("-")).toHaveLength(2);
});

test("Edit Info PUTs trimmed name and dates (both field spellings) and toasts", async () => {
  mockApi();
  API.put.mockResolvedValue({});
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  await user.click(within(details).getByRole("button", { name: /edit info/i }));
  const edit = await screen.findByRole("dialog", { name: "Edit Project" });
  const name = within(edit).getAllByRole("textbox")[0];
  await user.clear(name);
  await user.type(name, " Tower Z ");
  fireEvent.change(within(edit).getByPlaceholderText("Pick an end date"), { target: { value: "2027-01-31" } });
  await user.click(within(edit).getByRole("button", { name: "Update" }));
  expect(API.put).toHaveBeenCalledWith("projects/5/", {
    project_name: "Tower Z",
    description: "Main tower",
    start: "2026-01-01",
    end: "2027-01-31",
    start_date: "2026-01-01",
    end_date: "2027-01-31",
  });
  await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Project updated successfully"));
});

test("Edit failure toasts the server error", async () => {
  mockApi();
  API.put.mockRejectedValue({ response: { data: { error: "bad date" } } });
  jest.spyOn(console, "error").mockImplementation(() => {});
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  await user.click(within(details).getByRole("button", { name: /edit info/i }));
  const edit = await screen.findByRole("dialog", { name: "Edit Project" });
  await user.type(within(edit).getAllByRole("textbox")[1], "!");
  fireEvent.change(within(edit).getByPlaceholderText("Pick a start date"), { target: { value: "" } });
  await user.click(within(edit).getByRole("button", { name: "Update" }));
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("bad date"));
  expect(API.put.mock.calls[0][1]).toMatchObject({ description: "Main tower!", start: "" });
});

test("Delete confirms and calls projects/<id>/delete/", async () => {
  mockApi();
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  API.delete.mockResolvedValue({});
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  await user.click(within(details).getByRole("button", { name: /delete/i }));
  expect(API.delete).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await user.click(within(details).getByRole("button", { name: /delete/i }));
  expect(API.delete).toHaveBeenCalledWith("projects/5/delete/");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("Add User drawer filters by search/role and assigns selected users", async () => {
  mockApi();
  API.post.mockResolvedValue({});
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  await user.click(within(details).getByRole("button", { name: /add user/i }));
  const drawer = await screen.findByRole("dialog", { name: "Assign Users" });
  expect(within(drawer).getByText("Tower A")).toBeInTheDocument();
  const roleSelect = within(drawer).getByRole("combobox");
  const multi = within(drawer).getByRole("listbox");
  // role filter normalises "Data Contributor" / "project-manager"
  await user.selectOptions(roleSelect, "data_contributor");
  expect(within(drawer).getAllByRole("option").map((o) => o.textContent)).toContain("dc - Data Contributor");
  await user.selectOptions(roleSelect, "project_manager");
  expect(within(drawer).getByRole("option", { name: "pm - project-manager" })).toBeInTheDocument();
  await user.selectOptions(roleSelect, "all");
  await user.type(within(drawer).getByPlaceholderText("Search by username"), "zzz");
  expect(within(drawer).getByText("No users match the search or role filter.")).toBeInTheDocument();
  await user.clear(within(drawer).getByPlaceholderText("Search by username"));

  await user.selectOptions(multi, ["2", "3"]);
  await user.click(within(drawer).getByRole("button", { name: "Assign" }));
  expect(API.post).toHaveBeenCalledWith("assign-user/", { project_id: 5, user_ids: ["2", "3"] });
});

test("removing a user chip confirms and posts remove-user/", async () => {
  mockApi();
  API.post.mockResolvedValue({});
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  const chip = within(details).getByText("eng1").parentElement;
  await user.click(chip.lastElementChild);
  expect(confirm).toHaveBeenCalledWith("Remove user from project?");
  expect(API.post).toHaveBeenCalledWith("remove-user/", { project_id: 5, user_id: 1 });
  expect(screen.queryByRole("dialog", { name: "Change Role" })).not.toBeInTheDocument();
});

test("clicking a user chip opens Change Role and PUTs update-user-role/", async () => {
  mockApi();
  API.put.mockResolvedValue({});
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  await user.click(within(details).getByText("plain"));
  const roleDlg = await screen.findByRole("dialog", { name: "Change Role" });
  expect(within(roleDlg).getByText("plain - Project Manager")).toBeInTheDocument(); // default
  await user.selectOptions(within(roleDlg).getByRole("combobox"), "data_contributor");
  expect(within(roleDlg).getByText("plain - Data Contributor")).toBeInTheDocument();
  await user.click(within(roleDlg).getByRole("button", { name: "Update" }));
  expect(API.put).toHaveBeenCalledWith("update-user-role/2/", { sub_role: "data_contributor" });
});

test("existing sub_role preselected in Change Role", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  const details = await openDetails(user);
  await user.click(within(details).getByText("eng1"));
  const roleDlg = await screen.findByRole("dialog", { name: "Change Role" });
  expect(within(roleDlg).getByRole("combobox")).toHaveValue("project_engineer");
  expect(within(roleDlg).getByText("eng1 - Project Engineer")).toBeInTheDocument();
});
