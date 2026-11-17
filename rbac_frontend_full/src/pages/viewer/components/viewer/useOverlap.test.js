import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";
import useOverlap, { buildBimVoxels, cellKey, VOXEL } from "./useOverlap";

jest.mock("./useModelLoader", () => ({
  getSafeIfcType: (model, id) => model?.userData?.types?.[id] ?? null,
}));

function cloud(points) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points.flat()), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(points.length * 3).fill(0.5), 3));
  return new THREE.Points(g, new THREE.PointsMaterial());
}

function namedMesh(name, positions) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions.flat()), 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = name;
  return m;
}

// Indexed IFC mesh: vertices 0-2 are element 1 at x≈0, vertices 3-5 are
// element 2 at x≈10. The index lists element 2's triangle FIRST, so a lookup
// by index[vertex] instead of by vertex attributes the wrong element.
function ifcMesh() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 10, 0, 0, 10.01, 0, 0, 10, 0.01, 0]), 3),
  );
  g.setAttribute("expressID", new THREE.BufferAttribute(new Uint32Array([1, 1, 1, 2, 2, 2]), 1));
  g.setIndex([3, 4, 5, 0, 1, 2]);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.userData.types = { 1: "IFCWALL", 2: "IFCSLAB" };
  return mesh;
}

describe("cellKey / buildBimVoxels", () => {
  test("cellKey buckets by VOXEL size", () => {
    expect(VOXEL).toBe(0.15);
    expect(cellKey(new THREE.Vector3(0.1, 0.16, -0.01))).toBe("0,1,-1");
  });

  test("named (FBX) meshes become elements, in world space", () => {
    const group = new THREE.Group();
    const a = namedMesh("Wall_A", [[0, 0, 0]]);
    const parent = new THREE.Group();
    parent.name = "Door_P";
    const b = namedMesh("", [[1, 0, 0]]);
    parent.add(b);
    const c = namedMesh("", [[2, 0, 0]]);
    c.userData.elementName = "Fromuserdata";
    group.add(a, parent, c);
    group.position.set(3, 0, 0);
    const vox = buildBimVoxels(group);
    expect(vox.isIfc).toBe(false);
    expect(vox.elemNames).toEqual(["Wall_A", "Door_P", "Fromuserdata"]);
    expect(vox.occupied.has(cellKey(new THREE.Vector3(3, 0, 0)))).toBe(true);
    expect(vox.voxelToElems.get(cellKey(new THREE.Vector3(4, 0, 0)))).toEqual([1]);
    expect(vox.elemUuids[0]).toBe(a.uuid);
  });

  test("IFC vertices are attributed to their own element (not index[vertex])", () => {
    const vox = buildBimVoxels(ifcMesh());
    expect(vox.isIfc).toBe(true);
    const at0 = vox.voxelToElems.get(cellKey(new THREE.Vector3(0, 0, 0)));
    const at10 = vox.voxelToElems.get(cellKey(new THREE.Vector3(10, 0, 0)));
    expect(at0.map((i) => vox.elemIds[i])).toEqual([1]);
    expect(at10.map((i) => vox.elemIds[i])).toEqual([2]);
    expect(vox.elemNames[at0[0]]).toBe("IFCWALL #1");
  });
});

describe("useOverlap", () => {
  function setup({ highlightOverlap = true, bim, pc } = {}) {
    const canvas = document.createElement("canvas");
    const sceneData = { rendererRef: { current: { domElement: canvas } } };
    const modelData = {
      bimModel: bim || ifcMesh(),
      pcModel: pc || cloud([[0.05, 0.05, 0.05], [10.02, 0.01, 0], [50, 50, 50]]),
    };
    const cbs = {
      setOverlapElementCount: jest.fn(),
      setOverlapElementNames: jest.fn(),
      setOverlapCounts: jest.fn(),
    };
    const hook = renderHook((p) => useOverlap(sceneData, modelData, p), {
      initialProps: { highlightOverlap, ...cbs },
    });
    return { ...hook, canvas, modelData, cbs };
  }

  test("colours overlapping points green and reports per-element counts", () => {
    const { modelData, cbs } = setup();
    const col = modelData.pcModel.geometry.attributes.color.array;
    expect(Array.from(col.slice(0, 3))).toEqual([0, 1, 0]);
    expect(Array.from(col.slice(3, 6))).toEqual([0, 1, 0]);
    expect(Array.from(col.slice(6, 9))).toEqual([0.5, 0.5, 0.5]);
    expect(cbs.setOverlapElementCount).toHaveBeenCalledWith(2);
    expect(cbs.setOverlapElementNames).toHaveBeenCalledWith([
      { name: "IFCSLAB #2", count: 1 },
      { name: "IFCWALL #1", count: 1 },
    ]);
    const { byUuid, byExpressID } = cbs.setOverlapCounts.mock.calls[0][0];
    expect(byExpressID.get(1)).toBe(1);
    expect(byExpressID.get(2)).toBe(1);
    expect(byUuid.get(modelData.bimModel.uuid)).toBe(1);
  });

  test("turning it off restores the original colours and clears the names", () => {
    const { modelData, cbs, rerender } = setup();
    rerender({ highlightOverlap: false, ...cbs });
    expect(Array.from(modelData.pcModel.geometry.attributes.color.array.slice(0, 3))).toEqual([0.5, 0.5, 0.5]);
    expect(cbs.setOverlapElementNames).toHaveBeenLastCalledWith([]);
  });

  test("recomputes after a drag moved a model", () => {
    jest.useFakeTimers();
    const { modelData, cbs, canvas } = setup();
    expect(cbs.setOverlapElementCount).toHaveBeenLastCalledWith(2);
    modelData.pcModel.position.set(100, 0, 0);
    act(() => {
      canvas.dispatchEvent(new Event("pointerup"));
      jest.advanceTimersByTime(200);
    });
    expect(cbs.setOverlapElementCount).toHaveBeenLastCalledWith(0);
    // unchanged transforms → no recompute
    const calls = cbs.setOverlapElementCount.mock.calls.length;
    act(() => {
      canvas.dispatchEvent(new Event("pointerup"));
      jest.advanceTimersByTime(200);
    });
    expect(cbs.setOverlapElementCount.mock.calls.length).toBe(calls);
    jest.useRealTimers();
  });

  test("works with plain FBX meshes", () => {
    const bim = new THREE.Group();
    bim.add(namedMesh("Wall", [[0, 0, 0]]));
    const { cbs } = setup({ bim, pc: cloud([[0.01, 0.01, 0.01]]) });
    expect(cbs.setOverlapElementNames).toHaveBeenCalledWith([{ name: "Wall", count: 1 }]);
    expect(cbs.setOverlapCounts.mock.calls[0][0].byExpressID.size).toBe(0);
  });
});
