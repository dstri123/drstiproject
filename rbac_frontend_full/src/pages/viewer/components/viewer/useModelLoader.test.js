import { renderHook, act, waitFor } from "@testing-library/react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import { IFCLoader } from "web-ifc-three/IFCLoader";
import API from "../../../../api/axios";
import useModelLoader, {
  getSafeIfcType,
  categorizeElementName,
  categorizeIfcType,
} from "./useModelLoader";

jest.mock("three/examples/jsm/loaders/FBXLoader", () => ({ FBXLoader: jest.fn() }));
jest.mock("three/examples/jsm/loaders/PLYLoader", () => ({ PLYLoader: jest.fn() }));
jest.mock("three/examples/jsm/loaders/GLTFLoader", () => ({ GLTFLoader: jest.fn() }));
jest.mock("web-ifc-three/IFCLoader", () => ({ IFCLoader: jest.fn() }));
jest.mock("../../../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

// Per-test loader behaviour. The IFC loader is a module singleton inside
// useModelLoader, so it forwards to whatever mockIfcLoad currently is.
let mockFbxLoad;
let mockPlyLoad;
let mockIfcLoad;
const ifcSetWasmPath = jest.fn();

beforeEach(() => {
  mockFbxLoad = jest.fn();
  mockPlyLoad = jest.fn();
  mockIfcLoad = jest.fn();
  FBXLoader.mockImplementation(() => ({ load: (...a) => mockFbxLoad(...a) }));
  PLYLoader.mockImplementation(() => ({ load: (...a) => mockPlyLoad(...a) }));
  IFCLoader.mockImplementation(() => ({
    load: (...a) => mockIfcLoad(...a),
    ifcManager: { ifcAPI: { SetWasmPath: ifcSetWasmPath } },
  }));
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "debug").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
});

function makeSceneData() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  return {
    sceneRef: { current: new THREE.Scene() },
    cameraRef: { current: camera },
    controlsRef: {
      current: { target: new THREE.Vector3(), update: jest.fn(), enableZoom: false },
    },
    sceneReady: true,
  };
}

function renderLoader(props = {}, sceneData = makeSceneData()) {
  const callbacks = {
    setBimElementCount: jest.fn(),
    setBimCategories: jest.fn(),
    onError: jest.fn(),
  };
  const initial = { bimFile: null, pointFile: null, bimVisible: true, pcVisible: true, ...callbacks, ...props };
  const hook = renderHook((p) => useModelLoader(sceneData, p), { initialProps: initial });
  return { ...hook, sceneData, callbacks, initial };
}

const fbxFile = (name = "model.fbx") => new File(["x"], name);

function namedMesh(name, size = 2, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial(),
  );
  m.name = name;
  m.position.set(...pos);
  return m;
}

// A flat 10 x 10 grid of points on z = 0 (Y-extent > Z → treated as Z-up).
function planeCloudGeometry({ n = 10, color = true, offset = [100, 200, 0] } = {}) {
  const pos = [];
  const col = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      pos.push(offset[0] + i, offset[1] + j, offset[2]);
      col.push(0.5, 0.25, 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  if (color) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  return g;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
describe("getSafeIfcType", () => {
  test("returns null without a model or id", () => {
    expect(getSafeIfcType(null, 1)).toBeNull();
    expect(getSafeIfcType({}, null)).toBeNull();
    expect(getSafeIfcType({}, undefined)).toBeNull();
  });
  test("prefers the cached type map", () => {
    const model = {
      userData: { ifcTypeById: new Map([[5, "IFCWALL"]]) },
      getIfcType: jest.fn(() => "IFCSLAB"),
    };
    expect(getSafeIfcType(model, 5)).toBe("IFCWALL");
    expect(model.getIfcType).not.toHaveBeenCalled();
    expect(getSafeIfcType(model, 6)).toBe("IFCSLAB");
  });
  test("returns null when the library throws or is missing", () => {
    expect(getSafeIfcType({ userData: {} }, 1)).toBeNull();
    const broken = {
      getIfcType: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'types')");
      },
    };
    expect(getSafeIfcType(broken, 1)).toBeNull();
    expect(getSafeIfcType({ getIfcType: () => "" }, 1)).toBeNull();
  });
});

describe("categorizeElementName / categorizeIfcType", () => {
  test.each([
    ["Basic_Wall_Interior", "Walls"],
    ["Floor:Generic 150mm", "Floors / Slabs"],
    ["Columns_Rectangular_1", "Columns"],
    ["Structural Framing beam", "Beams / Framing"],
    ["Window_Fixed", "Windows"],
    ["Single-Flush Door", "Doors"],
    ["Basic Roof", "Roofs"],
    ["Compound Ceiling", "Ceilings"],
    ["Handrail - Pipe", "Stairs / Railings"],
    ["Footing-Rectangular", "Foundations"],
    ["Duct run", "MEP (Pipes/Ducts)"],
    ["Furniture_Desk", "Furniture"],
    ["Mystery thing", "Other"],
    ["", "Other"],
    [undefined, "Other"],
  ])("%s → %s", (name, cat) => {
    expect(categorizeElementName(name)).toBe(cat);
  });

  test("maps IFC types, case-insensitively, falling back to keywords", () => {
    expect(categorizeIfcType("IfcWallStandardCase")).toBe("Walls");
    expect(categorizeIfcType("IFCCOVERING")).toBe("Floors / Slabs");
    expect(categorizeIfcType("IFCPILE")).toBe("Foundations");
    expect(categorizeIfcType("IFCDUCTSEGMENT")).toBe("MEP (Pipes/Ducts)");
    expect(categorizeIfcType("IFCBUILDINGELEMENTPROXY")).toBe("Other");
    expect(categorizeIfcType(null)).toBe("Other");
  });
});

// ─── BIM loading ──────────────────────────────────────────────────────────────
describe("useModelLoader – BIM", () => {
  test("rejects unsupported BIM formats", () => {
    const { callbacks } = renderLoader({ bimFile: fbxFile("model.obj") });
    expect(callbacks.onError).toHaveBeenCalledWith(
      "Only FBX and IFC formats are supported for BIM",
    );
    expect(mockFbxLoad).not.toHaveBeenCalled();
  });

  test("loads an FBX file, builds categories, centres it and frames the camera", async () => {
    const group = new THREE.Group();
    group.add(namedMesh("Basic_Wall_1", 2, [10, 0, 0]), namedMesh("Door_2", 2, [14, 0, 0]));
    const bare = new THREE.Group();
    bare.name = "Window_7";
    bare.add(namedMesh(""));
    group.add(bare);
    mockFbxLoad.mockImplementation((url, onLoad) => onLoad(group));

    const { result, sceneData, callbacks } = renderLoader({ bimFile: fbxFile() });

    await waitFor(() => expect(result.current.bimModel).toBe(group));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockFbxLoad.mock.calls[0][0]).toBe("blob:mock");
    expect(callbacks.setBimElementCount).toHaveBeenLastCalledWith(3);
    expect(callbacks.setBimCategories).toHaveBeenLastCalledWith({
      Walls: ["Basic_Wall_1"],
      Doors: ["Door_2"],
      Windows: ["Window_7"],
    });
    expect(sceneData.sceneRef.current.children).toContain(group);
    // centred at the origin
    const c = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    expect(c.length()).toBeCloseTo(0, 5);
    // every mesh got the grey material + edge overlay
    group.traverse((o) => {
      if (o.isMesh) {
        expect(o.material).toBeInstanceOf(THREE.MeshStandardMaterial);
        expect(o.children.some((ch) => ch.name === "__bim_edges")).toBe(true);
      }
    });
    expect(sceneData.controlsRef.current.update).toHaveBeenCalled();
    expect(sceneData.controlsRef.current.enableZoom).toBe(true);
    expect(result.current.isLoadingBim).toBe(false);
  });

  test("passes remote FBX sources straight to the loader and honours a saved transform", async () => {
    const group = new THREE.Group();
    group.add(namedMesh("Slab"));
    mockFbxLoad.mockImplementation((url, onLoad) => onLoad(group));
    const transform = { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] };

    const { result } = renderLoader({
      bimFile: { url: "http://host/media/model.fbx", name: "model.fbx", transform },
    });

    await waitFor(() => expect(result.current.bimModel).toBe(group));
    expect(mockFbxLoad.mock.calls[0][0]).toBe("http://host/media/model.fbx");
    expect(API.get).not.toHaveBeenCalled();
    expect(group.position.toArray()).toEqual([1, 2, 3]);
    expect(group.scale.toArray()).toEqual([2, 2, 2]);
  });

  test("reports an FBX parse error", async () => {
    mockFbxLoad.mockImplementation((url, onLoad, onProgress, onErr) => onErr(new Error("bad")));
    const { result, callbacks } = renderLoader({ bimFile: fbxFile() });
    await waitFor(() =>
      expect(callbacks.onError).toHaveBeenCalledWith(
        "Failed to load BIM file. It may be corrupted or in an unsupported format.",
      ),
    );
    expect(result.current.error).toMatch(/Failed to load BIM file/);
    expect(result.current.bimModel).toBeNull();
    expect(result.current.isLoadingBim).toBe(false);
  });

  test("parses IFC in the browser and categorises elements by IFC type", async () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9 * 3).map((_, i) => i % 7), 3));
    geometry.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array([1, 1, 1, 2, 2, 2, 3, 3, 3]), 1));
    geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const ifcModel = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial()]);
    const types = { 1: "IFCWALL", 2: "IFCSLAB" };
    ifcModel.getIfcType = jest.fn((id) => {
      if (id === 3) throw new Error("registry lost");
      return types[id];
    });
    mockIfcLoad.mockImplementation((url, onLoad) => onLoad(ifcModel));

    const { result, callbacks } = renderLoader({ bimFile: new File(["x"], "site.IFC") });

    await waitFor(() => expect(result.current.bimModel).toBe(ifcModel));
    expect(ifcSetWasmPath).toHaveBeenCalledWith("/wasm/", true);
    expect(callbacks.setBimElementCount).toHaveBeenLastCalledWith(3);
    expect(callbacks.setBimCategories).toHaveBeenLastCalledWith({
      Walls: ["IFCWALL #1"],
      "Floors / Slabs": ["IFCSLAB #2"],
      Other: ["IFC #3"],
    });
    expect(ifcModel.userData.ifcTypeById.get(1)).toBe("IFCWALL");
    expect(Array.isArray(ifcModel.material)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  test("reports an IFC parse failure, but stays quiet on network errors", async () => {
    mockIfcLoad.mockImplementation((url, onLoad, onProgress, onErr) => onErr("boom"));
    const first = renderLoader({ bimFile: new File(["x"], "a.ifc") });
    await waitFor(() =>
      expect(first.callbacks.onError).toHaveBeenCalledWith(
        "Failed to parse IFC file in the browser.",
      ),
    );
    first.unmount();

    mockIfcLoad.mockImplementation((url, onLoad, onProgress, onErr) =>
      onErr(new TypeError("Failed to fetch")),
    );
    const second = renderLoader({ bimFile: new File(["x"], "b.ifc") });
    await waitFor(() => expect(second.result.current.error).toBe("Failed to fetch"));
    // NOTE: network failures only land in `error`, which ThreeViewer never
    // renders — the user gets no message (see report).
    expect(second.callbacks.onError).not.toHaveBeenCalled();
  });

  test("removes the BIM when the file is cleared", async () => {
    const group = new THREE.Group();
    group.add(namedMesh("Wall"));
    mockFbxLoad.mockImplementation((url, onLoad) => onLoad(group));
    const { result, rerender, sceneData, callbacks, initial } = renderLoader({ bimFile: fbxFile() });
    await waitFor(() => expect(result.current.bimModel).toBe(group));

    rerender({ ...initial, bimFile: null });
    await waitFor(() => expect(result.current.bimModel).toBeNull());
    expect(sceneData.sceneRef.current.children).not.toContain(group);
    expect(callbacks.setBimElementCount).toHaveBeenLastCalledWith(0);
    expect(callbacks.setBimCategories).toHaveBeenLastCalledWith({});
  });

  test("bimVisible toggles the model's visibility", async () => {
    const group = new THREE.Group();
    group.add(namedMesh("Wall"));
    mockFbxLoad.mockImplementation((url, onLoad) => onLoad(group));
    const { result, rerender, initial } = renderLoader({ bimFile: fbxFile() });
    await waitFor(() => expect(result.current.bimModel).toBe(group));
    rerender({ ...initial, bimVisible: false });
    expect(group.visible).toBe(false);
    rerender({ ...initial, bimVisible: true });
    expect(group.visible).toBe(true);
  });

  test("does nothing until the scene is ready", () => {
    const sceneData = { ...makeSceneData(), sceneReady: false };
    renderLoader({ bimFile: fbxFile() }, sceneData);
    expect(mockFbxLoad).not.toHaveBeenCalled();
  });
});

// ─── Point cloud loading ─────────────────────────────────────────────────────
describe("useModelLoader – point cloud", () => {
  test("rejects unsupported point cloud formats", () => {
    const { callbacks } = renderLoader({ pointFile: new File(["x"], "scan.obj") });
    expect(callbacks.onError).toHaveBeenCalledWith(
      'Unsupported point cloud format ".obj". Supported: PLY, LAS, LAZ, PLZ, E57, PTS, XYZ.',
    );
  });

  test("loads a PLY: quantises colours to Uint8 and positions to Float16, recentred and uprighted", async () => {
    const geometry = planeCloudGeometry();
    mockPlyLoad.mockImplementation((url, onLoad) => onLoad(geometry));
    const { result, sceneData } = renderLoader({ pointFile: new File(["x"], "scan.ply") });

    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    const pts = result.current.pcModel;
    expect(pts).toBeInstanceOf(THREE.Points);
    expect(pts.frustumCulled).toBe(false);
    expect(sceneData.sceneRef.current.children).toContain(pts);
    expect(pts.geometry.attributes.color.array).toBeInstanceOf(Uint8Array);
    expect(pts.geometry.attributes.color.array[0]).toBe(128);
    expect(pts.geometry.attributes.position).toBeInstanceOf(THREE.Float16BufferAttribute);
    // Z-up heuristic rotated it upright
    expect(pts.rotation.x).toBeCloseTo(-Math.PI / 2);
    // world centre at the origin
    const c = new THREE.Box3().setFromObject(pts).getCenter(new THREE.Vector3());
    expect(c.length()).toBeCloseTo(0, 2);
    // raw (file) coordinates → world matrix kept for camera alignment
    const raw = new THREE.Vector3(104.5, 204.5, 0).applyMatrix4(pts.userData.rawToWorld);
    expect(raw.length()).toBeCloseTo(0, 2);
    expect(pts.material.size).toBeGreaterThan(0.01);
    expect(result.current.wasCompressed).toBe(false);
    expect(result.current.isLoadingPc).toBe(false);
  });

  test("adds white colours when the PLY has none and keeps Float32 when a transform is saved", async () => {
    const geometry = planeCloudGeometry({ color: false });
    mockPlyLoad.mockImplementation((url, onLoad) => onLoad(geometry));
    const transform = { position: [5, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
    const { result } = renderLoader({
      pointFile: { url: "http://h/scan.ply", name: "scan.ply", transform },
    });
    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    const g = result.current.pcModel.geometry;
    expect(g.attributes.color.array[0]).toBe(255);
    expect(g.attributes.position.array).toBeInstanceOf(Float32Array);
    expect(result.current.pcModel.position.toArray()).toEqual([5, 0, 0]);
    expect(mockPlyLoad.mock.calls[0][0]).toBe("http://h/scan.ply");
  });

  test("subsamples clouds over 700 MB to ~70% of the points", async () => {
    const geometry = planeCloudGeometry(); // 100 points
    mockPlyLoad.mockImplementation((url, onLoad) => onLoad(geometry));
    const big = { url: "http://h/big.ply", name: "big.ply", size: 800 * 1024 * 1024 };
    const { result } = renderLoader({ pointFile: big });
    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    expect(result.current.wasCompressed).toBe(true);
    expect(result.current.pcModel.geometry.attributes.position.count).toBe(70);
  });

  test("subsamples remote clouds with no size field using the download size", async () => {
    const geometry = planeCloudGeometry();
    mockPlyLoad.mockImplementation((url, onLoad, onProgress) => {
      onProgress({ loaded: 10, total: 900 * 1024 * 1024 });
      onLoad(geometry);
    });
    const { result } = renderLoader({ pointFile: { url: "http://h/s.ply", name: "s.ply" } });
    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    expect(result.current.wasCompressed).toBe(true);
    expect(result.current.pcModel.geometry.attributes.position.count).toBe(70);
  });

  test("reports a PLY parse error", async () => {
    mockPlyLoad.mockImplementation((url, onLoad, onProgress, onErr) => onErr(new Error("x")));
    const { result, callbacks } = renderLoader({ pointFile: new File(["x"], "scan.ply") });
    await waitFor(() =>
      expect(callbacks.onError).toHaveBeenCalledWith(
        "Failed to load point cloud file. It may be corrupted or in an unsupported PLY format.",
      ),
    );
    expect(result.current.pcModel).toBeNull();
    expect(result.current.isLoadingPc).toBe(false);
  });

  test("converts non-PLY formats through the backend", async () => {
    const plyBlob = new Blob(["ply"]);
    API.post.mockResolvedValue({ data: plyBlob });
    mockPlyLoad.mockImplementation((url, onLoad) => onLoad(planeCloudGeometry()));
    const las = new File(["las"], "scan.las");
    const { result } = renderLoader({ pointFile: las });

    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    const [endpoint, form, config] = API.post.mock.calls[0];
    expect(endpoint).toBe("processing/tools/pointcloud-to-ply/");
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("file").name).toBe("scan.las");
    expect(config).toEqual({
      headers: { "Content-Type": "multipart/form-data" },
      responseType: "blob",
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(plyBlob);
  });

  test("surfaces the server's JSON error when conversion fails", async () => {
    API.post.mockRejectedValue({
      message: "Request failed with status code 400",
      response: { data: { text: () => Promise.resolve('{"error":"Unsupported LAS version"}') } },
    });
    const { result, callbacks } = renderLoader({ pointFile: new File(["x"], "scan.e57") });
    await waitFor(() => expect(callbacks.onError).toHaveBeenCalledWith("Unsupported LAS version"));
    expect(result.current.error).toBe("Unsupported LAS version");
    expect(mockPlyLoad).not.toHaveBeenCalled();
  });

  test("downloads remote non-PLY clouds with retry before converting", async () => {
    jest.useFakeTimers();
    API.get
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ data: new Blob(["las"]) });
    API.post.mockResolvedValue({ data: new Blob(["ply"]) });
    mockPlyLoad.mockImplementation((url, onLoad) => onLoad(planeCloudGeometry()));

    const { result } = renderLoader({ pointFile: { url: "http://h/scan.laz", name: "scan.laz" } });
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    expect(API.get).toHaveBeenCalledTimes(2);
    expect(API.get).toHaveBeenCalledWith("http://h/scan.laz", { responseType: "blob" });
  });

  test("gives up after 6 attempts with a network-error message (no toast)", async () => {
    jest.useFakeTimers();
    API.get.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, callbacks } = renderLoader({ pointFile: { url: "http://h/s.xyz", name: "s.xyz" } });
    for (let i = 0; i < 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await Promise.resolve();
        jest.advanceTimersByTime(6000);
      });
    }
    await waitFor(() =>
      expect(result.current.error).toBe("Network error while loading remote asset. Please try again."),
    );
    expect(API.get).toHaveBeenCalledTimes(6);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(result.current.isLoadingPc).toBe(false);
  });

  test("swapping to another cloud removes the previous one", async () => {
    const g1 = planeCloudGeometry();
    const g2 = planeCloudGeometry({ offset: [0, 0, 0] });
    mockPlyLoad.mockImplementationOnce((u, onLoad) => onLoad(g1)).mockImplementationOnce((u, onLoad) => onLoad(g2));
    const { result, rerender, sceneData, initial } = renderLoader({ pointFile: new File(["1"], "a.ply") });
    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    const first = result.current.pcModel;

    rerender({ ...initial, pointFile: new File(["2"], "b.ply") });
    await waitFor(() => expect(result.current.pcModel).not.toBe(first));
    await waitFor(() => expect(result.current.pcModel).toBeTruthy());
    const pts = sceneData.sceneRef.current.children.filter((c) => c.isPoints);
    expect(pts).toHaveLength(1);

    rerender({ ...initial, pointFile: null });
    await waitFor(() => expect(result.current.pcModel).toBeNull());
    expect(sceneData.sceneRef.current.children.filter((c) => c.isPoints)).toHaveLength(0);
  });
});

// ─── Model utilities ──────────────────────────────────────────────────────────
describe("useModelLoader – utilities", () => {
  async function loadBoth({ bimSize = 1000 } = {}) {
    const group = new THREE.Group();
    // thin box: Z extent small → no upright rotation
    const m = new THREE.Mesh(new THREE.BoxGeometry(bimSize, bimSize / 10, bimSize / 2), new THREE.MeshBasicMaterial());
    m.name = "Wall";
    group.add(m);
    mockFbxLoad.mockImplementation((url, onLoad) => onLoad(group));
    mockPlyLoad.mockImplementation((url, onLoad) => onLoad(planeCloudGeometry()));
    const hook = renderLoader({ bimFile: fbxFile(), pointFile: new File(["p"], "s.ply") });
    await waitFor(() => expect(hook.result.current.bimModel).toBeTruthy());
    await waitFor(() => expect(hook.result.current.pcModel).toBeTruthy());
    return hook;
  }

  test("rescales a millimetre BIM to the point cloud's size", async () => {
    const { result } = await loadBoth({ bimSize: 9000 });
    const bim = result.current.bimModel;
    const pcSize = new THREE.Box3().setFromObject(result.current.pcModel).getSize(new THREE.Vector3());
    const bimSize = new THREE.Box3().setFromObject(bim).getSize(new THREE.Vector3());
    expect(Math.max(bimSize.x, bimSize.y, bimSize.z)).toBeCloseTo(Math.max(pcSize.x, pcSize.y, pcSize.z), 2);
    const c = new THREE.Box3().setFromObject(bim).getCenter(new THREE.Vector3());
    expect(c.length()).toBeCloseTo(0, 3);
  });

  test("resetTransform restores the auto-placed transform", async () => {
    const { result } = await loadBoth();
    const pc = result.current.pcModel;
    const before = pc.position.clone();
    pc.position.set(50, 50, 50);
    pc.rotation.set(0, 1, 0);
    act(() => result.current.resetTransform(pc));
    expect(pc.position.distanceTo(before)).toBeCloseTo(0);
    act(() => result.current.resetTransform(new THREE.Object3D())); // unknown → no-op
    act(() => result.current.resetTransform(null));
  });

  test("setModelScale scales relative to the initial size about the model centre", async () => {
    const { result } = await loadBoth();
    const pc = result.current.pcModel;
    const initialScale = pc.scale.x;
    const centre = new THREE.Box3().setFromObject(pc).getCenter(new THREE.Vector3());
    act(() => result.current.setModelScale(pc, 2));
    expect(pc.scale.x).toBeCloseTo(initialScale * 2);
    const after = new THREE.Box3().setFromObject(pc).getCenter(new THREE.Vector3());
    expect(after.distanceTo(centre)).toBeCloseTo(0, 3);
    act(() => result.current.setModelScale(pc, 0)); // invalid → 1
    expect(pc.scale.x).toBeCloseTo(initialScale);
    act(() => result.current.setModelScale(pc, 0.001)); // clamped to 0.05
    expect(pc.scale.x).toBeCloseTo(initialScale * 0.05);
  });

  test("setModelOpacity updates every material", async () => {
    const { result } = await loadBoth();
    const { pcModel, bimModel } = result.current;
    act(() => result.current.setModelOpacity(pcModel, 0.4));
    expect(pcModel.material.opacity).toBe(0.4);
    expect(pcModel.material.transparent).toBe(true);
    expect(pcModel.material.depthWrite).toBe(false);
    act(() => result.current.setModelOpacity(bimModel, 7));
    bimModel.traverse((o) => {
      if (o.isMesh) {
        expect(o.material.opacity).toBe(1);
        expect(o.material.transparent).toBe(false);
      }
    });
  });

  test("fitAll frames both models", async () => {
    const { result, sceneData } = await loadBoth();
    sceneData.cameraRef.current.position.set(0, 0, 0);
    act(() => result.current.fitAll());
    expect(sceneData.cameraRef.current.position.length()).toBeGreaterThan(0);
    expect(sceneData.controlsRef.current.maxDistance).toBeGreaterThan(sceneData.controlsRef.current.minDistance);
  });

  test("toggleSegmentation paints RANSAC plane colours and restores the originals", async () => {
    const { result } = await loadBoth();
    const col = result.current.pcModel.geometry.attributes.color;
    const original = Array.from(col.array.slice(0, 3));

    act(() => result.current.toggleSegmentation());
    expect(result.current.isSegmented).toBe(true);
    // a single flat plane → first palette colour (green)
    expect(Array.from(col.array.slice(0, 3))).toEqual([51, 217, 102]);

    act(() => result.current.toggleSegmentation());
    expect(result.current.isSegmented).toBe(false);
    expect(Array.from(col.array.slice(0, 3))).toEqual(original);
  });
});
