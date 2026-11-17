// Shared test helper (not a test file): a camera at (0,0,10) looking at the
// origin, a 1000x1000 fake canvas, and helpers to click on it.
import * as THREE from "three";

export function makeTestScene() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 });
  return {
    scene,
    camera,
    canvas,
    sceneData: {
      sceneRef: { current: scene },
      cameraRef: { current: camera },
      rendererRef: { current: { domElement: canvas } },
      controlsRef: { current: { enabled: true, target: new THREE.Vector3(), update: () => {} } },
      sceneReady: true,
    },
  };
}

export function screenOf(camera, p) {
  const v = p.clone().project(camera);
  return { clientX: Math.round(((v.x + 1) / 2) * 1000), clientY: Math.round(((1 - v.y) / 2) * 1000) };
}

export function clickAt(target, coords, type = "click") {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...coords });
  target.dispatchEvent(ev);
  return ev;
}
