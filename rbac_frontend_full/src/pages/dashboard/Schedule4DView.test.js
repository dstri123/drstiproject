import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as THREE from "three";
import API from "../../api/axios";
import { fetchAsArrayBuffer, getFileUrl, parseIfc } from "@/lib/ifcModel";
import Schedule4DView, { buildModel, elementState, paint, plannedStateLabel, STATES } from "./Schedule4DView";
import { parseDay } from "./scheduleParser";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/ifcModel", () => ({ fetchAsArrayBuffer: jest.fn(), getFileUrl: jest.fn(), parseIfc: jest.fn() }));

// No WebGL in jsdom: a do-nothing renderer. Plain classes survive resetMocks.
jest.mock("three", () => {
  const actual = jest.requireActual("three");
  class WebGLRenderer {
    constructor() {
      this.domElement = global.document.createElement("canvas");
      this.domElement.setAttribute("data-testid", "webgl-canvas");
      WebGLRenderer.instances.push(this);
      this.disposed = false;
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {
      this.disposed = true;
    }
    forceContextLoss() {}
  }
  WebGLRenderer.instances = [];
  return { ...actual, WebGLRenderer };
});
jest.mock("three/examples/jsm/controls/OrbitControls", () => {
  const { Vector3 } = jest.requireActual("three");
  // Mimics what the real controls do on update(): aim the camera at target.
  class OrbitControls {
    constructor(camera) {
      this.object = camera;
      this.target = new Vector3();
    }
    update() {
      this.object.lookAt(this.target);
      this.object.updateMatrixWorld();
    }
    dispose() {}
  }
  return { OrbitControls };
});

const D = (s) => parseDay(s);

// ---------------------------------------------------------------- fixtures

// Three triangles, one IFC element (express ID 1, 2, 3) each, all in the
// z = 0 plane. Element 1 is a big triangle covering the model's centre.
function fakeIfcModel() {
  const pos = [
    -100, -100, 0, 100, -100, 0, 0, 100, 0, // element 1
    -100, 90, 0, -90, 90, 0, -100, 100, 0, // element 2
    90, 90, 0, 100, 90, 0, 100, 100, 0, // element 3
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array([1, 1, 1, 2, 2, 2, 3, 3, 3]), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), 1));
  return { geometry: g, close: jest.fn() };
}

const ACTIVITIES = [
  { id: "A1", name: "Columns", level: "L1", start: "2024-01-01", finish: "2024-01-03", ifcTypes: "IfcColumn" },
  {
    id: "A2",
    name: "Beams",
    level: "L2",
    start: "2024-01-04",
    finish: "2024-01-10",
    ifcTypes: "",
    actual: { matched: 4, actual_pct: 25 },
    progress: { label: "Delayed" },
  },
];

const LINK = {
  elements: { 1: "A1", 2: "A2" },
  actual: { 1: "completed", 2: "in_progress" },
  scan_date: "2024-01-05",
  linked_count: 2,
  element_count: 3,
};

function mockApi({ bims = [{ id: 7, file: "/media/model.ifc", date: "2024-01-01", description: "Main" }], link = LINK } = {}) {
  API.get.mockImplementation((url) => {
    if (url.endsWith("/bim/")) return Promise.resolve({ data: bims });
    if (url.startsWith("processing/progress/schedule-4d/")) return Promise.resolve({ data: link });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

let ifcModel;
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  // jsdom 16 has no PointerEvent: give the pointer events their coordinates.
  window.PointerEvent = window.MouseEvent;
  ifcModel = fakeIfcModel();
  getFileUrl.mockImplementation((f) => `http://srv${f}`);
  fetchAsArrayBuffer.mockResolvedValue(new ArrayBuffer(8));
  parseIfc.mockResolvedValue(ifcModel);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore?.();
});

function renderView(props = {}) {
  const onSelect = jest.fn();
  const all = {
    projectId: 5,
    activities: ACTIVITIES,
    visibleIds: null,
    selectedId: null,
    onSelect,
    scheduleStart: D("2024-01-01"),
    scheduleFinish: D("2024-01-10"),
    today: D("2024-01-05"),
    ...props,
  };
  const utils = render(<Schedule4DView {...all} />);
  return { ...utils, onSelect, rerenderWith: (p) => utils.rerender(<Schedule4DView {...all} {...p} />) };
}

const legend = () => screen.getByText(/elements linked/).parentElement;
const legendCount = (label) => within(legend()).getByText(label).nextSibling.textContent;

// ---------------------------------------------------------------- pure logic

describe("elementState", () => {
  const a = { id: "A", start: "2024-01-04", finish: "2024-01-10" };
  const base = { mode: "planned", date: "2024-01-05", selectedId: null, visibleIds: null };

  test("unlinked / selected / filtered take precedence", () => {
    expect(elementState(undefined, base)).toBe("unlinked");
    expect(elementState(a, { ...base, selectedId: "A", visibleIds: new Set() })).toBe("selected");
    expect(elementState(a, { ...base, visibleIds: new Set(["B"]) })).toBe("filtered");
    expect(elementState(a, { ...base, visibleIds: new Set(["A"]) })).toBe("active");
  });

  test.each([
    ["2024-01-03", "future"],
    ["2024-01-04", "active"],
    ["2024-01-10", "active"],
    ["2024-01-11", "done"],
  ])("planned mode on %s -> %s", (date, st) => {
    expect(elementState(a, { ...base, date })).toBe(st);
  });

  test.each([
    [undefined, "2024-01-20", "a_nodata"],
    ["completed", "2024-01-20", "a_done"],
    ["in_progress", "2024-01-20", "a_progress"],
    ["not_started", "2024-01-10", "a_behind"],
    ["not_started", "2024-01-20", "a_behind"],
    ["not_started", "2024-01-09", "a_notdue"],
    ["not_started", null, "a_notdue"],
  ])("actual mode, measured %p scan %p -> %s", (measured, scanDate, st) => {
    expect(elementState(a, { ...base, mode: "actual", measured, scanDate })).toBe(st);
  });
});

test("plannedStateLabel", () => {
  const a = { start: "2024-01-04", finish: "2024-01-10" };
  expect(plannedStateLabel(a, "2024-01-01")).toBe("Not started (per plan)");
  expect(plannedStateLabel(a, "2024-01-04")).toBe("In progress (per plan)");
  expect(plannedStateLabel(a, "2024-01-10")).toBe("In progress (per plan)");
  expect(plannedStateLabel(a, "2024-01-11")).toBe("Finished (per plan)");
});

describe("buildModel / paint", () => {
  test("buildModel splits the IFC mesh into solid + ghost meshes sharing vertex buffers", () => {
    const m = buildModel(ifcModel);
    expect(m.elements).toEqual([1, 2, 3]);
    expect(Array.from(m.triExp)).toEqual([1, 2, 3]);
    expect(m.solid.geometry.getAttribute("position")).toBe(ifcModel.geometry.getAttribute("position"));
    expect(m.ghost.geometry.getAttribute("position")).toBe(ifcModel.geometry.getAttribute("position"));
    expect(m.solid.geometry.getAttribute("color")).toBe(m.ghost.geometry.getAttribute("color"));
    expect(m.ghost.material.transparent).toBe(true);
    expect(m.ghost.renderOrder).toBe(1);
    expect(m.box.min.toArray()).toEqual([-100, -100, 0]);
    expect(m.box.max.toArray()).toEqual([100, 100, 0]);
  });

  test("paint colours solid states, routes ghost states to the ghost mesh and counts states", () => {
    const m = buildModel(ifcModel);
    const states = { 1: "done", 2: "future", 3: "a_behind" };
    const counts = paint(m, (exp) => states[exp]);
    expect(counts).toEqual({ done: 1, future: 1, a_behind: 1 });
    expect(m.solid.geometry.drawRange.count).toBe(6);
    expect(m.ghost.geometry.drawRange.count).toBe(3);
    expect(Array.from(m.solid.geometry.index.array.slice(0, 6))).toEqual([0, 1, 2, 6, 7, 8]);
    expect(Array.from(m.ghost.geometry.index.array.slice(0, 3))).toEqual([3, 4, 5]);
    const col = m.solid.geometry.getAttribute("color").array;
    const done = new THREE.Color(STATES.done.color);
    const behind = new THREE.Color(STATES.a_behind.color);
    expect(col[0]).toBeCloseTo(done.r);
    expect(col[2]).toBeCloseTo(done.b);
    expect(col[6 * 3]).toBeCloseTo(behind.r);
    expect(col[6 * 3 + 1]).toBeCloseTo(behind.g);

    // Repaint: everything ghosted.
    const counts2 = paint(m, () => "unlinked");
    expect(counts2).toEqual({ unlinked: 3 });
    expect(m.solid.geometry.drawRange.count).toBe(0);
    expect(m.ghost.geometry.drawRange.count).toBe(9);
  });
});

// ---------------------------------------------------------------- component

test("loads the project's IFC model and the schedule links, then shows the planned legend", async () => {
  mockApi({
    bims: [
      { id: 3, file: "/media/scan.las", date: "2024-01-01" },
      { id: 7, file: "/media/model.IFC?sig=1", date: "2024-01-02", description: "Main" },
    ],
  });
  renderView();
  expect(API.get).toHaveBeenCalledWith("projects/5/bim/");
  await screen.findByText(/2 of 3 elements linked/);
  expect(API.get).toHaveBeenCalledWith("processing/progress/schedule-4d/5/", { params: { bim: 7 } });
  expect(getFileUrl).toHaveBeenCalledWith("/media/model.IFC?sig=1");
  expect(fetchAsArrayBuffer).toHaveBeenCalledWith("http://srv/media/model.IFC?sig=1");
  // web-ifc's copy is released once the geometry is copied.
  expect(ifcModel.close).toHaveBeenCalled();
  // Only one IFC -> no model picker.
  expect(screen.queryByTitle("IFC model to colour")).not.toBeInTheDocument();
  // Slider starts on "today" (5 Jan): A1 finished, A2 in progress, element 3 unlinked.
  expect(screen.getByText("5 Jan 2024")).toBeInTheDocument();
  expect(legendCount("Built (per plan)")).toBe("1");
  expect(legendCount("In progress (per plan)")).toBe("1");
  expect(legendCount("Not started")).toBe("0");
  expect(legendCount("Not in schedule")).toBe("1");
  expect(within(legend()).queryByText("Selected activity")).not.toBeInTheDocument();
  expect(within(legend()).queryByText("Hidden by filters")).not.toBeInTheDocument();
  expect(screen.getByTestId("webgl-canvas")).toBeInTheDocument();
});

test("the slider moves the plan date and recolours", async () => {
  mockApi();
  renderView();
  await screen.findByText(/elements linked/);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
  expect(screen.getByText("1 Jan 2024")).toBeInTheDocument();
  expect(legendCount("In progress (per plan)")).toBe("1");
  expect(legendCount("Not started")).toBe("1");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "9" } });
  expect(screen.getByText("10 Jan 2024")).toBeInTheDocument();
  expect(legendCount("Built (per plan)")).toBe("1");
});

test("slider start is clamped to the schedule when today is outside it", () => {
  mockApi({ bims: [] });
  const { unmount } = renderView({ today: D("2023-06-01") });
  expect(screen.getByRole("slider")).toHaveValue("0");
  expect(screen.getByRole("slider")).toHaveAttribute("max", "9");
  unmount();
  renderView({ today: D("2030-01-01") });
  expect(screen.getByRole("slider")).toHaveValue("9");
});

test("play runs through the schedule and stops at the end; play at the end restarts", async () => {
  mockApi({ bims: [] });
  jest.useFakeTimers();
  try {
    renderView({ today: D("2024-01-08") });
    fireEvent.click(screen.getByTitle("Play the schedule"));
    expect(screen.getByTitle("Pause")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText("9 Jan 2024")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByText("10 Jan 2024")).toBeInTheDocument();
    expect(screen.getByTitle("Play the schedule")).toBeInTheDocument();
    // At the end: play restarts from day 0.
    fireEvent.click(screen.getByTitle("Play the schedule"));
    expect(screen.getByText("1 Jan 2024")).toBeInTheDocument();
    // Dragging the slider pauses playback.
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(screen.getByTitle("Play the schedule")).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test("actual mode: enabled once a scan exists, shows measured legend", async () => {
  mockApi();
  renderView();
  const actualBtn = await screen.findByRole("button", { name: "Actual (scan 5 Jan 2024)" });
  expect(actualBtn).toBeEnabled();
  expect(actualBtn).toHaveAttribute("title", "Measured on the 5 Jan 2024 scan");
  fireEvent.click(actualBtn);
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  expect(screen.getByText(/red = should be built by then/)).toBeInTheDocument();
  expect(legendCount("Built")).toBe("1");
  expect(legendCount("Partly built")).toBe("1");
  expect(legendCount("Not in schedule")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "Planned" }));
  expect(screen.getByRole("slider")).toBeInTheDocument();
});

test("actual mode is disabled without a scan", async () => {
  mockApi({ link: { ...LINK, scan_date: null, actual: {} } });
  renderView();
  await screen.findByText(/elements linked/);
  const btn = screen.getByRole("button", { name: "Actual" });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute("title", "Run a Progress Assessment to see measured progress");
});

test("filters ghost hidden activities and the selection is highlighted", async () => {
  mockApi();
  const { rerenderWith } = renderView({ visibleIds: new Set(["A2"]) });
  await screen.findByText(/elements linked/);
  expect(legendCount("Hidden by filters")).toBe("1");
  rerenderWith({ visibleIds: new Set(["A2"]), selectedId: "A1" });
  expect(legendCount("Selected activity")).toBe("1");
});

test("selected activity panel shows plan, measured progress and element count; × clears it", async () => {
  mockApi({ link: { ...LINK, elements: { 1: "A2", 2: "A2" } } });
  const { onSelect } = renderView({ selectedId: "A2" });
  await screen.findByText(/elements linked/);
  expect(screen.getByText("A2 · L2")).toBeInTheDocument();
  expect(screen.getByText("4 Jan 2024 – 10 Jan 2024")).toBeInTheDocument();
  expect(screen.getByText("On 5 Jan 2024")).toBeInTheDocument();
  // Once in the panel, once in the legend.
  expect(screen.getAllByText("In progress (per plan)")).toHaveLength(2);
  expect(screen.getByText("25% · Delayed")).toBeInTheDocument();
  expect(screen.getByText("2 in this model")).toBeInTheDocument();
  fireEvent.click(screen.getByTitle("Clear selection"));
  expect(onSelect).toHaveBeenCalledWith(null);
});

test("selected activity without scan data: no Measured row, IFC types listed", async () => {
  mockApi();
  renderView({ selectedId: "A1" });
  await screen.findByText(/elements linked/);
  expect(screen.queryByText("Measured")).not.toBeInTheDocument();
  expect(screen.getByText("1 in this model (IfcColumn)")).toBeInTheDocument();
});

test("clicking an element selects its activity; clicking it again or empty space clears", async () => {
  mockApi();
  const { container, onSelect, rerenderWith } = renderView();
  await screen.findByText(/elements linked/);
  const mount = screen.getByTestId("webgl-canvas").parentElement;
  mount.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

  // Centre of the view = centre of element 1 (activity A1).
  fireEvent.pointerDown(mount, { clientX: 50, clientY: 50 });
  fireEvent.pointerUp(mount, { clientX: 51, clientY: 50 });
  expect(onSelect).toHaveBeenLastCalledWith("A1");

  rerenderWith({ selectedId: "A1" });
  fireEvent.pointerDown(mount, { clientX: 50, clientY: 50 });
  fireEvent.pointerUp(mount, { clientX: 50, clientY: 50 });
  expect(onSelect).toHaveBeenLastCalledWith(null);

  // A drag (orbit) doesn't select.
  onSelect.mockClear();
  fireEvent.pointerDown(mount, { clientX: 50, clientY: 50 });
  fireEvent.pointerUp(mount, { clientX: 70, clientY: 50 });
  expect(onSelect).not.toHaveBeenCalled();

  // Off the model -> clear.
  fireEvent.pointerDown(mount, { clientX: -1000, clientY: -1000 });
  fireEvent.pointerUp(mount, { clientX: -1000, clientY: -1000 });
  expect(onSelect).toHaveBeenLastCalledWith(null);
  expect(container).toBeTruthy();
});

test("pointer clicks before the model loads do nothing", () => {
  mockApi({ bims: [] });
  const { onSelect } = renderView();
  const mount = screen.getByTestId("webgl-canvas").parentElement;
  fireEvent.pointerUp(mount, { clientX: 1, clientY: 1 });
  fireEvent.pointerDown(mount, { clientX: 1, clientY: 1 });
  fireEvent.pointerUp(mount, { clientX: 1, clientY: 1 });
  expect(onSelect).not.toHaveBeenCalled();
});

test("fit button reframes the camera without errors (and is a no-op with no model)", async () => {
  mockApi({ bims: [] });
  renderView();
  fireEvent.click(screen.getByTitle("Fit the model"));
  await screen.findByText(/No IFC model uploaded/);
});

test("several IFC models: picker switches the model and reloads its links", async () => {
  mockApi({
    bims: [
      { id: 7, file: "/media/a.ifc", date: "2024-01-01", description: "Arch" },
      { id: 8, file: "/media/b.ifc", date: "2024-02-01" },
    ],
  });
  renderView();
  await screen.findByText(/elements linked/);
  const picker = screen.getByTitle("IFC model to colour");
  expect(within(picker).getByRole("option", { name: "Arch · 2024-01-01" })).toBeInTheDocument();
  expect(within(picker).getByRole("option", { name: "b.ifc · 2024-02-01" })).toBeInTheDocument();
  parseIfc.mockResolvedValue(fakeIfcModel());
  fireEvent.change(picker, { target: { value: "8" } });
  await waitFor(() =>
    expect(API.get).toHaveBeenCalledWith("processing/progress/schedule-4d/5/", { params: { bim: 8 } }),
  );
  await screen.findByText(/elements linked/);
});

test("no IFC model uploaded -> guidance message", async () => {
  mockApi({ bims: [{ id: 1, file: "/media/cloud.las" }, { id: 2, file: null }] });
  renderView();
  expect(await screen.findByText(/No IFC model uploaded for this project yet/)).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledTimes(1);
});

test("BIM list failure -> error", async () => {
  API.get.mockRejectedValue(new Error("boom"));
  renderView();
  expect(await screen.findByText("Couldn't load the project's BIM models.")).toBeInTheDocument();
});

test("model / link load failure shows the server error or the exception message", async () => {
  mockApi();
  parseIfc.mockRejectedValue(new Error("bad wasm"));
  const { unmount } = renderView();
  expect(await screen.findByText("Couldn't load the model: bad wasm")).toBeInTheDocument();
  unmount();

  API.get.mockImplementation((url) =>
    url.endsWith("/bim/")
      ? Promise.resolve({ data: [{ id: 7, file: "/media/m.ifc" }] })
      : Promise.reject({ response: { data: { error: "No progress data" } } }),
  );
  parseIfc.mockResolvedValue(fakeIfcModel());
  renderView();
  expect(await screen.findByText("No progress data")).toBeInTheDocument();
});

test("shows a loading message while the model loads", async () => {
  mockApi();
  let resolve;
  parseIfc.mockReturnValue(new Promise((r) => (resolve = r)));
  renderView();
  expect(await screen.findByText("Loading model and linking it to the schedule…")).toBeInTheDocument();
  await act(async () => resolve(ifcModel));
  await screen.findByText(/elements linked/);
  expect(screen.queryByText(/Loading model/)).not.toBeInTheDocument();
});

test("unmounting mid-load discards the parsed model; unmount disposes the renderer", async () => {
  mockApi();
  let resolve;
  parseIfc.mockReturnValue(new Promise((r) => (resolve = r)));
  const { unmount } = renderView();
  await screen.findByText(/Loading model/);
  const renderer = THREE.WebGLRenderer.instances.at(-1);
  unmount();
  expect(renderer.disposed).toBe(true);
  await act(async () => resolve(ifcModel));
  expect(ifcModel.close).toHaveBeenCalled();
});
