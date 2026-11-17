import { render, fireEvent, waitFor } from "@testing-library/react";
import * as THREE from "three";
import BlenderViewportGizmo from "./BlenderViewportGizmo";

beforeEach(() => {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
});

function setup() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const controls = { target: new THREE.Vector3(), update: jest.fn() };
  const { container, unmount } = render(
    <BlenderViewportGizmo cameraRef={{ current: camera }} controlsRef={{ current: controls }} />,
  );
  const canvas = container.querySelector("canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 84, height: 84 });
  return { camera, controls, canvas, unmount };
}

// Looking down -Z, +X's tip is at (42 + 27, 42), +Y's at (42, 42 - 27).
describe("BlenderViewportGizmo", () => {
  test("renders an 84px canvas and draws every frame", () => {
    const { canvas, unmount } = setup();
    expect(canvas.width).toBe(84);
    expect(canvas.getContext).toHaveBeenCalledWith("2d");
    unmount();
  });

  test("hovering an axis tip shows a pointer cursor", () => {
    const { canvas } = setup();
    fireEvent.mouseMove(canvas, { clientX: 69, clientY: 42 });
    expect(canvas.style.cursor).toBe("pointer");
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: 5 });
    expect(canvas.style.cursor).toBe("default");
    fireEvent.mouseLeave(canvas);
  });

  test("clicking +X snaps the camera onto the X axis at the same distance", async () => {
    const { canvas, camera, controls } = setup();
    fireEvent.click(canvas, { clientX: 69, clientY: 42 });
    await waitFor(() => expect(camera.position.x).toBeCloseTo(10, 3));
    expect(camera.position.y).toBeCloseTo(0, 3);
    expect(camera.position.z).toBeCloseTo(0, 3);
    expect(controls.update).toHaveBeenCalled();
  });

  test("clicking the -Y handle looks from below", async () => {
    const { canvas, camera } = setup();
    fireEvent.click(canvas, { clientX: 42, clientY: 69 });
    await waitFor(() => expect(camera.position.y).toBeCloseTo(-10, 3));
  });

  test("clicking empty space does nothing", async () => {
    const { canvas, camera } = setup();
    fireEvent.click(canvas, { clientX: 2, clientY: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
  });
});
