import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";
import useSAMProgressDetection from "./useSAMProgressDetection";
import { segmentUrlOnce } from "./useConstructionSegmentation";

jest.mock("./useConstructionSegmentation", () => ({ segmentUrlOnce: jest.fn() }));
jest.mock("./useModelLoader", () => ({ getSafeIfcType: () => "IFCWALL" }));

const PTS = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [-0.5, 0.2, 0],
];

function makeCloud() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PTS.flat()), 3));
  return new THREE.Points(g, new THREE.PointsMaterial());
}

function makeIfc() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PTS.flat()), 3));
  g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array([7, 7, 7]), 1));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

function makeCamera(image = "http://img/1.jpg") {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.userData = { image };
  return cam;
}

const fullMask = (classKey, w = 8, h = 8) => ({
  imageWidth: w,
  imageHeight: h,
  masks: [{ classKey, area: w * h, segmentation: new Array(w * h).fill(true) }],
});

describe("useSAMProgressDetection", () => {
  test("labels overlapping points from the photos and counts them per IFC element", async () => {
    segmentUrlOnce.mockResolvedValue(fullMask("concrete"));
    const cams = [makeCamera(), makeCamera(null), Object.assign(makeCamera(), { userData: { image: "b", isBubble: true } })];
    const { result } = renderHook(() =>
      useSAMProgressDetection({ pcModel: makeCloud(), bimModel: makeIfc() }, cams),
    );
    let out;
    await act(async () => {
      out = await result.current.runDetection();
    });
    expect(segmentUrlOnce).toHaveBeenCalledTimes(1);
    expect(segmentUrlOnce).toHaveBeenCalledWith("http://img/1.jpg");
    expect(out.photosUsed).toBe(1);
    expect(out.photosFailed).toBe(0);
    expect(out.labeledPoints).toBe(3);
    expect(out.elements).toEqual({ 7: { points: 3, built: 3, partial: 0, clutter: 0 } });
    expect(result.current.isDetecting).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  test("rebar votes count as partial", async () => {
    segmentUrlOnce.mockResolvedValue(fullMask("rebar"));
    const { result } = renderHook(() =>
      useSAMProgressDetection({ pcModel: makeCloud(), bimModel: makeIfc() }, [makeCamera()]),
    );
    let out;
    await act(async () => {
      out = await result.current.runDetection();
    });
    expect(out.elements[7]).toEqual({ points: 3, built: 0, partial: 3, clutter: 0 });
  });

  test("errors: missing models, no photos, unreachable service, nothing visible, non-IFC", async () => {
    const run = async (modelData, cams) => {
      const { result } = renderHook(() => useSAMProgressDetection(modelData, cams));
      let err;
      await act(async () => {
        try {
          await result.current.runDetection();
        } catch (e) {
          err = e;
        }
      });
      return err?.message;
    };
    expect(await run({ pcModel: makeCloud() }, [])).toBe("Load both a BIM and a Point Cloud first.");
    expect(await run({ pcModel: makeCloud(), bimModel: makeIfc() }, [])).toMatch(/No posed site photos/);

    segmentUrlOnce.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await run({ pcModel: makeCloud(), bimModel: makeIfc() }, [makeCamera()])).toMatch(
      /not reachable at http:\/\/localhost:8001/,
    );

    segmentUrlOnce.mockRejectedValue(new Error("500"));
    expect(await run({ pcModel: makeCloud(), bimModel: makeIfc() }, [makeCamera()])).toBe(
      "SAM failed on 1 photo(s) and no labels reached the point cloud.",
    );

    const away = makeCamera();
    away.lookAt(0, 0, 100); // facing away from the cloud
    away.updateMatrixWorld(true);
    segmentUrlOnce.mockResolvedValue(fullMask("concrete"));
    expect(await run({ pcModel: makeCloud(), bimModel: makeIfc() }, [away])).toMatch(/None of the photos see/);

    const fbx = new THREE.Mesh(makeIfc().geometry.clone().deleteAttribute("expressID"), new THREE.MeshBasicMaterial());
    expect(await run({ pcModel: makeCloud(), bimModel: fbx }, [makeCamera()])).toMatch(/needs an IFC model/);
  });
});
