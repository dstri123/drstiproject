import { render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import API from "../../api/axios";
import ProgressAssessmentPage, {
  fmtDate,
  withElementCounts,
  completedLabel,
  fmtPct,
  niceCeil,
  shade,
  downloadBlob,
  exportCategoriesToCSV,
  roundRectPath,
  exportChartToPNG,
  polarToCartesian,
  describeArc,
  levelFor,
} from "./ProgressAssessmentPage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../viewer/layout/Header", () => () => <div data-testid="header" />);

const mockToast = {};
jest.mock("../../components/ToastContainer", () => ({
  useToast: () => mockToast,
}));

// ─── Canvas / download stubs ────────────────────────────────────────────────
let ctx;
let lastBlob;
function makeCtx() {
  const c = {};
  ["scale", "fillRect", "fillText", "beginPath", "moveTo", "lineTo", "arcTo", "closePath", "fill", "stroke", "save", "restore", "translate", "rotate"].forEach(
    (k) => (c[k] = jest.fn()),
  );
  c.measureText = jest.fn(() => ({ width: 40 }));
  return c;
}
let clickSpy;
beforeEach(() => {
  mockToast.success = jest.fn();
  mockToast.error = jest.fn();
  mockToast.info = jest.fn();
  ctx = makeCtx();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
  HTMLCanvasElement.prototype.toBlob = jest.fn((cb) => cb(new Blob(["png"])));
  lastBlob = null;
  URL.createObjectURL = jest.fn((b) => {
    lastBlob = b;
    return "blob:fake";
  });
  URL.revokeObjectURL = jest.fn();
  clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => clickSpy.mockRestore());

function readBlob(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blob);
  });
}

// ─── Pure helpers ───────────────────────────────────────────────────────────
describe("helpers", () => {
  test("fmtDate", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("2026-01-01")).toBe("2026-01-01");
  });

  test("fmtPct", () => {
    expect(fmtPct(51.4321)).toBe("51.43%");
    expect(fmtPct(7.155)).toBe("7.16%");
    expect(fmtPct(undefined)).toBe("0%");
  });

  test("completedLabel", () => {
    expect(completedLabel(850, 1375)).toBe(`850 / ${(1375).toLocaleString()} completed (61.82%)`);
    expect(completedLabel(0, 0)).toBe("0 / 0 completed (0.00%)");
    expect(completedLabel(undefined, undefined)).toBe("0 / 0 completed (0.00%)");
  });

  test("niceCeil rounds up to 1/2/5/10 × 10^n", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
    expect(niceCeil(undefined)).toBe(1);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(1.5)).toBe(2);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(73)).toBe(100);
    expect(niceCeil(120)).toBe(200);
    expect(niceCeil(0.03)).toBeCloseTo(0.05);
  });

  test("shade darkens/lightens and clamps", () => {
    expect(shade("#808080", 0)).toBe("#808080");
    expect(shade("#000000", -20)).toBe("#000000");
    expect(shade("#ffffff", 20)).toBe("#ffffff");
    expect(shade("#102030", 10)).toBe("#2a3a4a");
    expect(shade("102030", -10)).toBe("#000717");
  });

  test("polarToCartesian / describeArc", () => {
    const p = polarToCartesian(0, 0, 10, 90);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
    const top = polarToCartesian(5, 5, 10, 0);
    expect(top.x).toBeCloseTo(5);
    expect(top.y).toBeCloseTo(-5);
    expect(describeArc(0, 0, 10, -90, 90)).toMatch(/^M .* A 10 10 0 0 0 /);
    expect(describeArc(0, 0, 10, 0, 270)).toMatch(/A 10 10 0 1 0/);
  });

  test("levelFor thresholds", () => {
    expect(levelFor(100).key).toBe("high");
    expect(levelFor(70).key).toBe("high");
    expect(levelFor(69.9).key).toBe("medium");
    expect(levelFor(40).key).toBe("medium");
    expect(levelFor(39.9).key).toBe("low");
    expect(levelFor(0).key).toBe("low");
  });

  test("withElementCounts derives per-category status counts from elements", () => {
    const cats = [{ category: "Beams" }, { category: "Walls", count: 9 }, { category: "Empty" }];
    const els = [
      { category: "Beams", status: "completed" },
      { category: "Beams", status: "in_progress" },
      { element_type: "Walls", status: "not_started" },
      { status: "completed" }, // "Other"
      { category: "Beams", status: "bogus" },
    ];
    const out = withElementCounts(cats, els);
    expect(out[0]).toMatchObject({ completed: 1, in_progress: 1, not_started: 0, count: 2 });
    expect(out[1]).toMatchObject({ not_started: 1, count: 9 });
    expect(out[2]).toMatchObject({ completed: 0, count: 0 });
  });

  test("withElementCounts prefers counts already on the category", () => {
    const out = withElementCounts([{ category: "A", completed: 5, in_progress: 0, not_started: 1 }], [
      { category: "A", status: "completed" },
    ]);
    expect(out[0]).toMatchObject({ completed: 5, not_started: 1, count: 6 });
  });

  test("withElementCounts tolerates missing inputs", () => {
    expect(withElementCounts(undefined, undefined)).toEqual([]);
    expect(withElementCounts([{ category: "A" }], null)[0].count).toBe(0);
  });

  test("downloadBlob", () => {
    downloadBlob(new Blob(["x"]), "a.csv");
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  test("exportCategoriesToCSV escapes quotes and computes completed %", async () => {
    exportCategoriesToCSV(
      [
        { category: 'Big "B"', count: 4, completed: 1, bim_volume: 1.5, overlap_volume: 0.5, bim_points: 10, overlap_points: 5, completion: 25 },
        { category: "Zero", count: 0, bim_volume: 0, overlap_volume: 0, bim_points: 0, overlap_points: 0, completion: 0 },
      ],
      "count",
    );
    const text = await readBlob(lastBlob);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^Category,Count,Completed Elements/);
    expect(lines[1]).toBe('"Big ""B""",4,1,25.0,1.5,0.5,10,5,25');
    expect(lines[2]).toBe('"Zero",0,0,0,0,0,0,0,0');
    expect(clickSpy).toHaveBeenCalled();
  });

  test("roundRectPath clamps radius", () => {
    const c = makeCtx();
    roundRectPath(c, 0, 0, 4, 100, 10);
    expect(c.arcTo).toHaveBeenCalledWith(0, 0, 2, 0, 2);
  });

  test("exportChartToPNG draws bars, labels and downloads", () => {
    const metric = { key: "count", label: "Count", color: "#000", format: (v) => String(v) };
    const data = Array.from({ length: 10 }, (_, i) => ({
      category: i === 0 ? "A very long category name" : `C${i}`,
      value: i,
      raw: i % 2 ? { completed: 1, count: 2 } : null,
    }));
    exportChartToPNG(data, metric);
    const texts = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(texts).toContain("Count by BIM Element Category");
    expect(texts).toContain("A very long c…");
    expect(texts).toContain("1/2");
    expect(ctx.rotate).toHaveBeenCalled(); // > 8 bars → rotated labels
    expect(clickSpy).toHaveBeenCalled();
  });

  test("exportChartToPNG with no data and null blob", () => {
    HTMLCanvasElement.prototype.toBlob = jest.fn((cb) => cb(null));
    exportChartToPNG([], { key: "x", label: "X", color: "#000", format: String });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

// ─── Page fixtures ──────────────────────────────────────────────────────────
const BIM = [
  { id: 11, date: "2026-01-01", description: "Model v1", is_latest: false },
  { id: 12, date: "2026-02-01", description: "Model v2", is_latest: true },
];
const PC = [
  { id: 21, date: "2026-01-10", is_latest: false },
  { id: 22, date: "2026-02-10", is_latest: true },
];
const pair = (id, bim_id, pc_id, extra = {}) => ({
  id,
  bim_id,
  pointcloud_id: pc_id,
  bim_date: "2026-02-01",
  pointcloud_date: "2026-02-10",
  method: "icp",
  fitness: 0.8,
  ...extra,
});

const el = (id, type, category, status, completion, extra = {}) => ({
  element_id: id,
  name: `${type} ${id}`,
  element_type: type,
  category,
  status,
  completion,
  bim_volume: 1.25,
  bim_points: 100,
  overlap_points: completion,
  ...extra,
});
const RESULT = {
  summary: { total: 4, completed: 2, in_progress: 1, not_started: 1, overall_completion: 50 },
  elements: [
    el("e1", "IfcBeam", "Beams", "completed", 95, { verified: true, plane_inlier: 0.9 }),
    el("e2", "IfcBeam", "Beams", "in_progress", 40, { built_by: "sam", sam_built_ratio: 0.6 }),
    el("e3", "IfcWall", "Walls", "completed", 90),
    el("e4", "IfcWall", "Walls", "not_started", 0),
  ],
  categories: [
    { category: "Beams", count: 2, bim_volume: 2.5, overlap_volume: 1, bim_points: 200, overlap_points: 135, completion: 50 },
    { category: "Walls", count: 2, bim_volume: 2.5, overlap_volume: 1, bim_points: 200, overlap_points: 90, completion: 50 },
  ],
  levels: [
    { level: "L1", total: 2, completed: 1, in_progress: 1, not_started: 0, completion: 50, volume_completion: 60, built_volume: 1, bim_volume: 2, built_by: { sam: 1 } },
  ],
  trades: [
    { trade: "Structure", total: 4, completed: 2, in_progress: 1, not_started: 1, completion: 50, volume_completion: 55, built_volume: 2, bim_volume: 4 },
  ],
  overlap_source: "viewer_snapshot",
  warnings: ["Heads up"],
};
const HISTORY = [
  { overall_completion: 50, created_at: "2026-02-11" },
  { overall_completion: 30, created_at: "2026-01-11" },
];

function mockApi({ bim = BIM, pc = PC, pairs = [], saved = null, history = [], projects, pairsError = false } = {}) {
  API.get.mockImplementation((url) => {
    if (url === "projects/") return Promise.resolve({ data: projects ?? [{ id: 7, project_name: "Tower", slug: "tower" }] });
    if (url === "projects/7/bim/") return Promise.resolve({ data: bim });
    if (url === "projects/7/pointcloud/") return Promise.resolve({ data: pc });
    if (url === "processing/alignment/pairs/7/") return pairsError ? Promise.reject(new Error("x")) : Promise.resolve({ data: pairs });
    if (/^processing\/progress\/pair\/\d+\/latest\/$/.test(url)) {
      return saved ? Promise.resolve({ data: saved }) : Promise.reject({ response: { status: 404 } });
    }
    if (url.startsWith("processing/progress/history/7/")) return Promise.resolve({ data: history });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

let nav;
function NavGrab() {
  nav = useNavigate();
  return null;
}
function renderPage({ path = "/progress/7_Tower", routeParam } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavGrab />
      <Routes>
        <Route path="/progress/:slug" element={<ProgressAssessmentPage routeParam={routeParam} />} />
        <Route path="/viewer/:slug" element={<ProgressAssessmentPage routeParam="7_Tower" />} />
        <Route path="/progress-timeline/:slug" element={<div>TIMELINE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const pairSelect = () => screen.getByDisplayValue(/Select a registered pair|BIM .* ↔ PC/);

describe("ProgressAssessmentPage — loading", () => {
  test("loads project, uploads and pairs; defaults to the unregistered latest combo", async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText("Tower")).toBeInTheDocument();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/7/bim/"));
    expect(API.get).toHaveBeenCalledWith("projects/7/pointcloud/");
    expect(API.get).toHaveBeenCalledWith("processing/alignment/pairs/7/");
    const opt = await screen.findByRole("option", { name: /latest \(not yet registered\)/ });
    expect(opt.selected).toBe(true);
    expect(screen.getByRole("button", { name: /Register Pair/ })).toBeInTheDocument();
    expect(screen.getByText(/0 registered alignment pairs for this project \(2 BIM · 2 point-cloud uploads\)/)).toBeInTheDocument();
    expect(screen.getByText(/it isn't a registered pair yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Timeline/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Pick a registered pair, then click Analyze/)).toBeInTheDocument();
  });

  test("auto-selects the registered pair covering the latest uploads and loads its saved result", async () => {
    mockApi({ pairs: [pair(5, 12, 22)], saved: RESULT, history: HISTORY });
    renderPage();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/pair/5/latest/"));
    expect(API.get).toHaveBeenCalledWith("processing/progress/history/7/?pair_id=5");
    expect(await screen.findByText("Elements (4)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Register Pair/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /not yet registered/ })).not.toBeInTheDocument();
    expect(screen.getByText("Progress Over Time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Assessment/ })).toBeInTheDocument();
  });

  test("pairs endpoint failure is tolerated", async () => {
    mockApi({ pairsError: true });
    renderPage();
    expect(await screen.findByText(/0 registered alignment pairs/)).toBeInTheDocument();
    expect(await screen.findByText(/\(2 BIM · 2 point-cloud uploads\)/)).toBeInTheDocument();
  });

  test("falls back to the leading id when the project isn't listed", async () => {
    mockApi({ projects: [] });
    renderPage();
    expect(await screen.findByText("Project #7")).toBeInTheDocument();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/7/bim/"));
  });

  test("falls back to the leading id when the project list fails", async () => {
    mockApi();
    const impl = API.get.getMockImplementation();
    API.get.mockImplementation((url) => (url === "projects/" ? Promise.reject(new Error("x")) : impl(url)));
    renderPage();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/7/bim/"));
  });

  test("does not load uploads when the project cannot be resolved", async () => {
    mockApi({ projects: [] });
    renderPage({ path: "/progress/unknown-project" });
    expect(await screen.findByText("Project #—")).toBeInTheDocument();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/"));
    expect(API.get).toHaveBeenCalledTimes(1);
  });

  test("routeParam prop overrides the URL", async () => {
    mockApi({ projects: [{ id: 7, project_name: "Prop Project", slug: "prop" }] });
    renderPage({ path: "/progress/whatever", routeParam: "prop" });
    expect(await screen.findByText("Prop Project")).toBeInTheDocument();
  });

  test("Refresh button, window focus and visibility re-fetch uploads", async () => {
    mockApi();
    renderPage();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/7/bim/"));
    const count = () => API.get.mock.calls.filter((c) => c[0] === "projects/7/bim/").length;
    const n0 = count();
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(count()).toBe(n0 + 1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(count()).toBe(n0 + 2);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(count()).toBe(n0 + 3);
    await screen.findByText(/2 BIM/);
  });

  test("re-fetches when coming back to the Progress tab, not while hidden", async () => {
    mockApi();
    renderPage();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/7/bim/"));
    const count = () => API.get.mock.calls.filter((c) => c[0] === "projects/7/bim/").length;
    const n0 = count();
    act(() => nav("/viewer/7_Tower"));
    await screen.findAllByText(/registered alignment pair/);
    const n1 = count();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(count()).toBe(n1); // inactive tab: focus ignored
    act(() => nav("/progress/7_Tower"));
    await waitFor(() => expect(count()).toBeGreaterThan(n0));
  });
});

describe("ProgressAssessmentPage — actions", () => {
  test("Analyze posts the selected BIM/PC and shows results", async () => {
    mockApi();
    API.post.mockResolvedValue({ data: RESULT });
    renderPage();
    await screen.findByRole("button", { name: /Register Pair/ });
    await userEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    expect(API.post).toHaveBeenCalledWith("processing/progress/analyze/", { bim_id: "12", pointcloud_id: "22" });
    expect(await screen.findByText("Elements (4)")).toBeInTheDocument();
    expect(mockToast.info).toHaveBeenCalledWith("Heads up");
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/^Analyzed 4 elements in \d+s\.$/));
    expect(screen.getByText(/come from the viewer's live/)).toBeInTheDocument();
    expect(screen.getByText("50% overall")).toBeInTheDocument();
    // verified / SAM badges
    expect(screen.getByText("✓ verified")).toHaveAttribute("title", "Planar surface confirmed in scan (90% planar)");
    expect(screen.getByText("⚡ auto · SAM").getAttribute("title")).toMatch(/60% of labelled points/);
  });

  test("Analyze shows progress while running", async () => {
    mockApi();
    let resolve;
    API.post.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    await screen.findByRole("button", { name: /Register Pair/ });
    await userEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    expect(screen.getByRole("button", { name: /Analyzing… 0s/ })).toBeDisabled();
    expect(screen.getByText("Analyzing scan coverage…")).toBeInTheDocument();
    await act(async () => resolve({ data: { ...RESULT, elements: [], warnings: undefined } }));
    expect(mockToast.info).toHaveBeenCalledWith("No assessable BIM elements found in this IFC.");
    expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();
  });

  test("Analyze without a BIM/PC selection asks the user to pick one", async () => {
    mockApi({ bim: [], pc: [] });
    renderPage();
    await screen.findByText(/0 BIM · 0 point-cloud uploads/);
    await userEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    expect(mockToast.info).toHaveBeenCalledWith("Select a BIM file and a Point Cloud file first.");
    expect(API.post).not.toHaveBeenCalled();
    expect(screen.getByText(/Align a BIM \+ point cloud, then click "Save Alignment Pair"/)).toBeInTheDocument();
  });

  test("Analyze failure shows the server error", async () => {
    mockApi();
    API.post.mockRejectedValue({ response: { data: { error: "IFC broken" } } });
    renderPage();
    await screen.findByRole("button", { name: /Register Pair/ });
    await userEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("IFC broken"));
  });

  test("Analyze failure without a message uses a fallback", async () => {
    mockApi();
    API.post.mockRejectedValue(new Error("net"));
    renderPage();
    await screen.findByRole("button", { name: /Register Pair/ });
    await userEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Analysis failed."));
  });

  test("Save Assessment for an unregistered combo sends pair_id null and re-selects the new pair", async () => {
    mockApi();
    API.post.mockImplementation((url) =>
      url === "processing/progress/analyze/" ? Promise.resolve({ data: RESULT }) : Promise.resolve({ data: { pair_id: 9 } }),
    );
    renderPage();
    await screen.findByRole("button", { name: /Register Pair/ });
    await userEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    await screen.findByText("Elements (4)");
    // after save, the pairs endpoint returns the newly registered pair
    const impl = API.get.getMockImplementation();
    API.get.mockImplementation((url) =>
      url === "processing/alignment/pairs/7/" ? Promise.resolve({ data: [pair(9, 12, 22)] }) : impl(url),
    );
    await userEvent.click(screen.getByRole("button", { name: /Save Assessment/ }));
    expect(API.post).toHaveBeenCalledWith("processing/progress/save/", {
      project_id: 7,
      bim_id: "12",
      pointcloud_id: "22",
      pair_id: null,
      summary: RESULT.summary,
      elements: RESULT.elements,
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Assessment saved."));
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/history/7/?pair_id=9"));
    expect(await screen.findByText(/1 registered alignment pair for this project/)).toBeInTheDocument();
  });

  test("Save Assessment for a registered pair sends its id; failure shows error", async () => {
    mockApi({ pairs: [pair(5, 12, 22)], saved: RESULT });
    API.post.mockRejectedValue({ response: { data: { error: "nope" } } });
    renderPage();
    await screen.findByText("Elements (4)");
    await userEvent.click(screen.getByRole("button", { name: /Save Assessment/ }));
    expect(API.post).toHaveBeenCalledWith("processing/progress/save/", expect.objectContaining({ pair_id: "5", bim_id: "12", pointcloud_id: "22" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("nope"));
    expect(screen.getByRole("button", { name: /Save Assessment/ })).toBeEnabled();
  });

  test("Save failure without a message uses a fallback", async () => {
    mockApi({ pairs: [pair(5, 12, 22)], saved: RESULT });
    API.post.mockRejectedValue(new Error("x"));
    renderPage();
    await screen.findByText("Elements (4)");
    await userEvent.click(screen.getByRole("button", { name: /Save Assessment/ }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Save failed."));
  });

  test("Register Pair posts the latest combo and selects the new pair", async () => {
    mockApi();
    API.post.mockResolvedValue({ data: { pair_id: 9 } });
    renderPage();
    const btn = await screen.findByRole("button", { name: /Register Pair/ });
    const impl = API.get.getMockImplementation();
    API.get.mockImplementation((url) =>
      url === "processing/alignment/pairs/7/" ? Promise.resolve({ data: [pair(9, 12, 22)] }) : impl(url),
    );
    await userEvent.click(btn);
    expect(API.post).toHaveBeenCalledWith("processing/alignment/pair/", {
      project_id: 7,
      bim_id: "12",
      pointcloud_id: "22",
      method: "manual",
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Pair registered."));
    // NOTE: the saved result for pair 9 is NOT loaded afterwards — see the
    // "Register Pair blanks the selection" defect in the report.
    expect(await screen.findByText(/Registered Alignment Pairs \(1\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Register Pair/ })).not.toBeInTheDocument();
  });

  test("Register Pair failure shows the error", async () => {
    mockApi();
    API.post.mockRejectedValue({ response: { data: { error: "dup" } } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Register Pair/ }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("dup"));
    expect(screen.getByRole("button", { name: /Register Pair/ })).toBeEnabled();
  });

  test("Register Pair failure fallback message", async () => {
    mockApi();
    API.post.mockRejectedValue(new Error("x"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Register Pair/ }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to register pair."));
  });
});

describe("ProgressAssessmentPage — pairs table", () => {
  const many = [
    pair(1, 11, 21, { pointcloud_date: "2026-01-10", fitness: null, method: "manual" }),
    pair(2, 12, 21, { pointcloud_date: "2026-01-10", has_overlap_snapshot: true, overlap_element_count: 12, overlap_snapshot_at: "2026-01-11T10:00:00Z" }),
    pair(3, 11, 22, { has_overlap_snapshot: true }),
    pair(4, 12, 22),
    pair(5, 11, 22),
    pair(6, 11, 22),
    pair(7, 11, 22),
  ];

  test("filters by scan date, paginates and selects a row", async () => {
    mockApi({ pairs: many });
    renderPage();
    expect(await screen.findByText("Registered Alignment Pairs (7)")).toBeInTheDocument();
    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();
    const prev = screen.getByRole("button", { name: "Prev" });
    expect(prev).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByDisplayValue("All scan dates"), "2026-01-10");
    expect(screen.getByText("Registered Alignment Pairs (2)")).toBeInTheDocument();
    expect(screen.queryByText(/Page \d/)).not.toBeInTheDocument();
    expect(screen.getByText("✓ 12 elements")).toHaveAttribute("title", expect.stringMatching(/^Sent from viewer at /));

    // the manual pair shows its method in the dropdown (no fitness)
    expect(screen.getByRole("option", { name: /· manual$/ })).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: /80% fit/ }).length).toBeGreaterThan(0);

    const row = screen.getByRole("cell", { name: "1" }).closest("tr");
    await userEvent.click(row);
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/pair/1/latest/"));
  });

  test("Timeline button navigates to the timeline page", async () => {
    mockApi({ pairs: [pair(5, 12, 22)] });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Timeline/ }));
    expect(await screen.findByText("TIMELINE PAGE")).toBeInTheDocument();
  });

  test("choosing the blank option clears the selection", async () => {
    mockApi({ pairs: [pair(5, 12, 22)], saved: RESULT });
    renderPage();
    await screen.findByText("Elements (4)");
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "");
    expect(screen.queryByText(/Elements \(/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(mockToast.info).toHaveBeenCalledWith("Select a BIM file and a Point Cloud file first.");
  });
});

describe("ProgressAssessmentPage — result views", () => {
  async function loaded(saved = RESULT, history = HISTORY) {
    mockApi({ pairs: [pair(5, 12, 22)], saved, history });
    renderPage();
    await screen.findByText(`Elements (${saved.elements.length})`);
  }
  const elementRows = () => {
    const header = screen.getByRole("columnheader", { name: "Element ID" });
    return within(header.closest("table")).getAllByRole("row").slice(1);
  };

  test("summary cards filter the element table and toggle back", async () => {
    await loaded();
    await userEvent.click(screen.getAllByText("Completed")[0]);
    expect(screen.getByText("Elements (2 · Completed)")).toBeInTheDocument();
    expect(elementRows()).toHaveLength(2);
    await userEvent.click(screen.getAllByText("Completed")[0]);
    expect(screen.getByText("Elements (4)")).toBeInTheDocument();

    await userEvent.click(screen.getAllByText("Not Started")[0]);
    expect(screen.getByText("Elements (1 · Not Started)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not Started ✕" }));
    expect(screen.getByText("Elements (4)")).toBeInTheDocument();

    await userEvent.click(screen.getAllByText("In Progress")[0]);
    expect(screen.getByText("Elements (1 · In Progress)")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Total Elements"));
    expect(screen.getByText("Elements (4)")).toBeInTheDocument();
  });

  test("type filter narrows the element table", async () => {
    await loaded();
    await userEvent.selectOptions(screen.getByDisplayValue("All types"), "IfcWall");
    expect(elementRows()).toHaveLength(2);
    expect(elementRows().every((r) => r.textContent.includes("IfcWall"))).toBe(true);
  });

  test("'View incomplete elements' filters to non-completed and scrolls", async () => {
    jest.useFakeTimers();
    try {
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: /View incomplete elements/ }));
      expect(screen.getByText("Elements (2 · Incomplete)")).toBeInTheDocument();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      act(() => jest.advanceTimersByTime(2000));
    } finally {
      jest.useRealTimers();
    }
  });

  test("completion breakdown buckets jump to filtered elements", async () => {
    await loaded();
    const partial = screen.getByRole("button", { name: /Partial/ });
    fireEvent.mouseEnter(partial);
    fireEvent.mouseLeave(partial);
    await userEvent.click(partial);
    expect(screen.getByText("Elements (1 · In Progress)")).toBeInTheDocument();
  });

  test("category table shows completed labels", async () => {
    await loaded();
    const table = screen.getByRole("columnheader", { name: "Completed Elements" }).closest("table");
    expect(within(table).getByText("Beams").closest("tr")).toHaveTextContent("1 / 2 completed (50.00%)");
  });

  test("floor / trade progress toggles grouping and weighting", async () => {
    await loaded();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("L1").parentElement).toHaveAttribute("title", expect.stringMatching(/Auto-detected: 1 by SAM photo labels/));
    await userEvent.click(screen.getByRole("button", { name: "By volume" }));
    expect(screen.getByText("60%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Trade" }));
    expect(screen.getByText("Structure")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "By count" }));
    await userEvent.click(screen.getByRole("button", { name: "Floor" }));
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  test("floor / trade with only trades defaults to Trade; empty group message", async () => {
    await loaded({ ...RESULT, levels: [], trades: RESULT.trades });
    expect(screen.getByText("Structure")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Floor" }));
    expect(screen.getByText("No buildable elements to group.")).toBeInTheDocument();
  });

  test("KPI row shows totals and trend vs last assessment", async () => {
    await loaded();
    expect(screen.getByText("+20.0% vs last assessment")).toBeInTheDocument();
    expect(screen.getByText("Across 2 categories")).toBeInTheDocument();
    expect(screen.getByText("56.3%")).toBeInTheDocument(); // 225 / 400 coverage accuracy
  });

  test("KPI row with a single assessment", async () => {
    await loaded(RESULT, [{ overall_completion: 50 }]);
    expect(screen.getByText("First recorded assessment")).toBeInTheDocument();
  });

  test("Charts button scrolls to the dashboard", async () => {
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: /^Charts$/ }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test("category explorer: metric tabs, search, sort, zoom, focus, reset", async () => {
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Overlap Points" }));
    expect(screen.getByText(/Overlap Points by BIM element category/)).toBeInTheDocument();

    const search = screen.getByPlaceholderText("Search categories…");
    await userEvent.type(search, "zzz");
    expect(screen.getByText('No categories match "zzz".')).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "wal");
    expect(screen.getByText(/Showing 1 of 2 categories matching "wal"/)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Reset view"));
    expect(search).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: /High → Low/ }));
    await userEvent.click(screen.getByRole("button", { name: /Low → High/ }));
    await userEvent.click(screen.getByRole("button", { name: /Default/ }));

    const zoomIn = screen.getByTitle("Zoom in");
    for (let i = 0; i < 7; i++) await userEvent.click(zoomIn);
    expect(zoomIn).toBeDisabled();
    const zoomOut = screen.getByTitle("Zoom out");
    for (let i = 0; i < 10; i++) await userEvent.click(zoomOut);
    expect(zoomOut).toBeDisabled();
    expect(screen.getByText(/drag to pan/)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Reset view"));

    // Focus a bar by clicking its label area (title = category)
    const beamsBars = screen.getAllByTitle("Beams");
    fireEvent.mouseEnter(beamsBars[0]);
    fireEvent.click(beamsBars[0]);
  });

  test("category explorer exports CSV and PNG", async () => {
    await loaded();
    await userEvent.click(screen.getByTitle("Export the current view as CSV"));
    const text = await readBlob(lastBlob);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toMatch(/"Beams",2,1,50.0/);
    await userEvent.click(screen.getByTitle("Export the chart as a PNG image"));
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
  });

  test("full screen toggles and locks body scroll", async () => {
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: /Full Screen/ }));
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.click(screen.getByRole("button", { name: /Exit Full Screen/ }));
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  test("element coverage ranking: search, sort and show more", async () => {
    const elements = Array.from({ length: 25 }, (_, i) =>
      el(`x${i}`, i % 2 ? "IfcBeam" : "IfcSlab", "Beams", "completed", i * 4),
    );
    await loaded({ ...RESULT, elements, summary: { ...RESULT.summary, total: 25 } });
    const more = screen.getByRole("button", { name: /Show 20 more \(5 remaining\)/ });
    await userEvent.click(more);
    expect(screen.queryByRole("button", { name: /Show 20 more/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Search elements…"), "ifcslab");
    await userEvent.click(screen.getByRole("button", { name: /Least covered/ }));
    await userEvent.click(screen.getByRole("button", { name: /Best covered/ }));
    const first = screen.getAllByTitle(/^IfcSlab x/)[0];
    expect(first).toHaveAttribute("title", "IfcSlab x24");
    fireEvent.mouseEnter(first.parentElement);
  });

  test("result without categories hides the charts", async () => {
    await loaded({ ...RESULT, categories: [], levels: [], trades: [] });
    expect(screen.queryByText("Category Analytics Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Charts$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Built Progress by Floor / Trade")).not.toBeInTheDocument();
  });

  test("saved result with no elements is ignored", async () => {
    await act(async () => {
      mockApi({ pairs: [pair(5, 12, 22)], saved: { elements: [] } });
      renderPage();
    });
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("processing/progress/pair/5/latest/"));
    expect(screen.getByText(/Pick a registered pair, then click Analyze/)).toBeInTheDocument();
  });
});
