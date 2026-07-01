import { useEffect, useRef } from "react";
import * as THREE from "three";

// ─── Axis definitions ───────────────────────────────────────────────────────
const AXIS_DEFS = [
  { name: "x", color: 0xef4444, highlight: 0xff8a8a, dir: new THREE.Vector3(1, 0, 0) },
  { name: "y", color: 0x22c55e, highlight: 0x86efac, dir: new THREE.Vector3(0, 1, 0) },
  { name: "z", color: 0x3b82f6, highlight: 0x93c5fd, dir: new THREE.Vector3(0, 0, 1) },
];

// ─── Material factory ────────────────────────────────────────────────────────
function mat(color, opacity = 1.0) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ─── Build arrow for one axis ────────────────────────────────────────────────
function buildArrow(axisName, color, dir) {
  const group = new THREE.Group();
  group.userData = { gizmoType: "translate", axis: axisName };

  // Shaft (slimmer for a cleaner look)
  const shaftGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.8, 12);
  const shaft = new THREE.Mesh(shaftGeo, mat(color, 0.95));
  shaft.position.y = 0.44;
  shaft.userData = { gizmoType: "translate", axis: axisName };
  group.add(shaft);

  // Cone tip
  const coneGeo = new THREE.ConeGeometry(0.055, 0.2, 14);
  const cone = new THREE.Mesh(coneGeo, mat(color, 0.92));
  cone.position.y = 0.94;
  cone.userData = { gizmoType: "translate", axis: axisName };
  group.add(cone);

  // Transparent hit area (wider, invisible)
  const hitGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8);
  const hitMesh = new THREE.Mesh(hitGeo, mat(color, 0.001));
  hitMesh.position.y = 0.6;
  hitMesh.userData = { gizmoType: "translate", axis: axisName };
  group.add(hitMesh);

  // Orient to axis direction
  if (dir.x === 1) group.rotation.z = -Math.PI / 2;
  if (dir.z === 1) group.rotation.x = Math.PI / 2;

  return group;
}

// ─── Build rotation ring for one axis ────────────────────────────────────────
function buildRing(axisName, color, dir) {
  const geo = new THREE.TorusGeometry(0.9, 0.014, 12, 96);
  const ring = new THREE.Mesh(geo, mat(color, 0.85));
  ring.userData = { gizmoType: "rotate", axis: axisName };
  ring.renderOrder = 998;

  // Orient ring plane to be perpendicular to its axis
  if (dir.x === 1) ring.rotation.y = Math.PI / 2; // YZ plane
  if (dir.y === 1) ring.rotation.x = Math.PI / 2; // XZ plane
  // Z ring: XY plane, no rotation needed

  // Wider invisible hit tube around the ring
  const hitGeo = new THREE.TorusGeometry(0.9, 0.1, 6, 72);
  const hitRing = new THREE.Mesh(hitGeo, mat(color, 0.001));
  hitRing.userData = { gizmoType: "rotate", axis: axisName };
  if (dir.x === 1) hitRing.rotation.y = Math.PI / 2;
  if (dir.y === 1) hitRing.rotation.x = Math.PI / 2;

  const group = new THREE.Group();
  group.add(ring);
  group.add(hitRing);
  return group;
}

// ─── Build full gizmo group ──────────────────────────────────────────────────
function buildGizmo() {
  const root = new THREE.Group();
  root.renderOrder = 999;

  const arrowMeshes = {};
  const ringMeshes = {};

  for (const def of AXIS_DEFS) {
    const arrow = buildArrow(def.name, def.color, def.dir);
    root.add(arrow);
    arrowMeshes[def.name] = arrow;

    const ring = buildRing(def.name, def.color, def.dir);
    root.add(ring);
    ringMeshes[def.name] = ring;
  }

  // Center sphere
  const sphereGeo = new THREE.SphereGeometry(0.06, 16, 16);
  const center = new THREE.Mesh(sphereGeo, mat(0xffffff, 0.95));
  center.userData = { gizmoType: "center" };
  root.add(center);

  return { root, arrowMeshes, ringMeshes };
}

// ─── Set highlight on axis meshes ─────────────────────────────────────────────
function setHighlight(root, axisName, gizmoType, on) {
  const def = AXIS_DEFS.find((d) => d.name === axisName);
  if (!def) return;
  root.traverse((child) => {
    if (
      child.isMesh &&
      child.userData.axis === axisName &&
      child.userData.gizmoType === gizmoType
    ) {
      child.material.color.setHex(on ? def.highlight : def.color);
      const baseOpacity = gizmoType === "rotate" ? 0.7 : 0.92;
      child.material.opacity = on ? 1.0 : baseOpacity;
    }
  });
}

// ─── Main hook ───────────────────────────────────────────────────────────────
export default function useBlenderTransformGizmo(sceneData, selectedObject) {
  const { sceneRef, cameraRef, rendererRef, controlsRef } = sceneData;

  const gizmoRef = useRef(null);
  const selectedRef = useRef(selectedObject);
  const dragRef = useRef({
    active: false,
    type: null,   // "translate" | "rotate"
    axis: null,   // "x" | "y" | "z"
    prevX: 0,
    prevY: 0,
    hoveredAxis: null,
    hoveredType: null,
  });

  // Keep selectedRef in sync
  useEffect(() => {
    selectedRef.current = selectedObject;
  }, [selectedObject]);

  // Build gizmo once
  useEffect(() => {
    gizmoRef.current = buildGizmo();
  }, []);

  // Add/remove from scene when selection changes
  useEffect(() => {
    const scene = sceneRef?.current;
    const gizmo = gizmoRef.current;
    if (!scene || !gizmo) return;

    if (selectedObject) {
      scene.add(gizmo.root);
    } else {
      scene.remove(gizmo.root);
    }

    return () => {
      scene.remove(gizmo.root);
    };
  }, [selectedObject, sceneRef]);

  // Per-frame position + scale update
  useEffect(() => {
    const camera = cameraRef?.current;
    const gizmo = gizmoRef.current;
    if (!camera || !gizmo) return;

    let rafId;
    const _box = new THREE.Box3();
    const _center = new THREE.Vector3();

    const tick = () => {
      const obj = selectedRef.current;
      if (obj && gizmo.root.parent) {
        _box.setFromObject(obj);
        _box.getCenter(_center);
        gizmo.root.position.copy(_center);

        // Scale so gizmo stays a fixed apparent size regardless of zoom
        const dist = camera.position.distanceTo(_center);
        const fovRad = (camera.fov * Math.PI) / 180;
        const scale = dist * Math.tan(fovRad / 2) * 0.28;
        gizmo.root.scale.setScalar(scale);
      }
      rafId = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(rafId);
  }, [selectedObject, cameraRef]);

  // Mouse interaction
  useEffect(() => {
    const renderer = rendererRef?.current;
    const controls = controlsRef?.current;
    if (!renderer) return;

    const dom = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.1 };
    const mouse = new THREE.Vector2();
    const drag = dragRef.current;

    const collectHitMeshes = () => {
      const gizmo = gizmoRef.current;
      if (!gizmo) return [];
      const out = [];
      gizmo.root.traverse((c) => {
        if (c.isMesh && c.userData.gizmoType && c.userData.gizmoType !== "center") {
          out.push(c);
        }
      });
      return out;
    };

    const resetHighlights = () => {
      const gizmo = gizmoRef.current;
      if (!gizmo) return;
      for (const def of AXIS_DEFS) {
        setHighlight(gizmo.root, def.name, "translate", false);
        setHighlight(gizmo.root, def.name, "rotate", false);
      }
    };

    const onMouseMove = (e) => {
      const camera = cameraRef?.current;
      const gizmo = gizmoRef.current;
      const obj = selectedRef.current;
      if (!camera || !gizmo || !obj) return;

      const rect = dom.getBoundingClientRect();

      if (drag.active) {
        const dx = e.clientX - drag.prevX;
        const dy = e.clientY - drag.prevY;
        drag.prevX = e.clientX;
        drag.prevY = e.clientY;

        const axisVec = AXIS_DEFS.find((d) => d.name === drag.axis)?.dir.clone();
        if (!axisVec) return;

        if (drag.type === "translate") {
          // Project world axis onto screen to find dominant mouse direction
          const origin = gizmo.root.position.clone().project(camera);
          const tip = gizmo.root.position.clone().add(axisVec).project(camera);

          const screenAxis = new THREE.Vector2(
            tip.x - origin.x,
            -(tip.y - origin.y) // flip y
          );
          const screenLen = screenAxis.length();
          if (screenLen < 0.001) return;
          screenAxis.divideScalar(screenLen);

          const mouseDelta = new THREE.Vector2(
            (dx / rect.width) * 2,
            (dy / rect.height) * 2
          );

          const movement = mouseDelta.dot(screenAxis);
          const dist = camera.position.distanceTo(gizmo.root.position);
          obj.position.addScaledVector(axisVec, movement * dist * 1.6);
        }

        if (drag.type === "rotate") {
          const speed = 0.025;
          const angle = (dx - dy * 0.3) * speed;
          const q = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
          obj.quaternion.premultiply(q);
        }

        return;
      }

      // Hover detection
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const hits = raycaster.intersectObjects(collectHitMeshes(), false);
      resetHighlights();

      if (hits.length > 0) {
        const { gizmoType, axis } = hits[0].object.userData;
        if (axis && gizmoType) {
          setHighlight(gizmo.root, axis, gizmoType, true);
          drag.hoveredAxis = axis;
          drag.hoveredType = gizmoType;
          dom.style.cursor = "grab";
        }
      } else {
        drag.hoveredAxis = null;
        drag.hoveredType = null;
        dom.style.cursor = "";
      }
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const camera = cameraRef?.current;
      const gizmo = gizmoRef.current;
      const obj = selectedRef.current;
      if (!camera || !gizmo || !obj) return;

      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const hits = raycaster.intersectObjects(collectHitMeshes(), false);
      if (hits.length > 0) {
        const { gizmoType, axis } = hits[0].object.userData;
        if (axis && gizmoType) {
          drag.active = true;
          drag.type = gizmoType;
          drag.axis = axis;
          drag.prevX = e.clientX;
          drag.prevY = e.clientY;
          if (controls) controls.enabled = false;
          dom.style.cursor = "grabbing";
          e.stopPropagation();
        }
      }
    };

    const onMouseUp = () => {
      if (drag.active) {
        drag.active = false;
        drag.type = null;
        drag.axis = null;
        if (controls) controls.enabled = true;
        dom.style.cursor = "";
      }
    };

    dom.addEventListener("mousemove", onMouseMove);
    dom.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      dom.removeEventListener("mousemove", onMouseMove);
      dom.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [sceneRef, cameraRef, rendererRef, controlsRef]);
}
