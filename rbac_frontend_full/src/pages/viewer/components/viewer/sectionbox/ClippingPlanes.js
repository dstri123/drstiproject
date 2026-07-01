import * as THREE from "three";

export function buildPlanesFromBox(min, max) {
  // planes: [right, left, top, bottom, front, back]
  return [
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(max.x, 0, 0),
    ),
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(min.x, 0, 0),
    ),
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, max.y, 0),
    ),
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, min.y, 0),
    ),
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, max.z),
    ),
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, min.z),
    ),
  ];
}

export function createSectionBoxBox3(objects = []) {
  const box = new THREE.Box3();
  objects.forEach((o) => {
    if (o) box.expandByObject(o);
  });
  if (box.isEmpty()) {
    box.set(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );
  }
  return box;
}
