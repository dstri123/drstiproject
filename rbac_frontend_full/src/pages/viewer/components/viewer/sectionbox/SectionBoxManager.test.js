import * as THREE from "three";
import SectionBoxManager from "./SectionBoxManager";

function setup({ objects } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const domElement = document.createElement("canvas");
  domElement.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    right: 1000,
    bottom: 1000,
  });
  const renderer = { domElement, localClippingEnabled: false, clippingPlanes: [] };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  const onExtentsChange = jest.fn();
  const manager = new SectionBoxManager({
    scene,
    camera,
    renderer,
    domElement,
    objects: objects || [mesh],
    onExtentsChange,
  });
  return { scene, camera, renderer, domElement, mesh, manager, onExtentsChange };
}

// Screen position (canvas is 1000x1000 at 0,0) of a world point. jsdom
// truncates MouseEvent coordinates to integers, so round explicitly.
function toScreen(camera, p) {
  const v = p.clone().project(camera);
  return {
    clientX: Math.round(((v.x + 1) / 2) * 1000),
    clientY: Math.round(((1 - v.y) / 2) * 1000),
  };
}

function pointer(type, target, coords) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...coords });
  target.dispatchEvent(ev);
  return ev;
}

describe("SectionBoxManager", () => {
  test("init without scene/camera/renderer is a no-op", () => {
    const m = new SectionBoxManager();
    m.init();
    expect(m.box).toBeNull();
    // other entry points tolerate the empty manager too
    m.update();
    m.notify();
    m.setAxis("x", 0, 1);
    m.clearVisuals();
    m.dispose();
  });

  test("enable() builds the box from the objects and clips their materials", () => {
    const { manager, mesh, renderer, scene, onExtentsChange } = setup();
    manager.enable();

    expect(manager.box.min.toArray()).toEqual([-1, -1, -1]);
    expect(manager.box.max.toArray()).toEqual([1, 1, 1]);
    expect(manager.planes).toHaveLength(6);
    expect(renderer.localClippingEnabled).toBe(true);
    expect(renderer.clippingPlanes).toBe(manager.planes);
    expect(mesh.material.clippingPlanes).toBe(manager.planes);
    expect(mesh.material.clipIntersection).toBe(false);

    // visual helpers: edges + fill + 6 face handles + 8 corners
    expect(scene.children).toContain(manager.edgeMesh);
    expect(scene.children).toContain(manager.edgeFillMesh);
    expect(manager.handleMeshes).toHaveLength(14);

    expect(onExtentsChange).toHaveBeenLastCalledWith({
      bounds: { x: [-1, 1], y: [-1, 1], z: [-1, 1] },
      clip: { x: [-1, 1], y: [-1, 1], z: [-1, 1] },
    });
  });

  test("setAxis crops one face, clamped to the full extents and kept ordered", () => {
    const { manager, onExtentsChange } = setup();
    manager.enable();

    manager.setAxis("x", 0, 0.25);
    expect(manager.adjustedMin.x).toBe(0.25);
    manager.setAxis("y", 1, -0.5);
    expect(manager.adjustedMax.y).toBe(-0.5);
    // beyond the full box → clamped
    manager.setAxis("z", 0, -50);
    expect(manager.adjustedMin.z).toBe(-1);
    manager.setAxis("z", 1, 50);
    expect(manager.adjustedMax.z).toBe(1);
    // min can never cross max
    manager.setAxis("x", 0, 1);
    expect(manager.adjustedMin.x).toBeLessThan(manager.adjustedMax.x);
    // non-numeric input ignored
    manager.setAxis("x", 1, "abc");
    expect(manager.adjustedMax.x).toBe(1);

    const last = onExtentsChange.mock.calls.at(-1)[0];
    expect(last.bounds.x).toEqual([-1, 1]); // full extents never change
    expect(last.clip.y).toEqual([-1, -0.5]);
  });

  test("clipping planes follow the cropped extents", () => {
    const { manager } = setup();
    manager.enable();
    manager.setAxis("x", 1, 0);
    const kept = (p) => manager.planes.every((pl) => pl.distanceToPoint(p) >= 0);
    expect(kept(new THREE.Vector3(-0.5, 0, 0))).toBe(true);
    expect(kept(new THREE.Vector3(0.5, 0, 0))).toBe(false);
  });

  test("re-enabling preserves the crop; reset restores the full box", () => {
    const { manager } = setup();
    manager.enable();
    manager.setAxis("x", 0, 0.5);
    manager.disable();
    manager.enable();
    expect(manager.adjustedMin.x).toBe(0.5);

    manager.reset();
    expect(manager.adjustedMin.toArray()).toEqual([-1, -1, -1]);
    expect(manager.adjustedMax.toArray()).toEqual([1, 1, 1]);
  });

  test("disable() removes clipping from materials and renderer and hides the visuals", () => {
    const { manager, mesh, renderer, scene } = setup();
    manager.enable();
    manager.disable();
    expect(mesh.material.clippingPlanes).toEqual([]);
    expect(renderer.clippingPlanes).toEqual([]);
    expect(manager.edgeMesh).toBeNull();
    expect(manager.edgeFillMesh).toBeNull();
    expect(manager.handleMeshes).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    expect(manager.visualsAnimated).toBe(false);
  });

  test("setBoxVisible hides the box but keeps clipping", () => {
    const { manager, mesh } = setup();
    manager.enable();
    manager.setBoxVisible(false);
    expect(manager.edgeMesh.visible).toBe(false);
    expect(manager.edgeFillMesh.visible).toBe(false);
    manager.handleMeshes.forEach((h) => expect(h.visible).toBe(false));
    expect(mesh.material.clippingPlanes).toBe(manager.planes);

    // later rebuilds honour the flag
    manager.setAxis("x", 0, 0);
    expect(manager.edgeMesh.visible).toBe(false);
    manager.setBoxVisible(true);
    expect(manager.edgeMesh.visible).toBe(true);
  });

  test("clips Points and multi-material meshes too", () => {
    const pts = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3),
      ),
      new THREE.PointsMaterial(),
    );
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    const { manager } = setup({ objects: [pts, multi, null] });
    manager.enable();
    expect(pts.material.clippingPlanes).toBe(manager.planes);
    multi.material.forEach((m) => expect(m.clippingPlanes).toBe(manager.planes));
  });

  test("isolateFloor shows only meshes passing the predicate", () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    a.name = "L1";
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    b.name = "L2";
    const group = new THREE.Group();
    group.add(a, b);
    const { manager } = setup({ objects: [group] });
    manager.isolateFloor((o) => o.name === "L1");
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
    manager.isolateFloor();
    expect(b.visible).toBe(true);
  });

  test("dragging a corner handle grows the box toward the pointer", () => {
    const { manager, camera, domElement, scene } = setup();
    manager.enable();
    scene.updateMatrixWorld(true); // normally done by renderer.render each frame
    const start = toScreen(camera, new THREE.Vector3(1, 1, 1));

    const down = pointer("pointerdown", domElement, start);
    expect(down.defaultPrevented).toBe(true);
    expect(manager.dragging.active).toBe(true);
    expect(manager.dragging.mode).toBe("corner");

    pointer("pointermove", window, {
      clientX: start.clientX + 60,
      clientY: start.clientY - 60,
    });
    expect(manager.adjustedMax.x).toBeGreaterThan(1);
    expect(manager.adjustedMax.y).toBeGreaterThan(1);
    expect(manager.adjustedMin.x).toBe(-1);

    pointer("pointerup", window, {});
    expect(manager.dragging.active).toBe(false);
  });

  test("clicking a face handle without dragging steps that face inward", () => {
    const { manager, camera, domElement, scene } = setup();
    manager.enable();
    scene.updateMatrixWorld(true); // normally done by renderer.render each frame
    const at = toScreen(camera, new THREE.Vector3(1, 0, 0)); // +X face handle
    pointer("pointerdown", domElement, at);
    expect(manager.dragging.mode).toBe("face");
    pointer("pointerup", window, {});
    // step = 8.5% of the largest box dimension (2)
    expect(manager.adjustedMax.x).toBeCloseTo(1 - 0.17, 6);
    expect(manager.adjustedMin.x).toBe(-1);
  });

  test("pointerdown off the handles, or with no box shown, does nothing", () => {
    const { manager, domElement } = setup();
    manager.init();
    manager.disable(); // no edgeMesh
    pointer("pointerdown", domElement, { clientX: 500, clientY: 500 });
    expect(manager.dragging.active).toBe(false);

    manager.enable();
    pointer("pointerdown", domElement, { clientX: 1, clientY: 1 });
    expect(manager.dragging.active).toBe(false);
    // pointermove / pointerup while not dragging are ignored
    pointer("pointermove", window, { clientX: 5, clientY: 5 });
    pointer("pointerup", window, {});
    expect(manager.adjustedMax.toArray()).toEqual([1, 1, 1]);
  });

  test("dispose detaches listeners and clears clipping", () => {
    const { manager, domElement, renderer, mesh } = setup();
    manager.enable();
    const removeSpy = jest.spyOn(domElement, "removeEventListener");
    manager.dispose();
    expect(removeSpy).toHaveBeenCalledWith("pointerdown", manager.onPointerDown);
    expect(renderer.localClippingEnabled).toBe(false);
    expect(mesh.material.clippingPlanes).toEqual([]);
    expect(manager.edgeMesh).toBeNull();
  });
});
