import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import API from "../../api/axios";
import ProgressTimelinePage, {
  fmtDate,
  dateLabel,
  parseISODate,
  isoDay,
  periodOf,
  applyViewMode,
  fmtPct,
  fmtNum,
  catOf,
  deltaText,
  pctOf,
  changeLine,
  prevIndexWith,
  statusTip,
  categoryTip,
  tipHandlers,
  roundRectPath,
  downloadBlob,
  exportStatusChartToPNG,
  exportCategoryChartsToPNG,
} from "./ProgressTimelinePage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../viewer/layout/Header", () => () => <div data-testid="header" />);

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({
  useToast: () => mockToast,
}));

// ─── Canvas / download stubs ────────────────────────────────────────────────
let ctx;
function makeCtx() {
  const c = {};
  ["scale", "fillRect", "fillText", "beginPath", "moveTo", "lineTo", "arcTo", "closePath", "fill", "stroke", "save", "restore", "translate", "rotate", "arc", "setLineDash", "strokeRect"].forEach(
    (k) => (c[k] = jest.fn()),
  );
  c.measureText = jest.fn(() => ({ width: 40 }));
  return c;
}
beforeEach(() => {
  ctx = makeCtx();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
  HTMLCanvasElement.prototype.toBlob = jest.fn(function (cb) {
    cb(new Blob(["png"]));
  });
  URL.createObjectURL = jest.fn(() => "blob:fake");
  URL.revokeObjectURL = jest.fn();
  mockToast.success = jest.fn();
  mockToast.error = jest.fn();
  mockToast.info = jest.fn();
});

// ─── Fixtures ───────────────────────────────────────────────────────────────
const cat = (category, completed, count, extra = {}) => ({
  category,
  count,
  completed,
  in_progress: Math.max(0, count - completed - 1),
  not_started: Math.min(1, count - completed),
  completion: count ? Math.round((completed / count) * 10000) / 100 : 0,
  points_coverage: 50,
  ...extra,
});
const entry = (pair_id, date, summary, categories = []) => ({
  pair_id,
  pointcloud_date: date,
  summary,
  categories,
});
const summ = (completed, total = 10) => ({
  total,
  completed,
  in_progress: Math.max(0, total - completed - 2),
  not_started: Math.min(2, total - completed),
  overall_completion: (completed / total) * 100,
});

const DATES = [
  entry(1, "2026-01-05", summ(2), [cat("Beams", 1, 4), cat("Walls", 1, 6)]),
  entry(2, "2026-01-07", summ(4), [cat("Beams", 2, 4), cat("Walls", 2, 6)]),
  entry(3, "2026-02-10", summ(6), [cat("Beams", 4, 4), cat("Walls", 2, 6)]),
  entry(4, "2026-03-02", summ(7), [cat("Beams", 4, 4), cat("Walls", 3, 6), cat("Slabs", 0, 2)]),
  entry(5, null, null, []),
];

// ─── Pure helpers ───────────────────────────────────────────────────────────
describe("formatting helpers", () => {
  test("fmtDate / dateLabel", () => {
    expect(fmtDate(null)).toBe("No date");
    expect(fmtDate("2026-01-01")).toBe("2026-01-01");
    expect(dateLabel({ pointcloud_date: "2026-01-01" })).toBe("2026-01-01");
    expect(dateLabel({ label: "Jan 2026", pointcloud_date: "2026-01-01" })).toBe("Jan 2026");
    expect(dateLabel({})).toBe("No date");
  });

  test("fmtPct rounds to 2 decimals and treats nullish as 0", () => {
    expect(fmtPct(51.4321)).toBe("51.43%");
    expect(fmtPct(100)).toBe("100%");
    expect(fmtPct(undefined)).toBe("0%");
    expect(fmtPct(null)).toBe("0%");
  });

  test("fmtNum formats with locale separators", () => {
    expect(fmtNum(1234567)).toBe((1234567).toLocaleString());
    expect(fmtNum(undefined)).toBe("0");
  });

  test("deltaText", () => {
    expect(deltaText(null)).toBe("");
    expect(deltaText(undefined)).toBe("");
    expect(deltaText(0)).toBe("no change");
    expect(deltaText(5)).toBe("+5");
    expect(deltaText(-1200)).toBe(`−${(1200).toLocaleString()}`);
  });

  test("pctOf guards against a zero total", () => {
    expect(pctOf(5, 0)).toBe(0);
    expect(pctOf(5, 20)).toBe(25);
    expect(pctOf(undefined, 20)).toBe(0);
  });

  test("changeLine", () => {
    expect(changeLine(null, "x")).toMatch(/First date in view/);
    expect(changeLine(0, "Jan")).toBe("No change in completed vs Jan.");
    expect(changeLine(3, "Jan")).toBe("+3 completed vs Jan");
    expect(changeLine(-2, "Jan", "elements")).toBe("−2 elements vs Jan");
  });

  test("catOf finds a category or returns undefined", () => {
    expect(catOf(DATES[0], "Beams").completed).toBe(1);
    expect(catOf(DATES[0], "Nope")).toBeUndefined();
    expect(catOf({}, "Beams")).toBeUndefined();
  });
});

describe("date bucketing", () => {
  test("parseISODate parses YYYY-MM-DD as UTC and rejects junk", () => {
    const d = parseISODate("2026-03-02");
    expect(d.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(parseISODate("2026-03-02T10:00:00Z").toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(parseISODate(null)).toBeNull();
    expect(parseISODate("")).toBeNull();
    expect(parseISODate("03/02/2026")).toBeNull();
  });

  test("isoDay", () => {
    expect(isoDay(new Date(Date.UTC(2026, 0, 9)))).toBe("2026-01-09");
  });

  test("periodOf year / month / ISO week (Monday start)", () => {
    const d = parseISODate("2026-01-07"); // Wednesday
    expect(periodOf(d, "year")).toEqual({ key: "2026", label: "2026" });
    expect(periodOf(d, "month")).toEqual({ key: "2026-01", label: "Jan 2026" });
    expect(periodOf(d, "week")).toEqual({ key: "2026-01-05", label: "Week of 2026-01-05" });
    // Sunday belongs to the week starting the previous Monday
    expect(periodOf(parseISODate("2026-01-11"), "week").key).toBe("2026-01-05");
    // Monday is its own week start
    expect(periodOf(parseISODate("2026-01-12"), "week").key).toBe("2026-01-12");
    // Week crossing a year boundary
    expect(periodOf(parseISODate("2026-01-01"), "week").key).toBe("2025-12-29");
    expect(periodOf(parseISODate("2026-12-15"), "month").label).toBe("Dec 2026");
  });

  test("applyViewMode 'all' keeps everything including undated", () => {
    expect(applyViewMode(DATES, "all")).toBe(DATES);
  });

  test("applyViewMode 'last3' keeps the last 3 dated entries", () => {
    expect(applyViewMode(DATES, "last3").map((d) => d.pair_id)).toEqual([2, 3, 4]);
  });

  test("applyViewMode 'last3' falls back to undated entries when nothing is dated", () => {
    const undated = [entry(9, null, null), entry(10, "bad", null)];
    expect(applyViewMode(undated, "last3").map((d) => d.pair_id)).toEqual([9, 10]);
  });

  test("applyViewMode 'month' groups by month, using the latest assessed scan", () => {
    const out = applyViewMode(DATES, "month");
    expect(out.map((d) => d.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026"]);
    expect(out[0].pair_id).toBe(2);
    expect(out[0].subLabel).toBe("2 scans · latest 2026-01-07");
    expect(out[1].subLabel).toBe("1 scan · latest 2026-02-10");
  });

  test("applyViewMode prefers an assessed scan over a later unassessed one", () => {
    const ds = [entry(1, "2026-01-05", summ(1)), entry(2, "2026-01-20", null)];
    const [jan] = applyViewMode(ds, "month");
    expect(jan.pair_id).toBe(1);
    expect(jan.subLabel).toBe("2 scans · latest 2026-01-05");
  });

  test("applyViewMode uses the latest unassessed scan when none is assessed", () => {
    const ds = [entry(1, "2026-01-05", null), entry(2, "2026-01-20", null)];
    expect(applyViewMode(ds, "year")[0].pair_id).toBe(2);
  });

  test("applyViewMode 'week' and 'year'", () => {
    expect(applyViewMode(DATES, "week").map((d) => d.label)).toEqual([
      "Week of 2026-01-05",
      "Week of 2026-02-09",
      "Week of 2026-03-02",
    ]);
    expect(applyViewMode(DATES, "year")).toHaveLength(1);
    expect(applyViewMode([], "month")).toEqual([]);
  });
});

describe("tooltip builders", () => {
  test("prevIndexWith finds the previous matching entry", () => {
    const ds = [{ s: 1 }, { s: 0 }, { s: 1 }, { s: 0 }];
    expect(prevIndexWith(ds, 3, (x) => x.s)).toBe(2);
    expect(prevIndexWith(ds, 2, (x) => x.s)).toBe(0);
    expect(prevIndexWith(ds, 0, (x) => x.s)).toBe(-1);
    expect(prevIndexWith(ds, 99, (x) => x.s)).toBe(2);
  });

  test("statusTip without a summary", () => {
    const t = statusTip(entry(1, "2026-01-01", null), null);
    expect(t.title).toBe("2026-01-01");
    expect(t.footer).toMatch(/No saved assessment/);
    expect(t.rows).toBeUndefined();
  });

  test("statusTip with a summary and previous", () => {
    const t = statusTip(DATES[1], DATES[0]);
    expect(t.subtitle).toBe("10 BIM elements assessed");
    expect(t.rows.map((r) => r.value)).toEqual(["4", "4", "2"]);
    expect(t.rows[0].note).toBe("40%");
    render(<div>{t.footer}</div>);
    expect(screen.getByText("+2 completed vs 2026-01-05")).toBeInTheDocument();
  });

  test("statusTip first date has no comparison", () => {
    const t = statusTip(DATES[0], null);
    render(<div>{t.footer}</div>);
    expect(screen.getByText(/First date in view/)).toBeInTheDocument();
  });

  test("categoryTip without data", () => {
    const t = categoryTip("Slabs", DATES[0], null);
    expect(t.footer).toMatch(/No data for this category/);
    expect(t.subtitle).toBe("2026-01-05");
  });

  test("categoryTip with previous shows count and percentage-point change", () => {
    const t = categoryTip("Beams", DATES[2], DATES[1]);
    expect(t.rows[0].value).toBe("4 / 4");
    expect(t.rows[0].note).toBe("100%");
    render(<div>{t.footer}</div>);
    expect(screen.getByText(/\+2 completed vs 2026-01-07/)).toHaveTextContent("(+50%)");
    expect(screen.getByText("50% points coverage")).toBeInTheDocument();
    expect(screen.getByText("Click to open Beams details")).toBeInTheDocument();
  });

  test("categoryTip includes subLabel and hides zero pp change", () => {
    const d = { ...DATES[3], label: "Mar 2026", subLabel: "1 scan" };
    const t = categoryTip("Beams", d, DATES[2]);
    expect(t.subtitle).toBe("Mar 2026 · 1 scan");
    render(<div>{t.footer}</div>);
    expect(screen.getByText(/No change in completed/).textContent).not.toMatch(/\(/);
  });

  test("categoryTip omits points coverage when absent", () => {
    const d = entry(1, "2026-01-01", summ(1), [cat("X", 1, 2, { points_coverage: null })]);
    render(<div>{categoryTip("X", d, null).footer}</div>);
    expect(screen.queryByText(/points coverage/)).not.toBeInTheDocument();
  });

  test("tipHandlers wires pointer and focus events", () => {
    const setTip = jest.fn();
    const h = tipHandlers(setTip, () => ({ title: "T" }));
    expect(h.tabIndex).toBe(0);
    h.onPointerMove({ clientX: 3, clientY: 4 });
    expect(setTip).toHaveBeenLastCalledWith({ title: "T", x: 3, y: 4 });
    h.onPointerLeave();
    expect(setTip).toHaveBeenLastCalledWith(null);
    h.onFocus({ currentTarget: { getBoundingClientRect: () => ({ right: 10, top: 20 }) } });
    expect(setTip).toHaveBeenLastCalledWith({ title: "T", x: 10, y: 20 });
    h.onBlur();
    expect(setTip).toHaveBeenLastCalledWith(null);
  });
});

describe("canvas export", () => {
  test("roundRectPath clamps the radius", () => {
    const c = makeCtx();
    roundRectPath(c, 0, 0, 4, 100, 10);
    expect(c.arcTo).toHaveBeenCalledWith(0, 0, 2, 0, 2);
    roundRectPath(c, 0, 0, 10, 10, -5);
    expect(c.arcTo).toHaveBeenLastCalledWith(10, 0, 10, 0, 0);
  });

  test("downloadBlob clicks a temporary link and revokes the URL", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadBlob(new Blob(["x"]), "f.png");
    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
  });

  test("exportStatusChartToPNG draws and downloads a PNG", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportStatusChartToPNG(DATES);
    expect(ctx.fillText).toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  test("exportCategoryChartsToPNG draws one cell per category", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportCategoryChartsToPNG(DATES, ["Beams", "Slabs", "Walls"]);
    const labels = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(expect.arrayContaining(["Beams", "Slabs", "Walls"]));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  test("export does nothing when toBlob yields null", () => {
    HTMLCanvasElement.prototype.toBlob = jest.fn((cb) => cb(null));
    exportStatusChartToPNG([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

// ─── Page ───────────────────────────────────────────────────────────────────
function renderPage(slug = "7_Tower") {
  return render(
    <MemoryRouter initialEntries={["/start", `/progress-timeline/${slug}`]} initialIndex={1}>
      <Routes>
        <Route path="/progress-timeline/:slug" element={<ProgressTimelinePage />} />
        <Route path="/start" element={<div>START PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Wait until data is loaded and the default selection effect has settled.
async function ready() {
  await screen.findByText(/Showing 3 of 5/);
  await waitFor(() => expect(screen.getByText(/Selected:/).textContent).toMatch(/Selected: 2026-03-02/));
}

function mockApi({ projects = [{ id: 7, project_name: "Tower", slug: "tower" }], dates = DATES, timelineError } = {}) {
  API.get.mockImplementation((url) => {
    if (url === "projects/") return Promise.resolve({ data: projects });
    if (url.startsWith("processing/progress/timeline/")) {
      return timelineError ? Promise.reject(timelineError) : Promise.resolve({ data: { dates } });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

describe("ProgressTimelinePage", () => {
  test("loads the project and its timeline", async () => {
    mockApi();
    renderPage();
    expect(screen.getByText(/Loading timeline/)).toBeInTheDocument();
    expect(await screen.findByText("Tower")).toBeInTheDocument();
    expect(API.get).toHaveBeenCalledWith("projects/");
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/timeline/7/"));
    expect(await screen.findByText(/Showing 3 of 5 scan dates/)).toBeInTheDocument();
    expect(screen.getByText(/1 scan without a date hidden/)).toBeInTheDocument();
  });

  test("resolves the project by slug field", async () => {
    mockApi({ projects: [{ id: 12, project_name: "By Slug", slug: "tower-x" }] });
    renderPage("tower-x");
    expect(await screen.findByText("By Slug")).toBeInTheDocument();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/timeline/12/"));
  });

  test("falls back to the leading id when the project isn't in the list", async () => {
    mockApi({ projects: [] });
    renderPage("9_Unknown");
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/timeline/9/"));
    expect(await screen.findByText("Project #9")).toBeInTheDocument();
  });

  test("falls back to the leading id when the project list fails", async () => {
    API.get.mockImplementation((url) =>
      url === "projects/" ? Promise.reject(new Error("x")) : Promise.resolve({ data: { dates: [] } }),
    );
    renderPage("9_Unknown");
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/timeline/9/"));
    expect(await screen.findByText(/No registered alignment pairs/)).toBeInTheDocument();
  });

  // Regression: an unresolvable slug left the page on "Loading timeline…" forever.
  test("stops loading when the project cannot be resolved", async () => {
    mockApi({ projects: [] });
    renderPage("no-such-project");
    expect(await screen.findByText(/No registered alignment pairs/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading timeline/)).not.toBeInTheDocument();
  });

  test("stops loading when the project list fails for a non-numeric slug", async () => {
    API.get.mockRejectedValue(new Error("down"));
    renderPage("no-such-project");
    expect(await screen.findByText(/No registered alignment pairs/)).toBeInTheDocument();
  });

  test("shows a toast when the timeline fails to load", async () => {
    mockApi({ timelineError: new Error("500") });
    renderPage();
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to load progress timeline."));
    expect(await screen.findByText(/No registered alignment pairs/)).toBeInTheDocument();
  });

  test("empty timeline shows the empty state", async () => {
    mockApi({ dates: [] });
    renderPage();
    expect(await screen.findByText(/No registered alignment pairs for this project yet/)).toBeInTheDocument();
  });

  test("Back navigates to the previous page", async () => {
    mockApi();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(await screen.findByText("START PAGE")).toBeInTheDocument();
  });

  test("defaults to the latest assessed date and shows stat tiles", async () => {
    mockApi();
    renderPage();
    await ready();
    await waitFor(() =>
      expect(screen.getByText(/Selected:/).textContent).toMatch(/Selected: 2026-03-02 · compared with 2026-02-10/),
    );
    expect(screen.getAllByText("70%").length).toBeGreaterThan(0); // overall completion tile
    expect(screen.getByText("7 of 10 elements")).toBeInTheDocument();
    expect(screen.getByText("+10%")).toBeInTheDocument(); // overall delta
  });

  test("switching view modes changes the visible dates", async () => {
    mockApi();
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/3 months — each shows the latest assessed scan in that month/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jan 2026 — select this date" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Yearly" }));
    expect(screen.getByText(/1 year — each shows/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    expect(screen.getByText(/Showing 5 of 5 scan dates\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/without a date hidden/)).not.toBeInTheDocument();
  });

  test("clicking a date in the status chart selects it", async () => {
    mockApi();
    renderPage();
    await ready();
    const btn = screen.getByRole("button", { name: "2026-01-07 — select this date" });
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Selected:/).textContent).toMatch(/Selected: 2026-01-07/);
  });

  test("selecting a date without an assessment shows the empty tile message", async () => {
    mockApi();
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const undated = screen.getByRole("button", { name: "No date — select this date" });
    await userEvent.click(undated);
    await userEvent.unhover(undated);
    expect(screen.getByText("No saved assessment for this date yet.")).toBeInTheDocument();
  });

  test("hovering a date shows a tooltip; leaving hides it", async () => {
    mockApi();
    renderPage();
    await ready();
    const btn = screen.getByRole("button", { name: "2026-03-02 — select this date" });
    fireEvent.pointerMove(btn, { clientX: 10, clientY: 10 });
    const tip = await screen.findByRole("tooltip");
    expect(within(tip).getByText("2026-03-02")).toBeInTheDocument();
    expect(within(tip).getByText("+1 completed vs 2026-02-10")).toBeInTheDocument();
    fireEvent.pointerLeave(btn);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  test("legend toggles hide a status series", async () => {
    mockApi();
    renderPage();
    await ready();
    const toggle = screen.getAllByTitle("Click to hide Completed")[0];
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("title", "Click to show Completed");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("100% stacked layout toggle", async () => {
    mockApi();
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "100% stacked" }));
    expect(screen.getByRole("button", { name: "100% stacked" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Counts" })).toHaveAttribute("aria-pressed", "false");
  });

  test("category cards: search, hide empty, sort and open detail", async () => {
    mockApi();
    renderPage();
    await ready();
    expect(await screen.findByText(/3 of 3 categories · sorted by 2026-03-02/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search categories"), "wal");
    expect(screen.getByText(/1 of 3 categories/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search categories"));

    await userEvent.click(screen.getByLabelText(/Hide categories with nothing completed/));
    expect(screen.getByText(/2 of 3 categories/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Hide categories with nothing completed/));

    const order = () => screen.getAllByTitle(/^Open .* details$/).map((b) => b.getAttribute("title"));
    expect(order()).toEqual(["Open Beams details", "Open Slabs details", "Open Walls details"]);
    await userEvent.selectOptions(screen.getByLabelText("Sort categories"), "pct_asc");
    expect(order()).toEqual(["Open Slabs details", "Open Walls details", "Open Beams details"]);
    await userEvent.selectOptions(screen.getByLabelText("Sort categories"), "pct_desc");
    expect(order()[0]).toBe("Open Beams details");
    await userEvent.selectOptions(screen.getByLabelText("Sort categories"), "size");
    expect(order()[0]).toBe("Open Walls details");
    await userEvent.selectOptions(screen.getByLabelText("Sort categories"), "gain");
    expect(order()[0]).toBe("Open Walls details");
    await userEvent.selectOptions(screen.getByLabelText("Sort categories"), "drop");
    expect(order()[0]).toBe("Open Beams details");

    await userEvent.click(screen.getByTitle("Open Walls details"));
    const close = await screen.findByRole("button", { name: /Close ✕/ });
    expect(close).toBeInTheDocument();
    await userEvent.click(close);
    expect(screen.queryByRole("button", { name: /Close ✕/ })).not.toBeInTheDocument();
  });

  test("clicking a category bar selects that date", async () => {
    mockApi();
    renderPage();
    await ready();
    const bar = screen.getByRole("button", { name: /^Beams, 2026-01-07: 2 of 4 completed/ });
    await userEvent.click(bar);
    expect(screen.getByText(/Selected:/).textContent).toMatch(/Selected: 2026-01-07/);
    fireEvent.pointerMove(bar, { clientX: 1, clientY: 1 });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Beams");
  });

  test("category detail lets you select a date", async () => {
    mockApi();
    renderPage();
    await ready();
    await userEvent.click(screen.getByTitle("Open Beams details"));
    const close = await screen.findByRole("button", { name: /Close ✕/ });
    const detail = close.parentElement.parentElement;
    const rows = within(detail).getAllByRole("button").filter((b) => b !== close);
    await userEvent.click(rows[0]);
    expect(screen.getByText(/Selected:/).textContent).toMatch(/Selected: 2026-01-07/);
  });

  test("compare table: defaults, changes and sorting", async () => {
    mockApi();
    renderPage();
    await ready();
    const from = screen.getByLabelText("Compare from date");
    const to = screen.getByLabelText("Compare to date");
    await waitFor(() => expect(from).toHaveDisplayValue("2026-02-10"));
    expect(to).toHaveDisplayValue("2026-03-02");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Walls").closest("tr")).toHaveTextContent("+1");
    expect(screen.getByText(/Overall:/)).toHaveTextContent("Overall: 60% → 70% · +1 completed elements");

    await userEvent.selectOptions(from, "0"); // 2026-01-07 in last3 view
    expect(within(table).getByText("Beams").closest("tr")).toHaveTextContent("+2");

    const catHeader = within(table).getByRole("columnheader", { name: /Category/ });
    await userEvent.click(catHeader);
    expect(catHeader).toHaveAttribute("aria-sort", "ascending");
    const names = () => within(table).getAllByRole("row").slice(1).map((r) => r.cells[0].textContent);
    expect(names()).toEqual(["Beams", "Slabs", "Walls"]);
    await userEvent.click(catHeader);
    expect(catHeader).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Walls", "Slabs", "Beams"]);

    const toHeader = within(table).getByRole("columnheader", { name: /2026-03-02/ });
    await userEvent.click(toHeader);
    expect(toHeader).toHaveAttribute("aria-sort", "descending");
    expect(names()[0]).toBe("Beams");
    await userEvent.click(within(table).getByRole("columnheader", { name: /2026-01-07/ }));
    expect(names()[0]).toBe("Beams");
  });

  test("download buttons export PNGs", async () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mockApi();
    renderPage();
    await ready();
    const buttons = screen.getAllByTitle("Download this chart as a PNG image");
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  test("timeline with no saved assessments shows the category empty state", async () => {
    mockApi({ dates: [entry(1, "2026-01-01", null, []), entry(2, "2026-01-02", null, [])] });
    renderPage();
    expect(await screen.findByText(/No saved assessments yet/)).toBeInTheDocument();
    expect(screen.getAllByTitle("Download this chart as a PNG image")).toHaveLength(1);
    expect(screen.queryByLabelText("Compare from date")).not.toBeInTheDocument();
  });
});
