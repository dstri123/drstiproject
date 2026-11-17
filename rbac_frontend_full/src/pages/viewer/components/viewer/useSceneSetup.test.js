import { renderHook } from "@testing-library/react";
import * as THREE from "three";
import useSceneSetup, { disposeSceneDeep } from "./useSceneSetup";

jest.mock("three/examples/jsm/controls/OrbitControls", () => ({ OrbitControls: jest.fn() }));
const { OrbitControls } = require("three/examples/jsm/controls/OrbitControls");

let renderer;
let controls;
beforeEach(() => {
  renderer = {
    domElement: document.createElement("canvas"),
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    render: jest.fn(),
    dispose: jest.fn(),
    forceContextLoss: jest.fn(),
  };
  controls = { target: new THREE.Vector3(1, 1, 1), update: jest.fn(), dispose: jest.fn() };
  OrbitControls.mockImplementation(() => controls);
});

function mount() {
  const div = document.createElement("div");
  Object.defineProperty(div, "clientWidth", { value: 800 });
  Object.defineProperty(div, "clientHeight", { value: 400 });
  document.body.appendChild(div);
  return { current: div };
}

describe("useSceneSetup", () => {
  test("creates scene, camera, renderer, controls and hidden grid/axes", () => {
    const spy = jest.spyOn(THREE, "WebGLRenderer").mockImplementation(() => renderer);
    const mountRef = mount();
    const { result, unmount } = renderHook(() => useSceneSetup(mountRef));

    expect(spy).toHaveBeenCalledWith({ antialias: true });
    expect(result.current.sceneReady).toBe(true);
    expect(result.current.sceneError).toBeNull();
    expect(mountRef.current.contains(renderer.domElement)).toBe(true);
    expect(renderer.localClippingEnabled).toBe(true);
    expect(renderer.setSize).toHaveBeenCalledWith(800, 400);
    expect(result.current.cameraRef.current.aspect).toBe(2);
    expect(controls.enableDamping).toBe(true);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(result.current.gridRef.current.visible).toBe(false);
    expect(result.current.gridRef.current.userData.isGrid).toBe(true);
    expect(result.current.axesRef.current.visible).toBe(false);
    expect(result.current.sceneRef.current.children).toContain(result.current.gridRef.current);
    expect(renderer.render).toHaveBeenCalled();

    // grab cursor while dragging
    renderer.domElement.dispatchEvent(new Event("pointerdown"));
    expect(renderer.domElement.style.cursor).toBe("grabbing");
    window.dispatchEvent(new Event("pointerup"));
    expect(renderer.domElement.style.cursor).toBe("grab");

    const scene = result.current.sceneRef.current;
    unmount();
    expect(controls.dispose).toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalled();
    expect(renderer.forceContextLoss).toHaveBeenCalled();
    expect(mountRef.current.contains(renderer.domElement)).toBe(false);
    expect(scene.children).toHaveLength(0);
    spy.mockRestore();
  });

  test("surfaces a WebGL context failure as sceneError instead of crashing", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const spy = jest.spyOn(THREE, "WebGLRenderer").mockImplementation(() => {
      throw new Error("Error creating WebGL context.");
    });
    const { result } = renderHook(() => useSceneSetup(mount()));
    expect(result.current.sceneReady).toBe(false);
    expect(result.current.sceneError).toMatch(/Couldn't start the 3D viewer/);
    spy.mockRestore();
  });

  test("does nothing without a mount node", () => {
    const { result } = renderHook(() => useSceneSetup({ current: null }));
    expect(result.current.sceneReady).toBe(false);
  });
});

describe("disposeSceneDeep", () => {
  test("disposes geometries, materials and their textures", () => {
    const tex = new THREE.Texture();
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const geo = new THREE.BoxGeometry();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, [mat]));
    const spies = [jest.spyOn(tex, "dispose"), jest.spyOn(mat, "dispose"), jest.spyOn(geo, "dispose")];
    disposeSceneDeep(root);
    spies.forEach((s) => expect(s).toHaveBeenCalled());
    expect(() => disposeSceneDeep(null)).not.toThrow();
  });
});
