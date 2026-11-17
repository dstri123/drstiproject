import { renderHook, act, waitFor } from "@testing-library/react";
import * as THREE from "three";
import useCameraSystem from "./useCameraSystem";
import { makeTestScene, clickAt, screenOf } from "./testScene";

// COLMAP images.txt: pose line + POINTS2D line per image.
const IMAGES_TXT = [
  "# Image list with two lines of data per image:",
  "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
  "2 1 0 0 0 4 5 6 1 IMG_10.jpg",
  "533.24 12.5 -1 600.1 20.2 17",
  "1 1 0 0 0 1 2 3 1 IMG_2.jpg",
  "100.5 200.5 -1",
  "",
].join("\n");

// Pose-only export: every POINTS2D line is EMPTY.
const POSE_ONLY_TXT = [
  "# pose only",
  "1 1 0 0 0 1 0 0 1 A_1.jpg",
  "",
  "2 1 0 0 0 2 0 0 1 A_2.jpg",
  "",
  "3 1 0 0 0 3 0 0 1 A_3.jpg",
  "",
].join("\n");

const fileOf = (text) => ({ text: () => Promise.resolve(text) });

function setup(props = {}, modelData = {}) {
  const t = makeTestScene();
  const initialProps = { cameraPositionsFile: null, showCameras: true, cameraImages: [], ...props };
  const hook = renderHook((p) => useCameraSystem(t.sceneData, modelData, p), { initialProps });
  return { ...t, hook, initialProps };
}

const cams = (scene) => scene.children.filter((c) => c.isPerspectiveCamera);
const markers = (scene) => scene.children.filter((c) => c.userData?.cameraIndex != null);

beforeEach(() => {
  window.alert = jest.fn();
});

describe("useCameraSystem – images.txt parsing", () => {
  test("reads pose lines only, converts to camera centres and sorts by name", async () => {
    const { scene } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT) });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    const [first, second] = cams(scene);
    expect(first.userData.imageName).toBe("IMG_2.jpg"); // natural sort: 2 before 10
    expect(second.userData.imageName).toBe("IMG_10.jpg");
    // C = -Rᵀ t with R = identity
    expect(first.position.toArray()).toEqual([-1, -2, -3]);
    expect(second.position.toArray()).toEqual([-4, -5, -6]);
    // COLMAP looks down +Z; three.js cameras look down -Z → 180° about X
    const dir = first.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeCloseTo(1);
    expect(markers(scene)).toHaveLength(2);
  });

  test("keeps every camera of a pose-only file (empty POINTS2D lines)", async () => {
    const { scene } = setup({ cameraPositionsFile: fileOf(POSE_ONLY_TXT) });
    await waitFor(() => expect(cams(scene).length).toBeGreaterThan(0));
    expect(cams(scene).map((c) => c.userData.imageName)).toEqual(["A_1.jpg", "A_2.jpg", "A_3.jpg"]);
  });

  test("handles CRLF files and skips malformed pose lines", async () => {
    const crlf = "1 1 0 0 0 0 0 0 1 X.jpg\r\n\r\nbad line\r\n2 1 0 0 0 0 0 1 1 Y.jpg\r\n1 2 3\r\n";
    const { scene } = setup({ cameraPositionsFile: fileOf(crlf) });
    await waitFor(() => expect(cams(scene).length).toBeGreaterThan(0));
    expect(cams(scene).map((c) => c.userData.imageName.trim())).toEqual(["X.jpg", "Y.jpg"]);
  });

  test("bakes an uploaded camera matrix into the positions", async () => {
    const M = [
      [1, 0, 0, 10],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const { scene } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT), uploadedCameraMatrix: M });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    expect(cams(scene)[0].position.toArray()).toEqual([9, -2, -3]);
  });

  test("applies the point cloud's raw→world matrix", async () => {
    const pcModel = { userData: { rawToWorld: new THREE.Matrix4().makeTranslation(0, 100, 0) } };
    const { scene } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT) }, { pcModel });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    expect(cams(scene)[0].position.y).toBe(98);
  });

  test("fetches remote sources and logs HTTP errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(IMAGES_TXT) });
    const { scene } = setup({ cameraPositionsFile: { url: "http://h/images.txt" } });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    expect(fetch).toHaveBeenCalledWith("http://h/images.txt");

    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockResolvedValue({ ok: false, status: 404 });
    setup({ cameraPositionsFile: { url: "http://h/missing.txt" } });
    await waitFor(() => expect(err).toHaveBeenCalledWith("Failed to load camera positions file", expect.any(Error)));
  });

  test("clearing the file removes all cameras", async () => {
    const { scene, hook, initialProps } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT) });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    hook.rerender({ ...initialProps, cameraPositionsFile: null });
    expect(cams(scene)).toHaveLength(0);
    expect(markers(scene)).toHaveLength(0);
  });

  test("matches images to cameras by name (marker colours)", async () => {
    const { scene } = setup({
      cameraPositionsFile: fileOf(IMAGES_TXT),
      cameraImages: [{ id: 1, original_name: "img_2.JPG", image: "http://h/media/img_2.JPG" }],
    });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    const [withImg, without] = cams(scene);
    expect(withImg.userData.image).toBe("http://h/media/img_2.JPG");
    expect(without.userData.hasImage).toBe(false);
    expect(markers(scene)[0].userData.baseColor).toBe(0x8b5cf6);
    expect(markers(scene)[1].userData.baseColor).toBe(0xf97316);
  });
});

describe("useCameraSystem – manual cameras, colouring, export", () => {
  test("add, toggle and delete manual cameras", () => {
    const { scene, hook } = setup();
    act(() => window.addCameraManually());
    act(() => window.addBubbleCameraManually());
    expect(cams(scene)).toHaveLength(2);
    const names = hook.result.current.manualCameras.map((c) => c.name);
    expect(names[0]).toMatch(/^Camera \d+$/);
    expect(names[1]).toMatch(/^Bubble Camera \d+$/);
    expect(hook.result.current.manualCameras[1].isBubble).toBe(true);
    // spawned 5 units in front of the main camera
    expect(cams(scene)[0].position.z).toBeCloseTo(5);

    act(() => hook.result.current.toggleCameraVisibility(names[0]));
    expect(markers(scene)[0].visible).toBe(false);
    expect(hook.result.current.manualCameras[0].visible).toBe(false);

    act(() => hook.result.current.deleteCamera(names[0]));
    expect(cams(scene)).toHaveLength(1);
    expect(hook.result.current.manualCameras.map((c) => c.name)).toEqual([names[1]]);
    expect(cams(scene)[0].userData.index).toBe(0);
    act(() => hook.result.current.deleteCamera("nope"));
    expect(cams(scene)).toHaveLength(1);
  });

  test("colour markers by a data column (viridis) and reset", async () => {
    const { scene, hook } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT) });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    const coneGeo = markers(scene)[0].geometry;
    act(() =>
      hook.result.current.colorCamerasByColumn(
        { "IMG_2.jpg": { temp: "10" }, "IMG_10.jpg": { temp: "20" } },
        "temp",
      ),
    );
    const [m0, m1] = markers(scene);
    expect(m0.userData.hasDataColor).toBe(true);
    expect(m0.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(m0.material.color.getHex()).not.toBe(m1.material.color.getHex());

    act(() => hook.result.current.resetCameraColors());
    expect(m0.geometry).toBe(coneGeo);
    expect(m0.material.color.getHex()).toBe(0x9ca3af);
    expect(m0.userData.hasDataColor).toBe(false);

    // no column / no numeric values → nothing happens
    act(() => hook.result.current.colorCamerasByColumn({}, null));
    act(() => hook.result.current.colorCamerasByColumn({ "IMG_2.jpg": { temp: "n/a" } }, "temp"));
    expect(m0.userData.hasDataColor).toBe(false);
  });

  test("window.exportCameraPositions downloads every camera pose as JSON", async () => {
    URL.createObjectURL = jest.fn(() => "blob:c");
    URL.revokeObjectURL = jest.fn();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { scene } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT) });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));

    act(() => window.exportCameraPositions());
    expect(clickSpy).toHaveBeenCalled();
    const blob = URL.createObjectURL.mock.calls[0][0];
    const data = JSON.parse(
      await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsText(blob);
      }),
    );
    expect(data).toEqual([
      expect.objectContaining({ name: "IMG_2.jpg", position: [-1, -2, -3], fov: 60, manual: false }),
      expect.objectContaining({ name: "IMG_10.jpg", position: [-4, -5, -6] }),
    ]);
    expect(data[0].quaternion).toHaveLength(4);
    clickSpy.mockRestore();
  });

  test("exportCameraPositions with no cameras alerts", () => {
    setup();
    act(() => window.exportCameraPositions());
    expect(window.alert).toHaveBeenCalledWith("No cameras loaded.");
  });

  test("camera matrix upload validates the file", () => {
    setup();
    act(() => window.handleCameraMatrixUpload(new File(["x"], "m.txt")));
    expect(window.alert).toHaveBeenCalledWith('Invalid file format: "m.txt". Camera matrix must be a .json file.');
    act(() => window.applyCameraMatrix());
    expect(window.alert).toHaveBeenCalledWith("No matrix uploaded.");
  });

  test("folder upload rejects non-images", () => {
    setup();
    act(() => window.handleCameraFolderUpload([new File(["x"], "notes.pdf")]));
    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/Invalid image format: "notes.pdf"/));
  });
});

describe("useCameraSystem – marker click and live preview", () => {
  test("clicking a marker selects the camera; the preview renderer keeps its drawing buffer", async () => {
    const renderer = {
      setPixelRatio: jest.fn(),
      setSize: jest.fn(),
      setClearColor: jest.fn(),
      render: jest.fn(),
      dispose: jest.fn(),
    };
    const spy = jest.spyOn(THREE, "WebGLRenderer").mockImplementation(function Mock(opts) {
      return Object.assign(renderer, { domElement: opts.canvas });
    });
    const { scene, camera, canvas, hook } = setup({ cameraPositionsFile: fileOf(IMAGES_TXT) });
    await waitFor(() => expect(cams(scene)).toHaveLength(2));
    // put the first camera's marker in front of the main camera
    const marker = markers(scene)[0];
    marker.position.set(0, 0, 0);
    marker.scale.setScalar(1);
    scene.updateMatrixWorld(true);
    hook.result.current.previewCanvasRef.current = document.createElement("canvas");

    act(() => {
      clickAt(canvas, screenOf(camera, new THREE.Vector3(0, 0, 0)));
    });
    expect(hook.result.current.selectedCamera).toMatchObject({ name: "IMG_2.jpg", isManual: false });
    expect(marker.material.color.getHex()).toBe(marker.userData.baseColor); // idle grey → its meaning colour

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ preserveDrawingBuffer: true });
    await waitFor(() => expect(renderer.render).toHaveBeenCalled());
    spy.mockRestore();
  });
});
