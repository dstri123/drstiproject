import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import * as THREE from "three";
import API from "../../api/axios";
import { fetchAsArrayBuffer, getFileUrl, parseIfc } from "../../lib/ifcModel";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import AnalyticsPage, {
  toDateStr,
  MonthCalendar,
  applyCleanBim,
  setScreenCurtain,
  applySavedTransform,
  disposeObject,
  loadModel,
  overlayLabel,
  deg2rad,
  DEFAULT_ALIGN,
  closingSideFor,
  modelOptionsFor,
  autoPickDates,
  groupUploadsByDate,
} from "./AnalyticsPage";

// ─── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("three", () => {
  const actual = jest.requireActual("three");
  function WebGLRenderer() {
    this.domElement = global.document.createElement("canvas");
    this.setSize = () => {};
    this.setPixelRatio = () => {};
    this.render = () => {};
    this.dispose = () => {};
    this.forceContextLoss = () => {};
  }
  return { ...actual, WebGLRenderer };
});
jest.mock("three/examples/jsm/controls/OrbitControls", () => {
  const { Vector3 } = jest.requireActual("three");
  return {
    OrbitControls: function OrbitControls() {
      this.target = new Vector3();
      this.update = () => {};
      this.dispose = () => {};
    },
  };
});
jest.mock("three/examples/jsm/loaders/PLYLoader", () => ({ PLYLoader: jest.fn() }));
jest.mock("three/examples/jsm/loaders/FBXLoader", () => ({ FBXLoader: jest.fn() }));
jest.mock("three/examples/jsm/loaders/GLTFLoader", () => ({ GLTFLoader: jest.fn() }));
jest.mock("../../lib/ifcModel", () => ({
  fetchAsArrayBuffer: jest.fn(),
  getFileUrl: jest.fn(),
  parseIfc: jest.fn(),
}));
jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../viewer/layout/Header", () => () => <div data-testid="header" />);
jest.mock("../viewer/components/gizmo/BlenderViewportGizmo", () => () => null);
jest.mock("../viewer/layout/IconToolbar", () => (props) => (
  <div data-testid="toolbar" data-role={props.role} data-slug={props.projectSlug}>
    <button onClick={() => props.onSelectPanel("models")}>open models</button>
  </div>
));
jest.mock("../viewer/layout/Sidebar", () => (props) => (
  <div data-testid="context-panel" data-role={props.role} data-panel={props.activePanel}>
    <button onClick={props.onClosePanel}>close panel</button>
  </div>
));

// A small real mesh so Box3 / matrices work.
const box = (size = 2, at = [0, 0, 0]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
  m.position.set(...at);
  const g = new THREE.Group();
  g.add(m);
  return g;
};
const plyGeometry = (withColor = false) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3));
  if (withColor) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(6).fill(0.5), 3));
  return g;
};

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.requestAnimationFrame = jest.fn(() => 1);
  window.cancelAnimationFrame = jest.fn();
  getFileUrl.mockImplementation((f) => `http://host${f}`);
  fetchAsArrayBuffer.mockResolvedValue(new ArrayBuffer(8));
  parseIfc.mockImplementation(async () => box());
  PLYLoader.mockImplementation(function () {
    this.parse = () => plyGeometry();
  });
  FBXLoader.mockImplementation(function () {
    this.parse = () => box(1);
  });
  GLTFLoader.mockImplementation(function () {
    this.parseAsync = async () => ({ scene: box(1) });
  });
});

// ─── Pure helpers ───────────────────────────────────────────────────────────
describe("helpers", () => {
  test("toDateStr pads month/day", () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateStr(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  test("deg2rad and DEFAULT_ALIGN", () => {
    expect(deg2rad(180)).toBeCloseTo(Math.PI);
    expect(deg2rad(0)).toBe(0);
    expect(DEFAULT_ALIGN).toEqual({ rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, opacity: 1, scale: 1 });
  });

  test("overlayLabel positions on the requested side", () => {
    const s = overlayLabel("right", "#123456");
    expect(s.right).toBe(10);
    expect(s.left).toBeUndefined();
    expect(s.color).toBe("#123456");
    expect(s.border).toBe("1px solid #12345655");
  });

  describe("closingSideFor", () => {
    test("middle positions → no overlay", () => {
      expect(closingSideFor(0.5, 0.5, true, true)).toBeNull();
      expect(closingSideFor(0.11, 0.89, true, true)).toBeNull();
    });
    test("vertical handle at the edges", () => {
      expect(closingSideFor(0, 0.5, true, false)).toEqual({ side: "A", t: 1 });
      expect(closingSideFor(0.1, 0.5, true, false)).toEqual({ side: "A", t: 0 });
      expect(closingSideFor(0.05, 0.5, true, false).t).toBeCloseTo(0.5);
      expect(closingSideFor(1, 0.5, true, false).side).toBe("B");
      expect(closingSideFor(1, 0.5, true, false).t).toBeCloseTo(1);
      expect(closingSideFor(0.95, 0.5, true, false).t).toBeCloseTo(0.5);
    });
    test("horizontal handle: top closes B, bottom closes A", () => {
      expect(closingSideFor(0.5, 0, false, true)).toEqual({ side: "B", t: 1 });
      expect(closingSideFor(0.5, 1, false, true).side).toBe("A");
    });
    test("disabled curtains are ignored; vertical wins when both close", () => {
      expect(closingSideFor(0, 0, false, false)).toBeNull();
      expect(closingSideFor(0, 0.5, false, true)).toBeNull();
      expect(closingSideFor(0, 0, true, true).side).toBe("A");
      expect(closingSideFor(0.5, 0, true, true).side).toBe("B");
    });
  });

  describe("modelOptionsFor", () => {
    test("unknown date → no options", () => {
      expect(modelOptionsFor({}, "2026-01-01")).toEqual([]);
    });
    test("single model → no 'all' option; label falls back to file name then kind", () => {
      expect(modelOptionsFor({ d: { bim: [{ file: "/media/a/b.ifc" }], pc: [] } }, "d")).toEqual([
        { value: "bim:0", label: "BIM · b.ifc" },
      ]);
      expect(modelOptionsFor({ d: { bim: [], pc: [{}] } }, "d")).toEqual([{ value: "pc:0", label: "Point Cloud · cloud" }]);
      expect(modelOptionsFor({ d: { bim: [{}] } }, "d")).toEqual([{ value: "bim:0", label: "BIM · model" }]);
    });
    test("several models → 'all' first, description preferred", () => {
      const opts = modelOptionsFor({ d: { bim: [{ description: "Arch" }], pc: [{ file: "s.ply" }, { description: "Scan 2" }] } }, "d");
      expect(opts.map((o) => o.value)).toEqual(["all", "bim:0", "pc:0", "pc:1"]);
      expect(opts[0].label).toBe("All models (3)");
      expect(opts[1].label).toBe("BIM · Arch");
      expect(opts[3].label).toBe("Point Cloud · Scan 2");
    });
  });

  describe("autoPickDates", () => {
    const u = { "2026-01-01": {}, "2026-03-01": {}, "2026-02-01": {} };
    test("no dates → null", () => {
      expect(autoPickDates({}, null)).toBeNull();
    });
    test("A = second-latest, B = latest", () => {
      expect(autoPickDates(u)).toEqual({ a: "2026-02-01", b: "2026-03-01" });
    });
    test("A = initialDate when it has uploads", () => {
      expect(autoPickDates(u, "2026-03-01")).toEqual({ a: "2026-03-01", b: "2026-02-01" });
      expect(autoPickDates(u, "2026-01-01")).toEqual({ a: "2026-01-01", b: "2026-03-01" });
    });
    test("unknown initialDate is ignored", () => {
      expect(autoPickDates(u, "1999-01-01").a).toBe("2026-02-01");
    });
    test("single date → no B", () => {
      expect(autoPickDates({ "2026-01-01": {} })).toEqual({ a: "2026-01-01", b: null });
    });
  });

  test("groupUploadsByDate merges BIM and point clouds and skips undated items", () => {
    const out = groupUploadsByDate(
      [{ id: 1, date: "d1" }, { id: 2 }, { id: 3, date: "d2" }],
      [{ id: 4, date: "d1" }],
    );
    expect(out).toEqual({
      d1: { bim: [{ id: 1, date: "d1" }], pc: [{ id: 4, date: "d1" }] },
      d2: { bim: [{ id: 3, date: "d2" }], pc: [] },
    });
    expect(groupUploadsByDate(null, undefined)).toEqual({});
  });

  test("applySavedTransform applies valid arrays and ignores bad input", () => {
    const o = new THREE.Object3D();
    applySavedTransform(o, { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] });
    expect(o.position.toArray()).toEqual([1, 2, 3]);
    expect(o.scale.toArray()).toEqual([2, 2, 2]);
    applySavedTransform(o, { position: [9, 9], scale: "x" });
    expect(o.position.toArray()).toEqual([1, 2, 3]);
    expect(() => applySavedTransform(null, {})).not.toThrow();
    expect(() => applySavedTransform(o, null)).not.toThrow();
    expect(() => applySavedTransform(o, "str")).not.toThrow();
  });

  test("disposeObject disposes geometry, materials and closes IFC models", () => {
    const g = box();
    const mesh = g.children[0];
    const geo = jest.spyOn(mesh.geometry, "dispose");
    const mat = jest.spyOn(mesh.material, "dispose");
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    const m2a = jest.spyOn(m2.material[1], "dispose");
    g.add(m2);
    g.ifcManager = {};
    g.close = jest.fn();
    disposeObject(g);
    expect(geo).toHaveBeenCalled();
    expect(mat).toHaveBeenCalled();
    expect(m2a).toHaveBeenCalled();
    expect(g.close).toHaveBeenCalled();
  });

  test("applyCleanBim swaps mesh materials and adds edge lines", () => {
    const g = box();
    g.add(new THREE.Object3D());
    applyCleanBim(g);
    const mesh = g.children[0];
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mesh.material.opacity).toBeCloseTo(0.55);
    expect(mesh.children.find((c) => c.name === "__clean_edges")).toBeInstanceOf(THREE.LineSegments);
  });

  test("applyCleanBim tolerates degenerate geometry", () => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    m.geometry = { isBufferGeometry: true }; // EdgesGeometry throws on this
    g.add(m);
    expect(() => applyCleanBim(g)).not.toThrow();
    expect(m.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  describe("setScreenCurtain", () => {
    const cam = () => {
      const c = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      c.position.set(0, 0, 10);
      c.lookAt(0, 0, 0);
      c.updateMatrixWorld();
      return c;
    };
    test("missing planes is a no-op", () => {
      expect(() => setScreenCurtain(cam(), null, new THREE.Plane(), "v", 0.5)).not.toThrow();
    });
    test("vertical curtain: A keeps the left, B the right; planes are opposite", () => {
      const a = new THREE.Plane();
      const b = new THREE.Plane();
      setScreenCurtain(cam(), a, b, "v", 0.5);
      expect(a.distanceToPoint(new THREE.Vector3(-1, 0, 0))).toBeGreaterThan(0);
      expect(a.distanceToPoint(new THREE.Vector3(1, 0, 0))).toBeLessThan(0);
      expect(b.distanceToPoint(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0);
      expect(b.normal.x).toBeCloseTo(-a.normal.x);
    });
    test("vertical curtain follows the handle fraction", () => {
      const a = new THREE.Plane();
      const b = new THREE.Plane();
      setScreenCurtain(cam(), a, b, "v", 0.75);
      // a point slightly right of centre is now on A's side
      expect(a.distanceToPoint(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0);
    });
    test("horizontal curtain: A keeps below the line, B above", () => {
      const a = new THREE.Plane();
      const b = new THREE.Plane();
      setScreenCurtain(cam(), a, b, "h", 0.5);
      expect(a.distanceToPoint(new THREE.Vector3(0, -1, 0))).toBeGreaterThan(0);
      expect(b.distanceToPoint(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0);
    });
  });

  describe("loadModel", () => {
    test("IFC BIM: parsed, transformed, clean look, base opacity recorded", async () => {
      const obj = await loadModel("bim", { file: "/media/m.ifc", transform: { position: [5, 0, 0] } });
      expect(getFileUrl).toHaveBeenCalledWith("/media/m.ifc");
      expect(fetchAsArrayBuffer).toHaveBeenCalledWith("http://host/media/m.ifc");
      expect(parseIfc).toHaveBeenCalled();
      expect(obj.position.x).toBe(5);
      const mesh = obj.children[0];
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mesh.material.userData.baseOpacity).toBeCloseTo(0.55);
    });

    test("FBX and GLB/GLTF use their loaders (query string ignored)", async () => {
      await loadModel("bim", { file: "/m.FBX?x=1" });
      expect(FBXLoader).toHaveBeenCalled();
      await loadModel("bim", { file: "/m.glb" });
      await loadModel("bim", { file: "/m.gltf" });
      expect(GLTFLoader).toHaveBeenCalledTimes(2);
      expect(parseIfc).not.toHaveBeenCalled();
    });

    test("PLY point cloud: parsed directly, white colours added when missing", async () => {
      const obj = await loadModel("pc", { file: "/media/s.ply" });
      expect(API.post).not.toHaveBeenCalled();
      expect(obj).toBeInstanceOf(THREE.Points);
      expect(obj.geometry.attributes.color.array[0]).toBe(1);
      expect(obj.material.size).toBeGreaterThanOrEqual(0.01);
      expect(obj.material.userData.baseOpacity).toBe(1);
      const shader = { vertexShader: "a\n#include <logdepthbuf_vertex>" };
      obj.material.onBeforeCompile(shader);
      expect(shader.vertexShader).toMatch(/gl_PointSize = max\( gl_PointSize, 1.5 \);/);
    });

    test("PLY with colours keeps them", async () => {
      PLYLoader.mockImplementation(function () {
        this.parse = () => plyGeometry(true);
      });
      const obj = await loadModel("pc", { file: "/s.ply" });
      expect(obj.geometry.attributes.color.array[0]).toBe(0.5);
    });

    test("non-PLY point cloud is converted on the backend", async () => {
      API.post.mockResolvedValue({ data: new ArrayBuffer(4) });
      await loadModel("pc", { file: "/media/clouds/scan.LAS" });
      expect(API.post).toHaveBeenCalledWith(
        "processing/tools/pointcloud-to-ply/",
        expect.any(FormData),
        { headers: { "Content-Type": "multipart/form-data" }, responseType: "arraybuffer" },
      );
      const fd = API.post.mock.calls[0][1];
      expect(fd.get("file").name).toBe("scan.LAS");
    });

    test("download failure propagates", async () => {
      fetchAsArrayBuffer.mockRejectedValue(new Error("Failed to download model (404)."));
      await expect(loadModel("bim", { file: "/x.ifc" })).rejects.toThrow("404");
    });
  });
});

// ─── MonthCalendar ──────────────────────────────────────────────────────────
describe("MonthCalendar", () => {
  const uploads = {
    "2026-03-04": { bim: [{}], pc: [] },
    "2026-03-10": { bim: [], pc: [{}, {}] },
  };
  const anchors = [];
  afterEach(() => {
    anchors.splice(0).forEach((a) => a.remove());
  });
  function renderCal(props = {}) {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchors.push(anchor);
    const onDateSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <MonthCalendar
        uploadsByDate={uploads}
        selectedDate="2026-03-04"
        onDateSelect={onDateSelect}
        onClose={onClose}
        accent="#3b82f6"
        anchorEl={anchor}
        {...props}
      />,
    );
    return { onDateSelect, onClose, anchor };
  }

  test("opens on the month of the latest upload with upload tooltips", () => {
    renderCal();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(screen.getByText("4").parentElement).toHaveAttribute("title", "1 BIM · 0 Point Cloud");
    expect(screen.getByText("10").parentElement).toHaveAttribute("title", "0 BIM · 2 Point Cloud");
    expect(screen.getByText("11").parentElement).toHaveAttribute("title", "No uploads");
  });

  test("opens on the current month when there are no uploads", () => {
    renderCal({ uploadsByDate: {} });
    const now = new Date();
    expect(screen.getByText(now.toLocaleDateString("en-US", { month: "long", year: "numeric" }))).toBeInTheDocument();
  });

  test("clicking a date with uploads selects it and closes", async () => {
    const { onDateSelect, onClose } = renderCal();
    await userEvent.click(screen.getByText("10"));
    expect(onDateSelect).toHaveBeenCalledWith("2026-03-10", uploads["2026-03-10"]);
    expect(onClose).toHaveBeenCalled();
  });

  test("clicking an empty date does nothing", () => {
    const { onDateSelect, onClose } = renderCal();
    fireEvent.click(screen.getByText("11"));
    expect(onDateSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("month navigation", async () => {
    renderCal();
    const popup = screen.getByText("March 2026").parentElement.parentElement;
    const [prev, next] = within(popup).getAllByRole("button");
    await userEvent.click(next);
    expect(screen.getByText("April 2026")).toBeInTheDocument();
    await userEvent.click(prev);
    await userEvent.click(prev);
    expect(screen.getByText("February 2026")).toBeInTheDocument();
  });

  test("Escape and outside clicks close; clicks on the anchor don't", () => {
    const { onClose, anchor } = renderCal();
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText("March 2026"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("flips above the anchor when there's no room below", () => {
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ top: window.innerHeight - 20, bottom: window.innerHeight - 5, left: 30 });
    document.body.appendChild(anchor);
    anchors.push(anchor);
    render(<MonthCalendar uploadsByDate={uploads} selectedDate={null} onDateSelect={() => {}} onClose={() => {}} accent="#000" anchorEl={anchor} />);
    const popup = screen.getByText("March 2026").parentElement.parentElement;
    expect(popup.style.top).toBe(`${window.innerHeight - 20 - 280 - 6}px`);
    expect(popup.style.left).toBe("30px");
  });
});

// ─── Page ───────────────────────────────────────────────────────────────────
const BIM = [
  { id: 1, date: "2026-01-01", file: "/media/a.ifc", description: "Arch" },
  { id: 2, date: "2026-02-01", file: "/media/b.ifc" },
];
const PC = [
  { id: 3, date: "2026-02-01", file: "/media/s.ply", description: "Scan" },
  { id: 4, file: "/media/undated.ply" },
];

function mockApi({ projects = [{ id: 7, project_name: "Tower" }], bim = BIM, pc = PC, uploadsError, projectsError } = {}) {
  API.get.mockImplementation((url) => {
    if (url === "projects/") return projectsError ? Promise.reject(projectsError) : Promise.resolve({ data: projects });
    if (uploadsError && /^projects\/\d+\/(bim|pointcloud)\/$/.test(url)) return Promise.reject(uploadsError);
    if (/^projects\/\d+\/bim\/$/.test(url)) return Promise.resolve({ data: bim });
    if (/^projects\/\d+\/pointcloud\/$/.test(url)) return Promise.resolve({ data: pc });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

function renderPage(props = {}, path = "/analytics/7_Tower") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/analytics/:slug" element={<AnalyticsPage {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Both sides auto-load on arrival; wait until neither is loading.
async function settled() {
  await screen.findByText(/2 dates with uploads/);
  await waitFor(() => expect(screen.queryAllByText("LOADING…")).toHaveLength(0));
}

describe("AnalyticsPage — data loading", () => {
  test("resolves the project and groups uploads by date", async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText("Tower")).toBeInTheDocument();
    expect(API.get).toHaveBeenCalledWith("projects/");
    expect(API.get).toHaveBeenCalledWith("projects/7/bim/");
    expect(API.get).toHaveBeenCalledWith("projects/7/pointcloud/");
    await settled();
  });

  test("resolves a project by createProjectSlug / slug field", async () => {
    mockApi({ projects: [{ id: 12, project_name: "Other", slug: "other" }] });
    renderPage({}, "/analytics/other");
    expect(await screen.findByText("Other")).toBeInTheDocument();
    await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/12/bim/"));
    await settled();
  });

  test("routeParam prop overrides the URL", async () => {
    mockApi({ projects: [{ id: 9, project_name: "Nine" }] });
    renderPage({ routeParam: "9_Nine" }, "/analytics/ignored");
    expect(await screen.findByText("Nine")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar")).toHaveAttribute("data-slug", "9_Nine");
    await settled();
  });

  test("shows the slug's project id when the project list doesn't contain it", async () => {
    mockApi({ projects: [], bim: [], pc: [] });
    renderPage();
    expect(await screen.findByText("Project #7")).toBeInTheDocument();
    expect(await screen.findByText(/No BIM \/ point cloud uploads in this project yet/)).toBeInTheDocument();
  });

  test("project list failure shows an error", async () => {
    mockApi({ projectsError: new Error("down") });
    jest.spyOn(console, "error").mockImplementation(() => {});
    renderPage({}, "/analytics/unknown");
    expect(await screen.findByText(/Could not load project/)).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
    console.error.mockRestore();
  });

  test("upload failure with a status code", async () => {
    mockApi({ uploadsError: { response: { status: 500 } } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    renderPage();
    // The slug's id ("7") and the resolved id (7) differ in type, so uploads are
    // fetched twice and the message briefly clears in between — wait it out.
    await waitFor(() => expect(API.get.mock.calls.filter((c) => c[0] === "projects/7/bim/")).toHaveLength(2));
    await waitFor(() => expect(screen.getByText(/Could not load uploads \(server returned 500\)/)).toBeInTheDocument());
    console.error.mockRestore();
  });

  test("upload failure without a response", async () => {
    mockApi({ uploadsError: new Error("network") });
    jest.spyOn(console, "error").mockImplementation(() => {});
    renderPage();
    // The slug's id ("7") and the resolved id (7) differ in type, so uploads are
    // fetched twice and the message briefly clears in between — wait it out.
    await waitFor(() => expect(API.get.mock.calls.filter((c) => c[0] === "projects/7/bim/")).toHaveLength(2));
    await waitFor(() => expect(screen.getByText(/Could not load uploads \(server unreachable\)/)).toBeInTheDocument());
    console.error.mockRestore();
  });

  test("no route param → no requests", () => {
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>,
    );
    expect(API.get).not.toHaveBeenCalled();
    expect(screen.getAllByText("Pick date")).toHaveLength(2);
  });

  test("shows LOADING while uploads are fetched", async () => {
    let resolve;
    API.get.mockImplementation((url) =>
      url === "projects/" ? new Promise(() => {}) : new Promise((r) => (resolve = r)),
    );
    renderPage();
    expect(screen.getByText("LOADING…")).toBeInTheDocument();
    await act(async () => resolve({ data: [] }));
  });
});

describe("AnalyticsPage — role and panels", () => {
  test.each(["superadmin", "admin", "project_manager", "project_engineer", "data_contributor", "site_engineer", "viewer"])(
    "passes the %s role from localStorage to the toolbar and context panel",
    async (role) => {
      localStorage.setItem("role", role);
      mockApi({ bim: [], pc: [] });
      renderPage();
      expect(screen.getByTestId("toolbar")).toHaveAttribute("data-role", role);
      await userEvent.click(screen.getByText("open models"));
      expect(screen.getByTestId("context-panel")).toHaveAttribute("data-role", role);
      await screen.findByText("Tower");
    },
  );

  test("defaults to viewer when no role is stored", async () => {
    mockApi({ bim: [], pc: [] });
    renderPage();
    expect(screen.getByTestId("toolbar")).toHaveAttribute("data-role", "viewer");
    await screen.findByText("Tower");
  });

  test("selecting the same panel twice toggles it; close button closes it", async () => {
    mockApi({ bim: [], pc: [] });
    renderPage();
    await userEvent.click(screen.getByText("open models"));
    expect(screen.getByTestId("context-panel")).toHaveAttribute("data-panel", "models");
    await userEvent.click(screen.getByText("open models"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("open models"));
    await userEvent.click(screen.getByText("close panel"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    await screen.findByText("Tower");
  });
});

describe("AnalyticsPage — compare scene", () => {
  test("auto-picks A = second-latest date and B = latest, and loads both", async () => {
    mockApi();
    renderPage();
    await settled();
    expect(screen.getByText("A · 2026-01-01")).toBeInTheDocument();
    expect(screen.getByText("B · 2026-02-01")).toBeInTheDocument();
    // Side B has 2 models → "All models" option selected
    expect(screen.getByDisplayValue("All models (2)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("BIM · Arch")).toBeInTheDocument();
    expect(parseIfc).toHaveBeenCalledTimes(2);
    expect(PLYLoader).toHaveBeenCalledTimes(1);
  });

  test("initialDate selects Side A", async () => {
    mockApi();
    renderPage({ initialDate: "2026-02-01" });
    await settled();
    expect(screen.getByText("A · 2026-02-01")).toBeInTheDocument();
    expect(screen.getByText("B · 2026-01-01")).toBeInTheDocument();
  });

  test("models that don't overlap are auto-centred onto the other side", async () => {
    mockApi();
    let n = 0;
    parseIfc.mockImplementation(async () => box(1, [n++ * 100, 0, 0]));
    PLYLoader.mockImplementation(function () {
      this.parse = () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([100, 0, 0, 101, 1, 1]), 3));
        return g;
      };
    });
    renderPage();
    await settled();
    expect(screen.getByText(/Not aligned with other side — auto-centred/)).toBeInTheDocument();
    // Reset clears the notice
    const resets = screen.getAllByRole("button", { name: "Reset" });
    await userEvent.click(resets[1]);
    expect(screen.queryByText(/auto-centred/)).not.toBeInTheDocument();
  });

  test("picking a single model reloads that side", async () => {
    mockApi();
    renderPage();
    await settled();
    parseIfc.mockClear();
    await userEvent.selectOptions(screen.getByDisplayValue("All models (2)"), "pc:0");
    await waitFor(() => expect(screen.getByDisplayValue("Point Cloud · Scan")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryAllByText("LOADING…")).toHaveLength(0));
    expect(parseIfc).not.toHaveBeenCalled();
  });

  test("a failed load shows the reason; partial failure shows a count", async () => {
    mockApi();
    jest.spyOn(console, "error").mockImplementation(() => {});
    parseIfc.mockRejectedValue(new Error("bad ifc"));
    renderPage();
    await settled();
    expect(screen.getByText("⚠ Could not load — bad ifc")).toBeInTheDocument();
    expect(screen.getByText("⚠ 1 of 2 failed — bad ifc")).toBeInTheDocument();
    console.error.mockRestore();
  });

  test("calendar picks a new date for a side", async () => {
    mockApi();
    renderPage();
    await settled();
    await userEvent.click(screen.getByRole("button", { name: "2026-01-01" }));
    // opens on the month of the latest upload
    expect(screen.getByText("February 2026")).toBeInTheDocument();
    await userEvent.click(screen.getByText("1").parentElement);
    await waitFor(() => expect(screen.queryByText("February 2026")).not.toBeInTheDocument());
    expect(screen.getByText("A · 2026-02-01")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText("LOADING…")).toHaveLength(0));
  });

  test("calendar toggles open/closed from its button", async () => {
    mockApi();
    renderPage();
    await settled();
    const btn = screen.getByRole("button", { name: "2026-02-01" });
    await userEvent.click(btn);
    expect(screen.getByText("February 2026")).toBeInTheDocument();
    await userEvent.click(screen.getByText("2").parentElement); // no uploads on Feb 2 → stays open
    expect(screen.getByText("February 2026")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("February 2026")).not.toBeInTheDocument();
  });

  test("clip toggles and align panel", async () => {
    mockApi();
    renderPage();
    await settled();
    expect(screen.getByRole("button", { name: "Vert clip: On" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Horiz clip: Off" }));
    expect(screen.getByRole("button", { name: "Horiz clip: On" })).toBeInTheDocument();
    expect(screen.getByText(/· horizontal 50%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Vert clip: On" }));
    expect(screen.getByRole("button", { name: "Vert clip: Off" })).toBeInTheDocument();

    expect(screen.getByText("Manual Alignment")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide align" }));
    expect(screen.queryByText("Manual Alignment")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Align" }));
    expect(screen.getByText("Manual Alignment")).toBeInTheDocument();
  });

  test("align sliders update the readouts; Reset restores defaults", async () => {
    mockApi();
    renderPage();
    await settled();
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(16);
    fireEvent.change(sliders[0], { target: { value: "45" } }); // A rot X
    expect(screen.getByText("45°")).toBeInTheDocument();
    fireEvent.change(sliders[3], { target: { value: "2.5" } }); // A L/R
    expect(screen.getByText("3 m")).toBeInTheDocument();
    fireEvent.change(sliders[6], { target: { value: "0.4" } }); // A opacity
    expect(screen.getByText("40%")).toBeInTheDocument();
    fireEvent.change(sliders[7], { target: { value: "1.5" } }); // A scale
    expect(screen.getByText("1.50×")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Reset" })[0]);
    expect(screen.queryByText("45°")).not.toBeInTheDocument();
    expect(screen.queryByText("1.50×")).not.toBeInTheDocument();
  });

  test("dragging the vertical handle to the edge ghosts side A over B", async () => {
    mockApi();
    renderPage();
    await settled();
    const readout = screen.getByText(/Drag a handle to move the 3D clip plane/);
    const viewport = screen.getByText("A · 2026-01-01").parentElement;
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
    const handles = Array.from(viewport.children).filter((c) => c.onmousedown !== undefined && c.style.cursor);
    // The vertical handle is the element with the ew-resize/col-resize cursor
    const vHandle = Array.from(viewport.querySelectorAll("div")).find((d) => /resize/.test(d.style.cursor));
    expect(vHandle || handles[0]).toBeTruthy();
    fireEvent.mouseDown(vHandle);
    fireEvent.mouseMove(window, { clientX: 50 });
    expect(readout).toHaveTextContent("vertical 25% / 75%");
    fireEvent.mouseMove(window, { clientX: 0 });
    expect(await screen.findByText(/OVERLAY · A \(2026-01-01\) ghosted over B/)).toBeInTheDocument();
    fireEvent.mouseMove(window, { clientX: 100 });
    await waitFor(() => expect(screen.queryByText(/OVERLAY ·/)).not.toBeInTheDocument());
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 10 });
    expect(readout).toHaveTextContent("vertical 50% / 50%");
  });

  test("dragging the horizontal handle", async () => {
    mockApi();
    renderPage();
    await settled();
    await userEvent.click(screen.getByRole("button", { name: "Horiz clip: Off" }));
    const viewport = screen.getByText("A · 2026-01-01").parentElement;
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
    const hHandle = Array.from(viewport.querySelectorAll("div")).filter((d) => /resize/.test(d.style.cursor)).pop();
    fireEvent.mouseDown(hHandle);
    fireEvent.mouseMove(window, { clientY: 0 });
    expect(await screen.findByText(/OVERLAY · B \(2026-02-01\) ghosted over A/)).toBeInTheDocument();
    fireEvent.mouseUp(window);
  });

  test("unmount disposes the scene without throwing", async () => {
    mockApi();
    const { unmount } = renderPage();
    await settled();
    window.dispatchEvent(new Event("resize"));
    expect(() => unmount()).not.toThrow();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
