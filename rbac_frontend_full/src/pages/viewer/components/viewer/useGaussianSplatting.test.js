import { renderHook, act } from "@testing-library/react";
import { TextDecoder } from "util";
import * as THREE from "three";
import API from "../../../../api/axios";
import useGaussianSplatting from "./useGaussianSplatting";

jest.mock("../../../../api/axios", () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));
jest.mock("jszip", () =>
  jest.fn().mockImplementation(() => ({ file: jest.fn(), generateAsync: () => Promise.resolve(new Blob(["zip"])) })),
);
const JSZip = require("jszip");

beforeAll(() => {
  global.TextDecoder = TextDecoder;
});
beforeEach(() => {
  JSZip.mockImplementation(() => ({ file: jest.fn(), generateAsync: () => Promise.resolve(new Blob(["zip"])) }));
  global.fetch = jest.fn();
});

// Binary little-endian PLY with the given float properties and rows.
function plyBuffer(props, rows, comments = []) {
  const header =
    ["ply", "format binary_little_endian 1.0", ...comments.map((c) => `comment ${c}`), `element vertex ${rows.length}`]
      .concat(props.map((p) => `property float ${p}`))
      .concat(["end_header", ""])
      .join("\n");
  const head = new Uint8Array([...header].map((c) => c.charCodeAt(0)));
  const buf = new ArrayBuffer(head.length + rows.length * props.length * 4);
  new Uint8Array(buf).set(head);
  const view = new DataView(buf, head.length);
  rows.flat().forEach((v, i) => view.setFloat32(i * 4, v, true));
  return buf;
}

const GS_PROPS = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
const source = (buf, name = "splat.ply") => ({ name, arrayBuffer: () => Promise.resolve(buf) });

function setup(props = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const sceneData = {
    sceneRef: { current: scene },
    sceneReady: true,
    cameraRef: { current: camera },
    controlsRef: { current: { target: new THREE.Vector3(), update: jest.fn() } },
  };
  const hook = renderHook((p) => useGaussianSplatting(sceneData, { pcModel: null }, p), { initialProps: props });
  return { ...hook, scene, camera, sceneData };
}

const splatsIn = (scene) => scene.children.flatMap((g) => g.children).filter((o) => o.isPoints);

describe("useGaussianSplatting – trained .ply", () => {
  test("parses a standard 3DGS PLY (SH DC colour, sigmoid opacity, exp scale, wxyz→xyzw rotation)", async () => {
    const row = [1, 2, 3, 0, 1, -1, 0, 0, Math.log(2), 0, 2, 0, 0, 0];
    const { result, scene, camera } = setup({ gaussianPlyFile: source(plyBuffer(GS_PROPS, [row, row])) });
    let ok;
    await act(async () => {
      ok = await result.current.showTrainedGaussian();
    });
    expect(ok).toBe(true);
    expect(result.current.isGaussianVisible).toBe(true);
    expect(result.current.gaussianPointCount).toBe(2);
    expect(result.current.gaussianMode).toBe("trained");
    const [pts] = splatsIn(scene);
    const g = pts.geometry;
    expect(Array.from(g.attributes.position.array.slice(0, 3))).toEqual([1, 2, 3]);
    expect(g.attributes.color.array[0]).toBeCloseTo(0.5);
    expect(g.attributes.color.array[1]).toBeCloseTo(0.5 + 0.28209479);
    expect(g.attributes.aOpacity.array[0]).toBeCloseTo(0.5);
    expect(g.attributes.aScale.array[1]).toBeCloseTo(2);
    expect(Array.from(g.attributes.aRotation.array.slice(0, 4))).toEqual([0, 0, 0, 1]);
    // camera framed on the splats
    expect(camera.position.distanceTo(new THREE.Vector3(1, 2, 3))).toBeGreaterThan(0);

    act(() => result.current.hideGaussian());
    expect(splatsIn(scene)).toHaveLength(0);
    expect(result.current.isGaussianVisible).toBe(false);
  });

  test("this app's own 'activated' PLYs are read without sigmoid", async () => {
    const row = [0, 0, 0, 0.2, 0.2, 0.2, 0.75, 0, 0, 0, 1, 0, 0, 0];
    const { result, scene } = setup({ gaussianPlyFile: source(plyBuffer(GS_PROPS, [row], ["drsti activated"])) });
    await act(async () => result.current.showTrainedGaussian());
    const g = splatsIn(scene)[0].geometry;
    expect(g.attributes.aOpacity.array[0]).toBeCloseTo(0.75);
    expect(g.attributes.color.array[0]).toBeCloseTo(0.7);
  });

  test.each([
    [plyBuffer(["x", "y", "z"], [[0, 0, 0]]), "PLY file does not contain Gaussian splat attributes (opacity/scale/rot)."],
    [new TextEncoderBuffer("ply\nformat ascii 1.0\nelement vertex 1\nend_header\n"), "Only binary_little_endian Gaussian PLY files are supported."],
    [new TextEncoderBuffer("no header here"), "Invalid PLY header — no end_header found."],
  ])("rejects bad PLYs with a clear error (%#)", async (buf, message) => {
    const { result } = setup({ gaussianPlyFile: source(buf) });
    let ok;
    await act(async () => {
      ok = await result.current.showTrainedGaussian();
    });
    expect(ok).toBe(false);
    expect(result.current.gaussianError).toBe(message);
    expect(result.current.isGaussianVisible).toBe(false);
  });

  test("no uploaded .ply → error", async () => {
    const { result } = setup({});
    await act(async () => result.current.showTrainedGaussian());
    expect(result.current.gaussianError).toBe("No trained Gaussian .ply has been uploaded for this project.");
  });

  test("toggle prefers the uploaded model and hides when visible", async () => {
    const row = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
    const { result, scene } = setup({ gaussianPlyFile: source(plyBuffer(GS_PROPS, [row])) });
    await act(async () => result.current.toggleGaussianSplatting());
    expect(splatsIn(scene)).toHaveLength(1);
    await act(async () => result.current.toggleGaussianSplatting());
    expect(splatsIn(scene)).toHaveLength(0);
  });
});

// Encodes a string into an ArrayBuffer (jsdom 16 lacks TextEncoder).
function TextEncoderBuffer(str) {
  const a = new Uint8Array([...str].map((c) => c.charCodeAt(0)));
  return a.buffer;
}

describe("useGaussianSplatting – train from COLMAP files", () => {
  const files = {
    gaussianPointFile: { url: "http://h/points3D.txt" },
    gaussianCamerasFile: { url: "http://h/cameras.txt" },
    cameraPositionsFile: { url: "http://h/images.txt" },
    cameraImages: [{ image: "http://h/a.jpg", original_name: "a.jpg" }],
  };

  test("lists the missing inputs", async () => {
    const { result } = setup({ gaussianPointFile: null, cameraImages: [] });
    let ok;
    await act(async () => {
      ok = await result.current.trainGaussian();
    });
    expect(ok).toBe(false);
    expect(result.current.gaussianError).toBe(
      "Missing points3D.txt, cameras.txt, images.txt camera file, images — upload them on the project's data page.",
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("posts the COLMAP files + zipped images and shows the returned splats", async () => {
    // own-trainer fixed 14-float layout
    const header = "ply\nformat binary_little_endian 1.0\nelement vertex 1\nend_header\n";
    const head = new Uint8Array([...header].map((c) => c.charCodeAt(0)));
    const buf = new ArrayBuffer(head.length + 56);
    new Uint8Array(buf).set(head);
    const dv = new DataView(buf, head.length);
    [7, 8, 9, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, 0].forEach((v, i) => dv.setFloat32(i * 4, v, true));
    fetch.mockImplementation((url) =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(["img"])),
        arrayBuffer: () => Promise.resolve(url === "http://h/out.ply" ? buf : new ArrayBuffer(4)),
      }),
    );
    API.post.mockResolvedValue({ data: { url: "http://h/out.ply" } });

    const { result, scene } = setup(files);
    let ok;
    await act(async () => {
      ok = await result.current.trainGaussian();
    });
    expect(ok).toBe(true);
    const [url, form, config] = API.post.mock.calls[0];
    expect(url).toBe("processing/gaussian/train/");
    expect(config).toEqual({ timeout: 0 });
    ["cameras", "images_txt", "points", "images"].forEach((k) => expect(form.get(k)).toBeTruthy());
    expect(form.get("iterations")).toBe("120");
    expect(Array.from(splatsIn(scene)[0].geometry.attributes.position.array)).toEqual([7, 8, 9]);
    expect(result.current.gaussianPointCount).toBe(1);
  });

  test("shows the server error when training fails", async () => {
    fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()), arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) });
    API.post.mockRejectedValue({ response: { data: { error: "trainer out of memory" } } });
    const { result } = setup(files);
    await act(async () => result.current.trainGaussian());
    expect(result.current.gaussianError).toBe("trainer out of memory");
    expect(result.current.isGaussianLoading).toBe(false);
  });
});
