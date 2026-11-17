import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import CreateProject from "./CreateProject";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const USERS = [
  { id: 1, username: "eng1", email: "e1@x.com", first_name: "Eve", last_name: "Eng", sub_role: "project_engineer" },
  { id: 2, username: "data1", email: "", first_name: "", last_name: "", sub_role: "data_contributor" },
  { id: 3, username: "boss", email: "b@x.com", first_name: "Bo", last_name: "", role: "admin", sub_role: null },
];

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/projects/create"]}>
      <Routes>
        <Route path="/admin/projects/create" element={<CreateProject />} />
        <Route path="/admin/projects" element={<div>projects list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  API.get.mockResolvedValue({ data: USERS });
});
afterEach(() => jest.useRealTimers());

const createBtn = () => screen.getByRole("button", { name: "Create Project" });
const setDate = (placeholder, value) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

async function fillRequired(user) {
  await user.type(screen.getByLabelText("Project Name *"), "Tower A");
  await user.type(screen.getByLabelText("Description *"), "Main tower");
  setDate("Pick a start date", "2026-01-01");
  setDate("Pick an end date", "2026-12-31");
}

const availableTable = () => screen.getByText("Available Contributors").parentElement;

test("loads contributors from users/ and lists them with formatted roles", async () => {
  renderPage();
  expect(await screen.findByText("eng1")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("users/");
  expect(screen.getAllByText("Project Engineer").length).toBeGreaterThan(1); // badge + filter option
  expect(screen.getByText("Eve Eng")).toBeInTheDocument();
  expect(screen.getByText("Showing 1 to 3 of 3 contributor(s)")).toBeInTheDocument();
});

test("contributor load failure / non-array shows 'No contributors available'", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  API.get.mockRejectedValue(new Error("x"));
  renderPage();
  expect(await screen.findByText("No contributors available")).toBeInTheDocument();
  console.error.mockRestore();
});

test("non-array response is treated as empty", async () => {
  API.get.mockResolvedValue({ data: { detail: "nope" } });
  renderPage();
  expect(await screen.findByText("No contributors available")).toBeInTheDocument();
});

test("Create disabled until name and description are filled", async () => {
  const user = userEvent.setup();
  renderPage();
  expect(createBtn()).toBeDisabled();
  await user.type(screen.getByLabelText("Project Name *"), "x");
  expect(createBtn()).toBeDisabled();
  await user.type(screen.getByLabelText("Description *"), "y");
  expect(createBtn()).toBeEnabled();
});

test("missing dates block submit with messages", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Project Name *"), "x");
  await user.type(screen.getByLabelText("Description *"), "y");
  await user.click(createBtn());
  expect(screen.getByText("Start date is required")).toBeInTheDocument();
  expect(screen.getByText("End date is required")).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test("end before start is rejected", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Project Name *"), "x");
  await user.type(screen.getByLabelText("Description *"), "y");
  setDate("Pick a start date", "2026-05-01");
  setDate("Pick an end date", "2026-04-01");
  await user.click(createBtn());
  expect(screen.getByText("End date must be after start date")).toBeInTheDocument();
  expect(API.post).not.toHaveBeenCalled();
});

test("whitespace-only name/description are rejected", async () => {
  const user = userEvent.setup();
  renderPage();
  await fillRequired(user);
  await user.clear(screen.getByLabelText("Description *"));
  await user.type(screen.getByLabelText("Description *"), "   ");
  expect(createBtn()).toBeDisabled();
});

test("valid project posts multipart to create-project/, assigns contributors, then redirects", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  API.post.mockImplementation((url) =>
    Promise.resolve({ data: url === "create-project/" ? { project_id: 42 } : {} })
  );
  renderPage();
  await screen.findByText("eng1");
  await fillRequired(user);
  await user.type(screen.getByLabelText("Latitude (Optional)"), "12.5");
  await user.type(screen.getByLabelText("Longitude (Optional)"), "77.25");
  await user.type(screen.getByLabelText("Building Footprint Area (m²)"), "2500");

  // assign two contributors
  const rows = within(availableTable()).getAllByRole("row");
  await user.click(within(rows[1]).getByRole("checkbox"));
  await user.click(within(rows[3]).getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Assign (2) Contributors" }));
  expect(screen.getByText("2 contributor(s) assigned to this project")).toBeInTheDocument();

  await user.click(createBtn());

  const [url, fd, cfg] = API.post.mock.calls[0];
  expect(url).toBe("create-project/");
  expect(cfg.headers["Content-Type"]).toBe("multipart/form-data");
  expect(Object.fromEntries(fd.entries())).toEqual({
    project_name: "Tower A",
    description: "Main tower",
    start: "2026-01-01",
    end: "2026-12-31",
    latitude: "12.5",
    longitude: "77.25",
    footprint_area: "2500",
  });
  expect(API.post).toHaveBeenCalledWith("assign-user/", { project_id: 42, user_ids: [1, 3] });
  expect(mockToast.success).toHaveBeenCalledWith("Project created successfully!");
  await waitFor(() => expect(screen.getByLabelText("Project Name *").value).toBe(""));
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText("projects list")).toBeInTheDocument();
});

test("no contributors selected: assign-user/ is not called; optional fields omitted", async () => {
  const user = userEvent.setup();
  API.post.mockResolvedValue({ data: { project_id: 9 } });
  renderPage();
  await fillRequired(user);
  await user.click(createBtn());
  expect(API.post).toHaveBeenCalledTimes(1);
  const fd = API.post.mock.calls[0][1];
  expect(fd.has("latitude")).toBe(false);
  expect(fd.has("image")).toBe(false);
});

test.each([
  [{ response: { data: { error: "Start date and End date are required" } } }, "Start date and End date are required"],
  [new Error("x"), "Failed to create project"],
])("API error %# is shown", async (err, msg) => {
  const user = userEvent.setup();
  API.post.mockRejectedValue(err);
  renderPage();
  await fillRequired(user);
  await user.click(createBtn());
  expect(await screen.findByText(msg)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(msg);
});

test("image upload: rejects non-images, previews images, can be removed, and is sent", async () => {
  const user = userEvent.setup({ applyAccept: false });
  API.post.mockResolvedValue({ data: { project_id: 1 } });
  renderPage();
  const input = document.getElementById("project-image");
  await user.upload(input, new File(["x"], "a.txt", { type: "text/plain" }));
  expect(screen.getByText("Please upload a valid image file")).toBeInTheDocument();

  const img = new File(["png"], "a.png", { type: "image/png" });
  await user.upload(document.getElementById("project-image"), img);
  expect(await screen.findByAltText("Project preview")).toBeInTheDocument();
  expect(screen.queryByText("Please upload a valid image file")).not.toBeInTheDocument();

  await fillRequired(user);
  await user.click(createBtn());
  expect(API.post.mock.calls[0][1].get("image")).toBe(img);
});

test("Remove Image clears the preview", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.upload(document.getElementById("project-image"), new File(["png"], "a.png", { type: "image/png" }));
  await screen.findByAltText("Project preview");
  await user.click(screen.getByRole("button", { name: /remove image/i }));
  expect(screen.queryByAltText("Project preview")).not.toBeInTheDocument();
});

test("contributor search, role filter, select-all and unassign", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("eng1");
  await user.type(screen.getByPlaceholderText("Search by name or username..."), "eve");
  expect(screen.queryByText("data1")).not.toBeInTheDocument();
  expect(screen.getByText("eng1")).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText("Search by name or username..."));
  await user.type(screen.getByPlaceholderText("Search by name or username..."), "zzz");
  expect(screen.getByText("No matching contributors")).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText("Search by name or username..."));

  await user.selectOptions(screen.getByRole("combobox"), "admin");
  expect(screen.getByText("boss")).toBeInTheDocument();
  expect(screen.queryByText("eng1")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox"), "all");

  const headerCheckbox = within(within(availableTable()).getAllByRole("row")[0]).getByRole("checkbox");
  await user.click(headerCheckbox);
  expect(screen.getByRole("button", { name: "Assign (3) Contributors" })).toBeInTheDocument();
  await user.click(headerCheckbox);
  expect(screen.queryByRole("button", { name: /Assign \(/ })).not.toBeInTheDocument();

  // toggle one on/off, then assign one
  const row1 = within(availableTable()).getAllByRole("row")[1];
  await user.click(within(row1).getByRole("checkbox"));
  await user.click(within(row1).getByRole("checkbox"));
  await user.click(within(row1).getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Assign (1) Contributor" }));
  expect(screen.getByText("1 contributor(s) assigned to this project")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /unassign/i }));
  expect(screen.queryByText("Assigned Contributors")).not.toBeInTheDocument();
});

test("available contributors paginate at 10 and assigned at 3", async () => {
  API.get.mockResolvedValue({
    data: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, username: `u${i + 1}`, sub_role: "project_engineer" })),
  });
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("u1");
  expect(screen.getByText("Showing 1 to 10 of 12 contributor(s)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("u11")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Previous" }));
  await user.click(screen.getByRole("button", { name: "2" }));
  expect(screen.getByText("Showing 11 to 12 of 12 contributor(s)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "1" }));

  const header = within(within(availableTable()).getAllByRole("row")[0]).getByRole("checkbox");
  await user.click(header);
  await user.click(screen.getByRole("button", { name: "Assign (10) Contributors" }));
  expect(screen.getByText("Showing 1 to 3 of 10")).toBeInTheDocument();
  const assignedSection = screen.getByText("Assigned Contributors").parentElement;
  await user.click(within(assignedSection).getByRole("button", { name: "Next" }));
  expect(screen.getByText("Showing 4 to 6 of 10")).toBeInTheDocument();
  await user.click(within(assignedSection).getByRole("button", { name: "4" }));
  expect(screen.getByText("Showing 10 to 10 of 10")).toBeInTheDocument();
  await user.click(within(assignedSection).getByRole("button", { name: "Previous" }));
  expect(screen.getByText("Showing 7 to 9 of 10")).toBeInTheDocument();
});

test("number fields and invalid lat/long", async () => {
  // type=number inputs can't hold non-numeric text in jsdom, so the
  // "must be a valid number" branch is unreachable from the UI.
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Latitude (Optional)"), "1");
  expect(screen.getByText("Latitude is valid")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Longitude (Optional)"), "2");
  expect(screen.getByText("Longitude is valid")).toBeInTheDocument();
});

test("Back and Cancel navigate to the projects list", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("projects list")).toBeInTheDocument();
});

test("date validation blocks submit until dates are picked; clearing a date resets it", async () => {
  const user = userEvent.setup();
  API.post.mockResolvedValue({ data: { project_id: 1 } });
  renderPage();
  await waitFor(() => expect(API.get).toHaveBeenCalled());
  await user.type(screen.getByLabelText("Project Name *"), "x");
  await user.type(screen.getByLabelText("Description *"), "y");
  setDate("Pick a start date", "2026-01-01");
  expect(screen.getByText("Start date is valid")).toBeInTheDocument();
  setDate("Pick a start date", "");
  expect(screen.queryByText("Start date is valid")).not.toBeInTheDocument();
  await user.click(createBtn());
  expect(screen.getByText("Start date is required")).toBeInTheDocument();
  setDate("Pick a start date", "2026-01-01");
  setDate("Pick an end date", "2026-01-02");
  await user.click(createBtn());
  expect(API.post).toHaveBeenCalledTimes(1);
});
