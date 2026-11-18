import * as THREE from "three";
import API from "../../../../api/axios";
import {
  buildRawToWorld,
  exportBlocker,
  exportCroppedPly,
} from "./exportPointCloud";

jest.mock("../../../../api/axios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

// A cloud whose geometry was recentred on (10, 20, 30) and then placed at
// x + 100 with a 90° turn about Y — like useModelLoader leaves it.
function makeCloud() {
  const pc = new THREE.Points(new THREE.BufferGeometry());
  pc.position.set(100, 0, 0);
  pc.rotation.y = Math.PI / 2;
  pc.userData.geomCentroid = new THREE.Vector3(10, 20, 30);
  return pc;
}

describe("buildRawToWorld", () => {
  test("maps a raw file point to where the viewer draws it", () => {
    const pc = makeCloud();
    const M = buildRawToWorld(pc);
    const raw = new THREE.Vector3(11, 22, 33);
    // Drawn at matrixWorld * (raw - centroid) = matrixWorld * (1, 2, 3)
    const expected = new THREE.Vector3(1, 2, 3).applyMatrix4(pc.matrixWorld);
    const got = raw.clone().applyMatrix4(M);
    expect(got.distanceTo(expected)).toBeLessThan(1e-9);
    expect(got.x).toBeCloseTo(103);
    expect(got.z).toBeCloseTo(-1);
  });

  test("is null before the cloud has loaded", () => {
    expect(buildRawToWorld(null)).toBeNull();
    expect(buildRawToWorld(new THREE.Points())).toBeNull();
  });
});

describe("exportBlocker", () => {
  test.each([
    [null, { id: 1 }, "Load a point cloud first."],
    [makeCloud(), null, "Load a point cloud first."],
    [makeCloud(), { url: "x" }, "Only point clouds saved to the project can be exported."],
    [new THREE.Points(), { id: 1 }, "The point cloud is still loading."],
    [makeCloud(), { id: 1 }, null],
    [makeCloud(), { mergeId: 4 }, null],
  ])("%#", (pc, file, reason) => {
    expect(exportBlocker(pc, file)).toBe(reason);
  });
});

describe("exportCroppedPly", () => {
  let click;
  beforeEach(() => {
    API.post.mockReset();
    URL.createObjectURL = jest.fn(() => "blob:ply");
    URL.revokeObjectURL = jest.fn();
    click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });
  afterEach(() => click.mockRestore());

  test("posts the cloud, live matrix, box and frame; saves the server file", async () => {
    const pc = makeCloud();
    const blob = new Blob(["ply"]);
    API.post.mockResolvedValue({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="scan_cropped_aligned.ply"' },
    });
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(4, 5, 6));
    const name = await exportCroppedPly({
      pcModel: pc,
      pointFile: { id: 42 },
      box,
      frame: "aligned",
    });

    expect(name).toBe("scan_cropped_aligned.ply");
    const [url, body, opts] = API.post.mock.calls[0];
    expect(url).toBe("processing/tools/pointcloud-export/");
    expect(opts).toEqual({ responseType: "blob" });
    expect(body).toMatchObject({
      pointcloud_id: 42,
      box: { min: [-1, -2, -3], max: [4, 5, 6] },
      frame: "aligned",
    });
    expect(body.merge_id).toBeUndefined();
    expect(body.raw_to_world).toHaveLength(16);
    expect(body.raw_to_world).toEqual(Array.from(buildRawToWorld(pc).elements));
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click.mock.instances[0].download).toBe("scan_cropped_aligned.ply");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ply");
  });

  test("merged clouds send merge_id; an empty box means the whole cloud", async () => {
    API.post.mockResolvedValue({ data: new Blob(["ply"]) });
    const name = await exportCroppedPly({
      pcModel: makeCloud(),
      pointFile: { mergeId: 9, id: undefined },
      box: new THREE.Box3(),
    });
    const body = API.post.mock.calls[0][1];
    expect(body).toMatchObject({ merge_id: 9, box: null, frame: "original" });
    expect(body.pointcloud_id).toBeUndefined();
    expect(name).toBe("pointcloud_original.ply");
  });

  test("surfaces the server's error message from the blob body", async () => {
    API.post.mockRejectedValue({
      message: "Request failed with status code 400",
      response: {
        data: { text: () => Promise.resolve('{"error":"No points are inside the clipping box."}') },
      },
    });
    await expect(
      exportCroppedPly({ pcModel: makeCloud(), pointFile: { id: 1 }, box: null }),
    ).rejects.toThrow("No points are inside the clipping box.");
    expect(click).not.toHaveBeenCalled();
  });

  test("refuses without a saved cloud and never calls the server", async () => {
    await expect(
      exportCroppedPly({ pcModel: makeCloud(), pointFile: { url: "local" }, box: null }),
    ).rejects.toThrow("Only point clouds saved to the project can be exported.");
    expect(API.post).not.toHaveBeenCalled();
  });
});
