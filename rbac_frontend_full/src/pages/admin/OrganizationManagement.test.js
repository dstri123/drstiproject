import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import OrganizationManagement from "./OrganizationManagement";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const ORGS = [
  { id: 1, organization_name: "Acme", username: "acme_admin", created_at: "2026-01-15T10:00:00Z" },
  { id: 2, organization_name: "Globex", username: null, created_at: null },
];

function mockApi({ orgs = ORGS, admins = { 1: [{}, {}, {}], 2: "fail" } } = {}) {
  API.get.mockImplementation((url) => {
    if (url === "auth/organizations/") return Promise.resolve({ data: orgs });
    const m = url.match(/^auth\/organizations\/(\d+)\/admins\/$/);
    if (m) {
      const a = admins[m[1]];
      return a === "fail" ? Promise.reject(new Error("x")) : Promise.resolve({ data: a || [] });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/superadmin/organizations"]}>
      <Routes>
        <Route path="/superadmin/organizations" element={<OrganizationManagement />} />
        <Route path="/superadmin/organizations/create" element={<div>create page</div>} />
        <Route path="/superadmin/organizations/:id/edit" element={<div>edit page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const table = () => screen.getByRole("table");

afterEach(() => jest.restoreAllMocks());

test("lists organizations with admin, formatted date, and +N extra admins badge", async () => {
  mockApi();
  renderPage();
  expect(await within(table()).findByText("Acme")).toBeInTheDocument();
  const acmeRow = within(table()).getByText("Acme").closest("tr");
  expect(within(acmeRow).getByText("acme_admin")).toBeInTheDocument();
  expect(within(acmeRow).getByText("Jan 15, 2026")).toBeInTheDocument();
  expect(await within(acmeRow).findByText("2")).toBeInTheDocument(); // 3 admins → +2

  const globexRow = within(table()).getByText("Globex").closest("tr");
  expect(within(globexRow).getAllByText("-")).toHaveLength(2); // no admin, no date
  expect(API.get).toHaveBeenCalledWith("auth/organizations/1/admins/");
  expect(API.get).toHaveBeenCalledWith("auth/organizations/2/admins/");
});

test("search filters by organization name (case-insensitive) and shows the count", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await within(table()).findByText("Acme");
  await user.type(screen.getByPlaceholderText("Search organizations..."), "GLO");
  expect(screen.getByText("Found 1 result(s)")).toBeInTheDocument();
  expect(within(table()).queryByText("Acme")).not.toBeInTheDocument();
  expect(within(table()).getByText("Globex")).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText("Search organizations..."));
  await user.type(screen.getByPlaceholderText("Search organizations..."), "zzz");
  expect(within(table()).getByText("No organizations yet")).toBeInTheDocument();
});

test("empty list shows the empty state", async () => {
  mockApi({ orgs: [] });
  renderPage();
  await waitFor(() => expect(API.get).toHaveBeenCalled());
  expect(screen.getAllByText("No organizations yet")).toHaveLength(2); // table + mobile
});

test("Create Organization navigates to the create page", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: /create organization/i }));
  expect(screen.getByText("create page")).toBeInTheDocument();
});

test("Edit navigates to the org edit page", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  const row = (await within(table()).findByText("Acme")).closest("tr");
  await user.click(within(row).getByRole("button", { name: /edit/i }));
  expect(screen.getByText("edit page")).toBeInTheDocument();
});

test("Delete asks for confirmation, deletes, toasts and refetches", async () => {
  mockApi();
  jest.spyOn(window, "confirm").mockReturnValue(true);
  API.delete.mockResolvedValue({});
  const user = userEvent.setup();
  renderPage();
  const row = (await within(table()).findByText("Acme")).closest("tr");
  const callsBefore = API.get.mock.calls.filter(([u]) => u === "auth/organizations/").length;
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  expect(window.confirm).toHaveBeenCalledWith("Delete this organization?");
  expect(API.delete).toHaveBeenCalledWith("auth/organizations/1/");
  await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Organization deleted successfully!"));
  await waitFor(() =>
    expect(API.get.mock.calls.filter(([u]) => u === "auth/organizations/").length).toBe(callsBefore + 1)
  );
});

test("Delete cancelled does nothing; delete failure toasts an error", async () => {
  mockApi();
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderPage();
  const row = (await within(table()).findByText("Acme")).closest("tr");
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  expect(API.delete).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  API.delete.mockRejectedValue(new Error("x"));
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to delete organization"));
});
