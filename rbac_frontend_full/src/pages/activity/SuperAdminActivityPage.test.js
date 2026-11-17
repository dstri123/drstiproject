import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import API from "../../api/axios";
import SuperAdminActivityPage from "./SuperAdminActivityPage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

jest.mock("./ActivityLogPage", () => (props) => (
  <div data-testid="log-page">{JSON.stringify(props)}</div>
));

const ADMINS = {
  admins: [
    {
      id: 3,
      username: "adm",
      full_name: "Ada Admin",
      email: "ada@x.com",
      organization: "Acme",
      own_log_count: 4,
      users_log_count: 9,
      last_activity: null,
      users: [
        { id: 11, username: "pm1", full_name: "Pat M", role: "project_manager", is_active: true, log_count: 5, last_activity: null },
        { id: 12, username: "old", full_name: "", role: "data_contributor", is_active: false, log_count: 0, last_activity: null },
      ],
    },
    {
      id: 4,
      username: "solo",
      full_name: "",
      email: "",
      organization: "",
      own_log_count: 0,
      users_log_count: 0,
      last_activity: null,
      users: [{ id: 13, username: "only", full_name: "", role: "viewer", is_active: true, log_count: 1, last_activity: null }],
    },
  ],
  unlinked: { users: [{ id: 20, username: "orphan", full_name: "", role: "site_engineer", is_active: true, log_count: 2, last_activity: null }], log_count: 2, last_activity: null },
};

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderPage(el = <SuperAdminActivityPage />) {
  render(
    <MemoryRouter initialEntries={["/activity"]}>
      <Routes>
        <Route path="/activity" element={el} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("lists admins with stats and the unlinked group", async () => {
  API.get.mockResolvedValue({ data: ADMINS });
  renderPage();
  expect(screen.getByText("Loading admins...")).toBeInTheDocument();
  expect(await screen.findByText("Ada Admin (adm)")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("activity/admins/");
  expect(screen.getByText("solo")).toBeInTheDocument();
  expect(screen.getByText("Acme")).toBeInTheDocument();
  expect(screen.getByText("ada@x.com")).toBeInTheDocument();
  expect(screen.getByText("Not linked to an admin")).toBeInTheDocument();
  expect(screen.getByText("Unassigned")).toBeInTheDocument();
  // stats: "2 users" for Ada, "1 user" for solo
  expect(screen.getAllByText("users").length).toBeGreaterThan(0);
  expect(screen.getAllByText("user").length).toBeGreaterThan(0);
  expect(screen.getAllByText("own entries")[0].parentElement).toHaveTextContent("4 own entries");
});

test("expanding an admin shows their users; clicking a user opens the filtered page", async () => {
  API.get.mockResolvedValue({ data: ADMINS });
  renderPage();
  const toggle = await screen.findByRole("button", { name: /ada admin \(adm\)/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Pat M · Project Manager")).toBeInTheDocument();
  expect(screen.getByText("(inactive)")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /pm1/ }));
  expect(screen.getByTestId("where")).toHaveTextContent("/activity/admin/3?tab=users&user=11");
});

test("collapsing hides users again", async () => {
  API.get.mockResolvedValue({ data: ADMINS });
  renderPage();
  const toggle = await screen.findByRole("button", { name: /ada admin \(adm\)/i });
  await userEvent.click(toggle);
  await userEvent.click(toggle);
  expect(screen.queryByText("pm1")).not.toBeInTheDocument();
});

test("Open activity navigates to the admin and unlinked pages", async () => {
  API.get.mockResolvedValue({ data: ADMINS });
  renderPage();
  await screen.findByText("Ada Admin (adm)");
  const opens = screen.getAllByRole("button", { name: /open activity/i });
  expect(opens).toHaveLength(3);
  await userEvent.click(opens[2]);
  expect(screen.getByTestId("where")).toHaveTextContent("/activity/admin/unlinked");
});

test("Open activity for an admin", async () => {
  API.get.mockResolvedValue({ data: ADMINS });
  renderPage();
  await screen.findByText("Ada Admin (adm)");
  await userEvent.click(screen.getAllByRole("button", { name: /open activity/i })[0]);
  expect(screen.getByTestId("where")).toHaveTextContent("/activity/admin/3");
});

test("empty: no admins and an empty unlinked group", async () => {
  API.get.mockResolvedValue({ data: { admins: [{ ...ADMINS.admins[1], users: [] }], unlinked: { users: [], log_count: 0 } } });
  renderPage();
  await screen.findByText("solo");
  expect(screen.queryByText("Not linked to an admin")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /solo/ }));
  expect(screen.getByText("No users created yet.")).toBeInTheDocument();
});

test("no admins at all", async () => {
  API.get.mockResolvedValue({ data: { admins: [], unlinked: null } });
  renderPage();
  expect(await screen.findByText("No admins yet")).toBeInTheDocument();
});

test("load failure shows a toast", async () => {
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to load admins"));
  expect(await screen.findByText("No admins yet")).toBeInTheDocument();
});

test("refresh refetches; All activity tab embeds the full log and hides refresh", async () => {
  API.get.mockResolvedValue({ data: ADMINS });
  renderPage();
  await screen.findByText("Ada Admin (adm)");
  await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
  await waitFor(() => expect(API.get).toHaveBeenCalledTimes(2));

  await userEvent.click(screen.getByRole("button", { name: "All activity" }));
  const log = screen.getByTestId("log-page");
  expect(JSON.parse(log.textContent)).toEqual({
    embedded: true,
    title: "All activity",
    description: "Every entry from every admin and user",
  });
  expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "By admin" }));
  expect(screen.getByText("Ada Admin (adm)")).toBeInTheDocument();
});
