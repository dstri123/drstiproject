import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import { ToastProvider } from "../../components/ToastContainer";
import { parseScheduleFile, parseDay } from "./scheduleParser";
import ProjectDashboardPage, { fromServer, plannedPct, progressState, saveErrorMessage } from "./ProjectDashboardPage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("./scheduleParser", () => ({
  ...jest.requireActual("./scheduleParser"),
  parseScheduleFile: jest.fn(),
}));
// The 4D view (three.js + web-ifc) has its own tests; here only its props matter.
jest.mock("./Schedule4DView", () => ({
  __esModule: true,
  default: (p) =>
    require("react").createElement(
      "div",
      { "data-testid": "schedule-4d" },
      `4D project ${p.projectId}: ${p.activities.length} activities, visible ${
        p.visibleIds ? Array.from(p.visibleIds).join(",") : "all"
      }, ${p.scheduleStart.toISOString().slice(0, 10)}..${p.scheduleFinish.toISOString().slice(0, 10)}, today ${p.today
        .toISOString()
        .slice(0, 10)}`,
    ),
}));

// ---------------------------------------------------------------- clock

// "Today" is Wednesday 10 Jan 2024 (local noon). Only argument-less
// `new Date()` / Date.now() are pinned.
const RealDate = Date;
const NOW = new RealDate(2024, 0, 10, 12).getTime();
beforeAll(() => {
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(NOW);
    }
    static now() {
      return NOW;
    }
  };
});
afterAll(() => {
  global.Date = RealDate;
});

// ---------------------------------------------------------------- fixtures

const PROJECT = { id: 42, slug: "tower-a", project_name: "Tower A" };

const ACTIVITIES = [
  {
    id: "A1", wbs: "1.1", level: "L1", elevation: 0, name: "Columns", ifcTypes: "IfcColumn", elementCount: 10,
    duration: 5, start: "2024-01-01", finish: "2024-01-05", predecessors: [], dependency: "", mappingKey: "MK-COL",
    status: "Completed", milestone: false, mappedElements: 10,
  },
  {
    id: "A2", wbs: "1.2", level: "L1", elevation: 0, name: "Slab", ifcTypes: "IfcSlab", elementCount: 6,
    duration: 5, start: "2024-01-08", finish: "2024-01-12", predecessors: ["A1"], dependency: "FS", mappingKey: "",
    status: "In Progress", milestone: false,
  },
  {
    id: "B1", wbs: "2.1", level: "L2", elevation: 3500, name: "Walls", ifcTypes: "IfcWall", elementCount: null,
    duration: 5, start: "2024-01-15", finish: "2024-01-19", predecessors: [], dependency: "", mappingKey: "",
    status: "Not Started", milestone: false,
  },
];

const SERVER_SCHEDULE = {
  file_name: "plan.xlsx",
  uploaded_at: "2024-01-09T08:00:00Z",
  uploaded_by_name: "Priya",
  activities: ACTIVITIES,
  meta: {},
};

const PROGRESS = {
  activities: {
    A1: { match: "type_level", matched: 10, completed: 10, in_progress: 0, actual_pct: 100, scan_date: "2024-01-09", missing_total: 0, missing: [], actual_start: "2024-01-02", actual_finish: "2024-01-05" },
    A2: {
      match: "type_level", matched: 5, completed: 1, in_progress: 1, actual_pct: 20, scan_date: "2024-01-09", missing_total: 4,
      missing: [{ element_id: "g-1", name: "Slab 1", element_type: "IfcSlab", level: "L1", status: "in_progress", completion: 40.4 }],
    },
    B1: { match: "none" },
  },
  latest_scan_date: "2024-01-09",
  scan_dates: ["2024-01-02", "2024-01-09"],
  latest_has_levels: true,
  ifc_levels: ["Level 1", "L2"],
  level_map: {},
};

// Routes API.get by URL; each piece can be overridden per test.
function mockGets({ projects = [PROJECT], schedule = SERVER_SCHEDULE, progress = null, projectsError, scheduleError } = {}) {
  const state = { schedule, progress };
  API.get.mockImplementation((url) => {
    if (url === "projects/") return projectsError ? Promise.reject(projectsError) : Promise.resolve({ data: projects });
    if (url === `projects/${PROJECT.id}/schedule/`)
      return scheduleError ? Promise.reject(scheduleError) : Promise.resolve({ data: state.schedule });
    if (url === `processing/progress/schedule-status/${PROJECT.id}/`)
      return state.progress ? Promise.resolve({ data: state.progress }) : Promise.reject(new Error("no progress"));
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  return state;
}

function renderPage(slug = "tower-a") {
  const user = userEvent.setup();
  const utils = render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/prev", `/project-dashboard/${slug}`]} initialIndex={1}>
        <Routes>
          <Route path="/prev" element={<div>previous page</div>} />
          <Route path="/manager" element={<div>manager home</div>} />
          <Route path="/project-dashboard/:slug" element={<ProjectDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
  const fileInput = () => utils.container.querySelector('input[type="file"]');
  return { ...utils, user, fileInput };
}

const csv = (name = "plan.csv") => new File(["x"], name, { type: "text/csv" });
const tile = (label) => screen.getByText(label, { selector: "div" }).parentElement;

let scrollTo;
beforeEach(() => {
  scrollTo = jest.fn();
  Element.prototype.scrollTo = scrollTo;
});
afterEach(() => {
  delete Element.prototype.scrollTo;
});

// ---------------------------------------------------------------- pure helpers

describe("plannedPct", () => {
  const a = { start: "2024-01-08", finish: "2024-01-12" }; // Mon-Fri
  test.each([
    ["2024-01-05", 0],
    ["2024-01-08", 20],
    ["2024-01-10", 60],
    ["2024-01-12", 100],
    ["2024-01-13", 100],
  ])("on %s -> %d%%", (day, pct) => {
    expect(plannedPct(a, parseDay(day))).toBe(pct);
  });
  test("weekend-only activity does not divide by zero", () => {
    expect(plannedPct({ start: "2024-01-06", finish: "2024-01-07" }, parseDay("2024-01-06"))).toBe(0);
  });
});

describe("progressState", () => {
  const base = { start: "2024-01-08", finish: "2024-01-12" };
  const withActual = (actual) => progressState({ ...base, actual });
  test.each([
    [undefined, { label: "Not mapped" }],
    [{ match: "none", matched: 3 }, { label: "Not mapped" }],
    [{ match: "type", matched: 0 }, { label: "No scan data" }],
    [{ matched: 4, actual_pct: 100, scan_date: "2024-01-09" }, { label: "Completed", planned: 40, diff: 60 }],
    [{ matched: 4, actual_pct: 10, scan_date: "2024-01-05" }, { label: "Ahead", planned: 0, diff: 10 }],
    [{ matched: 4, actual_pct: 0, scan_date: "2024-01-05" }, { label: "Not due", planned: 0, diff: 0 }],
    [{ matched: 4, actual_pct: 50, scan_date: "2024-01-10" }, { label: "Delayed", planned: 60, diff: -10 }],
    [{ matched: 4, actual_pct: 51, scan_date: "2024-01-10" }, { label: "On track", planned: 60, diff: -9 }],
    [{ matched: 4, actual_pct: 69, scan_date: "2024-01-10" }, { label: "On track", planned: 60, diff: 9 }],
    [{ matched: 4, actual_pct: 70, scan_date: "2024-01-10" }, { label: "Ahead", planned: 60, diff: 10 }],
  ])("%j -> %j", (actual, expected) => {
    expect(withActual(actual)).toEqual(expected);
  });
});

describe("saveErrorMessage", () => {
  test.each([
    [{ response: { status: 403, data: { error: "You are not assigned to this project" } } }, "You are not assigned to this project"],
    [{ response: { status: 400, data: { activities: ["Too many activities."] } } }, "Too many activities."],
    [{ response: { status: 400, data: {} } }, "The server rejected the schedule (it may be too large)."],
    [{ response: { status: 413 } }, "The server rejected the schedule (it may be too large)."],
    [{ response: { status: 500 } }, "Couldn't save the schedule to the server."],
    [new Error("Network Error"), "Couldn't save the schedule to the server."],
  ])("%j", (err, msg) => {
    expect(saveErrorMessage(err)).toBe(msg);
  });
});

test("fromServer maps the API record and tolerates null / missing parts", () => {
  expect(fromServer(null)).toBeNull();
  expect(fromServer({ file_name: "f.csv" })).toEqual({
    fileName: "f.csv",
    uploadedAt: undefined,
    uploadedBy: undefined,
    activities: [],
    meta: {},
  });
  expect(fromServer(SERVER_SCHEDULE)).toMatchObject({ fileName: "plan.xlsx", uploadedBy: "Priya", activities: ACTIVITIES });
});

// ---------------------------------------------------------------- loading

test("loads the project by slug and its saved schedule, and shows the KPIs", async () => {
  mockGets();
  renderPage();
  expect(screen.getByText(/Loading schedule/)).toBeInTheDocument();
  expect(await screen.findByText(/Tower A · plan\.xlsx · uploaded .* by Priya/)).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("projects/");
  expect(API.get).toHaveBeenCalledWith("projects/42/schedule/");
  await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/schedule-status/42/"));

  expect(tile("Activities")).toHaveTextContent("Activities32 levels");
  expect(tile("IFC elements")).toHaveTextContent("16");
  expect(tile("Start")).toHaveTextContent("StartJan 12024");
  expect(tile("Finish")).toHaveTextContent("FinishJan 192024");
  expect(tile("Duration")).toHaveTextContent("19 days15 workdays");
  // (5×100% + 5×60% + 5×0%) / 15 workdays
  expect(tile("Planned progress")).toHaveTextContent("53%Active today: A2");
  expect(screen.getByText("3 of 3 activities")).toBeInTheDocument();
  // No progress -> no measured tiles or progress filter.
  expect(screen.queryByText("Actual progress")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("All progress")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Replace schedule" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove uploaded schedule" })).toBeInTheDocument();
  // Gantt is the default view and scrolls to today.
  expect(screen.getByTitle("A2 · Slab")).toBeInTheDocument();
  await waitFor(() => expect(scrollTo).toHaveBeenCalled());
});

test("finds the project by numeric id prefix of the slug", async () => {
  mockGets({ projects: [{ id: 7, slug: "other" }, PROJECT] });
  renderPage("42-tower");
  expect(await screen.findByText(/Tower A · plan\.xlsx/)).toBeInTheDocument();
});

test("unknown project: empty state, no schedule request, upload refused", async () => {
  mockGets({ projects: [{ id: 7, slug: "other" }] });
  const { user, fileInput } = renderPage("nope");
  expect(await screen.findByText("Upload your project schedule")).toBeInTheDocument();
  expect(screen.getByText("nope")).toBeInTheDocument();
  expect(API.get).not.toHaveBeenCalledWith("projects/42/schedule/");
  await user.upload(fileInput(), csv());
  expect(await screen.findByText("Project not found — can't save a schedule.")).toBeInTheDocument();
  expect(parseScheduleFile).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
});

test("project list failure ends loading and shows the empty state", async () => {
  mockGets({ projectsError: new Error("down") });
  renderPage();
  expect(await screen.findByText("Upload your project schedule")).toBeInTheDocument();
});

test("schedule load failure -> error toast", async () => {
  mockGets({ scheduleError: new Error("500") });
  renderPage();
  expect(await screen.findByText("Couldn't load the project schedule.")).toBeInTheDocument();
  expect(screen.getByText("Upload your project schedule")).toBeInTheDocument();
});

test("no server schedule: a legacy browser-stored schedule is uploaded once and removed", async () => {
  mockGets({ schedule: null });
  localStorage.setItem(
    "drsti.projectDashboard.schedule.tower-a",
    JSON.stringify({ fileName: "old.csv", activities: ACTIVITIES.slice(0, 1) }),
  );
  API.put.mockResolvedValue({ data: { ...SERVER_SCHEDULE, file_name: "old.csv", activities: ACTIVITIES.slice(0, 1) } });
  renderPage();
  expect(await screen.findByText("Moved this browser's saved schedule to the server.")).toBeInTheDocument();
  expect(API.put).toHaveBeenCalledWith("projects/42/schedule/", {
    file_name: "old.csv",
    activities: ACTIVITIES.slice(0, 1),
    meta: {},
  });
  expect(localStorage.getItem("drsti.projectDashboard.schedule.tower-a")).toBeNull();
  expect(screen.getByText(/Tower A · old\.csv/)).toBeInTheDocument();
});

test("a server schedule wins: stale legacy copy is dropped without uploading", async () => {
  mockGets();
  localStorage.setItem("drsti.projectDashboard.schedule.tower-a", JSON.stringify({ activities: ACTIVITIES }));
  renderPage();
  await screen.findByText(/plan\.xlsx/);
  expect(API.put).not.toHaveBeenCalled();
  expect(localStorage.getItem("drsti.projectDashboard.schedule.tower-a")).toBeNull();
});

test("corrupt or empty legacy data is ignored", async () => {
  mockGets({ schedule: null });
  localStorage.setItem("drsti.projectDashboard.schedule.tower-a", "{not json");
  renderPage();
  expect(await screen.findByText("Upload your project schedule")).toBeInTheDocument();
  expect(API.put).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------- upload / replace / delete

test("uploading a file parses it and PUTs {file_name, activities, meta}", async () => {
  mockGets({ schedule: null });
  parseScheduleFile.mockResolvedValue({ activities: ACTIVITIES, meta: { sourceIfc: "m.ifc" } });
  API.put.mockResolvedValue({ data: { ...SERVER_SCHEDULE, file_name: "plan.csv", meta: { sourceIfc: "m.ifc" } } });
  const { user, fileInput } = renderPage();
  await screen.findByText("Upload your project schedule");
  expect(screen.getByRole("button", { name: "Upload schedule" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove uploaded schedule" })).not.toBeInTheDocument();

  const file = csv();
  await user.upload(fileInput(), file);
  expect(parseScheduleFile).toHaveBeenCalledWith(file);
  await waitFor(() =>
    expect(API.put).toHaveBeenCalledWith("projects/42/schedule/", {
      file_name: "plan.csv",
      activities: ACTIVITIES,
      meta: { sourceIfc: "m.ifc" },
    }),
  );
  expect(await screen.findByText("Saved 3 activities from plan.csv")).toBeInTheDocument();
  expect(tile("Activities")).toHaveTextContent("3");
  // The input is reset so the same file can be picked again.
  expect(fileInput().value).toBe("");
});

test("dropping a file on the empty state uploads it", async () => {
  mockGets({ schedule: null });
  parseScheduleFile.mockResolvedValue({ activities: ACTIVITIES });
  API.put.mockResolvedValue({ data: SERVER_SCHEDULE });
  renderPage();
  const zone = (await screen.findByText("Upload your project schedule")).parentElement;
  fireEvent.dragOver(zone);
  fireEvent.dragLeave(zone);
  fireEvent.drop(zone, { dataTransfer: { files: [csv("drop.csv")] } });
  await waitFor(() =>
    expect(API.put).toHaveBeenCalledWith("projects/42/schedule/", expect.objectContaining({ file_name: "drop.csv", meta: {} })),
  );
  expect(await screen.findByText("Saved 3 activities from drop.csv")).toBeInTheDocument();
});

test("a file the parser rejects shows its message and is not saved", async () => {
  mockGets({ schedule: null });
  parseScheduleFile.mockRejectedValue(new Error("No activities with a valid Start date were found."));
  const { user, fileInput } = renderPage();
  await screen.findByText("Upload your project schedule");
  await user.upload(fileInput(), csv("bad.csv"));
  expect(await screen.findByText("No activities with a valid Start date were found.")).toBeInTheDocument();
  expect(API.put).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Upload schedule" })).toBeEnabled();
});

test("parser error without a message falls back to a generic one", async () => {
  mockGets({ schedule: null });
  parseScheduleFile.mockRejectedValue(new Error(""));
  const { user, fileInput } = renderPage();
  await screen.findByText("Upload your project schedule");
  await user.upload(fileInput(), csv());
  expect(await screen.findByText("Couldn't read that schedule file.")).toBeInTheDocument();
});

test.each(["viewer", "site_engineer", "admin"])(
  "no client-side role gating (%s): the server's 403 message is shown on save",
  async (role) => {
    localStorage.setItem("role", role);
    mockGets();
    parseScheduleFile.mockResolvedValue({ activities: ACTIVITIES, meta: {} });
    API.put.mockRejectedValue({ response: { status: 403, data: { error: "You are not assigned to this project" } } });
    const { user, fileInput } = renderPage();
    await screen.findByText(/plan\.xlsx/);
    expect(screen.getByRole("button", { name: "Replace schedule" })).toBeEnabled();
    await user.upload(fileInput(), csv("new.csv"));
    expect(await screen.findByText("You are not assigned to this project")).toBeInTheDocument();
    // The existing schedule is kept.
    expect(screen.getByText(/Tower A · plan\.xlsx/)).toBeInTheDocument();
  },
);

test("removing the schedule asks first, then DELETEs and returns to the empty state", async () => {
  mockGets();
  const confirm = jest.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  API.delete.mockResolvedValue({ data: { message: "Deleted" } });
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByRole("button", { name: "Remove uploaded schedule" }));
  expect(confirm).toHaveBeenCalledWith("Remove the schedule from this project's dashboard for all users?");
  expect(API.delete).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove uploaded schedule" }));
  expect(API.delete).toHaveBeenCalledWith("projects/42/schedule/");
  expect(await screen.findByText("Upload your project schedule")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Upload schedule" })).toBeInTheDocument();
  confirm.mockRestore();
});

test("delete failure shows the server error and keeps the schedule", async () => {
  mockGets();
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  API.delete.mockRejectedValue({ response: { data: { error: "You are not assigned to this project" } } });
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByRole("button", { name: "Remove uploaded schedule" }));
  expect(await screen.findByText("You are not assigned to this project")).toBeInTheDocument();
  expect(screen.getByText(/plan\.xlsx/)).toBeInTheDocument();
  API.delete.mockRejectedValue(new Error("net"));
  await user.click(screen.getByRole("button", { name: "Remove uploaded schedule" }));
  expect(await screen.findByText("Couldn't remove the schedule.")).toBeInTheDocument();
  confirm.mockRestore();
});

// ---------------------------------------------------------------- navigation

test("back arrow goes to the previous page", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByTitle("Back"));
  expect(screen.getByText("previous page")).toBeInTheDocument();
});

test("header goes to the role's dashboard", async () => {
  localStorage.setItem("role", "project_manager");
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByTitle("Back to Dashboard"));
  expect(screen.getByText("manager home")).toBeInTheDocument();
});

// ---------------------------------------------------------------- views, filters, toolbar

test("Main Table lists activities by level; clicking a row toggles selection", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByRole("button", { name: "Main Table" }));
  const table = screen.getByRole("table");
  const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
  expect(headers).toEqual([
    "Activity ID", "WBS", "Activity", "Elevation (mm)", "IFC Type(s)", "Elements", "Mapped", "Duration (wd)",
    "Start", "Finish", "Predecessor", "Dep.", "Planned %", "Status",
  ]);
  expect(within(table).getByText(/2024-01-01 → 2024-01-12 · 2 activities/)).toBeInTheDocument();
  expect(within(table).getByText(/2024-01-15 → 2024-01-19 · 1 activities/)).toBeInTheDocument();
  const row = within(table).getByText("Slab").closest("tr");
  expect(row).toHaveTextContent("A21.2Slab0IfcSlab65");
  expect(row).toHaveTextContent("A1FS60%In Progress");
  await user.click(row);
  expect(row).toHaveStyle({ background: "#eef2f7" });
  await user.click(row);
  expect(row).not.toHaveStyle({ background: "#eef2f7" });
});

test("4D tab passes the activities, filter and range to the 4D view", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByRole("button", { name: "4D Model" }));
  expect(screen.getByTestId("schedule-4d")).toHaveTextContent(
    "4D project 42: 3 activities, visible all, 2024-01-01..2024-01-19, today 2024-01-10",
  );
  // Gantt-only controls are gone.
  expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByDisplayValue("All levels"), "L2");
  expect(screen.getByTestId("schedule-4d")).toHaveTextContent("visible B1,");
  // A filter matching nothing keeps the 4D view up.
  await user.type(screen.getByPlaceholderText("Search activities"), "zzz");
  expect(screen.getByTestId("schedule-4d")).toHaveTextContent("visible ,");
});

test("search, level and status filters narrow the activities", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  const search = screen.getByPlaceholderText("Search activities");

  await user.type(search, "slab");
  expect(screen.getByText("1 of 3 activities")).toBeInTheDocument();
  expect(screen.getByTitle("A2 · Slab")).toBeInTheDocument();
  expect(screen.queryByTitle("A1 · Columns")).not.toBeInTheDocument();

  // Also matches mapping keys and IFC types.
  await user.clear(search);
  await user.type(search, "mk-col");
  expect(screen.getByText("1 of 3 activities")).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, "IFCWALL");
  expect(screen.getByTitle("B1 · Walls")).toBeInTheDocument();

  await user.clear(search);
  await user.type(search, "nothing like this");
  expect(screen.getByText("No activities match the current filters.")).toBeInTheDocument();
  await user.clear(search);

  const level = screen.getByDisplayValue("All levels");
  expect(within(level).getAllByRole("option").map((o) => o.textContent)).toEqual(["All levels", "L1", "L2"]);
  await user.selectOptions(level, "L1");
  expect(screen.getByText("2 of 3 activities")).toBeInTheDocument();
  await user.selectOptions(level, "all");

  const status = screen.getByDisplayValue("All statuses");
  expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "All statuses", "Completed", "In Progress", "Not Started",
  ]);
  await user.selectOptions(status, "Not Started");
  expect(screen.getByText("1 of 3 activities")).toBeInTheDocument();
  expect(screen.getByTitle("B1 · Walls")).toBeInTheDocument();
});

test("collapse all / expand all levels", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  await user.click(screen.getByTitle("Collapse all levels"));
  expect(screen.queryByTitle("A1 · Columns")).not.toBeInTheDocument();
  expect(screen.queryByTitle("B1 · Walls")).not.toBeInTheDocument();
  // Expanding one level by clicking its header.
  await user.click(screen.getByText("1 task"));
  expect(screen.getByTitle("B1 · Walls")).toBeInTheDocument();
  expect(screen.getByTitle("Collapse all levels")).toBeInTheDocument();
  await user.click(screen.getByText("1 task"));
  await user.click(screen.getByTitle("Expand all levels"));
  expect(screen.getByTitle("A1 · Columns")).toBeInTheDocument();
});

test("zoom select, zoom buttons and Overview change the Gantt scale", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  const zoom = screen.getByDisplayValue("Days");
  expect(screen.getByText("Week 2")).toBeInTheDocument();
  await user.selectOptions(zoom, "weeks");
  expect(zoom).toHaveDisplayValue("Weeks");
  expect(screen.getByText("Jan 2024")).toBeInTheDocument();
  await user.selectOptions(zoom, "months");
  expect(screen.getByText("2024", { selector: "b" })).toBeInTheDocument();
  await user.selectOptions(zoom, "days");
  await user.click(screen.getByTitle("Zoom in"));
  expect(zoom).toHaveDisplayValue("Days");
  await user.click(screen.getByTitle("Zoom out"));
  await user.click(screen.getByTitle("Zoom out"));
  await user.click(screen.getByTitle("Zoom out")); // 39 -> 30 -> 23 -> 17.7 px/day
  expect(zoom).toHaveDisplayValue("Weeks");
  await user.selectOptions(zoom, "days");
  // Fit: 818px viewport (jsdom fallback) over 46 days ≈ 17.8 px/day.
  await user.click(screen.getByRole("button", { name: "Overview" }));
  expect(zoom).toHaveDisplayValue("Weeks");
});

test("Today scrolls the Gantt to today when it is inside the schedule", async () => {
  mockGets();
  const { user } = renderPage();
  await screen.findByText(/plan\.xlsx/);
  const today = screen.getByRole("button", { name: "Today" });
  expect(today).toBeEnabled();
  expect(today).toHaveAttribute("title", "Scroll to today");
  await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  scrollTo.mockClear();
  await user.click(today);
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
});

test("Today is disabled for a schedule far from today; no activity active", async () => {
  const shift = (a) => ({ ...a, start: a.start.replace("2024", "2025"), finish: a.finish.replace("2024", "2025") });
  mockGets({ schedule: { ...SERVER_SCHEDULE, activities: ACTIVITIES.map(shift) } });
  renderPage();
  await screen.findByText(/plan\.xlsx/);
  const today = screen.getByRole("button", { name: "Today" });
  expect(today).toBeDisabled();
  expect(today).toHaveAttribute("title", "Today is outside the schedule");
  expect(tile("Planned progress")).toHaveTextContent("0%No activity scheduled today");
});

// ---------------------------------------------------------------- measured progress

test("measured progress: KPI tiles, scan-driven status and progress chips", async () => {
  mockGets({ progress: PROGRESS });
  const { user } = renderPage();
  await screen.findByText("Actual progress");
  // 11 of 15 matched elements built; planned at scan (10×100 + 5×40) / 15.
  expect(tile("Actual progress")).toHaveTextContent("73%Planned 80% on scan date");
  expect(tile("Delayed activities")).toHaveTextContent("1of 2 measured");
  expect(tile("Missing elements")).toHaveTextContent("0");
  expect(tile("Latest scan")).toHaveTextContent("Jan 92 scans assessed");
  // 8 days elapsed for 73% -> 100% after 11 days.
  expect(tile("Forecast finish")).toHaveTextContent("Jan 12At current pace · planned Jan 19");

  await user.click(screen.getByRole("button", { name: "Main Table" }));
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(
    expect.arrayContaining(["Actual %", "Progress", "Actual start", "Actual finish", "Not built"]),
  );
  const a1 = within(table).getByText("Columns").closest("tr");
  expect(a1).toHaveTextContent("100%");
  expect(within(a1).getAllByText("Completed")).toHaveLength(2); // progress chip + status
  expect(a1).toHaveTextContent("2024-01-022024-01-05");
  const a2 = within(table).getByText("Slab").closest("tr");
  expect(within(a2).getByText("Delayed (-20%)")).toHaveAttribute("title", "Planned 40% on the scan date");
  expect(within(a2).getByTitle("Schedule expects 6 elements but 5 were found in the model")).toBeInTheDocument();
  expect(within(a2).getByText("In Progress")).toBeInTheDocument();
  const b1 = within(table).getByText("Walls").closest("tr");
  expect(within(b1).getByText("Not mapped")).toBeInTheDocument();
  expect(within(b1).getByText("—")).toBeInTheDocument();

  // Progress filter
  await user.selectOptions(screen.getByDisplayValue("All progress"), "Delayed");
  expect(screen.getByText("1 of 3 activities")).toBeInTheDocument();
});

test("missing-elements dialog lists elements not built and closes", async () => {
  mockGets({ progress: PROGRESS });
  const { user } = renderPage();
  await screen.findByText("Actual progress");
  await user.click(screen.getByRole("button", { name: "Main Table" }));
  await user.click(screen.getByRole("button", { name: "4 of 5" }));
  expect(screen.getByText("A2 · Slab")).toBeInTheDocument();
  expect(screen.getByText(/4 of 5 elements not built in the scan of 2024-01-09 — showing first 1\./)).toBeInTheDocument();
  const dialogRow = screen.getByText("g-1").closest("tr");
  expect(dialogRow).toHaveTextContent("Slab 1IfcSlabL1In Progress40%g-1");
  // Opening the dialog doesn't select the row.
  expect(screen.getByText("Slab", { selector: "td" }).closest("tr")).not.toHaveStyle({ background: "#eef2f7" });
  await user.click(screen.getByTitle("Close"));
  expect(screen.queryByText("g-1")).not.toBeInTheDocument();
});

test("forecast shows Done at 100% and a dash with no progress", async () => {
  const done = JSON.parse(JSON.stringify(PROGRESS));
  done.activities.A2 = { ...done.activities.A2, completed: 5, actual_pct: 100, missing_total: 0, missing: [] };
  mockGets({ progress: done });
  const { unmount } = renderPage();
  await screen.findByText("Actual progress");
  expect(tile("Forecast finish")).toHaveTextContent("DoneNeeds progress on a scan");
  expect(tile("Latest scan")).toHaveTextContent("2 scans assessed");
  unmount();

  const none = JSON.parse(JSON.stringify(PROGRESS));
  none.scan_dates = ["2024-01-09"];
  none.activities.A1 = { ...none.activities.A1, completed: 0, actual_pct: 0, missing_total: 10 };
  none.activities.A2 = { ...none.activities.A2, completed: 0, in_progress: 0, actual_pct: 0 };
  mockGets({ progress: none });
  renderPage();
  await screen.findByText("Actual progress");
  expect(tile("Forecast finish")).toHaveTextContent("—Needs progress on a scan");
  expect(tile("Latest scan")).toHaveTextContent("1 scan assessed");
  // A1 should be finished by the scan but none of its 10 elements are built.
  expect(tile("Missing elements")).toHaveTextContent("10");
});

test("notice when no Progress Assessment has been saved", async () => {
  mockGets({ progress: { ...PROGRESS, scan_dates: [], activities: {} } });
  renderPage();
  expect(await screen.findByText(/No Progress Assessment saved yet/)).toBeInTheDocument();
});

test("notice when the latest assessment predates floor recording", async () => {
  mockGets({ progress: { ...PROGRESS, latest_has_levels: false } });
  renderPage();
  expect(await screen.findByText(/saved before floors were recorded/)).toBeInTheDocument();
});

test("unmatched levels: notice, mapping dialog, PATCH level_map and reload", async () => {
  const state = mockGets({ progress: PROGRESS });
  API.patch.mockImplementation(async (url, body) => {
    state.progress = { ...PROGRESS, level_map: { L1: "Level 1" } };
    return { data: { ...SERVER_SCHEDULE, meta: { level_map: body.level_map } } };
  });
  const { user } = renderPage();
  expect(
    await screen.findByText("1 schedule level (L1) doesn't match any floor in the model."),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Map levels" }));
  expect(screen.getByText("Map schedule levels to model floors")).toBeInTheDocument();
  // L2 exists in the model; L1 does not.
  expect(screen.getByDisplayValue("Same name (matches)")).toBeInTheDocument();
  await user.selectOptions(screen.getByDisplayValue("— not mapped —"), "Level 1");
  await user.click(screen.getByRole("button", { name: "Save mapping" }));

  expect(API.patch).toHaveBeenCalledWith("projects/42/schedule/", { level_map: { L1: "Level 1", L2: "" } });
  expect(await screen.findByText("Level mapping saved.")).toBeInTheDocument();
  expect(screen.queryByText("Map schedule levels to model floors")).not.toBeInTheDocument();
  // Progress reloaded with the mapping -> the notice turns into "Edit mapping".
  expect(await screen.findByText(/Schedule levels are mapped to model floors\./)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit mapping" }));
  expect(screen.getByDisplayValue("Level 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText("Map schedule levels to model floors")).not.toBeInTheDocument();
});

test("several unmatched levels use the plural and truncate after four", async () => {
  const levels = ["Lv1", "Lv2", "Lv3", "Lv4", "Lv5"];
  const acts = levels.map((lv, i) => ({ ...ACTIVITIES[0], id: `X${i}`, level: lv }));
  const actual = Object.fromEntries(acts.map((a) => [a.id, { ...PROGRESS.activities.A1 }]));
  mockGets({ schedule: { ...SERVER_SCHEDULE, activities: acts }, progress: { ...PROGRESS, activities: actual } });
  renderPage();
  expect(
    await screen.findByText("5 schedule levels (Lv1, Lv2, Lv3, Lv4…) don't match any floor in the model."),
  ).toBeInTheDocument();
});

test("level-mapping save failure keeps the dialog open and shows the error", async () => {
  mockGets({ progress: PROGRESS });
  API.patch.mockRejectedValue({ response: { data: {} } });
  const { user } = renderPage();
  await user.click(await screen.findByRole("button", { name: "Map levels" }));
  await user.click(screen.getByRole("button", { name: "Save mapping" }));
  expect(await screen.findByText("Couldn't save the level mapping.")).toBeInTheDocument();
  expect(screen.getByText("Map schedule levels to model floors")).toBeInTheDocument();
  // Clicking the backdrop closes it.
  await user.click(screen.getByText("Map schedule levels to model floors").closest("[style*='fixed']"));
  expect(screen.queryByText("Map schedule levels to model floors")).not.toBeInTheDocument();
});
