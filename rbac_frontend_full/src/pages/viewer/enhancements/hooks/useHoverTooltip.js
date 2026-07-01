import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

/**
 * Inspiration: IFCtoFDS hover highlight + tooltip
 * On pointermove: raycasts into scene, highlights the hit mesh gold,
 * and fires onHover(data, x, y) so the UI can show a tooltip.
 *
 * Usage:
 *   useHoverTooltip(sceneData, { onHover, onClear, exclude });
 *   // onHover({ name, type, id }, clientX, clientY)
 *   // onClear()
 */
export function useHoverTooltip(sceneData, options = {}) {
  const hoveredRef = useRef(null);
  const originalMaterialsRef = useRef(new Map());
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  const HOVER_COLOR = 0xffd166;
  const HOVER_EMISSIVE = 0x332000;

  const applyHover = useCallback((mesh, on) => {
    if (!mesh) return;
    mesh.traverse(node => {
      if (!node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((mat, i) => {
        const key = `${node.uuid}_${i}`;
        if (on) {
          if (!originalMaterialsRef.current.has(key)) {
            originalMaterialsRef.current.set(key, {
              color: mat.color?.getHex() ?? null,
              emissive: mat.emissive?.getHex() ?? null,
              opacity: mat.opacity,
            });
          }
          if (mat.color) mat.color.setHex(HOVER_COLOR);
          if (mat.emissive) mat.emissive.setHex(HOVER_EMISSIVE);
          mat.opacity = Math.min(1, Math.max(mat.opacity ?? 1, 0.9));
          mat.transparent = mat.opacity < 1;
        } else {
          const orig = originalMaterialsRef.current.get(key);
          if (orig) {
            if (mat.color && orig.color !== null) mat.color.setHex(orig.color);
            if (mat.emissive && orig.emissive !== null) mat.emissive.setHex(orig.emissive);
            mat.opacity = orig.opacity;
            mat.transparent = orig.opacity < 1;
            originalMaterialsRef.current.delete(key);
          }
        }
      });
    });
  }, []);

  const clearHover = useCallback(() => {
    if (hoveredRef.current) {
      applyHover(hoveredRef.current, false);
      hoveredRef.current = null;
    }
    originalMaterialsRef.current.clear();
    options.onClear?.();
  }, [applyHover, options]);

  const handlePointerMove = useCallback((e) => {
    const { camera, renderer, scene } = sceneData || {};
    if (!camera || !renderer || !scene) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouseRef.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycasterRef.current.setFromCamera(mouseRef.current, camera);

    const targets = [];
    scene.traverse(node => {
      if (!node.isMesh || !node.visible) return;
      // Skip helpers, sprites, gizmos
      if (node.isSprite || node.isLine || node.isLineSegments) return;
      if (node.name?.includes('helper') || node.name?.includes('gizmo')) return;
      if (options.exclude?.includes(node)) return;
      targets.push(node);
    });

    const hits = raycasterRef.current.intersectObjects(targets, false);
    const hit = hits[0];
    const newMesh = hit ? findRoot(hit.object) : null;

    if (newMesh !== hoveredRef.current) {
      if (hoveredRef.current) applyHover(hoveredRef.current, false);
      hoveredRef.current = newMesh;
      if (newMesh) applyHover(newMesh, true);
    }

    if (newMesh && hit) {
      const data = extractData(hit.object);
      options.onHover?.(data, e.clientX, e.clientY);
    } else {
      options.onClear?.();
    }
  }, [sceneData, options, applyHover]);

  useEffect(() => {
    const el = sceneData?.renderer?.domElement;
    if (!el) return;
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerleave', clearHover);
    return () => {
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerleave', clearHover);
      clearHover();
    };
  }, [sceneData, handlePointerMove, clearHover]);

  return { clearHover };
}

function findRoot(object) {
  let node = object;
  let last = node;
  while (node.parent && !node.parent.isScene) {
    node = node.parent;
    if (node.userData?.type || node.isMesh) last = node;
  }
  return last;
}

function extractData(object) {
  const u = object.userData || {};
  return {
    name: u.name || object.name || 'Object',
    type: u.type || object.type || 'Mesh',
    id: u.id || u.globalId || null,
    ifcType: u.ifcType || null,
  };
}
