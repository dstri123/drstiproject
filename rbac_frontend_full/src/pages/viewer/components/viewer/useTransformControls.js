import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";

/**
 * useTransformControls — Blender-style camera transform
 *
 * FLOW (mirrors original ThreeViewer.js exactly):
 *   1. Click a camera marker  → setActiveCamera(cam) is called
 *   2. Press G / R / S        → activates move / rotate / scale mode
 *   3. Move mouse             → camera moves in real-time (NO click-drag needed)
 *   4. Click OR press Escape  → commits / cancels
 *
 * This matches the original ThreeViewer.js behaviour where mode is set by
 * keydown and movement is tracked via pointermove delta from that moment.
 */
export default function useTransformControls(
  sceneData,
  { cameraMarkersRef, cameraHelpersRef, onTransformCommit } = {},
) {
  const { rendererRef, controlsRef } = sceneData;

  const transformRef = useRef({
    mode: null, // "move" | "rotate" | "scale" | null
    activeCamera: null,
    startPos: null,
    startRot: null,
    startFov: null,
    lastX: 0,
    lastY: 0,
  });

  // ── sync cone marker + helper after every mutation ────────────────────────
  const syncMarker = useCallback(
    (cam) => {
      if (!cam) return;
      const idx = cam.userData.index;
      const marker = cameraMarkersRef?.current?.[idx];
      if (marker) {
        marker.position.copy(cam.position);
        marker.setRotationFromQuaternion(cam.quaternion);
      }
      const helper = cameraHelpersRef?.current?.[idx];
      if (helper) helper.update();
    },
    [cameraMarkersRef, cameraHelpersRef],
  );

  // ── public API ────────────────────────────────────────────────────────────
  const setActiveCamera = useCallback((cam) => {
    const tr = transformRef.current;
    tr.activeCamera = cam;
    tr.mode = null;
  }, []);

  const clearActiveCamera = useCallback(
    (nameOrCam) => {
      const tr = transformRef.current;
      if (!tr.activeCamera) return;
      const match =
        typeof nameOrCam === "string"
          ? tr.activeCamera.userData.imageName === nameOrCam ||
            tr.activeCamera.userData.name === nameOrCam
          : tr.activeCamera === nameOrCam;
      if (match) {
        tr.activeCamera = null;
        tr.mode = null;
        if (controlsRef?.current) controlsRef.current.enabled = true;
      }
    },
    [controlsRef],
  );

  const commitAndEnd = useCallback(
    (revert = false) => {
      const tr = transformRef.current;
      if (!tr.activeCamera) return;

      if (revert) {
        if (tr.startPos) tr.activeCamera.position.copy(tr.startPos);
        if (tr.startRot) tr.activeCamera.rotation.copy(tr.startRot);
        if (tr.startFov != null) {
          tr.activeCamera.fov = tr.startFov;
          tr.activeCamera.updateProjectionMatrix();
        }
      }

      syncMarker(tr.activeCamera);

      if (!revert) {
        onTransformCommit?.({
          index: tr.activeCamera.userData.index,
          position: tr.activeCamera.position.toArray(),
          quaternion: tr.activeCamera.quaternion.toArray(),
          fov: tr.activeCamera.fov,
        });
      }

      tr.mode = null;
      tr.startPos = null;
      tr.startRot = null;
      tr.startFov = null;
      if (controlsRef?.current) controlsRef.current.enabled = true;
    },
    [syncMarker, onTransformCommit, controlsRef],
  );

  // ── keyboard: G activates move, R rotate, S scale, Escape cancels ─────────
  useEffect(() => {
    const onKeyDown = (e) => {
      const tr = transformRef.current;
      if (!tr.activeCamera) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key.toLowerCase();

      if (key === "g") {
        tr.mode = "move";
        tr.startPos = tr.activeCamera.position.clone();
        if (controlsRef?.current) controlsRef.current.enabled = false;
        // seed lastX/Y so first delta is 0
        return;
      }
      if (key === "r") {
        tr.mode = "rotate";
        tr.startRot = tr.activeCamera.rotation.clone();
        if (controlsRef?.current) controlsRef.current.enabled = false;
        return;
      }
      if (key === "s") {
        tr.mode = "scale";
        tr.startFov = tr.activeCamera.fov;
        if (controlsRef?.current) controlsRef.current.enabled = false;
        return;
      }
      if (e.key === "Escape") {
        commitAndEnd(true); // revert
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitAndEnd, controlsRef]);

  // ── pointermove: apply transform while mode is active ────────────────────
  // ── pointerdown (left-click): commit transform ────────────────────────────
  useEffect(() => {
    let detach = () => {};
    let intervalId = null;

    const tryAttach = () => {
      const dom = rendererRef?.current?.domElement;
      if (!dom) return false;

      // Track raw mouse position at all times
      const onPointerMove = (e) => {
        const tr = transformRef.current;

        // Always update lastX/Y so when a mode is first activated
        // the first frame delta is small
        const prevX = tr.lastX ?? e.clientX;
        const prevY = tr.lastY ?? e.clientY;
        tr.lastX = e.clientX;
        tr.lastY = e.clientY;

        if (!tr.mode || !tr.activeCamera) return;

        const rect = dom.getBoundingClientRect();
        const dx = (e.clientX - prevX) / rect.width;
        const dy = (e.clientY - prevY) / rect.height;

        const cam = tr.activeCamera;

        // ── MOVE ────────────────────────────────────────────────────────
        if (tr.mode === "move") {
          const forward = new THREE.Vector3();
          cam.getWorldDirection(forward).normalize();
          const right = new THREE.Vector3()
            .crossVectors(forward, cam.up)
            .normalize();
          const up = cam.up.clone().normalize();

          const speed = 10;
          cam.position.addScaledVector(right, -dx * speed);
          cam.position.addScaledVector(up, -dy * speed);
        }

        // ── ROTATE ──────────────────────────────────────────────────────
        if (tr.mode === "rotate") {
          const speed = 2.5;
          const qy = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -dx * speed,
          );
          const qx = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            -dy * speed,
          );
          cam.quaternion.multiplyQuaternions(qy, cam.quaternion);
          cam.quaternion.multiplyQuaternions(cam.quaternion, qx);
        }

        // ── SCALE / FOV ─────────────────────────────────────────────────
        if (tr.mode === "scale") {
          cam.fov = THREE.MathUtils.clamp(cam.fov + dy * 80, 15, 120);
          cam.updateProjectionMatrix();
          const idx = cam.userData.index;
          const marker = cameraMarkersRef?.current?.[idx];
          if (marker) {
            const s = THREE.MathUtils.mapLinear(cam.fov, 15, 120, 0.6, 1.6);
            marker.scale.setScalar(s);
          }
        }

        syncMarker(cam);
      };

      // Left-click while a mode is active → COMMIT
      const onPointerDown = (e) => {
        const tr = transformRef.current;
        if (!tr.mode) return;
        if (e.button !== 0) return;
        // Suppress the upcoming "click" event that might re-open a marker
        dom.__suppressNextClick = true;
        commitAndEnd(false);
      };

      // Right-click while a mode is active → CANCEL
      const onContextMenu = (e) => {
        const tr = transformRef.current;
        if (!tr.mode) return;
        e.preventDefault();
        commitAndEnd(true);
      };

      window.addEventListener("pointermove", onPointerMove);
      dom.addEventListener("pointerdown", onPointerDown);
      dom.addEventListener("contextmenu", onContextMenu);

      detach = () => {
        window.removeEventListener("pointermove", onPointerMove);
        dom.removeEventListener("pointerdown", onPointerDown);
        dom.removeEventListener("contextmenu", onContextMenu);
      };

      return true;
    };

    if (!tryAttach()) {
      intervalId = setInterval(() => {
        if (tryAttach()) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }, 100);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      detach();
    };
  }, [syncMarker, commitAndEnd, cameraMarkersRef, rendererRef]);

  return { transformRef, setActiveCamera, clearActiveCamera };
}
