import { renderHook, act, waitFor } from "@testing-library/react";
import * as THREE from "three";
import useIssuePins from "./useIssuePins";
import { makeTestScene, clickAt, screenOf } from "./testScene";

jest.mock("./useModelLoader", () => ({ getSafeIfcType: () => "IFCWALL" }));
jest.mock("../../issues/useIssues", () => ({
  ISSUE_STATUS: { open: { color: "#dc2626" }, resolved: { color: "#16a34a" } },
}));

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText() {},
    drawImage: jest.fn(),
  }));
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb) {
    cb(new Blob(["png"], { type: "image/png" }));
  };
});

function setup(props = {}, { bimModel } = {}) {
  const t = makeTestScene();
  const bim = bimModel || new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  t.scene.add(bim);
  t.scene.updateMatrixWorld(true);
  t.sceneData.rendererRef.current.render = jest.fn();
  t.canvas.width = 1000;
  t.canvas.height = 1000;
  const cb = { onPick: jest.fn(), onSelect: jest.fn(), onCancel: jest.fn() };
  const initialProps = { issues: [], pinMode: false, selectedIssueId: null, ...cb, ...props };
  const hook = renderHook((p) => useIssuePins(t.sceneData, { bimModel: bim, pcModel: null }, p), { initialProps });
  return { ...t, ...cb, hook, bim, initialProps };
}

const pinGroup = (scene) => scene.getObjectByName("issuePins");

describe("useIssuePins", () => {
  test("renders one pin per issue with a position, placed in the BIM frame (IFC Z-up → Y-up)", async () => {
    const issues = [
      { id: 1, number: 1, status: "open", position: [0, 0, 1] },
      { id: 2, number: 2, status: "weird", position: [1, 2, 3] },
      { id: 3, number: 3, status: "open", position: null },
    ];
    const { scene, bim } = setup({ issues, selectedIssueId: 2 });
    bim.position.set(5, 0, 0);
    const group = pinGroup(scene);
    expect(group.children).toHaveLength(2);
    expect(group.children[1].userData.selected).toBe(true);
    expect(group.children[0].userData.isHelper).toBe(true);
    // IFC (1,2,3) → scene (1,3,-2), then the BIM's transform
    await waitFor(() => expect(group.children[1].position.toArray()).toEqual([6, 3, -2]));
    expect(group.children[0].scale.x).toBeGreaterThan(0);
  });

  test("pin mode: a click on the model reports position/viewpoint in IFC coordinates plus a snapshot", async () => {
    const { canvas, onPick, sceneData } = setup({ pinMode: true });
    expect(canvas.style.cursor).toBe("crosshair");
    await act(async () => {
      clickAt(canvas, { clientX: 500, clientY: 500 });
    });
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const pick = onPick.mock.calls[0][0];
    pick.position.forEach((v, i) => expect(v).toBeCloseTo([0, -1, 0][i]));
    pick.viewpoint.position.forEach((v, i) => expect(v).toBeCloseTo([0, -10, 0][i]));
    pick.viewpoint.direction.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i]));
    expect(pick.viewpoint.fov).toBe(50);
    expect(pick.element).toBeNull();
    expect(pick.snapshot.name).toBe("snapshot.png");
    expect(sceneData.rendererRef.current.render).toHaveBeenCalled();
  });

  test("pin mode on an IFC element records its expressID, type and GlobalId", async () => {
    const g = new THREE.BoxGeometry(2, 2, 2);
    g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array(g.attributes.position.count).fill(42), 1));
    const ifc = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    ifc.modelID = 0;
    ifc.ifcManager = { getItemProperties: jest.fn().mockResolvedValue({ GlobalId: { value: "2O2Fr$t4X7Zf8NOew3FLOH" } }) };
    const { canvas, onPick } = setup({ pinMode: true }, { bimModel: ifc });
    await act(async () => {
      clickAt(canvas, { clientX: 500, clientY: 500 });
    });
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].element).toEqual({ expressID: 42, type: "IFCWALL", globalId: "2O2Fr$t4X7Zf8NOew3FLOH" });
  });

  test("a drag (not a click) is ignored; Escape cancels pin mode", async () => {
    const { canvas, onPick, onCancel } = setup({ pinMode: true });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100 }));
      clickAt(canvas, { clientX: 500, clientY: 500 });
    });
    expect(onPick).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onCancel).toHaveBeenCalled();
  });

  test("clicking a pin selects its issue", async () => {
    const issue = { id: 7, number: 7, status: "open", position: [3, 0, 0] }; // scene (3,0,0)
    const { scene, canvas, camera, onSelect } = setup({ issues: [issue] });
    const sprite = pinGroup(scene).children[0];
    await waitFor(() => expect(sprite.position.x).toBe(3));
    scene.updateMatrixWorld(true);
    act(() => {
      clickAt(canvas, screenOf(camera, new THREE.Vector3(3, 0, 0)));
    });
    expect(onSelect).toHaveBeenCalledWith(issue);
  });

  test("window.flyToIssue moves the camera to the saved viewpoint", async () => {
    const { camera, sceneData } = setup();
    act(() => window.flyToIssue({ position: [0, 0, 0], viewpoint: { position: [4, -5, 6] } }));
    // IFC (4,-5,6) → scene (4,6,5)
    await waitFor(() => expect(camera.position.distanceTo(new THREE.Vector3(4, 6, 5))).toBeLessThan(1e-6), { timeout: 2000 });
    expect(sceneData.controlsRef.current.target.length()).toBeCloseTo(0);
  });
});
