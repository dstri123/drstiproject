import { renderHook, act, waitFor } from "@testing-library/react";
import * as THREE from "three";
import API from "../../../../api/axios";
import useAlignment, { describeAutoFit } from "./useAlignment";

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("../../../../components/ToastContainer", () => ({
  useToast: () => mockToast,
}));
jest.mock("../../../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  window.alert = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

function makeCloud(n = 200) {
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (i % 10) * 0.5;
    arr[i * 3 + 1] = Math.floor(i / 10) % 5;
    arr[i * 3 + 2] = Math.floor(i / 50);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  return new THREE.Points(g, new THREE.PointsMaterial());
}

function makeBim() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6), new THREE.MeshBasicMaterial()));
  return group;
}

// Known rigid transform used for the picked pairs: 90° about Y, scale 2, shift.
const TRUE_M = new THREE.Matrix4().compose(
  new THREE.Vector3(5, -1, 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  new THREE.Vector3(2, 2, 2),
);
const PC_PICKS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 2, 0),
  new THREE.Vector3(0, 0, 3),
];
const BIM_PICKS = PC_PICKS.map((p) => p.clone().applyMatrix4(TRUE_M));

const nested = (m) => {
  const e = m.elements;
  return [
    [e[0], e[4], e[8], e[12]],
    [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]],
    [e[3], e[7], e[11], e[15]],
  ];
};

function renderAlignment(props = {}, models = {}) {
  const modelData = {
    pcModel: "pcModel" in models ? models.pcModel : makeCloud(),
    bimModel: "bimModel" in models ? models.bimModel : makeBim(),
  };
  const cb = { onMatrixChange: jest.fn(), onAlignmentLocked: jest.fn() };
  const hook = renderHook((p) => useAlignment({}, modelData, p), {
    initialProps: { bimPoints: [], pcPoints: [], ...cb, ...props },
  });
  return { ...hook, modelData, cb };
}

const expectMappedOnto = (obj, src, dst) => {
  obj.updateMatrixWorld(true);
  src.forEach((p, i) => {
    const w = p.clone().applyMatrix4(obj.matrixWorld);
    expect(w.distanceTo(dst[i])).toBeLessThan(1e-4);
  });
};

describe("describeAutoFit", () => {
  test("formats building fit and error", () => {
    expect(describeAutoFit(null)).toBe("");
    expect(describeAutoFit({ fitness: 0.456 })).toBe("46% of cloud on BIM");
    expect(describeAutoFit({})).toBe("0% of cloud on BIM");
    expect(describeAutoFit({ building_fit: 0.84 })).toBe("84% of building on BIM");
    expect(describeAutoFit({ building_fit: 0.84, error: 0.172 })).toBe(
      "84% of building on BIM · error ≈ 17 cm",
    );
    expect(describeAutoFit({ building_fit: 0.5, error: 1.234 })).toBe(
      "50% of building on BIM · error ≈ 1.23 m",
    );
  });
});

describe("alignGeometry (Kabsch from picked pairs)", () => {
  test("maps the point cloud's picks onto the BIM picks", () => {
    const { result, modelData, cb } = renderAlignment({ bimPoints: BIM_PICKS, pcPoints: PC_PICKS });
    act(() => window.alignGeometry());
    expectMappedOnto(modelData.pcModel, PC_PICKS, BIM_PICKS);
    const M = cb.onMatrixChange.mock.calls[0][0];
    expect(M).toHaveLength(4);
    expect(M[3]).toEqual([0, 0, 0, 1]);
    expect(M[0][3]).toBeCloseTo(5);
    expect(cb.onAlignmentLocked).toHaveBeenCalledWith(expect.any(THREE.Vector3));
    expect(mockToast.success).toHaveBeenCalledWith("Geometry aligned from picked points.");
    expect(result.current.alignGeometry).toBe(window.alignGeometry);
  });

  test("needs a point cloud", () => {
    renderAlignment({ bimPoints: BIM_PICKS, pcPoints: PC_PICKS }, { pcModel: null });
    act(() => window.alignGeometry());
    expect(mockToast.info).toHaveBeenCalledWith("Load a point cloud before aligning.");
  });

  test("needs at least 3 picks on each model", () => {
    const { cb } = renderAlignment({ bimPoints: BIM_PICKS.slice(0, 2), pcPoints: PC_PICKS });
    act(() => window.alignGeometry());
    expect(mockToast.info).toHaveBeenCalledWith(
      "Pick at least 3 points on each model (BIM: 2, Point Cloud: 4).",
    );
    expect(cb.onMatrixChange).not.toHaveBeenCalled();
  });

  test("refuses unequal pick counts", () => {
    const { modelData } = renderAlignment({ bimPoints: BIM_PICKS.slice(0, 3), pcPoints: PC_PICKS });
    const before = modelData.pcModel.matrix.clone();
    act(() => window.alignGeometry());
    expect(mockToast.error.mock.calls[0][0]).toMatch(/Point counts must match: BIM has 3, Point Cloud has 4/);
    expect(modelData.pcModel.matrix.equals(before)).toBe(true);
  });

  test("reports (and does not apply) a degenerate pick set", () => {
    const same = [0, 1, 2].map(() => new THREE.Vector3(1, 1, 1));
    const { modelData } = renderAlignment({ bimPoints: BIM_PICKS.slice(0, 3), pcPoints: same });
    act(() => window.alignGeometry());
    expect(mockToast.error.mock.calls[0][0]).toMatch(/same location/);
    expect(modelData.pcModel.position.toArray().every(Number.isFinite)).toBe(true);
    expect(modelData.pcModel.matrix.equals(new THREE.Matrix4())).toBe(true);
  });
});

describe("uploaded alignment matrix", () => {
  test("is applied once when the point cloud is available", () => {
    const M = nested(TRUE_M);
    const { modelData, cb, rerender } = renderAlignment({ uploadedAlignmentMatrix: M });
    expectMappedOnto(modelData.pcModel, PC_PICKS, BIM_PICKS);
    expect(cb.onMatrixChange).toHaveBeenCalledWith(M);
    expect(mockToast.success).toHaveBeenCalledWith("Point cloud aligned using the uploaded matrix file.");

    // same matrix value (new array identity) → not re-applied
    rerender({ bimPoints: [], pcPoints: [], ...cb, uploadedAlignmentMatrix: JSON.parse(JSON.stringify(M)) });
    expectMappedOnto(modelData.pcModel, PC_PICKS, BIM_PICKS);
    expect(cb.onMatrixChange).toHaveBeenCalledTimes(1);
  });

  test("a corrected matrix replaces (does not stack on) the previous one", () => {
    const first = nested(new THREE.Matrix4().makeTranslation(100, 0, 0));
    const { modelData, cb, rerender } = renderAlignment({ uploadedAlignmentMatrix: first });
    expect(modelData.pcModel.position.x).toBeCloseTo(100);

    rerender({ bimPoints: [], pcPoints: [], ...cb, uploadedAlignmentMatrix: nested(TRUE_M) });
    expectMappedOnto(modelData.pcModel, PC_PICKS, BIM_PICKS);
  });

  test("waits for a point cloud", () => {
    const { cb } = renderAlignment({ uploadedAlignmentMatrix: nested(TRUE_M) }, { pcModel: null });
    expect(cb.onMatrixChange).not.toHaveBeenCalled();
  });
});

describe("window.applyUploadedMatrix (sidebar Import Matrix)", () => {
  test("applies a nested 4x4 row-major matrix to the point cloud", () => {
    const { modelData, cb } = renderAlignment();
    act(() => window.applyUploadedMatrix(nested(TRUE_M)));
    expectMappedOnto(modelData.pcModel, PC_PICKS, BIM_PICKS);
    expect(cb.onAlignmentLocked).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith("Matrix applied!");
  });

  test("composes onto the current pose (relative matrix, same as batch-uploaded matrix files)", () => {
    // Export of a no-picks matrix writes the ABSOLUTE matrixWorld, so
    // re-importing it onto a cloud that is already at that pose doubles it.
    // Documented as a design issue in the report (relative vs absolute).
    const { modelData } = renderAlignment();
    modelData.pcModel.position.set(7, 0, 0);
    modelData.pcModel.updateMatrixWorld(true);
    act(() => window.applyUploadedMatrix(nested(modelData.pcModel.matrixWorld.clone())));
    expect(modelData.pcModel.position.x).toBeCloseTo(14);
  });

  test("called with no argument (as the sidebar's Apply Matrix button does) it only alerts", () => {
    const { modelData } = renderAlignment();
    act(() => window.applyUploadedMatrix());
    expect(window.alert).toHaveBeenCalledWith("Missing model or matrix");
    expect(modelData.pcModel.matrix.equals(new THREE.Matrix4())).toBe(true);
  });
});

describe("generateMatrix / exportMatrix", () => {
  test("generates from picks when there are 3+ pairs", () => {
    const { cb, modelData } = renderAlignment({ bimPoints: BIM_PICKS, pcPoints: PC_PICKS });
    act(() => window.generateMatrix());
    expect(mockToast.success).toHaveBeenCalledWith("Matrix generated from picked points.");
    expect(cb.onMatrixChange.mock.calls[0][0][0][3]).toBeCloseTo(5);
    // generating does not move the cloud
    expect(modelData.pcModel.position.toArray()).toEqual([0, 0, 0]);
  });

  test("captures the cloud's current transform without picks", () => {
    const { cb, modelData } = renderAlignment();
    modelData.pcModel.position.set(7, 8, 9);
    act(() => window.generateMatrix());
    expect(cb.onMatrixChange.mock.calls[0][0][0][3]).toBe(7);
    expect(cb.onMatrixChange.mock.calls[0][0][2][3]).toBe(9);
    expect(mockToast.success).toHaveBeenCalledWith("Matrix generated from the current point-cloud position.");
  });

  test("generate needs a point cloud", () => {
    renderAlignment({}, { pcModel: null });
    act(() => window.generateMatrix());
    expect(mockToast.info).toHaveBeenCalledWith("Load a point cloud first to generate a matrix.");
  });

  test("export downloads alignment_matrix.json", () => {
    URL.createObjectURL = jest.fn(() => "blob:m");
    URL.revokeObjectURL = jest.fn();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { modelData } = renderAlignment();
    modelData.pcModel.position.set(1, 2, 3);
    act(() => window.exportMatrix());
    expect(clickSpy).toHaveBeenCalled();
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json");
    expect(mockToast.success).toHaveBeenCalledWith("Matrix exported as alignment_matrix.json.");
    clickSpy.mockRestore();
  });

  test("export without a cloud or matrix tells the user", () => {
    renderAlignment({}, { pcModel: null });
    act(() => window.exportMatrix());
    expect(mockToast.info).toHaveBeenCalledWith("Load a point cloud (or run an alignment) before exporting.");
  });
});

describe("ICP alignment", () => {
  test("posts both clouds (+ Kabsch seed) and applies the returned transform", async () => {
    const T = nested(new THREE.Matrix4().makeTranslation(0, 0, 4));
    API.post.mockResolvedValue({ data: { transform: T, fitness: 0.91, rmse: 0.0123 } });
    const { modelData, cb } = renderAlignment({ bimPoints: BIM_PICKS, pcPoints: PC_PICKS });

    await act(async () => window.alignGeometryICP());

    const [url, body] = API.post.mock.calls[0];
    expect(url).toBe("processing/align/icp/");
    expect(body.with_scale).toBe(false);
    expect(body.source).toHaveLength(200);
    expect(body.target.length).toBeGreaterThan(3);
    expect(body.init_transform[0][3]).toBeCloseTo(5);
    expect(modelData.pcModel.position.z).toBeCloseTo(4);
    expect(cb.onMatrixChange).toHaveBeenCalledWith(T);
    expect(mockToast.success).toHaveBeenCalledWith("ICP aligned — 91% overlap, RMSE 0.012.");
  });

  test("sends no seed for unusable picks instead of throwing", async () => {
    API.post.mockResolvedValue({ data: { transform: nested(new THREE.Matrix4()) } });
    renderAlignment({ bimPoints: BIM_PICKS.slice(0, 3), pcPoints: PC_PICKS });
    await act(async () => window.alignGeometryICP());
    expect(API.post.mock.calls[0][1].init_transform).toBeNull();
  });

  test("shows the server error", async () => {
    API.post.mockRejectedValue({ response: { data: { error: "ICP diverged" } } });
    renderAlignment();
    await act(async () => window.alignGeometryICP());
    expect(mockToast.error).toHaveBeenCalledWith("ICP diverged");
  });

  test("needs both models and enough geometry", async () => {
    renderAlignment({}, { bimModel: null });
    await act(async () => window.alignGeometryICP());
    expect(mockToast.info).toHaveBeenCalledWith("Load both a BIM model and a point cloud before ICP align.");

    renderAlignment({}, { bimModel: new THREE.Group() });
    await act(async () => window.alignGeometryICP());
    expect(mockToast.error).toHaveBeenCalledWith("Not enough geometry to run ICP.");
    expect(API.post).not.toHaveBeenCalled();
  });
});

describe("auto alignment", () => {
  const T0 = nested(new THREE.Matrix4().makeTranslation(1, 0, 0));
  const T1 = nested(new THREE.Matrix4().makeTranslation(0, 2, 0));
  const response = {
    data: {
      candidates: [
        { transform: T0, fitness: 0.8, building_fit: 0.9, error: 0.05 },
        { transform: T1, fitness: 0.4 },
      ],
      confidence: "high",
      ambiguous: false,
      building_fit: 0.9,
      error: 0.05,
    },
  };

  test("applies the best candidate, cycles results and undoes", async () => {
    API.post.mockResolvedValue(response);
    const states = [];
    const listener = (e) => states.push(e.detail);
    window.addEventListener("autoalign-state", listener);
    const { modelData, cb } = renderAlignment();

    await act(async () => window.autoAlign());

    const [url, body] = API.post.mock.calls[0];
    expect(url).toBe("processing/align/auto/");
    expect(body.init_transform).toBeNull();
    expect(body.source.length).toBe(200);
    expect(body.target.length).toBe(60000);
    // rounded to 4 decimals
    body.target.slice(0, 50).flat().forEach((v) => expect(Math.round(v * 1e4) / 1e4).toBe(v));
    expect(modelData.pcModel.position.toArray()).toEqual([1, 0, 0]);
    expect(cb.onMatrixChange).toHaveBeenLastCalledWith(T0);
    expect(mockToast.success).toHaveBeenCalledWith(
      "Auto aligned — 90% of building on BIM · error ≈ 5 cm (confidence: high).",
    );
    expect(states.at(-1)).toMatchObject({ busy: false, count: 2, index: 0, confidence: "high" });
    expect(window.autoAlignState).toEqual(states.at(-1));

    act(() => window.tryNextAutoAlign());
    expect(modelData.pcModel.position.toArray()).toEqual([0, 2, 0]); // from the original pose, not stacked
    expect(mockToast.info).toHaveBeenLastCalledWith("Result 2 of 2 — 40% of cloud on BIM.");

    act(() => window.undoAutoAlign());
    expect(modelData.pcModel.position.toArray()).toEqual([0, 0, 0]);
    expect(mockToast.info).toHaveBeenLastCalledWith("Auto alignment undone.");
    act(() => window.tryNextAutoAlign());
    expect(mockToast.info).toHaveBeenLastCalledWith("No other alignment results to try.");
    window.removeEventListener("autoalign-state", listener);
  });

  test("seeds from equal picks and reports low confidence as info", async () => {
    API.post.mockResolvedValue({ data: { ...response.data, confidence: "low" } });
    renderAlignment({ bimPoints: BIM_PICKS, pcPoints: PC_PICKS });
    await act(async () => window.autoAlign());
    expect(API.post.mock.calls[0][1].init_transform[0][3]).toBeCloseTo(5);
    expect(mockToast.info).toHaveBeenLastCalledWith(expect.stringMatching(/confidence: low\)\. Check it/));
  });

  test("ignores a second click while the request is running", async () => {
    let resolve;
    API.post.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAlignment();
    let first;
    act(() => {
      first = window.autoAlign();
    });
    await act(async () => window.autoAlign());
    expect(API.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(response);
      await first;
    });
  });

  test("reports HTTP and connection failures", async () => {
    API.post.mockRejectedValueOnce({ response: { status: 502, data: {} } });
    renderAlignment();
    await act(async () => window.autoAlign());
    expect(mockToast.error).toHaveBeenLastCalledWith("Auto alignment failed (HTTP 502).");

    API.post.mockRejectedValueOnce(new Error("Network Error"));
    await act(async () => window.autoAlign());
    expect(mockToast.error).toHaveBeenLastCalledWith(
      "Auto alignment failed — could not reach the backend. Is the Django server running?",
    );
  });

  test("needs both models and enough geometry", async () => {
    renderAlignment({}, { pcModel: null });
    await act(async () => window.autoAlign());
    expect(mockToast.info).toHaveBeenCalledWith("Load both a BIM model and a point cloud before Auto Align.");

    renderAlignment({}, { pcModel: makeCloud(10) });
    await act(async () => window.autoAlign());
    expect(mockToast.error).toHaveBeenCalledWith("Not enough geometry to auto-align.");
    expect(API.post).not.toHaveBeenCalled();
  });
});
