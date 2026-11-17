import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";
import usePicking from "./usePicking";
import { makeTestScene, clickAt, screenOf } from "./testScene";

// usePicking reuses the category helpers from useModelLoader, whose loader
// imports are ESM-only.
jest.mock("three/examples/jsm/loaders/FBXLoader", () => ({ FBXLoader: jest.fn() }));
jest.mock("three/examples/jsm/loaders/PLYLoader", () => ({ PLYLoader: jest.fn() }));
jest.mock("three/examples/jsm/loaders/GLTFLoader", () => ({ GLTFLoader: jest.fn() }));
jest.mock("web-ifc-three/IFCLoader", () => ({ IFCLoader: jest.fn() }));
jest.mock("../../../../api/axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

const CENTER = { clientX: 500, clientY: 500 };
const click = (target, coords) => act(() => {
  clickAt(target, coords);
});

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillText: jest.fn(),
  }));
  delete window.__overlapCountsByExpressID;
  delete window.__overlapCountsByUuid;
});

function boxMesh(name = "Basic_Wall_3") {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  m.name = name;
  return m;
}

function cloudAtOrigin() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0.5, 0.5, 1]), 3));
  return new THREE.Points(g, new THREE.PointsMaterial());
}

function setup({ bimModel = boxMesh(), pcModel = null } = {}) {
  const t = makeTestScene();
  if (bimModel) t.scene.add(bimModel);
  if (pcModel) t.scene.add(pcModel);
  t.scene.updateMatrixWorld(true);
  const props = { onBimPointsChange: jest.fn(), onPcPointsChange: jest.fn(), onElementSelect: jest.fn() };
  const hook = renderHook(() => usePicking(t.sceneData, { bimModel, pcModel }, props));
  return { ...t, ...props, hook, bimModel, pcModel };
}

describe("usePicking – element metadata (no picking mode)", () => {
  test("clicking an FBX element highlights it and reports its metadata", () => {
    const { canvas, bimModel, onElementSelect } = setup();
    const original = bimModel.material;
    window.__overlapCountsByUuid = new Map([[bimModel.uuid, 12]]);
    click(canvas, CENTER);
    expect(onElementSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Basic_Wall_3",
        type: "Mesh",
        expressID: null,
        category: "Walls",
        elementLabel: "Basic_Wall_3",
        position: [0, 0, 0],
        overlappingPoints: 12,
      }),
    );
    expect(bimModel.material.color.getHex()).toBe(0xff0000);
    // next click restores the original material
    click(canvas, { clientX: 1, clientY: 1 });
    expect(bimModel.material).toBe(original);
  });

  test("IFC elements are isolated by expressID (fallback when createSubset fails)", () => {
    const g = new THREE.BoxGeometry(2, 2, 2);
    g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array(g.attributes.position.count).fill(5), 1));
    const ifc = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    ifc.getIfcType = () => "IFCWALL";
    ifc.createSubset = () => {
      throw new Error("registry out of sync");
    };
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const { canvas, onElementSelect } = setup({ bimModel: ifc });
    window.__overlapCountsByExpressID = new Map([[5, 33]]);
    click(canvas, CENTER);
    expect(onElementSelect).toHaveBeenCalledWith(
      expect.objectContaining({ expressID: 5, type: "IFCWALL", category: "Walls", elementLabel: "IFCWALL #5", overlappingPoints: 33 }),
    );
    const highlight = ifc.children.find((c) => c.userData.isIfcSelectionSubset);
    expect(highlight).toBeTruthy();
    expect(highlight.geometry.index.count).toBe(g.index.count);

    // the next click clears the previous highlight
    click(canvas, { clientX: 1, clientY: 1 });
    expect(ifc.children.find((c) => c.userData.isIfcSelectionSubset)).toBeUndefined();
  });

  test("uses web-ifc-three subsets when available", () => {
    const g = new THREE.BoxGeometry(2, 2, 2);
    g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array(g.attributes.position.count).fill(9), 1));
    const ifc = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const subset = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    ifc.createSubset = jest.fn(() => subset);
    ifc.removeSubset = jest.fn();
    const { canvas } = setup({ bimModel: ifc });
    click(canvas, CENTER);
    expect(ifc.createSubset).toHaveBeenCalledWith(expect.objectContaining({ ids: [9], customID: "selectedIfcElement" }));
    expect(subset.userData).toEqual({ isIfcSelectionSubset: true, expressID: 9 });
    click(canvas, CENTER);
    expect(ifc.removeSubset).toHaveBeenCalled();
  });
});

describe("usePicking – alignment point picking", () => {
  test("BIM picking adds numbered markers and reports points; clicking a marker removes it", () => {
    const { canvas, scene, hook, onBimPointsChange, camera } = setup();
    act(() => window.setPickingMode("bim"));
    expect(window.__pickingMode).toBe("bim");
    expect(canvas.style.cursor).toBe("crosshair");

    click(canvas, CENTER);
    expect(hook.result.current.bimPoints).toHaveLength(1);
    expect(hook.result.current.bimPoints[0].z).toBeCloseTo(1); // front face of the box
    expect(onBimPointsChange).toHaveBeenLastCalledWith(hook.result.current.bimPoints);
    const sprites = scene.children.filter((c) => c.userData.isPickingMarker);
    expect(sprites).toHaveLength(1);
    expect(sprites[0].userData).toMatchObject({ type: "bim", pointIndex: 0 });

    const at = screenOf(camera, new THREE.Vector3(0.5, 0.5, 1));
    click(canvas, at);
    expect(hook.result.current.bimPoints).toHaveLength(2);
    expect(scene.children.filter((c) => c.userData.isPickingMarker)[1].userData.pointIndex).toBe(1);

    // click the first marker again → removed, the other renumbered to #1
    scene.updateMatrixWorld(true);
    click(canvas, CENTER);
    expect(hook.result.current.bimPoints).toHaveLength(1);
    const left = scene.children.filter((c) => c.userData.isPickingMarker);
    expect(left).toHaveLength(1);
    expect(left[0].userData.pointIndex).toBe(0);
  });

  test("point-cloud picking uses the cloud", () => {
    const { canvas, hook, onPcPointsChange } = setup({ bimModel: null, pcModel: cloudAtOrigin() });
    act(() => window.setPickingMode("pc"));
    click(canvas, CENTER);
    expect(hook.result.current.pcPoints).toHaveLength(1);
    expect(onPcPointsChange).toHaveBeenCalledTimes(1);
  });

  test("the viewer role cannot pick points", () => {
    localStorage.setItem("role", "viewer");
    const { canvas, hook, scene, onBimPointsChange } = setup();
    act(() => window.setPickingMode("bim"));
    click(canvas, CENTER);
    expect(hook.result.current.bimPoints).toHaveLength(0);
    expect(onBimPointsChange).not.toHaveBeenCalled();
    expect(scene.children.some((c) => c.userData.isPickingMarker)).toBe(false);
  });

  test("window.clearMarkers removes every marker and resets both point lists", () => {
    const { canvas, scene, hook, onBimPointsChange, onPcPointsChange } = setup();
    act(() => window.setPickingMode("bim"));
    click(canvas, CENTER);
    act(() => window.clearMarkers());
    expect(scene.children.some((c) => c.userData.isPickingMarker)).toBe(false);
    expect(hook.result.current.bimPoints).toEqual([]);
    expect(onBimPointsChange).toHaveBeenLastCalledWith([]);
    expect(onPcPointsChange).toHaveBeenLastCalledWith([]);
    act(() => window.setPickingMode(null));
    expect(canvas.style.cursor).toBe("grab");
  });
});
