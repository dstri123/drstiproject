import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import EditProjectContributor from "./EditProjectContributor";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));
let mockEmail;
jest.mock("../../hooks/useCheckUsername", () => ({ useCheckEmail: () => mockEmail }));

const USERS = [
  { id: 4, username: "eng1", email: "e@x.com", first_name: "Eve", last_name: "Eng", sub_role: "data_contributor", description: "notes" },
  { id: 5, username: "bare", email: null, first_name: null, last_name: null, sub_role: null, role: null },
];

beforeEach(() => {
  mockEmail = { checking: false, isAvailable: true, debouncedCheck: jest.fn() };
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderPage(id = "4") {
  render(
    <MemoryRouter initialEntries={[`/admin/project-user/${id}/edit`]}>
      <Routes>
        <Route path="/admin/project-user/:id/edit" element={<EditProjectContributor />} />
        <Route path="/admin/project-user" element={<div>contributors list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const saveBtn = () => screen.getByRole("button", { name: "Save Changes" });

test("loads contributor from users/ and prefills (username read-only)", async () => {
  API.get.mockResolvedValue({ data: USERS });
  renderPage();
  expect(await screen.findByRole("heading", { name: "Edit Eve Eng" })).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("users/");
  expect(screen.getByLabelText("Username (Read Only)")).toBeDisabled();
  expect(screen.getByLabelText("Username (Read Only)")).toHaveValue("eng1");
  expect(screen.getByLabelText("Email Address *")).toHaveValue("e@x.com");
  expect(screen.getByLabelText("Role *")).toHaveValue("data_contributor");
  expect(screen.getByLabelText("Description")).toHaveValue("notes");
  expect(mockEmail.debouncedCheck).not.toHaveBeenCalled(); // unchanged email isn't checked
});

test("missing fields default; role falls back to project_engineer", async () => {
  API.get.mockResolvedValue({ data: USERS });
  renderPage("5");
  await screen.findByLabelText("Role *");
  expect(screen.getByLabelText("Role *")).toHaveValue("project_engineer");
  expect(screen.getByLabelText("First Name *")).toHaveValue("");
});

test("unknown id and load failure redirect with a toast", async () => {
  API.get.mockResolvedValue({ data: USERS });
  renderPage("99");
  expect(await screen.findByText("contributors list")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Contributor not found");
});

test("load failure redirects", async () => {
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await screen.findByText("contributors list")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Failed to load contributor");
});

test("validation: required names, email format, taken email", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Eve Eng" });
  await user.clear(screen.getByLabelText("First Name *"));
  await user.clear(screen.getByLabelText("Last Name *"));
  await user.clear(screen.getByLabelText("Email Address *"));
  await user.click(saveBtn());
  expect(screen.getByText("First name is required")).toBeInTheDocument();
  expect(screen.getByText("Last name is required")).toBeInTheDocument();
  expect(screen.getByText("Email is required")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Email Address *"), "bad@x");
  expect(screen.queryByText("Email is required")).not.toBeInTheDocument();
  await user.click(saveBtn());
  expect(screen.getByText("Please enter a valid email address")).toBeInTheDocument();

  mockEmail = { ...mockEmail, isAvailable: false };
  await user.clear(screen.getByLabelText("Email Address *"));
  await user.type(screen.getByLabelText("Email Address *"), "taken@x.com");
  expect(mockEmail.debouncedCheck).toHaveBeenLastCalledWith("taken@x.com");
  await user.click(saveBtn());
  expect(screen.getByText("Email is already in use")).toBeInTheDocument();
  expect(API.put).not.toHaveBeenCalled();
});

test("Save disabled while checking email", async () => {
  mockEmail = { ...mockEmail, checking: true };
  API.get.mockResolvedValue({ data: USERS });
  renderPage();
  await screen.findByRole("heading", { name: "Edit Eve Eng" });
  expect(saveBtn()).toBeDisabled();
});

test("valid save PUTs users/<id>/ and redirects after 2s", async () => {
  API.get.mockResolvedValue({ data: USERS });
  API.put.mockResolvedValue({ data: {} });
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  renderPage();
  await screen.findByRole("heading", { name: "Edit Eve Eng" });
  await user.selectOptions(screen.getByLabelText("Role *"), "admin");
  await user.type(screen.getByLabelText("Description"), "!");
  await user.click(saveBtn());
  expect(API.put).toHaveBeenCalledWith("users/4/", {
    first_name: "Eve",
    last_name: "Eng",
    email: "e@x.com",
    sub_role: "admin",
    description: "notes!",
  });
  expect(mockToast.success).toHaveBeenCalledWith("Contributor updated successfully!");
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText("contributors list")).toBeInTheDocument();
});

test.each([
  [{ response: { data: { detail: "D" } } }, "D"],
  [{ response: { data: { error: "User not found" } } }, "User not found"],
  [{ response: { data: { message: "M" } } }, "M"],
  [{ response: { data: { email: ["invalid"] } } }, "invalid"],
  [new Error("x"), "Failed to update contributor"],
])("save error %#", async (err, msg) => {
  API.get.mockResolvedValue({ data: USERS });
  API.put.mockRejectedValue(err);
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Edit Eve Eng" });
  await user.click(saveBtn());
  expect(await screen.findByText(msg)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(msg);
});

test("Cancel and Back navigate to the list", async () => {
  API.get.mockResolvedValue({ data: USERS });
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(screen.getByText("contributors list")).toBeInTheDocument();
});
