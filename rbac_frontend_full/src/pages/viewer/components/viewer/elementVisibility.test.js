import * as THREE from "three";
import { applyHiddenElements } from "./elementVisibility";

// Merged IFC mesh: 3 triangles, triangle 0 + 1 belong to element 10, triangle 2
// to element 20 (expressID is per-vertex, like web-ifc-three).
function makeIfcModel() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(9 * 3), 3),
  );
  geometry.setAttribute(
    "expressID",
    new THREE.BufferAttribute(new Uint32Array([10, 10, 10, 10, 10, 10, 20, 20, 20]), 1),
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  return { group, geometry };
}

describe("applyHiddenElements", () => {
  test("does nothing without a model", () => {
    expect(() => applyHiddenElements(null, ["IFCWALL #1"])).not.toThrow();
  });

  test("collapses the triangles of a hidden IFC element and restores them", () => {
    const { group, geometry } = makeIfcModel();
    const version = geometry.index.version;

    applyHiddenElements(group, ["IFCWALL #10"]);
    expect(Array.from(geometry.index.array)).toEqual([0, 0, 0, 3, 3, 3, 6, 7, 8]);
    expect(geometry.index.version).toBeGreaterThan(version);

    // Hide a different element — must start from the original list, so 10 comes back.
    applyHiddenElements(group, ["IFCSLAB #20"]);
    expect(Array.from(geometry.index.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 6, 6]);

    // Show everything again.
    applyHiddenElements(group, []);
    expect(Array.from(geometry.index.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("leaves an IFC geometry untouched when nothing has ever been hidden", () => {
    const { group, geometry } = makeIfcModel();
    const version = geometry.index.version;
    applyHiddenElements(group, []);
    expect(geometry.index.version).toBe(version);
    expect(Array.from(geometry.index.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("toggles .visible on non-IFC (FBX) meshes by name or parent name", () => {
    const geo = new THREE.BoxGeometry();
    const wall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    wall.name = "Basic_Wall_1";
    const unnamedParent = new THREE.Group();
    unnamedParent.name = "Door_7";
    const doorMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    unnamedParent.add(doorMesh);
    const nameless = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const root = new THREE.Group();
    root.add(wall, unnamedParent, nameless);

    applyHiddenElements(root, ["Basic_Wall_1", "Door_7"]);
    expect(wall.visible).toBe(false);
    expect(doorMesh.visible).toBe(false);
    expect(nameless.visible).toBe(true);

    applyHiddenElements(root, ["Door_7"]);
    expect(wall.visible).toBe(true);
    expect(doorMesh.visible).toBe(false);
  });

  test("ignores labels that are not '<type> #<id>' when matching IFC ids", () => {
    const { group, geometry } = makeIfcModel();
    applyHiddenElements(group, ["Wall 10", "#abc"]);
    expect(Array.from(geometry.index.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
