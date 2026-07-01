import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

const MIN_DRAG_PX = 4;

/**
 * Inspiration: IFCtoFDS Shift+drag marquee multi-selection
 * Shift+drag draws a screen-space rectangle. All visible meshes
 * whose projected bounding-box center falls inside the rect are selected.
 *
 * Usage:
 *   useMarqueeSelection(sceneData, { onSelect, overlayRef });
 *   // onSelect(meshArray) — array of THREE.Object3D
 *   // overlayRef — React ref to a <div> used as the marquee rectangle
 */
export function useMarqueeSelection(sceneData, options = {}) {
  const stateRef = useRef(null);
  const bbox3 = useRef(new THREE.Box3());
  const center3 = useRef(new THREE.Vector3());

  const completeSelection = useCallback((x1, y1, x2, y2) => {
    const { scene, camera, renderer } = sceneData || {};
    if (!scene || !camera || !renderer) return;

    const cw = renderer.domElement.clientWidth || 1;
    const ch = renderer.domElement.clientHeight || 1;

    const picked = [];
    scene.traverse(node => {
      if (!node.isMesh || !node.visible) return;
      if (node.isSprite || node.isLine || node.isLineSegments) return;
      if (node.name?.includes('helper') || node.name?.includes('gizmo')) return;

      bbox3.current.makeEmpty().expandByObject(node);
      if (bbox3.current.isEmpty()) return;

      bbox3.current.getCenter(center3.current);
      const projected = center3.current.clone().project(camera);

      if (projected.z < -1 || projected.z > 1) return;

      const sx = (projected.x * 0.5 + 0.5) * cw;
      const sy = (-projected.y * 0.5 + 0.5) * ch;

      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
        if (!picked.includes(node)) picked.push(node);
      }
    });

    options.onSelect?.(picked);
  }, [sceneData, options]);

  const updateOverlay = useCallback((startX, startY, currentX, currentY) => {
    const el = options.overlayRef?.current;
    if (!el) return;
    el.style.left = Math.min(startX, currentX) + 'px';
    el.style.top = Math.min(startY, currentY) + 'px';
    el.style.width = Math.abs(currentX - startX) + 'px';
    el.style.height = Math.abs(currentY - startY) + 'px';
    el.style.display = 'block';
  }, [options]);

  const hideOverlay = useCallback(() => {
    const el = options.overlayRef?.current;
    if (el) el.style.display = 'none';
  }, [options]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0 || !e.shiftKey) return;
    const { renderer, controls } = sceneData || {};
    const rect = renderer?.domElement.getBoundingClientRect();
    stateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      rectLeft: rect?.left ?? 0,
      rectTop: rect?.top ?? 0,
      dragged: false,
      pointerId: e.pointerId,
    };
    try { renderer?.domElement.setPointerCapture(e.pointerId); } catch (_) {}
    if (controls) controls.enabled = false;
    e.preventDefault();
  }, [sceneData]);

  const onPointerMove = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.dragged && Math.abs(dx) + Math.abs(dy) < MIN_DRAG_PX) return;
    s.dragged = true;
    updateOverlay(s.startX, s.startY, e.clientX, e.clientY);
  }, [updateOverlay]);

  const onPointerUp = useCallback((e) => {
    const s = stateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    stateRef.current = null;

    const { renderer, controls } = sceneData || {};
    try { renderer?.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
    if (controls) controls.enabled = true;
    hideOverlay();

    if (!s.dragged) return;

    const rl = s.rectLeft;
    const rt = s.rectTop;
    const x1 = Math.min(s.startX, e.clientX) - rl;
    const y1 = Math.min(s.startY, e.clientY) - rt;
    const x2 = Math.max(s.startX, e.clientX) - rl;
    const y2 = Math.max(s.startY, e.clientY) - rt;
    completeSelection(x1, y1, x2, y2);
  }, [sceneData, completeSelection, hideOverlay]);

  useEffect(() => {
    const el = sceneData?.renderer?.domElement;
    if (!el) return;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [sceneData, onPointerDown, onPointerMove, onPointerUp]);
}
