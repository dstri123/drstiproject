import * as THREE from "three";
import { buildPlanesFromBox, createSectionBoxBox3 } from "./ClippingPlanes";

export default class SectionBoxManager {
  constructor({
    scene,
    camera,
    renderer,
    domElement,
    objects = [],
    onExtentsChange = null,
  } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.domElement = domElement;
    this.objects = objects;
    this.onExtentsChange = onExtentsChange;

    this.box = null;
    this.fullBox = null; // unchanging full extents — slider ranges/reset use this
    this.planes = [];
    this.edgeMesh = null;
    this.handleMeshes = [];
    this.dragging = { active: false };

    this.adjustedMin = new THREE.Vector3();
    this.adjustedMax = new THREE.Vector3();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
  }

  init() {
    if (!this.scene || !this.camera || !this.renderer) return;
    // compute initial box
    this.box = createSectionBoxBox3(this.objects);
    this.fullBox = this.box.clone();
    this.adjustedMin.copy(this.box.min);
    this.adjustedMax.copy(this.box.max);
    this.update();
    // attach pointer events
    if (this.domElement) {
      this.domElement.addEventListener("pointerdown", this.onPointerDown);
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    }
  }

  dispose() {
    if (this.domElement) {
      this.domElement.removeEventListener("pointerdown", this.onPointerDown);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
    }
    try {
      if (this.renderer) {
        this.renderer.localClippingEnabled = false;
        this.renderer.clippingPlanes = [];
      }
    } catch (e) {}
    this.clearClippingFromObjects();
    this.clearVisuals();
  }

  clearVisuals() {
    if (!this.scene) return;
    if (this.edgeMesh) {
      try {
        this.scene.remove(this.edgeMesh);
      } catch (e) {}
      this.edgeMesh.geometry.dispose();
      this.edgeMesh.material.dispose();
      this.edgeMesh = null;
    }
    if (this.edgeFillMesh) {
      try {
        this.scene.remove(this.edgeFillMesh);
      } catch (e) {}
      try {
        this.edgeFillMesh.geometry.dispose();
      } catch (e) {}
      try {
        this.edgeFillMesh.material.dispose();
      } catch (e) {}
      this.edgeFillMesh = null;
    }
    this.handleMeshes.forEach((h) => {
      try {
        this.scene.remove(h);
      } catch (e) {}
      try {
        h.geometry.dispose();
      } catch (e) {}
      try {
        h.material.dispose();
      } catch (e) {}
    });
    this.handleMeshes = [];
  }

  applyClippingToObjects() {
    if (!this.objects || !this.planes) return;
    this.objects.forEach((model) => {
      if (!model) return;
      model.traverse((obj) => {
        if (obj.isMesh || obj.isPoints) {
          const materials = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          materials.forEach((material) => {
            if (!material) return;
            material.clippingPlanes = this.planes;
            material.clipIntersection = false;
            material.needsUpdate = true;
          });
        }
      });
    });
  }

  clearClippingFromObjects() {
    if (!this.objects) return;
    this.objects.forEach((model) => {
      if (!model) return;
      model.traverse((obj) => {
        if (obj.isMesh || obj.isPoints) {
          const materials = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          materials.forEach((material) => {
            if (!material) return;
            material.clippingPlanes = [];
            material.needsUpdate = true;
          });
        }
      });
    });
  }

  update() {
    if (!this.scene || !this.renderer) return;
    // ensure min/max valid
    const min = this.adjustedMin.clone();
    const max = this.adjustedMax.clone();
    min.x = Math.min(min.x, max.x - 1e-6);
    min.y = Math.min(min.y, max.y - 1e-6);
    min.z = Math.min(min.z, max.z - 1e-6);
    max.x = Math.max(max.x, min.x + 1e-6);
    max.y = Math.max(max.y, min.y + 1e-6);
    max.z = Math.max(max.z, min.z + 1e-6);
    this.adjustedMin.copy(min);
    this.adjustedMax.copy(max);

    this.box = new THREE.Box3(min, max);
    this.planes = buildPlanesFromBox(min, max);
    this.renderer.localClippingEnabled = true;
    this.renderer.clippingPlanes = this.planes;
    this.applyClippingToObjects();

    // update visual box
    this.clearVisuals();
    const size = this.box.getSize(new THREE.Vector3());
    const center = this.box.getCenter(new THREE.Vector3());
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(geom);
    const mat = new THREE.LineBasicMaterial({
      color: 0x2563eb,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(edges, mat);
    lines.position.copy(center);
    lines.renderOrder = 1000;
    lines.material.transparent = true;
    this.scene.add(lines);
    this.edgeMesh = lines;
    // Play the subtle grow-in animation ONCE (on first enable). On later
    // updates (dragging handles / slider) the box is shown at full size
    // immediately — re-running the animation each update caused the flicker.
    if (!this.visualsAnimated) {
      this.visualsAnimated = true;
      lines.scale.set(0.001, 0.001, 0.001);
      lines.material.opacity = 0.0;
      const start = performance.now();
      const dur = 240;
      const animate = (t) => {
        const p = Math.min(1, (t - start) / dur);
        const s = 0.001 + (1 - 0.001) * p;
        if (this.edgeMesh) this.edgeMesh.scale.set(s, s, s);
        if (this.edgeMesh && this.edgeMesh.material)
          this.edgeMesh.material.opacity = p;
        if (p < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    } else {
      lines.scale.set(1, 1, 1);
      lines.material.opacity = 1;
    }

    // Filled semi-transparent helper (Revit-like). FrontSide so it's only
    // visible from OUTSIDE the box — with BackSide it rendered the inner faces
    // and flooded the whole screen blue whenever the camera went inside.
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const fillGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const fillMesh = new THREE.Mesh(fillGeom, fillMat);
    fillMesh.position.copy(center);
    fillMesh.renderOrder = 900;
    this.scene.add(fillMesh);
    this.edgeFillMesh = fillMesh;

    // handles (faces and corners)
    const boxMin = this.box.min;
    const boxMax = this.box.max;
    const faceNormals = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];
    const faceCenters = [
      new THREE.Vector3(
        boxMax.x,
        (boxMin.y + boxMax.y) / 2,
        (boxMin.z + boxMax.z) / 2,
      ),
      new THREE.Vector3(
        boxMin.x,
        (boxMin.y + boxMax.y) / 2,
        (boxMin.z + boxMax.z) / 2,
      ),
      new THREE.Vector3(
        (boxMin.x + boxMax.x) / 2,
        boxMax.y,
        (boxMin.z + boxMax.z) / 2,
      ),
      new THREE.Vector3(
        (boxMin.x + boxMax.x) / 2,
        boxMin.y,
        (boxMin.z + boxMax.z) / 2,
      ),
      new THREE.Vector3(
        (boxMin.x + boxMax.x) / 2,
        (boxMin.y + boxMax.y) / 2,
        boxMax.z,
      ),
      new THREE.Vector3(
        (boxMin.x + boxMax.x) / 2,
        (boxMin.y + boxMax.y) / 2,
        boxMin.z,
      ),
    ];
    const handleSize = Math.max(size.x, size.y, size.z) * 0.04;
    const createArrowMarker = (normal, size) => {
      const arrowMat = new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
      });
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.08, size * 0.08, size * 0.8, 10),
        arrowMat,
      );
      shaft.position.set(0, size * 0.4, 0);
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.2, size * 0.35, 12),
        arrowMat,
      );
      head.position.set(0, size * 0.8, 0);
      const arrowGroup = new THREE.Group();
      arrowGroup.add(shaft, head);
      arrowGroup.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        normal,
      );
      arrowGroup.position.copy(normal.clone().multiplyScalar(-size * 0.35));
      arrowGroup.scale.set(1.3, 1.3, 1.3);
      arrowGroup.traverse((child) => {
        if (child.isMesh) {
          child.renderOrder = 2001;
        }
      });
      return arrowGroup;
    };

    for (let i = 0; i < 6; i++) {
      const sphereGeom = new THREE.SphereGeometry(handleSize, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      });
      const handleGroup = new THREE.Group();
      const hm = new THREE.Mesh(sphereGeom, sphereMat);
      hm.position.set(0, 0, 0);
      hm.renderOrder = 2000;
      handleGroup.add(hm);
      const arrow = createArrowMarker(faceNormals[i].clone(), handleSize);
      handleGroup.add(arrow);
      handleGroup.position.copy(faceCenters[i]);
      handleGroup.userData = { faceIndex: i, normal: faceNormals[i].clone() };
      handleGroup.traverse((child) => {
        if (child.isMesh) {
          child.renderOrder = 2000;
        }
      });
      this.scene.add(handleGroup);
      this.handleMeshes.push(handleGroup);
    }

    // corners
    const cornerSigns = [
      [1, 1, 1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, -1, -1],
    ];
    const cornerSize = handleSize * 0.8;
    const cornerGeo = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize);
    const cornerMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < 8; i++) {
      const sx = cornerSigns[i][0] === 1 ? boxMax.x : boxMin.x;
      const sy = cornerSigns[i][1] === 1 ? boxMax.y : boxMin.y;
      const sz = cornerSigns[i][2] === 1 ? boxMax.z : boxMin.z;
      const cm = new THREE.Mesh(cornerGeo, cornerMat);
      cm.position.set(sx, sy, sz);
      cm.userData = { cornerIndex: i, signs: cornerSigns[i] };
      cm.renderOrder = 2000;
      this.scene.add(cm);
      this.handleMeshes.push(cm);
    }

    // Honour the box-display toggle (clipping stays active regardless).
    this.applyBoxVisibility();

    this.notify();
  }

  // Show/hide just the visual box (edges, fill, handles) WITHOUT touching the
  // clipping planes — so the user can crop the model but hide the blue box.
  applyBoxVisibility() {
    const vis = this.boxVisible !== false;
    if (this.edgeMesh) this.edgeMesh.visible = vis;
    if (this.edgeFillMesh) this.edgeFillMesh.visible = vis;
    (this.handleMeshes || []).forEach((m) => (m.visible = vis));
  }

  setBoxVisible(visible) {
    this.boxVisible = Boolean(visible);
    this.applyBoxVisibility();
  }

  // Build the {bounds, clip} shape the ClipBar slider UI expects and push it
  // to React so the sliders track handle drags (and vice-versa).
  notify() {
    if (!this.onExtentsChange || !this.fullBox) return;
    this.onExtentsChange({
      bounds: {
        x: [this.fullBox.min.x, this.fullBox.max.x],
        y: [this.fullBox.min.y, this.fullBox.max.y],
        z: [this.fullBox.min.z, this.fullBox.max.z],
      },
      clip: {
        x: [this.adjustedMin.x, this.adjustedMax.x],
        y: [this.adjustedMin.y, this.adjustedMax.y],
        z: [this.adjustedMin.z, this.adjustedMax.z],
      },
    });
  }

  // Driven by the X/Y/Z slider bar — crop one face of the box.
  setAxis(axis, which, rawValue) {
    if (!this.fullBox) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const lo = this.fullBox.min[axis];
    const hi = this.fullBox.max[axis];
    const clamped = Math.min(Math.max(value, lo), hi);
    if (which === 0) {
      this.adjustedMin[axis] = Math.min(clamped, this.adjustedMax[axis] - 1e-6);
    } else {
      this.adjustedMax[axis] = Math.max(clamped, this.adjustedMin[axis] + 1e-6);
    }
    this.update();
  }

  enable() {
    if (!this.box) {
      this.init();
      return;
    }
    // Preserve the current adjusted extents when re-enabling the section box.
    this.update();
  }

  disable() {
    // Turning the section box off must restore the full, un-clipped model —
    // otherwise a tight crop can leave the point cloud looking "disappeared".
    if (this.renderer) {
      try {
        this.renderer.clippingPlanes = [];
      } catch (e) {}
    }
    this.clearClippingFromObjects();
    this.clearVisuals();
    // Next enable should grow-in again.
    this.visualsAnimated = false;
  }

  reset() {
    this.box = createSectionBoxBox3(this.objects);
    this.fullBox = this.box.clone();
    this.adjustedMin.copy(this.box.min);
    this.adjustedMax.copy(this.box.max);
    this.update();
  }

  isolateFloor(floorPredicate) {
    // Example: hide all objects except those passing floorPredicate
    this.objects.forEach((m) => {
      m.traverse((o) => {
        if (o.isMesh) {
          o.visible = Boolean(floorPredicate ? floorPredicate(o) : true);
        }
      });
    });
  }

  // Pointer handlers implement face/corner dragging similar to inline implementation
  onPointerDown(e) {
    if (!this.edgeMesh) return;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hits = ray.intersectObjects(this.handleMeshes, true);
    if (hits.length > 0) {
      let hit = hits[0].object;
      while (
        hit &&
        hit.userData &&
        hit.userData.faceIndex === undefined &&
        hit.userData.cornerIndex === undefined
      ) {
        hit = hit.parent;
      }
      if (!hit || !hit.userData) return;
      if (hit.userData.faceIndex !== undefined) {
        const normal = hit.userData.normal.clone();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          normal,
          hit.position,
        );
        const start = new THREE.Vector3();
        ray.ray.intersectPlane(plane, start);
        this.dragging = {
          mode: "face",
          active: true,
          moved: false,
          handle: hit,
          startPoint: start.clone(),
          startOffsets: {
            min: this.adjustedMin.clone(),
            max: this.adjustedMax.clone(),
          },
        };
      } else if (hit.userData && hit.userData.cornerIndex !== undefined) {
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camDir,
          hit.position,
        );
        const start = new THREE.Vector3();
        ray.ray.intersectPlane(plane, start);
        this.dragging = {
          mode: "corner",
          active: true,
          handle: hit,
          startPoint: start.clone(),
          startOffsets: {
            min: this.adjustedMin.clone(),
            max: this.adjustedMax.clone(),
          },
        };
      }
      e.preventDefault();
    }
  }

  onPointerMove(e) {
    if (!this.dragging.active) return;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const h = this.dragging.handle;
    const curr = new THREE.Vector3();
    if (this.dragging.mode === "face") {
      const normal = h.userData.normal.clone();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        h.position,
      );
      ray.ray.intersectPlane(plane, curr);
      if (!curr) return;
      const delta = normal.dot(curr.clone().sub(this.dragging.startPoint));
      if (Math.abs(delta) > 1e-4) {
        this.dragging.moved = true;
      }
      const startMin = this.dragging.startOffsets.min.clone();
      const startMax = this.dragging.startOffsets.max.clone();
      const faceIndex = h.userData.faceIndex;
      if (faceIndex === 0) startMax.x += delta;
      if (faceIndex === 1) startMin.x += delta;
      if (faceIndex === 2) startMax.y += delta;
      if (faceIndex === 3) startMin.y += delta;
      if (faceIndex === 4) startMax.z += delta;
      if (faceIndex === 5) startMin.z += delta;
      this.adjustedMin.copy(startMin);
      this.adjustedMax.copy(startMax);
      this.update();
    } else if (this.dragging.mode === "corner") {
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camDir,
        h.position,
      );
      ray.ray.intersectPlane(plane, curr);
      if (!curr) return;
      const deltaVec = curr.clone().sub(this.dragging.startPoint);
      const startMin = this.dragging.startOffsets.min.clone();
      const startMax = this.dragging.startOffsets.max.clone();
      const signs = h.userData.signs || [1, 1, 1];
      const dx = deltaVec.dot(new THREE.Vector3(1, 0, 0));
      const dy = deltaVec.dot(new THREE.Vector3(0, 1, 0));
      const dz = deltaVec.dot(new THREE.Vector3(0, 0, 1));
      if (signs[0] === 1) startMax.x = startMax.x + dx;
      else startMin.x = startMin.x + dx;
      if (signs[1] === 1) startMax.y = startMax.y + dy;
      else startMin.y = startMin.y + dy;
      if (signs[2] === 1) startMax.z = startMax.z + dz;
      else startMin.z = startMin.z + dz;
      this.adjustedMin.copy(startMin);
      this.adjustedMax.copy(startMax);
      this.adjustedMin.x = Math.min(
        this.adjustedMin.x,
        this.adjustedMax.x - 1e-6,
      );
      this.adjustedMin.y = Math.min(
        this.adjustedMin.y,
        this.adjustedMax.y - 1e-6,
      );
      this.adjustedMin.z = Math.min(
        this.adjustedMin.z,
        this.adjustedMax.z - 1e-6,
      );
      this.update();
    }
    e.preventDefault();
  }

  onPointerUp() {
    if (!this.dragging.active) return;
    if (
      this.dragging.mode === "face" &&
      !this.dragging.moved &&
      this.dragging.handle &&
      this.dragging.handle.userData
    ) {
      const faceIndex = this.dragging.handle.userData.faceIndex;
      const size = this.box.getSize(new THREE.Vector3());
      const step = Math.max(size.x, size.y, size.z) * 0.085;
      const startMin = this.dragging.startOffsets.min.clone();
      const startMax = this.dragging.startOffsets.max.clone();
      if (faceIndex === 0) startMax.x -= step;
      if (faceIndex === 1) startMin.x += step;
      if (faceIndex === 2) startMax.y -= step;
      if (faceIndex === 3) startMin.y += step;
      if (faceIndex === 4) startMax.z -= step;
      if (faceIndex === 5) startMin.z += step;
      this.adjustedMin.copy(startMin);
      this.adjustedMax.copy(startMax);
      this.update();
    }
    this.dragging = { active: false };
  }
}
