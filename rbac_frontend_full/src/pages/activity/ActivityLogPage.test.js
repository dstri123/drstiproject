import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API from "../../api/axios";
import ActivityLogPage from "./ActivityLogPage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const LOGS = [
  {
    id: 1,
    created_at: "2026-01-02T10:00:00Z",
    username: "alice",
    user_role: "project_manager",
    action: "upload",
    action_label: "Upload",
    description: "Uploaded model.ifc",
    note: "first upload",
    project_name: "Tower A",
    target_type: "bim",
    target_name: "model.ifc",
    ip_address: "10.0.0.1",
    method: "POST",
    path: "/api/v1/projects/1/bim/",
    details: { changes: { file_name: ["old.ifc", "model.ifc"], meta: [null, { a: 1 }] } },
    edited_at: "2026-01-03T10:00:00Z",
    edited_by_username: "boss",
  },
  {
    id: 2,
    created_at: "2026-01-01T09:00:00Z",
    username: "",
    user_role: "",
    action: "mystery",
    action_label: "Mystery",
    description: "Deleted 2 activity log entries",
    note: "",
    project_name: "",
    details: {
      deleted: [
        { id: 7, created_at: "2025-12-31T00:00:00Z", username: "bob", description: "Old thing" },
      ],
    },
  },
];

const FILTERS = {
  users: [{ id: 5, username: "alice" }],
  projects: [{ id: 9, name: "Tower A" }],
  actions: [
    { value: "upload", label: "Upload" },
    { value: "delete", label: "Delete" },
  ],
};

function mockApi({ logs = LOGS, canEdit = false, count, totalPages = 1, page = 1, listError } = {}) {
  API.get.mockImplementation((url, config) => {
    if (url === "activity/filters/") return Promise.resolve({ data: FILTERS });
    if (url === "activity/") {
      if (listError) return Promise.reject(listError);
      return Promise.resolve({
        data: {
          results: logs,
          count: count ?? logs.length,
          total_pages: totalPages,
          page: config?.params?.page ?? page,
          can_edit: canEdit,
        },
      });
    }
    if (url === "activity/export/") return Promise.resolve({ data: new Blob(["a,b"]) });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

const listCalls = () => API.get.mock.calls.filter(([u]) => u === "activity/").map(([, c]) => c.params);
const lastListParams = () => listCalls().at(-1);

beforeEach(() => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  jest.spyOn(console, "error").mockImplementation(() => {});
  // Radix warns that DialogContent has no Description; not under test here.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test("loads logs and filter options with the default query", async () => {
  mockApi();
  render(<ActivityLogPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Activity Log" })).toBeInTheDocument();
  expect(screen.getAllByText("Loading activity...").length).toBeGreaterThan(0);
  expect((await screen.findAllByText("Uploaded model.ifc")).length).toBe(2); // desktop + mobile
  expect(lastListParams()).toEqual({ page: 1, page_size: 25 });
  expect(API.get).toHaveBeenCalledWith("activity/filters/", { params: {} });
  expect(screen.getAllByText("Note: first upload").length).toBeGreaterThan(0);
  expect(screen.getByText("Project Manager")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Tower A" })).toBeInTheDocument();
  expect(screen.getByText(/2 entries · Page 1 of 1/)).toBeInTheDocument();
  // read-only: no edit/delete/checkboxes
  expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("embedded mode uses an h2 title and the given description", async () => {
  mockApi();
  render(<ActivityLogPage embedded title="All activity" description="desc here" />);
  expect(screen.getByRole("heading", { level: 2, name: "All activity" })).toBeInTheDocument();
  expect(screen.getByText("desc here")).toBeInTheDocument();
  await screen.findAllByText("Uploaded model.ifc");
});

test("scope params and initial filters go to the server; hideUserFilter hides the user select", async () => {
  mockApi();
  render(<ActivityLogPage scopeParams={{ owner_admin: 3 }} initialFilters={{ user: "5" }} />);
  await screen.findAllByText("Uploaded model.ifc");
  expect(lastListParams()).toEqual({ owner_admin: 3, page: 1, page_size: 25, user: "5" });
  expect(API.get).toHaveBeenCalledWith("activity/filters/", { params: { owner_admin: 3 } });
  expect(screen.getByRole("option", { name: "All users" })).toBeInTheDocument();
});

test("hideUserFilter removes the user dropdown", async () => {
  mockApi();
  render(<ActivityLogPage scopeParams={{ user: 4 }} hideUserFilter />);
  await screen.findAllByText("Uploaded model.ifc");
  expect(screen.queryByRole("option", { name: "All users" })).not.toBeInTheDocument();
  expect(lastListParams()).toEqual({ user: 4, page: 1, page_size: 25 });
});

test("403 shows the no-access screen", async () => {
  mockApi({ listError: { response: { status: 403 } } });
  render(<ActivityLogPage />);
  expect(await screen.findByText("No access")).toBeInTheDocument();
  expect(mockToast.error).not.toHaveBeenCalled();
});

test("other load errors show a toast and the empty state", async () => {
  mockApi({ listError: { response: { status: 500 } } });
  render(<ActivityLogPage />);
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to load activity log"));
  expect(screen.getAllByText("No activity recorded yet").length).toBeGreaterThan(0);
});

test("filters re-query from page 1 and can be cleared", async () => {
  mockApi();
  render(<ActivityLogPage />);
  await screen.findAllByText("Uploaded model.ifc");
  const selects = screen.getAllByRole("combobox");
  await userEvent.selectOptions(selects[0], "upload");
  await waitFor(() => expect(lastListParams()).toMatchObject({ action: "upload", page: 1 }));
  await userEvent.selectOptions(selects[1], "5");
  await userEvent.selectOptions(selects[2], "9");
  await waitFor(() => expect(lastListParams()).toMatchObject({ action: "upload", user: "5", project: "9" }));

  const from = screen.getByLabelText("From");
  const to = screen.getByLabelText("To");
  fireEvent.change(from, { target: { value: "2026-01-01" } });
  fireEvent.change(to, { target: { value: "2026-01-31" } });
  await waitFor(() =>
    expect(lastListParams()).toMatchObject({
      date_from: new Date("2026-01-01T00:00:00").toISOString(),
      date_to: new Date("2026-01-31T23:59:59.999").toISOString(),
    }),
  );
  expect(to).toHaveAttribute("min", "2026-01-01");
  expect(from).toHaveAttribute("max", "2026-01-31");

  await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
  await waitFor(() => expect(lastListParams()).toEqual({ page: 1, page_size: 25 }));
  expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
});

test("search is debounced and trimmed", async () => {
  mockApi({ logs: [] });
  render(<ActivityLogPage />);
  await screen.findAllByText("No activity recorded yet");
  const before = listCalls().length;
  await userEvent.type(screen.getByPlaceholderText(/search by user/i), "  tower ");
  // typing alone does not query per keystroke
  expect(listCalls().length).toBe(before);
  await waitFor(() => expect(lastListParams()).toMatchObject({ search: "tower" }), { timeout: 2000 });
  expect(screen.getAllByText("No activity matches these filters").length).toBeGreaterThan(0);
});

test("pagination moves pages and page size resets to page 1", async () => {
  mockApi({ count: 60, totalPages: 3 });
  render(<ActivityLogPage />);
  await screen.findByText(/60 entries · Page 1 of 3/);
  expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  await screen.findByText(/Page 2 of 3/);
  expect(lastListParams()).toMatchObject({ page: 2 });
  await userEvent.click(screen.getByRole("button", { name: /previous/i }));
  await screen.findByText(/Page 1 of 3/);
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  await screen.findByText(/Page 2 of 3/);
  await userEvent.selectOptions(screen.getByDisplayValue("25 per page"), "50");
  await waitFor(() => expect(lastListParams()).toEqual({ page: 1, page_size: 50 }));
});

test("server-clamped page number is adopted", async () => {
  // Server says the requested page is out of range and returns page 2.
  API.get.mockImplementation((url) =>
    url === "activity/filters/"
      ? Promise.resolve({ data: FILTERS })
      : Promise.resolve({ data: { results: LOGS, count: 30, total_pages: 2, page: 2 } }),
  );
  render(<ActivityLogPage />);
  await screen.findByText(/Page 2 of 2/);
});

test("refresh reloads logs and options", async () => {
  mockApi();
  render(<ActivityLogPage />);
  await screen.findAllByText("Uploaded model.ifc");
  API.get.mockClear();
  await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
  await waitFor(() => expect(API.get).toHaveBeenCalledWith("activity/", expect.anything()));
  expect(API.get).toHaveBeenCalledWith("activity/filters/", { params: {} });
});

describe("editing (can_edit)", () => {
  test("single delete asks, calls the API and refetches", async () => {
    mockApi({ canEdit: true });
    API.delete.mockResolvedValue({ data: { deleted: 1 } });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    const n = listCalls().length;
    await userEvent.click(screen.getAllByTitle("Delete")[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(API.delete).toHaveBeenCalledWith("activity/1/");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Log entry deleted"));
    await waitFor(() => expect(listCalls().length).toBe(n + 1));
  });

  test("single delete cancelled does nothing; failure surfaces detail", async () => {
    mockApi({ canEdit: true });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    window.confirm.mockReturnValueOnce(false);
    await userEvent.click(screen.getAllByTitle("Delete")[0]);
    expect(API.delete).not.toHaveBeenCalled();

    API.delete.mockRejectedValue({ response: { data: { detail: "Not found." } } });
    await userEvent.click(screen.getAllByTitle("Delete")[0]);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Not found."));
    API.delete.mockRejectedValue({});
    await userEvent.click(screen.getAllByTitle("Delete")[0]);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to delete log entry"));
  });

  test("bulk select and delete", async () => {
    mockApi({ canEdit: true });
    API.post.mockResolvedValue({ data: { deleted: 2 } });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    const selectAll = screen.getByLabelText("Select all on this page");
    await userEvent.click(selectAll);
    expect(screen.getByRole("button", { name: /delete selected \(2\)/i })).toBeInTheDocument();
    await userEvent.click(selectAll);
    expect(screen.queryByRole("button", { name: /delete selected/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByLabelText("Select entry")[0]);
    await userEvent.click(screen.getByRole("button", { name: /delete selected \(1\)/i }));
    expect(window.confirm).toHaveBeenLastCalledWith(
      "Delete 1 selected log entry? This cannot be undone.",
    );
    expect(API.post).toHaveBeenCalledWith("activity/bulk-delete/", { ids: [1] });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Deleted 2 log entries"));
  });

  test("bulk delete: cancel, single-entry wording and error", async () => {
    mockApi({ canEdit: true });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.click(screen.getByLabelText("Select all on this page"));
    window.confirm.mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: /delete selected \(2\)/i }));
    expect(window.confirm).toHaveBeenLastCalledWith("Delete 2 selected log entries? This cannot be undone.");
    expect(API.post).not.toHaveBeenCalled();

    API.post.mockRejectedValue({ response: { data: { error: "ids must be a non-empty list" } } });
    await userEvent.click(screen.getByRole("button", { name: /delete selected \(2\)/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("ids must be a non-empty list"));

    API.post.mockResolvedValue({ data: { deleted: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /delete selected \(2\)/i }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Deleted 1 log entry"));
  });

  test("edit validates and patches description + note", async () => {
    mockApi({ canEdit: true });
    API.patch.mockResolvedValue({ data: {} });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.click(screen.getAllByTitle("Edit")[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit log entry")).toBeInTheDocument();
    const [desc] = within(dialog).getAllByRole("textbox");
    expect(desc).toHaveValue("Uploaded model.ifc");

    await userEvent.clear(desc);
    await userEvent.type(desc, "   ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mockToast.error).toHaveBeenCalledWith("Description cannot be empty");
    expect(API.patch).not.toHaveBeenCalled();

    await userEvent.clear(desc);
    await userEvent.type(desc, "  Fixed text  ");
    const note = within(dialog).getByPlaceholderText(/add context/i);
    await userEvent.clear(note);
    await userEvent.type(note, "why");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(API.patch).toHaveBeenCalledWith("activity/1/", { description: "Fixed text", note: "why" });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Log entry updated"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("edit failure keeps the dialog open and shows the server detail", async () => {
    mockApi({ canEdit: true });
    API.patch.mockRejectedValue({ response: { data: { detail: "nope" } } });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.click(screen.getAllByTitle("Edit")[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("nope"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("details dialog", () => {
  test("shows request info, changes and edit trail; can jump to edit", async () => {
    mockApi({ canEdit: true });
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.click(screen.getAllByTitle("View details")[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Activity details")).toBeInTheDocument();
    expect(within(dialog).getByText("bim: model.ifc")).toBeInTheDocument();
    expect(within(dialog).getByText("10.0.0.1")).toBeInTheDocument();
    expect(within(dialog).getByText("POST /api/v1/projects/1/bim/")).toBeInTheDocument();
    expect(within(dialog).getByText("file name")).toBeInTheDocument();
    expect(within(dialog).getByText("old.ifc")).toBeInTheDocument();
    expect(within(dialog).getByText('{"a":1}')).toBeInTheDocument();
    expect(within(dialog).getByText("—")).toBeInTheDocument(); // null "before"
    expect(within(dialog).getByText(/by boss/)).toBeInTheDocument();
    expect(within(dialog).getByText(/alice \(Project Manager\)/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByText("Edit log entry")).toBeInTheDocument();
  });

  test("delete from the details dialog", async () => {
    mockApi({ canEdit: true });
    API.delete.mockResolvedValue({});
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.click(screen.getAllByTitle("View details")[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    expect(API.delete).toHaveBeenCalledWith("activity/1/");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("shows deleted entries and dashes for a sparse entry; no footer when read-only", async () => {
    mockApi();
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.click(screen.getAllByTitle("View details")[1]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Deleted entries")).toBeInTheDocument();
    expect(within(dialog).getByText(/Old thing/)).toBeInTheDocument();
    expect(within(dialog).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(within(dialog).queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });
});

describe("CSV export", () => {
  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => "blob:x");
    URL.revokeObjectURL = jest.fn();
  });

  test("downloads with the current filters and scope, without paging params", async () => {
    mockApi();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ActivityLogPage scopeParams={{ owner_admin: 2 }} />);
    await screen.findAllByText("Uploaded model.ifc");
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "delete");
    await userEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(API.get).toHaveBeenCalledWith("activity/export/", {
      params: { owner_admin: 2, action: "delete" },
      responseType: "blob",
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  test("export failure shows a toast; disabled with no entries", async () => {
    mockApi();
    render(<ActivityLogPage />);
    await screen.findAllByText("Uploaded model.ifc");
    API.get.mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to export activity log"));
  });

  test("export is disabled when there are no entries", async () => {
    mockApi({ logs: [] });
    render(<ActivityLogPage />);
    await screen.findAllByText("No activity recorded yet");
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  });
});
