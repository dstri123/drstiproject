import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

const WALK_SPEED = 2.0;
const RUN_MULTIPLIER = 2.5;
const EYE_HEIGHT = 1.65;
const GRAVITY = 9.81;
const JUMP_VELOCITY = 4.5;
const STEP_HEIGHT = 0.45;
const COLLISION_RADIUS = 0.3;

/**
 * Inspiration: IFCtoFDS SceneViewer walk mode
 * Adds first-person walk navigation with gravity, jump, WASD controls,
 * collision against BIM/PC geometry, and PointerLockControls.
 *
 * Usage:
 *   const walkMode = useWalkMode(sceneData, modelData);
 *   // walkMode.isWalking — current state
 *   // walkMode.toggle()  — enter/exit walk mode
 */
export function useWalkMode(sceneData, modelData) {
  const stateRef = useRef({
    active: false,
    placed: false,
    velocityY: 0,
    floorY: 0,
    savedCamera: null,
    movement: { forward: false, backward: false, left: false, right: false, jump: false, fast: false },
    lastTime: 0,
  });
  const lockControlsRef = useRef(null);
  const rafRef = useRef(null);
  const listenersRef = useRef([]);
  const callbacksRef = useRef({ onEnter: null, onExit: null, onStatus: null });

  const getCollisionMeshes = useCallback(() => {
    const meshes = [];
    if (!modelData) return meshes;
    const { bimModel, pcModel } = modelData;
    if (bimModel) bimModel.traverse(n => { if (n.isMesh && n.visible) meshes.push(n); });
    if (pcModel && pcModel.isMesh) meshes.push(pcModel);
    return meshes;
  }, [modelData]);

  const raycastDown = useCallback((x, z, fromY, meshes) => {
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    raycaster.far = 200;
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      if (!hit.face) continue;
      const normal = hit.face.normal.clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize();
      if (normal.y >= 0.2) return hit.point.y;
    }
    return null;
  }, []);

  const resolveHorizontal = useCallback((from, toX, toZ, meshes) => {
    const dx = toX - from.x;
    const dz = toZ - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return { x: from.x, z: from.z };

    const dir = new THREE.Vector3(dx / len, 0, dz / len);
    const raycaster = new THREE.Raycaster();
    let minDist = Infinity;

    for (const probeY of [from.y, from.y - EYE_HEIGHT * 0.5]) {
      raycaster.set(new THREE.Vector3(from.x, probeY, from.z), dir);
      raycaster.far = len + COLLISION_RADIUS;
      const hits = raycaster.intersectObjects(meshes, false);
      for (const hit of hits) {
        if (hit.object.userData?.surf_id === 'IFC_DOOR') continue;
        if (hit.distance < minDist) minDist = hit.distance;
        break;
      }
    }

    const allowed = minDist < Infinity ? Math.max(0, minDist - COLLISION_RADIUS) : len;
    return { x: from.x + dir.x * allowed, z: from.z + dir.z * allowed };
  }, []);

  const setStatus = useCallback((text) => {
    callbacksRef.current.onStatus?.(text);
  }, []);

  const exitWalk = useCallback(() => {
    const s = stateRef.current;
    const { camera, controls, renderer } = sceneData || {};
    if (!s.active) return;

    s.active = false;
    s.placed = false;
    s.velocityY = 0;
    Object.keys(s.movement).forEach(k => { s.movement[k] = false; });

    if (lockControlsRef.current?.isLocked) lockControlsRef.current.unlock();
    if (lockControlsRef.current) {
      lockControlsRef.current.disconnect();
      lockControlsRef.current = null;
    }
    if (controls) controls.enabled = true;

    if (s.savedCamera && camera && controls) {
      camera.position.copy(s.savedCamera.position);
      camera.quaternion.copy(s.savedCamera.quaternion);
      controls.target.copy(s.savedCamera.target);
      controls.update();
      s.savedCamera = null;
    }

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setStatus('');
    callbacksRef.current.onExit?.();
  }, [sceneData, setStatus]);

  const placeWalker = useCallback((point) => {
    const { camera } = sceneData || {};
    if (!camera) return;
    const s = stateRef.current;
    const eye = new THREE.Vector3(point.x, point.y + EYE_HEIGHT, point.z);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    dir.y = 0;
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, -1);
    dir.normalize();
    camera.position.copy(eye);
    camera.lookAt(eye.clone().add(dir));
    s.placed = true;
    s.velocityY = 0;
    s.floorY = point.y;
    setStatus('Walking — WASD to move, Space to jump, Shift to run, Esc to exit');
    if (lockControlsRef.current && !lockControlsRef.current.isLocked) {
      lockControlsRef.current.lock();
    }
  }, [sceneData, setStatus]);

  const handleClick = useCallback((e) => {
    const s = stateRef.current;
    const { camera, renderer } = sceneData || {};
    if (!s.active || !camera || !renderer) return;

    if (s.placed) {
      if (lockControlsRef.current && !lockControlsRef.current.isLocked) {
        lockControlsRef.current.lock();
      }
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const meshes = getCollisionMeshes();
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const anchor = hits[0].point.clone();
      const floorY = raycastDown(anchor.x, anchor.z, anchor.y + 50, meshes);
      placeWalker(new THREE.Vector3(anchor.x, floorY ?? s.floorY, anchor.z));
    } else {
      setStatus('Click a floor or surface to start walking');
    }
  }, [sceneData, getCollisionMeshes, raycastDown, placeWalker, setStatus]);

  const animate = useCallback((time) => {
    const s = stateRef.current;
    if (!s.active || !s.placed) return;
    const { camera } = sceneData || {};
    if (!camera) return;

    const delta = s.lastTime ? Math.min((time - s.lastTime) / 1000, 0.1) : 0;
    s.lastTime = time;

    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (s.movement.forward) move.add(forward);
    if (s.movement.backward) move.sub(forward);
    if (s.movement.right) move.add(right);
    if (s.movement.left) move.sub(right);
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(WALK_SPEED * (s.movement.fast ? RUN_MULTIPLIER : 1) * delta);
    }

    const meshes = getCollisionMeshes();
    const pos = camera.position;
    const horiz = resolveHorizontal(pos, pos.x + move.x, pos.z + move.z, meshes);
    const floorY = raycastDown(horiz.x, horiz.z, pos.y + STEP_HEIGHT + 0.05, meshes);
    const surfaceY = floorY !== null && floorY <= pos.y - EYE_HEIGHT + STEP_HEIGHT + 0.02
      ? floorY
      : s.floorY;
    const targetEyeY = surfaceY + EYE_HEIGHT;

    s.velocityY -= GRAVITY * delta;
    let nextY = pos.y + s.velocityY * delta;
    if (nextY <= targetEyeY) {
      nextY = targetEyeY;
      s.velocityY = 0;
      if (s.movement.jump) s.velocityY = JUMP_VELOCITY;
    }

    camera.position.set(horiz.x, nextY, horiz.z);
    rafRef.current = requestAnimationFrame(animate);
  }, [sceneData, getCollisionMeshes, resolveHorizontal, raycastDown]);

  const enterWalk = useCallback(() => {
    const { camera, controls, renderer } = sceneData || {};
    if (!camera || !controls || !renderer) return;
    const s = stateRef.current;
    if (s.active) return;

    s.active = true;
    s.placed = false;
    s.velocityY = 0;
    s.lastTime = 0;
    s.savedCamera = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      target: controls.target.clone(),
    };
    controls.enabled = false;

    // PointerLockControls
    const { PointerLockControls } = require('three/examples/jsm/controls/PointerLockControls');
    const plc = new PointerLockControls(camera, renderer.domElement);
    lockControlsRef.current = plc;
    plc.addEventListener('unlock', () => { if (s.active && s.placed) setStatus('Click viewport to re-lock cursor'); });

    setStatus('Click on a floor surface to place yourself');
    rafRef.current = requestAnimationFrame(animate);
    callbacksRef.current.onEnter?.();
  }, [sceneData, animate, setStatus]);

  const toggle = useCallback(() => {
    stateRef.current.active ? exitWalk() : enterWalk();
  }, [enterWalk, exitWalk]);

  // Keyboard listeners
  useEffect(() => {
    const onKey = (pressed) => (e) => {
      const s = stateRef.current;
      if (!s.active) return;
      const key = e.key?.toLowerCase();
      if (key === 'w' || key === 'arrowup') { s.movement.forward = pressed; e.preventDefault(); }
      else if (key === 's' || key === 'arrowdown') { s.movement.backward = pressed; e.preventDefault(); }
      else if (key === 'a' || key === 'arrowleft') { s.movement.left = pressed; e.preventDefault(); }
      else if (key === 'd' || key === 'arrowright') { s.movement.right = pressed; e.preventDefault(); }
      else if (key === ' ') { s.movement.jump = pressed; e.preventDefault(); }
      else if (key === 'shift') { s.movement.fast = pressed; }
      else if (key === 'escape' && pressed) { exitWalk(); }
    };
    const kd = onKey(true);
    const ku = onKey(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [exitWalk]);

  // Click listener on renderer
  useEffect(() => {
    const el = sceneData?.renderer?.domElement;
    if (!el) return;
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [sceneData, handleClick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { exitWalk(); };
  }, [exitWalk]);

  return {
    isWalking: stateRef.current.active,
    toggle,
    enterWalk,
    exitWalk,
    onEnter: (cb) => { callbacksRef.current.onEnter = cb; },
    onExit: (cb) => { callbacksRef.current.onExit = cb; },
    onStatus: (cb) => { callbacksRef.current.onStatus = cb; },
  };
}
