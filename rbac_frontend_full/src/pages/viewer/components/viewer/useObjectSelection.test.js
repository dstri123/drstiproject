import { renderHook } from "@testing-library/react";
import * as THREE from "three";
import useObjectSelection from "./useObjectSelection";
import { makeTestScene, clickAt } from "./testScene";

const CENTER = { clientX: 500, clientY: 500 };
const CORNER = { clientX: 2, clientY: 2 };

function setup(build) {
  const t = makeTestScene();
  build(t.scene);
  t.scene.updateMatrixWorld(true);
  const onSelect = jest.fn();
  const { sceneRef, cameraRef, rendererRef } = t.sceneData;
  const hook = renderHook(() => useObjectSelection(sceneRef, cameraRef, rendererRef, {}, onSelect));
  return { ...t, onSelect, hook };
}

afterEach(() => {
  window.__pickingMode = null;
});

describe("useObjectSelection", () => {
  test("selects the clicked group root and highlights it; clicking empty space deselects", () => {
    let mesh, group;
    const { canvas, onSelect } = setup((scene) => {
      group = new THREE.Group();
      mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
      group.add(mesh);
      scene.add(group);
    });
    clickAt(canvas, CENTER);
    expect(onSelect).toHaveBeenLastCalledWith(group);

    let mesh2;
    const t = setup((scene) => {
      mesh2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      scene.add(mesh2);
    });
    const original = mesh2.material;
    clickAt(t.canvas, CENTER);
    expect(t.onSelect).toHaveBeenLastCalledWith(mesh2);
    expect(mesh2.material).not.toBe(original);
    expect(mesh2.material.color.getHex()).toBe(0x00aaff);

    clickAt(t.canvas, CORNER);
    expect(t.onSelect).toHaveBeenLastCalledWith(null);
    expect(mesh2.material).toBe(original);
  });

  test("point clouds are selected without touching their colours", () => {
    let pts;
    const { canvas, onSelect } = setup((scene) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
      pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x123456 }));
      scene.add(pts);
    });
    clickAt(canvas, CENTER);
    expect(onSelect).toHaveBeenLastCalledWith(pts);
    expect(pts.material.color.getHex()).toBe(0x123456);
  });

  test("ignores helpers, gizmos, sprites and IFC element meshes", () => {
    const { canvas, onSelect } = setup((scene) => {
      const helper = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
      helper.userData.isHelper = true;
      const gizmo = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
      gizmo.position.z = 1;
      gizmo.userData.gizmoType = "translate";
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
      sprite.position.z = 2;
      scene.add(helper, gizmo, sprite);
    });
    clickAt(canvas, CENTER);
    expect(onSelect).toHaveBeenLastCalledWith(null);

    const t = setup((scene) => {
      const g = new THREE.BoxGeometry(2, 2, 2);
      g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array(g.attributes.position.count), 1));
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    });
    clickAt(t.canvas, CENTER);
    expect(t.onSelect).not.toHaveBeenCalled();
  });

  test("stands down while alignment points are being picked", () => {
    const { canvas, onSelect } = setup((scene) => {
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
    });
    window.__pickingMode = "pc";
    clickAt(canvas, CENTER);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("does nothing without a renderer", () => {
    expect(() =>
      renderHook(() => useObjectSelection({ current: null }, { current: null }, { current: null }, {}, jest.fn())),
    ).not.toThrow();
  });
});
