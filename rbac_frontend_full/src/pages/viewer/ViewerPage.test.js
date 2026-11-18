import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import API from "../../api/axios";
import ViewerPage from "./ViewerPage";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: "http://127.0.0.1:8000/api/v1/" },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};
jest.mock("../../components/ToastContainer", () => ({
  useToast: () => mockToast,
}));

// The three.js engine is owned/tested elsewhere; capture the props it gets.
const mockThree = { props: null };
jest.mock("./components/viewer/ThreeViewer", () => ({
  __esModule: true,
  default: (props) => {
    mockThree.props = props;
    return require("react").createElement("div", { "data-testid": "three" });
  },
}));
jest.mock("./components/viewer/elementVisibility", () => ({
  applyHiddenElements: jest.fn(),
}));

const PROJECT = {
  id: 7,
  project_name: "Tower",
  latitude: 12.9,
  longitude: 77.5,
  altitude: 3,
  scale: 1,
  zoom: 17,
  footprint_area: 100,
};

const MATRIX = [
  [1, 0, 0, 1],
  [0, 1, 0, 2],
  [0, 0, 1, 3],
  [0, 0, 0, 1],
];

function baseData() {
  return {
    "projects/": [PROJECT],
    "projects/7/bim/": [
      { id: 1, file: "/media/old.ifc", date: "2026-03-01T12:00:00" },
      {
        id: 2,
        file: "/media/latest.ifc",
        is_latest: true,
        date: "2026-03-10T12:00:00",
        transform: { position: [1, 2, 3] },
      },
    ],
    "projects/7/pointcloud/": [
      { id: 5, file: "http://cdn.test/cloud.ply?x=1", date: "2026-03-10T12:00:00" },
    ],
    "projects/7/images/": [
      { id: 1, batch_name: "a", uploaded_at: "2026-01-01T00:00:00" },
      { id: 2, batch_name: "b", uploaded_at: "2026-02-01T00:00:00" },
    ],
    "projects/7/camera/": [
      { id: 3, file: "/media/cams/images%20v2.txt", date: "2026-03-10T12:00:00" },
    ],
    "projects/7/matrix/": [
      { id: 4, file: "/media/m.json", date: "2026-03-10T12:00:00" },
    ],
    "issues/project/7/": [],
    "issues/project/7/assignees/": [{ id: 11, name: "Asha" }],
  };
}

let data;
function mockGets(overrides = {}) {
  data = { ...baseData(), ...overrides };
  API.get.mockImplementation((url) => {
    const v = data[url];
    if (v instanceof Error) return Promise.reject(v);
    if (v === undefined) return Promise.reject(new Error(`unmocked ${url}`));
    return Promise.resolve({ data: v });
  });
}

function renderPage({ role = "admin", path = "/viewer/7_Tower", props = {} } = {}) {
  localStorage.setItem("role", role);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ViewerPage projectSlug="7_Tower" {...props} />
    </MemoryRouter>,
  );
}

const three = () => mockThree.props;
const waitLoaded = () =>
  waitFor(() => expect(three().bimFile).toBeTruthy());

beforeEach(() => {
  mockThree.props = null;
  mockGets();
  global.fetch = jest.fn().mockResolvedValue({ json: async () => MATRIX });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
});

describe("asset loading", () => {
  test("fetches the project and its five asset lists and feeds ThreeViewer", async () => {
    renderPage();
    await waitLoaded();

    const urls = API.get.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(
      expect.arrayContaining([
        "projects/",
        "projects/7/bim/",
        "projects/7/pointcloud/",
        "projects/7/images/",
        "projects/7/camera/",
        "projects/7/matrix/",
        "issues/project/7/",
        "issues/project/7/assignees/",
      ]),
    );

    // Latest-flagged BIM wins; relative URLs resolve against the server root,
    // not ".../api/v1/" (regression guard for resolveRemoteUrl).
    expect(three().bimFile).toEqual({
      url: "http://127.0.0.1:8000/media/latest.ifc",
      name: "latest.ifc",
      transform: { position: [1, 2, 3] },
      id: 2,
    });
    expect(three().pointFile).toMatchObject({
      url: "http://cdn.test/cloud.ply?x=1",
      name: "cloud.ply",
      id: 5,
    });
    expect(three().projectId).toBe(7);
    expect(three().selectedDate).toBe("2026-03-10");
    expect(three().initialLatitude).toBe(12.9);
    expect(three().initialFootprintArea).toBe(100);
    // newest image batch only
    expect(three().cameraImages.map((i) => i.id)).toEqual([2]);
    await waitFor(() =>
      expect(three().cameraPositionsFile).toMatchObject({
        url: "http://127.0.0.1:8000/media/cams/images%20v2.txt",
      }),
    );
    await waitFor(() => expect(three().uploadedAlignmentMatrix).toEqual(MATRIX));
    expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/media/m.json");
    expect(screen.getByTitle("Pick a date")).toHaveTextContent("2026-03-10");
  });

  test("a matrix file that is not 4x4 is ignored", async () => {
    global.fetch.mockResolvedValue({ json: async () => [[1, 2, 3]] });
    renderPage();
    await waitLoaded();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(three().uploadedAlignmentMatrix).toBeNull();
  });

  test("falls back to the first item by extension when nothing is flagged latest", async () => {
    mockGets({
      "projects/7/bim/": [
        { id: 8, file: "/media/notes.pdf", date: "2026-03-10T12:00:00" },
        { id: 9, file: "/media/model.FBX", date: "2026-03-10T12:00:00" },
      ],
      "projects/7/pointcloud/": [],
      "projects/7/camera/": [],
      "projects/7/matrix/": [],
    });
    renderPage();
    await waitLoaded();
    expect(three().bimFile.id).toBe(9);
    expect(three().pointFile).toBeNull();
    expect(three().cameraPositionsFile).toBeNull();
    expect(three().uploadedAlignmentMatrix).toBeNull();
  });

  test("one failing list does not blank the viewer and the user is told", async () => {
    mockGets({ "projects/7/images/": new Error("500") });
    renderPage();
    await waitLoaded();
    expect(three().pointFile).toBeTruthy();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Could not load images for this project.",
    );
  });

  test("a failing projects request shows an error", async () => {
    mockGets({ "projects/": new Error("offline") });
    renderPage();
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        "Failed to load project data. Please try again.",
      ),
    );
    expect(three().bimFile).toBeNull();
  });

  test("does not load while the viewer route is not active", async () => {
    renderPage({ path: "/analytics/7_Tower" });
    // only useIssues fetches
    await waitFor(() => expect(API.get).toHaveBeenCalled());
    expect(API.get.mock.calls.map((c) => c[0])).not.toContain("projects/");
  });

  test("reports the loaded date up via onDateChange", async () => {
    const onDateChange = jest.fn();
    renderPage({ props: { onDateChange } });
    await waitFor(() =>
      expect(onDateChange).toHaveBeenLastCalledWith("7_Tower", "2026-03-10"),
    );
  });
});

describe("role gating", () => {
  const ROLES = [
    "superadmin",
    "admin",
    "project_manager",
    "project_engineer",
    "data_contributor",
    "site_engineer",
    "viewer",
  ];

  test.each(ROLES)("save callbacks and alignment tools for %s", async (role) => {
    renderPage({ role });
    await waitLoaded();
    const contributor = role === "data_contributor";
    expect(typeof three().onSavePosition).toBe(contributor ? "function" : "undefined");
    expect(typeof three().onSaveGeo).toBe(contributor ? "function" : "undefined");

    for (const label of ["Picking", "Alignment"]) {
      if (role === "viewer") expect(screen.queryByTitle(label)).not.toBeInTheDocument();
      else expect(screen.getByTitle(label)).toBeInTheDocument();
    }
  });

  test("defaults to the viewer role when none is stored", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/7_Tower"]}>
        <ViewerPage projectSlug="7_Tower" />
      </MemoryRouter>,
    );
    await waitLoaded();
    expect(three().onSavePosition).toBeUndefined();
    expect(screen.queryByTitle("Picking")).not.toBeInTheDocument();
  });
});

function fakeModel(pos) {
  return {
    updateMatrixWorld: jest.fn(),
    position: { toArray: () => pos },
    quaternion: { toArray: () => [0, 0, 0, 1] },
    scale: { toArray: () => [1, 1, 1] },
  };
}

describe("save position (data_contributor)", () => {
  test("PUTs both model transforms and names them in the toast", async () => {
    API.put.mockResolvedValue({ data: {} });
    renderPage({ role: "data_contributor" });
    await waitLoaded();
    act(() =>
      three().onModelsChanged({
        bimModel: fakeModel([1, 2, 3]),
        pcModel: fakeModel([4, 5, 6]),
      }),
    );
    await act(() => three().onSavePosition());

    expect(API.put).toHaveBeenCalledWith("bim/2/update/", {
      transform: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(API.put).toHaveBeenCalledWith("pointcloud/5/update/", {
      transform: { position: [4, 5, 6], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Saved position & orientation for BIM and Point Cloud.",
    );
    expect(three().saveStatus).toBe("saved");
  });

  test("asks to load a model first when none is loaded", async () => {
    renderPage({ role: "data_contributor" });
    await waitLoaded();
    await act(() => three().onSavePosition());
    expect(mockToast.info).toHaveBeenCalledWith(
      "Load the latest BIM or PointCloud model before saving.",
    );
    expect(API.put).not.toHaveBeenCalled();
  });

  test("reports when there are no uploads", async () => {
    mockGets({ "projects/7/bim/": [], "projects/7/pointcloud/": [] });
    renderPage({ role: "data_contributor" });
    await waitFor(() => expect(three().selectedDate).toBe("2026-03-10"));
    await act(() => three().onSavePosition());
    expect(mockToast.info).toHaveBeenCalledWith("No uploaded models available to save.");
  });

  test("shows an error when the save fails", async () => {
    API.put.mockRejectedValue(new Error("boom"));
    renderPage({ role: "data_contributor" });
    await waitLoaded();
    act(() => three().onModelsChanged({ bimModel: fakeModel([0, 0, 0]), pcModel: null }));
    await act(() => three().onSavePosition());
    expect(API.put).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Failed to save model position. Please try again.",
    );
    expect(three().saveStatus).toBe("error");
  });
});

describe("save geo location (data_contributor)", () => {
  const geo = {
    latitude: 1,
    longitude: 2,
    altitude: 3,
    scale: 4,
    zoom: 5,
    footprint_area: 6,
  };

  test("PUTs the location to the project and re-seeds the map", async () => {
    API.put.mockResolvedValue({ data: {} });
    renderPage({ role: "data_contributor" });
    await waitLoaded();
    await act(() => three().onSaveGeo(geo));
    expect(API.put).toHaveBeenCalledWith("projects/7/", geo);
    expect(mockToast.success).toHaveBeenCalledWith("Project location saved.");
    expect(three().initialLatitude).toBe(1);
    expect(three().initialZoom).toBe(5);
  });

  test("shows an error on failure", async () => {
    API.put.mockRejectedValue(new Error("no"));
    renderPage({ role: "data_contributor" });
    await waitLoaded();
    await act(() => three().onSaveGeo(geo));
    expect(mockToast.error).toHaveBeenCalledWith("Failed to save project location.");
  });
});

describe("sidebar-exposed actions", () => {
  test("window.saveAlignmentPair posts the current pair", async () => {
    API.post.mockResolvedValue({
      data: { bim_date: "2026-03-10", pointcloud_date: "2026-03-09", created: true },
    });
    renderPage();
    await waitLoaded();
    await act(() => window.saveAlignmentPair());
    expect(API.post).toHaveBeenCalledWith("processing/alignment/pair/", {
      project_id: 7,
      bim_id: 2,
      pointcloud_id: 5,
      method: "manual",
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Created alignment pair — BIM 2026-03-10 ↔ Point Cloud 2026-03-09.",
    );
  });

  test("window.saveAlignmentPair surfaces the backend error", async () => {
    API.post.mockRejectedValue({ response: { data: { error: "Nope" } } });
    renderPage();
    await waitLoaded();
    await act(() => window.saveAlignmentPair());
    expect(mockToast.error).toHaveBeenCalledWith("Nope");
  });

  test("window.saveAlignmentPair needs both models", async () => {
    mockGets({ "projects/7/pointcloud/": [] });
    renderPage();
    await waitLoaded();
    await act(() => window.saveAlignmentPair());
    expect(API.post).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith(
      "Load both a BIM and a Point Cloud to save an alignment pair.",
    );
  });

  test("window.sendOverlapSnapshot sends per-express-id counts", async () => {
    API.post.mockResolvedValue({ data: {} });
    renderPage();
    await waitLoaded();
    act(() => {
      three().setBimElementCount(40);
      three().setOverlapElementCount(2);
      three().setOverlapElementNames([
        { name: "IFCWALL #101", count: 12 },
        { name: "Mesh 3", count: 4 },
        "IFCSLAB #7",
      ]);
    });
    await act(() => window.sendOverlapSnapshot());
    expect(API.post).toHaveBeenCalledWith("processing/progress/overlap-snapshot/", {
      project_id: 7,
      bim_id: 2,
      pointcloud_id: 5,
      bim_element_count: 40,
      overlap_element_count: 2,
      overlap_points_by_express_id: { 101: 12 },
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Sent overlap data for 1 elements to Progress Assessment.",
    );
  });

  test("window.sendOverlapSnapshot explains missing data", async () => {
    renderPage();
    await waitLoaded();
    await act(() => window.sendOverlapSnapshot());
    expect(mockToast.info).toHaveBeenLastCalledWith(
      expect.stringContaining('Turn on "Overlapping PointCloud Points"'),
    );
    act(() => three().setOverlapElementNames([{ name: "Mesh 3", count: 1 }]));
    await act(() => window.sendOverlapSnapshot());
    expect(mockToast.info).toHaveBeenLastCalledWith(
      expect.stringContaining("No IFC element IDs"),
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("window.sendOverlapSnapshot surfaces errors", async () => {
    API.post.mockRejectedValue(new Error("x"));
    renderPage();
    await waitLoaded();
    act(() => three().setOverlapElementNames([{ name: "IFCBEAM #5", count: 1 }]));
    await act(() => window.sendOverlapSnapshot());
    expect(mockToast.error).toHaveBeenCalledWith("Could not send overlap data.");
  });

  test("globals are removed on unmount", async () => {
    const { unmount } = renderPage();
    await waitLoaded();
    unmount();
    expect(window.saveAlignmentPair).toBeUndefined();
    expect(window.sendOverlapSnapshot).toBeUndefined();
  });
});

describe("segmentation state from ThreeViewer", () => {
  test("RANSAC and SAM reports do not clobber each other", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Models"));

    const toggleSeg = jest.fn();
    const toggleSam = jest.fn();
    act(() =>
      three().onModelDataChange({
        toggleSegmentation: toggleSeg,
        isSegmented: true,
        isSegmenting: false,
        wasCompressed: true,
      }),
    );
    act(() =>
      three().onModelDataChange({
        toggleSemanticSegmentation: toggleSam,
        isSemanticActive: true,
        isSamRunning: false,
        samProgress: null,
        semanticSummary: null,
        runBuiltDetection: null,
        isBuiltDetecting: false,
        builtDetectProgress: null,
      }),
    );

    expect(screen.getByRole("button", { name: "Hide Segments" })).toBeInTheDocument();
    expect(screen.getByText(/Compressed/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Construction Segments" }),
    ).toBeInTheDocument();

    // A later RANSAC report keeps SAM state too.
    act(() =>
      three().onModelDataChange({
        toggleSegmentation: toggleSeg,
        isSegmented: false,
        isSegmenting: false,
        wasCompressed: false,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Show Segments (RANSAC)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Construction Segments" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Segments (RANSAC)" }));
    expect(toggleSeg).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Hide Construction Segments" }));
    expect(toggleSam).toHaveBeenCalled();
  });

  test("Auto-detect Built posts a SAM snapshot", async () => {
    const user = userEvent.setup();
    API.post.mockResolvedValue({ data: {} });
    const run = jest.fn().mockResolvedValue({
      elements: { 101: { built: 1 }, 102: { built: 0 } },
      bimElementCount: 50,
      photosUsed: 3,
      labeledPoints: 1234,
    });
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Models"));
    act(() =>
      three().onModelDataChange({
        toggleSemanticSegmentation: null,
        runBuiltDetection: run,
        isBuiltDetecting: false,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Auto-detect Built Elements (SAM)" }));
    await waitFor(() =>
      expect(API.post).toHaveBeenCalledWith("processing/progress/sam-snapshot/", {
        project_id: 7,
        bim_id: 2,
        pointcloud_id: 5,
        bim_element_count: 50,
        cameras_used: 3,
        elements: { 101: { built: 1 }, 102: { built: 0 } },
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining("across 2 elements"));
  });

  test("Auto-detect Built with no overlap does not post", async () => {
    const user = userEvent.setup();
    const run = jest.fn().mockResolvedValue({ elements: {} });
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Models"));
    act(() => three().onModelDataChange({ runBuiltDetection: run }));
    await user.click(screen.getByRole("button", { name: "Auto-detect Built Elements (SAM)" }));
    await waitFor(() =>
      expect(mockToast.info).toHaveBeenCalledWith(
        "No point-cloud points overlap the BIM — align the models first.",
      ),
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("Auto-detect Built surfaces failures", async () => {
    const user = userEvent.setup();
    const run = jest.fn().mockRejectedValue(new Error("service down"));
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Models"));
    act(() => three().onModelDataChange({ runBuiltDetection: run }));
    await user.click(screen.getByRole("button", { name: "Auto-detect Built Elements (SAM)" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("service down"));
  });
});

describe("per-element overlap count", () => {
  test("ThreeViewer's overlap counts reach the selected element panel", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    expect(typeof three().setOverlapCounts).toBe("function");
    await user.click(screen.getByTitle("Models"));
    act(() => {
      three().setOverlapCounts({
        byUuid: new Map([["u-1", 7]]),
        byExpressID: new Map([[101, 42]]),
      });
      three().onElementSelect({ expressID: 101, name: "Wall A" });
    });
    const label = screen.getByText("Overlapping PointCloud Points:");
    expect(label.parentElement.nextElementSibling).toHaveTextContent("42");

    act(() => three().onElementSelect({ uuid: "u-1", name: "Mesh" }));
    expect(
      screen.getByText("Overlapping PointCloud Points:").parentElement.nextElementSibling,
    ).toHaveTextContent("7");
  });
});

describe("element visibility", () => {
  test("hidden names are applied to the BIM model and reset on a new model", async () => {
    const { applyHiddenElements } = require("./components/viewer/elementVisibility");
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    const model = fakeModel([0, 0, 0]);
    act(() => three().onModelsChanged({ bimModel: model, pcModel: null }));
    act(() => three().setBimCategories({ Walls: ["Wall #1"] }));
    await user.click(screen.getByTitle("Models"));
    await user.click(screen.getByRole("button", { name: /Walls/ }));
    await user.click(screen.getByTitle("Hide element"));
    let last = applyHiddenElements.mock.calls.at(-1);
    expect(last[0]).toBe(model);
    expect([...last[1]]).toEqual(["Wall #1"]);
    await user.click(screen.getByTitle("Show element"));
    last = applyHiddenElements.mock.calls.at(-1);
    expect([...last[1]]).toEqual([]);
  });
});

describe("date calendar", () => {
  test("picking a date loads only that day's uploads", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Pick a date"));
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    // a day without uploads is disabled
    expect(screen.getByRole("button", { name: /^2$/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^1$/ }));
    await waitFor(() => expect(three().bimFile.id).toBe(1));
    expect(three().pointFile).toBeNull();
    expect(three().cameraPositionsFile).toBeNull();
    expect(three().selectedDate).toBe("2026-03-01");
    expect(screen.queryByText("March 2026")).not.toBeInTheDocument();
  });

  test("month navigation crosses year boundaries", async () => {
    const user = userEvent.setup();
    mockGets({
      "projects/7/bim/": [{ id: 1, file: "/a.ifc", date: "2026-01-15T12:00:00" }],
      "projects/7/pointcloud/": [],
      "projects/7/camera/": [],
      "projects/7/matrix/": [],
    });
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Pick a date"));
    expect(screen.getByText("January 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("December 2025")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("February 2026")).toBeInTheDocument();
  });

  test("Escape closes the calendar", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Pick a date"));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("March 2026")).not.toBeInTheDocument();
  });
});

describe("issues", () => {
  test("picking a spot opens the new-issue form and saves it", async () => {
    const user = userEvent.setup();
    API.post.mockResolvedValue({ data: { id: 9, number: 3, title: "Leak", status: "open" } });
    renderPage();
    await waitLoaded();
    act(() =>
      three().onIssuePick({
        position: [1, 2, 3],
        viewpoint: null,
        element: { expressID: 55, type: "IFCWALL", globalId: "G" },
        snapshot: null,
      }),
    );
    const dialog = screen.getByText("New issue").closest("form");
    await user.type(within(dialog).getByLabelText("Title"), "Leak");
    await user.click(within(dialog).getByRole("button", { name: "Create issue" }));

    await waitFor(() =>
      expect(API.post).toHaveBeenCalledWith("issues/project/7/", expect.any(FormData)),
    );
    const form = API.post.mock.calls[0][1];
    expect(form.get("title")).toBe("Leak");
    expect(form.get("bim")).toBe("2");
    expect(form.get("position")).toBe("[1,2,3]");
    expect(form.get("element_express_id")).toBe("55");
    expect(mockToast.success).toHaveBeenCalledWith("Issue #3 created.");
    await waitFor(() => expect(screen.queryByText("New issue")).not.toBeInTheDocument());
    expect(three().issues).toHaveLength(1);
  });

  test("opening an issue flies to it, and delete removes it", async () => {
    const user = userEvent.setup();
    const issue = { id: 4, number: 2, title: "Crack", status: "open" };
    mockGets({ "issues/project/7/": [issue] });
    API.delete.mockResolvedValue({});
    window.flyToIssue = jest.fn();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await waitLoaded();
    await waitFor(() => expect(three().issues).toHaveLength(1));
    act(() => three().onIssueSelect(issue));
    expect(window.flyToIssue).toHaveBeenCalledWith(issue);
    expect(three().selectedIssueId).toBe(4);
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(API.delete).toHaveBeenCalledWith("issues/4/"));
    expect(mockToast.success).toHaveBeenCalledWith("Issue #2 deleted.");
    await waitFor(() => expect(three().issues).toHaveLength(0));
    delete window.flyToIssue;
  });

  test("hiding an issue pin removes it from the 3D view only", async () => {
    const user = userEvent.setup();
    mockGets({ "issues/project/7/": [{ id: 4, number: 2, title: "Crack", status: "open" }] });
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Issues"));
    await user.click(await screen.findByTitle("Hide pin in viewer"));
    expect(three().issues).toHaveLength(0);
    expect(screen.getByText("Crack")).toBeInTheDocument();
  });

  test("pin mode toggles from the panel and BCF export errors are reported", async () => {
    const user = userEvent.setup();
    mockGets({ "issues/project/7/": [{ id: 4, number: 2, title: "Crack", status: "open" }] });
    renderPage();
    await waitLoaded();
    act(() => three().onModelsChanged({ bimModel: fakeModel([0, 0, 0]), pcModel: null }));
    await user.click(screen.getByTitle("Issues"));
    await user.click(await screen.findByRole("button", { name: /Pin new issue/ }));
    expect(three().issuePinMode).toBe(true);
    act(() => three().onCancelIssuePin());
    expect(three().issuePinMode).toBe(false);

    API.get.mockImplementation((url) =>
      url.endsWith("/bcf/") ? Promise.reject(new Error("x")) : Promise.resolve({ data: [] }),
    );
    await user.click(screen.getByRole("button", { name: /BCF/ }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("BCF export failed."));
  });
});

describe("monthly point-cloud merge", () => {
  const MERGED = {
    id: 21,
    project_id: 7,
    year: 2026,
    month: 3,
    status: "completed",
    file_url: "/media/merged_pointclouds/project_7/March_2026_Merged_PointCloud.ply",
    transform: { position: [9, 8, 7], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    point_count: 5000,
    total_source_files: 1,
    voxel_size: 0.02,
    is_stale: false,
  };
  const PREVIEW = {
    project_name: "Tower",
    output_name: "March_2026_Merged_PointCloud.ply",
    sources: [{ id: 5, date: "2026-03-10", name: "cloud.ply", format: "PLY", has_saved_alignment: false }],
    excluded_sources: [],
    missing_sources: [],
    eligible_count: 1,
    can_merge: true,
    running: null,
    latest: MERGED,
    latest_completed: MERGED,
  };

  const openDialog = async (user) => {
    await user.click(screen.getByTitle("Pick a date"));
    await user.click(screen.getByRole("button", { name: /Merge Point Clouds/ }));
    return screen.findByRole("dialog");
  };

  test("one month-level button, with that month's point-cloud count", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Pick a date"));
    const btn = screen.getByRole("button", { name: /Merge Point Clouds/ });
    expect(btn).toHaveTextContent("Merge Point Clouds1");
    expect(btn).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /Merge Point Clouds/ })).toHaveLength(1);
    // a month without point clouds can't be merged
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("button", { name: /Merge Point Clouds/ })).toBeDisabled();
    expect(
      screen.getByTitle("No point clouds uploaded in February 2026"),
    ).toBeInTheDocument();
  });

  test("picking a date never calls the merge API", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await user.click(screen.getByTitle("Pick a date"));
    await user.click(screen.getByRole("button", { name: /^10$/ }));
    await waitFor(() => expect(three().pointFile.id).toBe(5));
    expect(API.post).not.toHaveBeenCalled();
    expect(API.get).not.toHaveBeenCalledWith("pointcloud/merge/", expect.anything());
  });

  test("the button opens the confirmation for the viewed project/month", async () => {
    const user = userEvent.setup();
    mockGets({ "pointcloud/merge/": { ...PREVIEW, latest: null, latest_completed: null } });
    API.post.mockResolvedValue({
      data: { merge: { ...MERGED, status: "queued", progress: 0, file_url: null } },
    });
    renderPage();
    await waitLoaded();
    const dialog = await openDialog(user);
    expect(screen.queryByText("March 2026", { selector: "span" })).not.toBeInTheDocument();
    expect(API.get).toHaveBeenCalledWith("pointcloud/merge/", {
      params: { project_id: 7, year: 2026, month: 3 },
    });
    expect(within(dialog).getByText("Tower")).toBeInTheDocument();
    await user.click(await within(dialog).findByRole("button", { name: /Merge 1 point cloud/ }));
    expect(API.post).toHaveBeenCalledWith("pointcloud/merge/", {
      project_id: 7,
      year: 2026,
      month: 3,
      force: false,
    });
    // running: dialog button disabled, chip beside the calendar, calendar button busy
    expect(await within(dialog).findByRole("button", { name: /Merging… 0%/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByTitle(/Merging point clouds for March 2026/)).toHaveTextContent(
      "Merging March 2026 · 0%",
    );
    await user.click(screen.getByTitle("Pick a date"));
    expect(screen.getByRole("button", { name: /Merging… 0%/ })).toBeDisabled();
    // the date-wise cloud is still the one on screen
    expect(three().pointFile.id).toBe(5);
  });

  test("viewing the merged cloud keeps originals safe and is reversible", async () => {
    const user = userEvent.setup();
    API.put.mockResolvedValue({ data: {} });
    mockGets({ "pointcloud/merge/": PREVIEW });
    renderPage({ role: "data_contributor" });
    await waitLoaded();
    const original = three().pointFile;
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole("button", { name: /View merged/ }));

    expect(three().pointFile).toMatchObject({
      url: "http://127.0.0.1:8000/media/merged_pointclouds/project_7/March_2026_Merged_PointCloud.ply",
      transform: MERGED.transform,
      merged: true,
      mergeId: 21,
    });
    expect(screen.getByText(/Merged · March 2026/)).toBeInTheDocument();

    // Save position never writes the merged pose onto an original upload
    act(() =>
      three().onModelsChanged({ bimModel: fakeModel([1, 2, 3]), pcModel: fakeModel([4, 5, 6]) }),
    );
    await act(() => three().onSavePosition());
    expect(API.put).toHaveBeenCalledTimes(1);
    expect(API.put).toHaveBeenCalledWith("bim/2/update/", expect.anything());

    await user.click(screen.getByRole("button", { name: "Back to the date-wise point cloud" }));
    expect(three().pointFile).toBe(original);
    expect(screen.queryByText(/Merged · March 2026/)).not.toBeInTheDocument();
  });

  test("picking a date leaves the merged view", async () => {
    const user = userEvent.setup();
    mockGets({ "pointcloud/merge/": PREVIEW });
    renderPage();
    await waitLoaded();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole("button", { name: /View merged/ }));
    expect(three().pointFile.merged).toBe(true);
    await user.click(screen.getByTitle("Pick a date"));
    await user.click(screen.getByRole("button", { name: /^10$/ }));
    await waitFor(() => expect(three().pointFile.id).toBe(5));
    expect(three().pointFile.merged).toBeUndefined();
    expect(screen.queryByText(/Merged · March 2026/)).not.toBeInTheDocument();
  });

  test("a completed merge offers a View chip that can be dismissed", async () => {
    const user = userEvent.setup();
    mockGets({ "pointcloud/merge/": { ...PREVIEW, latest: null, latest_completed: null } });
    API.post.mockResolvedValue({ data: { merge: MERGED, reused: true } });
    renderPage();
    await waitLoaded();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole("button", { name: /Merge 1 point cloud/ }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /View merged March 2026/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: /View merged March 2026/ })).not.toBeInTheDocument();
    expect(three().pointFile.id).toBe(5);
  });
});
