import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import API from "../../api/axios";
import AdminActivityDetailPage from "./AdminActivityDetailPage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("./ActivityLogPage", () => (props) => (
  <div data-testid="log-page">{JSON.stringify(props)}</div>
));

const ADMIN = {
  id: 3,
  username: "adm",
  full_name: "Ada Admin",
  email: "ada@x.com",
  organization: "Acme",
  own_log_count: 4,
  users_log_count: 9,
  users: [{ id: 11 }],
};

function Search() {
  const loc = useLocation();
  return <div data-testid="search">{loc.search}</div>;
}

function renderAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/activity/admin/:adminId"
          element={
            <>
              <AdminActivityDetailPage />
              <Search />
            </>
          }
        />
        <Route path="/activity" element={<div>admins list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const logProps = () => JSON.parse(screen.getByTestId("log-page").textContent);

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("shows the admin header and their own activity by default", async () => {
  API.get.mockResolvedValue({ data: { admins: [ADMIN, { ...ADMIN, id: 4, username: "x" }] } });
  renderAt("/activity/admin/3");
  expect(screen.getByText("Loading...")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Ada Admin" })).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("activity/admins/");
  expect(screen.getByText("@adm · Admin")).toBeInTheDocument();
  expect(screen.getByText("ada@x.com")).toBeInTheDocument();
  expect(screen.getByText("Acme")).toBeInTheDocument();
  expect(screen.getByText("1 user created")).toBeInTheDocument();
  expect(screen.getByText("AA")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /adm's own activity\s*4/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /their users' activity\s*9/i })).toBeInTheDocument();
  expect(logProps()).toMatchObject({ scopeParams: { user: "3" }, hideUserFilter: true, embedded: true });
});

test("switching tabs updates the URL and the log scope", async () => {
  API.get.mockResolvedValue({ data: { admins: [{ ...ADMIN, full_name: "", users: [{ id: 1 }, { id: 2 }] }] } });
  renderAt("/activity/admin/3");
  await screen.findByRole("heading", { name: "adm" });
  expect(screen.getByText("2 users created")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /their users' activity/i }));
  expect(screen.getByTestId("search")).toHaveTextContent("?tab=users");
  expect(logProps()).toMatchObject({ scopeParams: { owner_admin: "3" }, initialFilters: { user: "" } });
  await userEvent.click(screen.getByRole("button", { name: /own activity/i }));
  expect(screen.getByTestId("search")).toHaveTextContent("");
  expect(logProps().scopeParams).toEqual({ user: "3" });
});

test("?tab=users&user= preselects a user", async () => {
  API.get.mockResolvedValue({ data: { admins: [ADMIN] } });
  renderAt("/activity/admin/3?tab=users&user=11");
  await screen.findByRole("heading", { name: "Ada Admin" });
  expect(logProps()).toMatchObject({ scopeParams: { owner_admin: "3" }, initialFilters: { user: "11" } });
});

test("unknown admin shows not found and no log", async () => {
  API.get.mockResolvedValue({ data: { admins: [ADMIN] } });
  renderAt("/activity/admin/99");
  expect(await screen.findByText("Admin not found.")).toBeInTheDocument();
  expect(screen.queryByTestId("log-page")).not.toBeInTheDocument();
});

test("load failure shows not found", async () => {
  API.get.mockRejectedValue(new Error("boom"));
  renderAt("/activity/admin/3");
  expect(await screen.findByText("Admin not found.")).toBeInTheDocument();
});

test("missing admins array is treated as not found", async () => {
  API.get.mockResolvedValue({ data: {} });
  renderAt("/activity/admin/3");
  expect(await screen.findByText("Admin not found.")).toBeInTheDocument();
});

test("unlinked page does not fetch admins and scopes the log to unlinked users", async () => {
  renderAt("/activity/admin/unlinked?user=20");
  expect(screen.getByRole("heading", { name: "Users not linked to an admin" })).toBeInTheDocument();
  expect(API.get).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /own activity/i })).not.toBeInTheDocument();
  expect(logProps()).toMatchObject({ scopeParams: { unlinked: 1 }, initialFilters: { user: "20" } });
});

test("back button returns to the admin list", async () => {
  API.get.mockResolvedValue({ data: { admins: [ADMIN] } });
  renderAt("/activity/admin/3");
  await screen.findByRole("heading", { name: "Ada Admin" });
  await userEvent.click(screen.getByRole("button", { name: /all admins/i }));
  expect(screen.getByText("admins list")).toBeInTheDocument();
});

test("a late response after unmount is ignored", async () => {
  let resolve;
  API.get.mockReturnValue(new Promise((r) => (resolve = r)));
  const { unmount } = render(
    <MemoryRouter initialEntries={["/activity/admin/3"]}>
      <Routes>
        <Route path="/activity/admin/:adminId" element={<AdminActivityDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  unmount();
  resolve({ data: { admins: [ADMIN] } });
  await waitFor(() => expect(API.get).toHaveBeenCalledTimes(1));
});
