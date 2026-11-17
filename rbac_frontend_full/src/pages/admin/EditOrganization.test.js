import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import EditOrganization from "./EditOrganization";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));
let mockEmail;
jest.mock("../../hooks/useCheckUsername", () => ({ useCheckEmail: () => mockEmail }));

const ORGS = [{ id: 7, organization_name: "Acme", username: "a1", created_at: "2026-03-02T00:00:00Z" }];
const ADMINS = [
  { id: 11, username: "a1", email: "a1@acme.com", first_name: "Ann", last_name: "One", projects_count: 0, has_dependencies: false },
  { id: 12, username: "a2", email: "a2@acme.com", first_name: "Ben", last_name: "Two", projects_count: 3, has_dependencies: true },
];

function mockApi({ orgs = ORGS, admins = ADMINS, fail = false } = {}) {
  API.get.mockImplementation((url) => {
    if (fail) return Promise.reject(new Error("down"));
    if (url === "auth/organizations/") return Promise.resolve({ data: orgs });
    if (url === "auth/organizations/7/admins/") return Promise.resolve({ data: admins });
    return Promise.reject(new Error(url));
  });
}

beforeEach(() => {
  mockEmail = { checking: false, isAvailable: true, debouncedCheck: jest.fn() };
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderPage(id = "7") {
  render(
    <MemoryRouter initialEntries={[`/superadmin/organizations/${id}/edit`]}>
      <Routes>
        <Route path="/superadmin/organizations/:id/edit" element={<EditOrganization />} />
        <Route path="/superadmin/organizations" element={<div>orgs list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const rowOf = (username) => within(screen.getByRole("table")).getByText(username).closest("tr");

test("loads org + admins and pre-fills the name", async () => {
  mockApi();
  renderPage();
  expect(await screen.findByRole("heading", { name: "Edit Acme" })).toBeInTheDocument();
  expect(screen.getByLabelText("Organization Name")).toHaveValue("Acme");
  expect(screen.getByText("#7")).toBeInTheDocument();
  expect(screen.getByText("Mar 2, 2026")).toBeInTheDocument();
  expect(screen.getByText("a1@acme.com")).toBeInTheDocument();
  expect(screen.getByText("Note: Admins with projects cannot be edited or deleted.")).toBeInTheDocument();
});

test("unknown org id: error toast and redirect to list", async () => {
  mockApi();
  renderPage("99");
  expect(await screen.findByText("orgs list")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Organization not found");
});

test("load failure: error toast and redirect", async () => {
  mockApi({ fail: true });
  renderPage();
  expect(await screen.findByText("orgs list")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Failed to load organization");
});

test("org with no admins shows the empty state", async () => {
  mockApi({ admins: null });
  renderPage();
  expect(await screen.findByText("No admin users")).toBeInTheDocument();
});

test("Save is disabled until the name changes; empty name disables it", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  const save = await screen.findByRole("button", { name: "Save Changes" });
  expect(save).toBeDisabled();
  await user.clear(screen.getByLabelText("Organization Name"));
  expect(save).toBeDisabled();
  await user.type(screen.getByLabelText("Organization Name"), "Acme Corp");
  expect(save).toBeEnabled();
});

test("rename PUTs the new name, toasts, and navigates back after 1s", async () => {
  mockApi();
  API.put.mockResolvedValue({});
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  renderPage();
  await screen.findByRole("heading", { name: "Edit Acme" });
  await user.clear(screen.getByLabelText("Organization Name"));
  await user.type(screen.getByLabelText("Organization Name"), "Acme Corp");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(API.put).toHaveBeenCalledWith("auth/organizations/7/update/", { organization_name: "Acme Corp" });
  expect(mockToast.success).toHaveBeenCalledWith("Organization updated successfully!");
  act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByText("orgs list")).toBeInTheDocument();
});

test("rename failure shows an error", async () => {
  mockApi();
  API.put.mockRejectedValue(new Error("x"));
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Acme" });
  await user.type(screen.getByLabelText("Organization Name"), "!");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByText("Failed to update organization")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Failed to update organization");
});

test("Cancel and Back navigate to the list", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(screen.getByText("orgs list")).toBeInTheDocument();
});

test("admins with dependencies have disabled edit/delete buttons", async () => {
  mockApi();
  renderPage();
  await screen.findByText("a2");
  const [edit, del] = within(rowOf("a2")).getAllByRole("button");
  expect(edit).toBeDisabled();
  expect(del).toBeDisabled();
  expect(del).toHaveAttribute("title", "Cannot delete: has 3 project(s)");
  const [edit1] = within(rowOf("a1")).getAllByRole("button");
  expect(edit1).toBeEnabled();
});

describe("edit admin modal", () => {
  async function openModal(user) {
    mockApi();
    renderPage();
    await screen.findByText("a1");
    await user.click(within(rowOf("a1")).getByTitle("Edit admin"));
    expect(screen.getByRole("heading", { name: "Edit Admin: a1" })).toBeInTheDocument();
  }

  test("prefills fields; unchanged email saves without availability check", async () => {
    const user = userEvent.setup();
    API.put.mockResolvedValue({});
    await openModal(user);
    expect(screen.getByPlaceholderText("email@example.com")).toHaveValue("a1@acme.com");
    expect(mockEmail.debouncedCheck).not.toHaveBeenCalled();
    await user.clear(screen.getByPlaceholderText("First name"));
    await user.type(screen.getByPlaceholderText("First name"), "Anna");
    await user.type(screen.getByPlaceholderText("Leave empty to keep current password"), "NewPw1!");
    await user.click(screen.getByRole("button", { name: "Save Admin" }));
    expect(API.put).toHaveBeenCalledWith("auth/admins/11/", {
      email: "a1@acme.com",
      first_name: "Anna",
      last_name: "One",
      password: "NewPw1!",
    });
    expect(mockToast.success).toHaveBeenCalledWith("Admin updated successfully!");
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Edit Admin/ })).not.toBeInTheDocument());
  });

  test("changed email is checked; updated email appears in the table", async () => {
    const user = userEvent.setup();
    API.put.mockResolvedValue({});
    await openModal(user);
    const email = screen.getByPlaceholderText("email@example.com");
    await user.clear(email);
    await user.type(email, "new@acme.com");
    expect(mockEmail.debouncedCheck).toHaveBeenLastCalledWith("new@acme.com");
    await user.click(screen.getByRole("button", { name: "Save Admin" }));
    expect(await within(screen.getByRole("table")).findByText("new@acme.com")).toBeInTheDocument();
  });

  // Regression: editErrors.email was set but never rendered, so Save silently did nothing.
  test("changed email that is taken shows 'Email is already in use' and does not save", async () => {
    mockEmail = { ...mockEmail, isAvailable: false };
    const user = userEvent.setup();
    await openModal(user);
    const email = screen.getByPlaceholderText("email@example.com");
    await user.clear(email);
    await user.type(email, "taken@acme.com");
    await user.click(screen.getByRole("button", { name: "Save Admin" }));
    expect(screen.getByText("Email is already in use")).toBeInTheDocument();
    expect(API.put).not.toHaveBeenCalled();
  });

  test("blank required field shows 'All fields are required'", async () => {
    const user = userEvent.setup();
    await openModal(user);
    await user.clear(screen.getByPlaceholderText("Last name"));
    await user.click(screen.getByRole("button", { name: "Save Admin" }));
    expect(screen.getByText("All fields are required")).toBeInTheDocument();
    expect(API.put).not.toHaveBeenCalled();
  });

  test("Save disabled while checking email", async () => {
    mockEmail = { ...mockEmail, checking: true };
    const user = userEvent.setup();
    await openModal(user);
    expect(screen.getByRole("button", { name: "Save Admin" })).toBeDisabled();
  });

  test("server error is shown in the modal (with fallback)", async () => {
    const user = userEvent.setup();
    await openModal(user);
    API.put.mockRejectedValueOnce({ response: { data: { error: "Cannot edit admin who has 1 project(s)." } } });
    await user.click(screen.getByRole("button", { name: "Save Admin" }));
    expect(await screen.findByText("Cannot edit admin who has 1 project(s).")).toBeInTheDocument();
    API.put.mockRejectedValueOnce(new Error("x"));
    await user.click(screen.getByRole("button", { name: "Save Admin" }));
    expect(await screen.findByText("Failed to update admin")).toBeInTheDocument();
  });

  test("Cancel closes the modal", async () => {
    const user = userEvent.setup();
    await openModal(user);
    await user.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1));
    expect(screen.queryByRole("heading", { name: /Edit Admin/ })).not.toBeInTheDocument();
  });
});

describe("delete admin", () => {
  test("confirmed delete removes the row", async () => {
    mockApi();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    API.delete.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("a1");
    await user.click(within(rowOf("a1")).getByTitle("Delete admin"));
    expect(window.confirm).toHaveBeenCalledWith("Are you sure you want to delete admin a1?");
    expect(API.delete).toHaveBeenCalledWith("auth/admins/11/");
    await waitFor(() => expect(screen.queryByText("a1@acme.com")).not.toBeInTheDocument());
    expect(mockToast.success).toHaveBeenCalledWith("Admin deleted successfully!");
  });

  test("cancelled confirm does nothing; failure toasts server error", async () => {
    mockApi();
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("a1");
    await user.click(within(rowOf("a1")).getByTitle("Delete admin"));
    expect(API.delete).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    API.delete.mockRejectedValueOnce({ response: { data: { error: "Cannot delete admin who has 2 project(s)" } } });
    await user.click(within(rowOf("a1")).getByTitle("Delete admin"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Cannot delete admin who has 2 project(s)"));
    API.delete.mockRejectedValueOnce(new Error("x"));
    await user.click(within(rowOf("a1")).getByTitle("Delete admin"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to delete admin"));
  });
});
