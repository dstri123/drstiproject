import { useEffect, useCallback } from 'react';
import * as THREE from 'three';

/**
 * Inspiration: IFCtoFDS numpad view shortcuts + arrow-key orbit
 *
 * Number keys snap camera to standard engineering views:
 *   1 = Front,  2 = Back,  3 = Left,  4 = Right
 *   5 = Top,    6 = Bottom,  0 = Isometric
 *
 * Arrow keys orbit camera in 5° steps:
 *   ← → = yaw,  ↑ ↓ = pitch
 *   Shift + ← → = strafe,  Shift + ↑ ↓ = dolly
 *
 * Usage:
 *   useKeyboardShortcuts(sceneData, { enabled, onViewChange });
 */
export function useKeyboardShortcuts(sceneData, options = {}) {
  const VIEW_MAP = {
    '1': 'front', '2': 'back', '3': 'left',
    '4': 'right', '5': 'top', '6': 'bottom', '0': 'iso',
    'numpad1': 'front', 'numpad2': 'back', 'numpad3': 'left',
    'numpad4': 'right', 'numpad5': 'top', 'numpad6': 'bottom', 'numpad0': 'iso',
  };

  const computeSceneBox = useCallback(() => {
    const { scene } = sceneData || {};
    if (!scene) return null;
    const box = new THREE.Box3();
    scene.traverse(node => {
      if (node.isMesh && node.visible) box.expandByObject(node);
    });
    return box.isEmpty() ? null : box;
  }, [sceneData]);

  const setView = useCallback((direction) => {
    const { camera, controls } = sceneData || {};
    if (!camera || !controls) return;

    const box = computeSceneBox();
    if (!box) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z, 1) * 1.6;

    controls.target.copy(center);

    const positions = {
      front:  new THREE.Vector3(center.x, center.y, center.z + dist),
      back:   new THREE.Vector3(center.x, center.y, center.z - dist),
      left:   new THREE.Vector3(center.x - dist, center.y, center.z),
      right:  new THREE.Vector3(center.x + dist, center.y, center.z),
      top:    new THREE.Vector3(center.x, center.y + dist, center.z),
      bottom: new THREE.Vector3(center.x, center.y - dist, center.z),
      iso:    new THREE.Vector3(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7),
    };

    camera.position.copy(positions[direction] || positions.iso);
    camera.near = Math.max(dist / 500, 0.02);
    camera.far = dist * 50;
    camera.updateProjectionMatrix();
    controls.update();
    options.onViewChange?.(direction);
  }, [sceneData, computeSceneBox, options]);

  const orbitByKey = useCallback((direction, shift) => {
    const { camera, controls } = sceneData || {};
    if (!camera || !controls) return;

    const target = controls.target;
    const offset = new THREE.Vector3().subVectors(camera.position, target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const ROTATE = Math.PI / 36; // 5°
    const DOLLY = 1.12;
    const PAN = offset.length() * 0.05;

    if (shift && (direction === 'up' || direction === 'down')) {
      offset.multiplyScalar(direction === 'up' ? 1 / DOLLY : DOLLY);
    } else if (shift && (direction === 'left' || direction === 'right')) {
      const right = new THREE.Vector3();
      camera.getWorldDirection(right);
      right.cross(camera.up).normalize().multiplyScalar(direction === 'right' ? PAN : -PAN);
      target.add(right);
      camera.position.add(right);
      controls.update();
      return;
    } else if (direction === 'left')  { spherical.theta -= ROTATE; offset.setFromSpherical(spherical); }
      else if (direction === 'right') { spherical.theta += ROTATE; offset.setFromSpherical(spherical); }
      else if (direction === 'up')    { spherical.phi = Math.max(0.05, spherical.phi - ROTATE); offset.setFromSpherical(spherical); }
      else if (direction === 'down')  { spherical.phi = Math.min(Math.PI - 0.05, spherical.phi + ROTATE); offset.setFromSpherical(spherical); }

    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    controls.update();
  }, [sceneData]);

  useEffect(() => {
    const handler = (e) => {
      if (options.enabled === false) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // View shortcuts
      const key = e.code?.startsWith('Numpad')
        ? 'numpad' + e.code.replace('Numpad', '').toLowerCase()
        : e.key;
      const view = VIEW_MAP[key];
      if (view && !e.shiftKey) {
        e.preventDefault();
        setView(view);
        return;
      }

      // Arrow key orbit
      const arrowMap = {
        ArrowLeft: 'left', ArrowRight: 'right',
        ArrowUp: 'up', ArrowDown: 'down',
      };
      if (arrowMap[e.key]) {
        e.preventDefault();
        orbitByKey(arrowMap[e.key], e.shiftKey);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [options.enabled, setView, orbitByKey]);

  return { setView, orbitByKey };
}
