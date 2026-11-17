import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import API from "../../api/axios";
import ProjectContributors from "./ProjectContributors";
import { exportContributorsToCSV, parseCSVFile } from "../../utils/csvUtils";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));
jest.mock("../../utils/csvUtils", () => ({
  exportContributorsToCSV: jest.fn(),
  parseCSVFile: jest.fn(),
  downloadCSVTemplate: jest.fn(),
}));

const USERS = [
  { id: 1, username: "charlie", first_name: "Zed", last_name: "C", email: "c@x.com", sub_role: "project_engineer" },
  { id: 2, username: "alice", first_name: "Yan", last_name: "A", email: "a@x.com", sub_role: "data_contributor" },
  { id: 3, username: "Bob", first_name: "Xi", last_name: "", email: "", role: "admin", sub_role: null },
];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/project-user"]}>
      <Routes>
        <Route path="/admin/project-user" element={<ProjectContributors />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const table = () => screen.getByRole("table");
const usernamesInTable = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("loads users/ and lists them sorted by username asc, with role badges", async () => {
  API.get.mockResolvedValue({ data: USERS });
  renderPage();
  expect(within(table()).getByText("Loading contributors...")).toBeInTheDocument();
  await within(table()).findByText("alice");
  expect(API.get).toHaveBeenCalledWith("users/");
  expect(usernamesInTable()).toEqual(["alice", "Bob", "charlie"]);
  expect(within(table()).getByText("Admin")).toBeInTheDocument();
  expect(within(table()).getByText("Data Contributor")).toBeInTheDocument();
  expect(within(table()).getByText("Xi")).toBeInTheDocument();
});

test("load failure and non-array data show the empty state", async () => {
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await within(table()).findByText("No contributors yet")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Failed to load contributors");
});

test("non-array response is treated as empty", async () => {
  API.get.mockResolvedValue({ data: { detail: "x" } });
  renderPage();
  expect(await within(table()).findByText("No contributors yet")).toBeInTheDocument();
});

test("sorting by first name / role and descending order", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const user = userEvent.setup();
  renderPage();
  await within(table()).findByText("alice");
  const [sortSelect, roleSelect] = screen.getAllByRole("combobox");
  await user.click(screen.getByTitle("Sort Descending"));
  expect(usernamesInTable()).toEqual(["charlie", "Bob", "alice"]);
  await user.click(screen.getByTitle("Sort Ascending"));
  await user.selectOptions(sortSelect, "first_name");
  expect(usernamesInTable()).toEqual(["Bob", "alice", "charlie"]); // Xi, Yan, Zed
  await user.selectOptions(sortSelect, "role");
  expect(usernamesInTable()).toEqual(["Bob", "alice", "charlie"]); // admin, data_contributor, project_engineer
  await user.selectOptions(roleSelect, "project_engineer");
  expect(usernamesInTable()).toEqual(["charlie"]);
});

test("search matches username, name or email", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const user = userEvent.setup();
  renderPage();
  await within(table()).findByText("alice");
  const search = screen.getByPlaceholderText("Search by username, name, or email...");
  await user.type(search, "c@x");
  expect(usernamesInTable()).toEqual(["charlie"]);
  expect(screen.getByText("Found 1 contributor(s)")).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, "yan");
  expect(usernamesInTable()).toEqual(["alice"]);
  await user.clear(search);
  await user.type(search, "zzz");
  expect(within(table()).getByText("No contributors yet")).toBeInTheDocument();
});

test("paginates at 10 per page", async () => {
  API.get.mockResolvedValue({
    data: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, username: `u${String(i + 1).padStart(2, "0")}` })),
  });
  const user = userEvent.setup();
  renderPage();
  await within(table()).findByText("u01");
  expect(within(table()).queryByText("u11")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "2" }));
  expect(within(table()).getByText("u11")).toBeInTheDocument();
});

test("Create and Edit navigate", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const user = userEvent.setup();
  renderPage();
  const row = (await within(table()).findByText("alice")).closest("tr");
  await user.click(within(row).getByRole("button", { name: /edit/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/project-user/2/edit");
});

test("Create Contributor navigates", async () => {
  API.get.mockResolvedValue({ data: [] });
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: /create contributor/i }));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/project-user/create");
});

test("delete: confirm, DELETE users/<id>/, refetch; cancel; server error", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderPage();
  const row = (await within(table()).findByText("alice")).closest("tr");
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  expect(API.delete).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  API.delete.mockResolvedValueOnce({});
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  expect(API.delete).toHaveBeenCalledWith("users/2/");
  await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Contributor deleted successfully!"));
  expect(API.get).toHaveBeenCalledTimes(2);

  API.delete.mockRejectedValueOnce({ response: { data: { error: "You cannot delete your own account" } } });
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("You cannot delete your own account"));
  API.delete.mockRejectedValueOnce(new Error("x"));
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to delete contributor"));
});

test("Export CSV toasts the util result", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const user = userEvent.setup();
  renderPage();
  await within(table()).findByText("alice");
  exportContributorsToCSV.mockReturnValueOnce({ success: true, message: "Contributors exported successfully" });
  await user.click(screen.getByRole("button", { name: /export csv/i }));
  expect(exportContributorsToCSV).toHaveBeenCalledWith(USERS);
  expect(mockToast.success).toHaveBeenCalledWith("Contributors exported successfully");
  exportContributorsToCSV.mockReturnValueOnce({ success: false, message: "No contributors to export" });
  await user.click(screen.getByRole("button", { name: /export csv/i }));
  expect(mockToast.error).toHaveBeenCalledWith("No contributors to export");
});

describe("Import CSV", () => {
  const csvInput = () => document.getElementById("csv-import");
  const file = () => new File(["x"], "c.csv", { type: "text/csv" });

  // Regression: first/last name were parsed from the CSV but dropped from the payload.
  test("posts each parsed row (incl. first/last name) and reports counts", async () => {
    API.get.mockResolvedValue({ data: [] });
    parseCSVFile.mockResolvedValue([
      { username: "n1", email: "n1@x.com", first_name: "Nia", last_name: "One", role: "site_engineer" },
      { username: "n2", email: "n2@x.com", first_name: "Ned", last_name: "Two", role: "project_engineer" },
    ]);
    API.post.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("dup"));
    const user = userEvent.setup();
    renderPage();
    await user.upload(csvInput(), file());
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Imported 1 contributor(s), 1 failed"));
    expect(API.post).toHaveBeenCalledWith("create-user-assign/", {
      username: "n1",
      email: "n1@x.com",
      first_name: "Nia",
      last_name: "One",
      password: expect.stringMatching(/^.{12}$/),
      sub_role: "site_engineer",
    });
    expect(API.post).toHaveBeenCalledTimes(2);
    expect(csvInput().value).toBe("");
  });

  test("all rows imported: no 'failed' suffix", async () => {
    API.get.mockResolvedValue({ data: [] });
    parseCSVFile.mockResolvedValue([{ username: "n1", email: "e", first_name: "", last_name: "", role: "admin" }]);
    API.post.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();
    await user.upload(csvInput(), file());
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Imported 1 contributor(s)"));
  });

  test("parse error is toasted", async () => {
    API.get.mockResolvedValue({ data: [] });
    parseCSVFile.mockRejectedValue("CSV must contain columns: username, email");
    const user = userEvent.setup();
    renderPage();
    await user.upload(csvInput(), file());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("CSV must contain columns: username, email"));
    expect(API.post).not.toHaveBeenCalled();
  });

  test("Import button opens the hidden file input", async () => {
    API.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderPage();
    const click = jest.spyOn(csvInput(), "click");
    await user.click(screen.getByRole("button", { name: /import csv/i }));
    expect(click).toHaveBeenCalled();
  });
});
