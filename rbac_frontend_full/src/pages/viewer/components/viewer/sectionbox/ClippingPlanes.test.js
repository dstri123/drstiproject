import * as THREE from "three";
import { buildPlanesFromBox, createSectionBoxBox3 } from "./ClippingPlanes";

// three.js clips fragments where plane.distanceToPoint(p) < 0, so a point is
// kept only if it is on the positive side of every plane.
const keptBy = (planes, p) => planes.every((pl) => pl.distanceToPoint(p) >= 0);

describe("buildPlanesFromBox", () => {
  const min = new THREE.Vector3(-1, 0, 2);
  const max = new THREE.Vector3(3, 5, 4);
  const planes = buildPlanesFromBox(min, max);

  test("returns six planes [right, left, top, bottom, front, back]", () => {
    expect(planes).toHaveLength(6);
    const normals = planes.map((p) => p.normal.toArray());
    expect(normals).toEqual([
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ]);
    // Each plane passes through its face of the box.
    expect(planes[0].distanceToPoint(new THREE.Vector3(3, 1, 3))).toBeCloseTo(0);
    expect(planes[1].distanceToPoint(new THREE.Vector3(-1, 1, 3))).toBeCloseTo(0);
    expect(planes[2].distanceToPoint(new THREE.Vector3(0, 5, 3))).toBeCloseTo(0);
    expect(planes[3].distanceToPoint(new THREE.Vector3(0, 0, 3))).toBeCloseTo(0);
    expect(planes[4].distanceToPoint(new THREE.Vector3(0, 1, 4))).toBeCloseTo(0);
    expect(planes[5].distanceToPoint(new THREE.Vector3(0, 1, 2))).toBeCloseTo(0);
  });

  test("keeps points inside the box and clips points outside any face", () => {
    expect(keptBy(planes, new THREE.Vector3(1, 2.5, 3))).toBe(true);
    expect(keptBy(planes, min)).toBe(true);
    expect(keptBy(planes, max)).toBe(true);
    expect(keptBy(planes, new THREE.Vector3(3.01, 2, 3))).toBe(false);
    expect(keptBy(planes, new THREE.Vector3(-1.01, 2, 3))).toBe(false);
    expect(keptBy(planes, new THREE.Vector3(1, 5.01, 3))).toBe(false);
    expect(keptBy(planes, new THREE.Vector3(1, -0.01, 3))).toBe(false);
    expect(keptBy(planes, new THREE.Vector3(1, 2, 4.01))).toBe(false);
    expect(keptBy(planes, new THREE.Vector3(1, 2, 1.99))).toBe(false);
  });
});

describe("createSectionBoxBox3", () => {
  test("wraps all given objects", () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    b.position.set(10, 0, 0);
    b.updateMatrixWorld(true);
    const box = createSectionBoxBox3([a, null, b]);
    expect(box.min.toArray()).toEqual([-1, -1, -1]);
    expect(box.max.toArray()).toEqual([11, 1, 1]);
  });

  test("falls back to a unit box when there is nothing to wrap", () => {
    for (const objs of [undefined, [], [null], [new THREE.Group()]]) {
      const box = createSectionBoxBox3(objs);
      expect(box.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
      expect(box.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    }
  });
});
