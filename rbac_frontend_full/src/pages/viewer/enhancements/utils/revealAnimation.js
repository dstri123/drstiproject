import * as THREE from 'three';

/**
 * Inspiration: IFCtoFDS post-conversion reveal animation
 * After loading a new model, the existing layer fades to ghost opacity
 * while the new layer sweeps in bottom-up via a rising clipping plane.
 *
 * Usage:
 *   playReveal(scene, {
 *     revealGroup,          // THREE.Group — the model being revealed
 *     fadeGroup,            // THREE.Group — model to fade to ghost (optional)
 *     finalFadeOpacity,     // e.g. 0.2 (ghost BIM behind point cloud)
 *     onComplete,
 *   });
 *
 *   Returns a cancel() function.
 */
export function playReveal(scene, options = {}) {
  const {
    revealGroup,
    fadeGroup,
    finalFadeOpacity = 0.2,
    fadeMs = 900,
    onComplete,
  } = options;

  if (!revealGroup) { onComplete?.(); return () => {}; }

  revealGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().expandByObject(revealGroup);
  if (box.isEmpty()) { onComplete?.(); return () => {}; }

  const height = Math.max(0.01, box.max.y - box.min.y);
  const revealMs = Math.max(1800, Math.min(5000, height * 300));

  const yMin = box.min.y - 0.01;
  const yMax = box.max.y + 0.01;

  // Attach a rising clip plane to every material in revealGroup
  const revealPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), yMin);
  const savedClips = [];
  revealGroup.traverse(node => {
    if (node.material?.isMaterial) {
      savedClips.push({ mat: node.material, prev: node.material.clippingPlanes });
      node.material.clippingPlanes = [revealPlane];
    }
  });

  // Collect fade materials
  const fadeMaterials = [];
  if (fadeGroup) {
    fadeGroup.traverse(node => {
      if (node.material?.isMaterial) {
        fadeMaterials.push({ mat: node.material, startOpacity: node.material.opacity });
      }
    });
  }

  let frame = null;
  let finished = false;
  const startTime = performance.now();

  function cleanup() {
    if (finished) return;
    finished = true;
    savedClips.forEach(({ mat, prev }) => { mat.clippingPlanes = prev; });
    fadeMaterials.forEach(({ mat }) => {
      mat.opacity = finalFadeOpacity;
      mat.transparent = finalFadeOpacity < 1;
    });
    if (frame) cancelAnimationFrame(frame);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  }

  function step(now) {
    const elapsed = now - startTime;

    // Phase 1: fade existing layer
    if (elapsed < fadeMs && fadeMaterials.length) {
      const t = easeOutCubic(elapsed / fadeMs);
      fadeMaterials.forEach(({ mat, startOpacity }) => {
        mat.opacity = startOpacity - (startOpacity - finalFadeOpacity) * t;
        mat.transparent = mat.opacity < 1;
      });
      frame = requestAnimationFrame(step);
      return;
    }

    // Ensure fade reached final value
    fadeMaterials.forEach(({ mat }) => {
      mat.opacity = finalFadeOpacity;
      mat.transparent = finalFadeOpacity < 1;
    });

    // Phase 2: reveal new layer bottom-up
    const t2 = Math.max(0, Math.min(1, (elapsed - fadeMs) / revealMs));
    revealPlane.constant = yMin + (yMax - yMin) * t2;

    if (elapsed >= fadeMs + revealMs) {
      cleanup();
      onComplete?.();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  frame = requestAnimationFrame(step);
  return cleanup;
}

/**
 * Simple opacity fade utility — no clip plane, just fades a group in or out.
 * Returns a cancel function.
 */
export function fadeGroup(group, targetOpacity, durationMs = 600, onComplete) {
  if (!group) { onComplete?.(); return () => {}; }

  const materials = [];
  group.traverse(node => {
    if (node.material?.isMaterial) {
      materials.push({ mat: node.material, start: node.material.opacity });
    }
  });

  if (!materials.length) { onComplete?.(); return () => {}; }

  const startTime = performance.now();
  let frame = null;
  let done = false;

  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    materials.forEach(({ mat, start }) => {
      mat.opacity = start + (targetOpacity - start) * t;
      mat.transparent = mat.opacity < 1;
    });
    if (t >= 1) {
      done = true;
      onComplete?.();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  frame = requestAnimationFrame(step);
  return () => { if (!done && frame) cancelAnimationFrame(frame); };
}
