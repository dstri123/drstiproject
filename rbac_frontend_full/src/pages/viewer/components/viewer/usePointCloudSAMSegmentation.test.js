import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";
import usePointCloudSAMSegmentation from "./usePointCloudSAMSegmentation";

function tower() {
  // 1 x 10 x 1 column of points (Y is the tall axis), 100 points.
  const pos = [];
  for (let i = 0; i < 100; i++) pos.push((i % 3) * 0.5, i * 0.1, ((i * 7) % 3) * 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.Uint8BufferAttribute(new Uint8Array(300).fill(9), 3, true));
  return new THREE.Points(g, new THREE.PointsMaterial());
}

describe("usePointCloudSAMSegmentation", () => {
  test("paints semantic colours, summarises them, and toggles back", async () => {
    const pcModel = tower();
    const { result } = renderHook(() => usePointCloudSAMSegmentation({ pcModel }));
    await act(async () => result.current.toggleSemanticSegmentation());

    expect(result.current.isSemanticActive).toBe(true);
    const col = pcModel.geometry.attributes.color.array;
    // lowest point is ground (brown)
    expect(Array.from(col.slice(0, 3))).toEqual([101, 67, 33]);
    // highest point → equipment colour bucket (vNorm > 0.75, no other rule)
    const summary = result.current.semanticSummary;
    expect(summary.reduce((s, c) => s + c.count, 0)).toBe(100);
    expect(summary.find((c) => c.key === "ground").count).toBeGreaterThan(0);
    // sorted by count, descending
    for (let i = 1; i < summary.length; i++) expect(summary[i - 1].count).toBeGreaterThanOrEqual(summary[i].count);
    expect(result.current.isRunning).toBe(false);

    await act(async () => result.current.toggleSemanticSegmentation());
    expect(result.current.isSemanticActive).toBe(false);
    expect(Array.from(col.slice(0, 3))).toEqual([9, 9, 9]);

    // second activation reuses the cached colours
    await act(async () => result.current.toggleSemanticSegmentation());
    expect(Array.from(col.slice(0, 3))).toEqual([101, 67, 33]);
  });

  test("without a point cloud it does nothing", async () => {
    const { result } = renderHook(() => usePointCloudSAMSegmentation({ pcModel: null }));
    await act(async () => result.current.toggleSemanticSegmentation());
    expect(result.current.isSemanticActive).toBe(false);
    expect(result.current.semanticSummary).toBeNull();
  });
});
