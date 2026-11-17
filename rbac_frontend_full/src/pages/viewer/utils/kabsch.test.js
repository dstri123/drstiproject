import * as THREE from "three";
import * as numeric from "numeric";
import { kabschAlgorithm, kabsch } from "./kabsch";

// Apply s * R * p + t to a {x,y,z} point.
function transform(p, R, t, s = 1) {
  const v = numeric.dot(R, [p.x, p.y, p.z]);
  return { x: s * v[0] + t[0], y: s * v[1] + t[1], z: s * v[2] + t[2] };
}

function rotationFromQuaternion(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements; // column-major
  return [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]],
  ];
}

const expectMatrixClose = (a, b, digits = 6) => {
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) expect(a[i][j]).toBeCloseTo(b[i][j], digits);
};

const SOURCE = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 0, y: 3, z: 0 },
  { x: 0, y: 0, z: 2 },
  { x: 1, y: 2, z: 5 },
];

describe("kabschAlgorithm", () => {
  test("identity when source equals target", () => {
    const { R, t, scale } = kabschAlgorithm(SOURCE, SOURCE);
    expectMatrixClose(R, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    t.forEach((v) => expect(v).toBeCloseTo(0, 6));
    expect(scale).toBeCloseTo(1, 6);
  });

  test("recovers a pure translation", () => {
    const shift = [10, -5, 2.5];
    const target = SOURCE.map((p) => ({
      x: p.x + shift[0],
      y: p.y + shift[1],
      z: p.z + shift[2],
    }));
    const { R, t, scale } = kabschAlgorithm(SOURCE, target);
    expectMatrixClose(R, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    t.forEach((v, i) => expect(v).toBeCloseTo(shift[i], 6));
    expect(scale).toBeCloseTo(1, 6);
  });

  test("recovers a 90 degree rotation about Z", () => {
    const Rz = [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    const target = SOURCE.map((p) => transform(p, Rz, [0, 0, 0]));
    const { R, t, scale } = kabschAlgorithm(SOURCE, target);
    expectMatrixClose(R, Rz);
    t.forEach((v) => expect(v).toBeCloseTo(0, 6));
    expect(scale).toBeCloseTo(1, 6);
  });

  test("recovers a general rotation + translation + uniform scale", () => {
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.3, -1.1, 2.0, "XYZ"))
      .normalize();
    const Rtrue = rotationFromQuaternion(q);
    const ttrue = [3.2, -7.5, 12];
    const strue = 0.001; // e.g. a millimetre cloud mapped onto a metre BIM
    const target = SOURCE.map((p) => transform(p, Rtrue, ttrue, strue));

    const { R, t, scale } = kabschAlgorithm(SOURCE, target);
    expectMatrixClose(R, Rtrue);
    expect(scale).toBeCloseTo(strue, 9);
    t.forEach((v, i) => expect(v).toBeCloseTo(ttrue[i], 6));

    // The returned transform maps every source point onto its target.
    SOURCE.forEach((p, i) => {
      const mapped = transform(p, R, t, scale);
      expect(mapped.x).toBeCloseTo(target[i].x, 6);
      expect(mapped.y).toBeCloseTo(target[i].y, 6);
      expect(mapped.z).toBeCloseTo(target[i].z, 6);
    });
  });

  test("works with exactly three (coplanar) point pairs", () => {
    const src = SOURCE.slice(0, 3);
    const Rtrue = rotationFromQuaternion(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 1, 0).normalize(),
        Math.PI / 3,
      ),
    );
    const target = src.map((p) => transform(p, Rtrue, [1, 2, 3], 2));
    const { R, t, scale } = kabschAlgorithm(src, target);
    expect(numeric.det(R)).toBeCloseTo(1, 6);
    expect(scale).toBeCloseTo(2, 6);
    src.forEach((p, i) => {
      const mapped = transform(p, R, t, scale);
      expect(mapped.x).toBeCloseTo(target[i].x, 6);
      expect(mapped.y).toBeCloseTo(target[i].y, 6);
      expect(mapped.z).toBeCloseTo(target[i].z, 6);
    });
  });

  test("always returns a proper rotation (det +1), never a reflection", () => {
    // Mirror the points through the YZ plane — no rotation can reproduce this.
    const mirrored = SOURCE.map((p) => ({ x: -p.x, y: p.y, z: p.z }));
    const { R } = kabschAlgorithm(SOURCE, mirrored);
    expect(numeric.det(R)).toBeCloseTo(1, 6);
    // R stays orthonormal
    const RtR = numeric.dot(numeric.transpose(R), R);
    expectMatrixClose(RtR, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  test("is robust to small noise on the target", () => {
    const Rz = [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    const noise = [0.001, -0.002, 0.0015, -0.001, 0.002];
    const target = SOURCE.map((p, i) => {
      const q = transform(p, Rz, [5, 5, 5]);
      return { x: q.x + noise[i], y: q.y - noise[i], z: q.z + noise[i] };
    });
    const { R, scale } = kabschAlgorithm(SOURCE, target);
    expectMatrixClose(R, Rz, 2);
    expect(scale).toBeCloseTo(1, 2);
  });

  test("throws when point counts differ", () => {
    expect(() => kabschAlgorithm(SOURCE, SOURCE.slice(0, 4))).toThrow(
      /same number of points/,
    );
  });

  test("throws with fewer than 3 pairs", () => {
    expect(() => kabschAlgorithm(SOURCE.slice(0, 2), SOURCE.slice(0, 2))).toThrow(
      /at least 3 pairs/,
    );
    expect(() => kabschAlgorithm([], [])).toThrow();
  });

  test("throws (instead of returning a NaN scale) when all source points coincide", () => {
    const same = [
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
    ];
    expect(() => kabschAlgorithm(same, SOURCE.slice(0, 3))).toThrow(
      /same location/,
    );
  });

  test("kabsch is an alias of kabschAlgorithm", () => {
    expect(kabsch).toBe(kabschAlgorithm);
  });
});
