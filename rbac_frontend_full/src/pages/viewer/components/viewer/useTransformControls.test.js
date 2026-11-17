import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";
import useTransformControls from "./useTransformControls";
import { makeTestScene } from "./testScene";

function setup() {
  const t = makeTestScene();
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.userData = { index: 0, imageName: "IMG_1.jpg" };
  const marker = new THREE.Mesh(new THREE.ConeGeometry(), new THREE.MeshBasicMaterial());
  const helper = { update: jest.fn() };
  const onTransformCommit = jest.fn();
  const hook = renderHook(() =>
    useTransformControls(t.sceneData, {
      cameraMarkersRef: { current: [marker] },
      cameraHelpersRef: { current: [helper] },
      onTransformCommit,
    }),
  );
  return { ...t, cam, marker, helper, onTransformCommit, hook };
}

const key = (k) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: k })));
const move = (x, y) =>
  act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y })));

describe("useTransformControls (camera markers: G / R / S)", () => {
  test("G moves the active camera with the mouse; click commits", () => {
    const { hook, cam, marker, canvas, sceneData, onTransformCommit } = setup();
    act(() => hook.result.current.setActiveCamera(cam));
    move(500, 500);
    key("g");
    expect(hook.result.current.transformRef.current.mode).toBe("move");
    expect(sceneData.controlsRef.current.enabled).toBe(false);
    move(600, 500); // +0.1 of the width to the right
    expect(cam.position.x).toBeCloseTo(-1); // -dx * 10 along the camera right (+x)
    expect(marker.position.equals(cam.position)).toBe(true);

    act(() => canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0 })));
    expect(onTransformCommit).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, position: cam.position.toArray(), fov: 60 }),
    );
    expect(canvas.__suppressNextClick).toBe(true);
    expect(sceneData.controlsRef.current.enabled).toBe(true);
    expect(hook.result.current.transformRef.current.mode).toBeNull();
  });

  test("Escape reverts a move; right-click reverts a rotate", () => {
    const { hook, cam, canvas, onTransformCommit } = setup();
    act(() => hook.result.current.setActiveCamera(cam));
    move(500, 500);
    key("G");
    move(700, 300);
    expect(cam.position.length()).toBeGreaterThan(0);
    key("Escape");
    expect(cam.position.toArray()).toEqual([0, 0, 0]);

    key("r");
    move(800, 300);
    expect(cam.quaternion.equals(new THREE.Quaternion())).toBe(false);
    act(() => canvas.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true })));
    expect(cam.rotation.x).toBeCloseTo(0);
    expect(cam.rotation.y).toBeCloseTo(0);
    expect(onTransformCommit).not.toHaveBeenCalled();
  });

  test("S changes the FOV (clamped 15–120) and scales the marker", () => {
    const { hook, cam, marker } = setup();
    act(() => hook.result.current.setActiveCamera(cam));
    move(500, 500);
    key("s");
    move(500, 1000); // dy = +0.5 → fov + 40
    expect(cam.fov).toBe(100);
    expect(marker.scale.x).toBeGreaterThan(1);
    move(500, 3000);
    expect(cam.fov).toBe(120);
  });

  test("keys are ignored without an active camera or while typing", () => {
    const { hook, cam } = setup();
    key("g");
    expect(hook.result.current.transformRef.current.mode).toBeNull();

    act(() => hook.result.current.setActiveCamera(cam));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    key("g");
    expect(hook.result.current.transformRef.current.mode).toBeNull();
    input.remove();
  });

  test("clearActiveCamera matches by name or object", () => {
    const { hook, cam } = setup();
    act(() => hook.result.current.setActiveCamera(cam));
    act(() => hook.result.current.clearActiveCamera("other"));
    expect(hook.result.current.transformRef.current.activeCamera).toBe(cam);
    act(() => hook.result.current.clearActiveCamera("IMG_1.jpg"));
    expect(hook.result.current.transformRef.current.activeCamera).toBeNull();
    act(() => hook.result.current.setActiveCamera(cam));
    act(() => hook.result.current.clearActiveCamera(cam));
    expect(hook.result.current.transformRef.current.activeCamera).toBeNull();
  });

  test("waits for the renderer canvas to exist", () => {
    jest.useFakeTimers();
    const rendererRef = { current: null };
    renderHook(() => useTransformControls({ rendererRef, controlsRef: { current: null } }));
    const canvas = document.createElement("canvas");
    const spy = jest.spyOn(canvas, "addEventListener");
    rendererRef.current = { domElement: canvas };
    act(() => jest.advanceTimersByTime(150));
    expect(spy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    jest.useRealTimers();
  });
});
