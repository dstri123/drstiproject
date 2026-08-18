import { useEffect, useRef, useState, useCallback } from "react";
import { viridisColor } from "../../enhancements/utils/colormap.js";
import * as THREE from "three";

const GLOBAL_IMAGE_MAP = {};

function lookupImage(name) {
  if (!name) return null;
  const noExt = name.replace(/\.[^/.]+$/, "");
  return (
    GLOBAL_IMAGE_MAP[name] ||
    GLOBAL_IMAGE_MAP[name.toLowerCase()] ||
    GLOBAL_IMAGE_MAP[name.toUpperCase()] ||
    GLOBAL_IMAGE_MAP[name.replace(/\.[^/.]+$/, (e) => e.toLowerCase())] ||
    GLOBAL_IMAGE_MAP[name.replace(/\.[^/.]+$/, (e) => e.toUpperCase())] ||
    GLOBAL_IMAGE_MAP[noExt] ||
    GLOBAL_IMAGE_MAP[noExt.toLowerCase()] ||
    GLOBAL_IMAGE_MAP[noExt.toUpperCase()] ||
    null
  );
}

let manualCameraCounter = 0;

// Natural/numeric filename comparator — kept here in case you still use it
// elsewhere, but the path itself now uses spatial ordering below.
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const ax = a.match(re) || [];
  const bx = b.match(re) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const av = ax[i] ?? "";
    const bv = bx[i] ?? "";
    const an = Number(av);
    const bn = Number(bv);
    const aIsNum = av !== "" && !Number.isNaN(an);
    const bIsNum = bv !== "" && !Number.isNaN(bn);
    if (aIsNum && bIsNum) {
      if (an !== bn) return an - bn;
    } else if (av !== bv) {
      return av < bv ? -1 : 1;
    }
  }
  return 0;
}

// Greedy nearest-neighbor ordering: starting from the first camera, repeatedly
// jump to whichever remaining camera is spatially closest. Traces physical
// layout of the rig/scan regardless of filename convention.
function nearestNeighborOrder(camObjs) {
  if (camObjs.length < 2) return camObjs.slice();
  const remaining = camObjs.slice();
  const ordered = [remaining.shift()];
  let current = ordered[0];
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = current.position.distanceToSquared(remaining[i].position);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

export default function useCameraSystem(sceneData, modelData, props) {
  const { sceneRef, cameraRef, rendererRef, controlsRef } = sceneData;
  const { pcModel } = modelData;
  const {
    cameraPositionsFile,
    showCameras,
    cameraImages,
    uploadedCameraMatrix,
  } = props;

  const camerasRef = useRef([]);
  const cameraMarkersRef = useRef([]);
  const cameraHelpersRef = useRef([]);
  const originalPosRef = useRef([]);
  const selectedMarkerRef = useRef(null);
  const matrixAppliedRef = useRef(false);
  const matrixRef = useRef(null);

  // ── Camera path (poly-line through camera positions) ─────────────────────
  const pathLineRef = useRef(null);
  const pathDotsRef = useRef(null); // THREE.Group of small red sphere dots
  const cameraPathVisibleRef = useRef(false);
  const [cameraPathVisible, setCameraPathVisible] = useState(false);

  const previewCanvasRef = useRef(null);
  const previewRendererRef = useRef(null);
  const previewRafRef = useRef(null);

  // ── Transform state ───────────────────────────────────────────────────────
  const transformRef = useRef({
    mode: null,
    activeCamera: null,
    startPos: null,
    startRot: null,
    startScale: null,
  });

  const [selectedCamera, setSelectedCamera] = useState(null);
  const [manualCameras, setManualCameras] = useState([]);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!Array.isArray(cameraImages) || cameraImages.length === 0) return;

    cameraImages.forEach((item) => {
      const label = item.original_name || item.image?.split("/").pop();
      const url = item.image;
      const idKey = item.id ? String(item.id) : null;
      if (!label || !url) return;

      const basename = label.split("/").pop();
      const noExt = basename.replace(/\.[^/.]+$/, "");
      const rawUrlName = item.image?.split("/").pop();
      const rawUrlNoExt = rawUrlName?.replace(/\.[^/.]+$/, "");

      [
        basename,
        basename.toLowerCase(),
        basename.toUpperCase(),
        basename.replace(/\.[^/.]+$/, (ext) => ext.toLowerCase()),
        basename.replace(/\.[^/.]+$/, (ext) => ext.toUpperCase()),
        noExt,
        noExt?.toLowerCase(),
        noExt?.toUpperCase(),
        rawUrlName,
        rawUrlName?.toLowerCase(),
        rawUrlName?.toUpperCase(),
        rawUrlNoExt,
        rawUrlNoExt?.toLowerCase(),
        rawUrlNoExt?.toUpperCase(),
        idKey,
      ]
        .filter(Boolean)
        .forEach((key) => {
          GLOBAL_IMAGE_MAP[key] = url;
        });
    });

    camerasRef.current.forEach((cam, index) => {
      if (!cam) return;
      const url = lookupImage(cam.userData.imageName);
      cam.userData.image = url;
      cam.userData.hasImage = !!url;
      const marker = cameraMarkersRef.current[index];
      if (marker && !cam.userData.isManual) {
        marker.userData.baseColor = url ? 0x8b5cf6 : 0xf97316;
      }
    });

    setSelectedCamera((prev) =>
      prev ? { ...prev, image: lookupImage(prev.name) } : prev,
    );
  }, [cameraImages]);

  // ── public helpers ────────────────────────────────────────────────────────
  const setActiveCamera = useCallback((cam) => {
    transformRef.current.activeCamera = cam;
    transformRef.current.mode = null;
  }, []);

  const clearActiveCamera = useCallback(
    (name) => {
      const tr = transformRef.current;
      if (!tr.activeCamera) return;
      const match =
        tr.activeCamera.userData.imageName === name ||
        tr.activeCamera.userData.name === name;
      if (match) {
        tr.activeCamera = null;
        tr.mode = null;
        if (controlsRef?.current) controlsRef.current.enabled = true;
      }
    },
    [controlsRef],
  );

  // ── sync marker + helper after transform ──────────────────────────────────
  const syncMarker = useCallback((cam) => {
    if (!cam) return;
    const idx = cam.userData.index;
    const marker = cameraMarkersRef.current[idx];
    if (marker) {
      marker.position.copy(cam.position);
      marker.setRotationFromQuaternion(cam.quaternion);
    }
    const helper = cameraHelpersRef.current[idx];
    if (helper) helper.update();
  }, []);

  // ── KEYBOARD: G / R / S / Escape ─────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      const tr = transformRef.current;
      if (!tr.activeCamera) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "g" || e.key === "G") {
        tr.mode = "move";
        tr.startPos = tr.activeCamera.position.clone();
        if (controlsRef?.current) controlsRef.current.enabled = false;
      }
      if (e.key === "r" || e.key === "R") {
        tr.mode = "rotate";
        tr.startRot = tr.activeCamera.rotation.clone();
        if (controlsRef?.current) controlsRef.current.enabled = false;
      }
      if (e.key === "s" || e.key === "S") {
        tr.mode = "scale";
        tr.startScale = tr.activeCamera.scale.x;
        if (controlsRef?.current) controlsRef.current.enabled = false;
      }
      if (e.key === "Escape") {
        if (tr.startPos) tr.activeCamera.position.copy(tr.startPos);
        if (tr.startRot) tr.activeCamera.rotation.copy(tr.startRot);
        if (tr.startScale) tr.activeCamera.scale.setScalar(tr.startScale);
        syncMarker(tr.activeCamera);
        tr.mode = null;
        if (controlsRef?.current) controlsRef.current.enabled = true;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [syncMarker, controlsRef]);

  // ── POINTER DRAG ──────────────────────────────────────────────────────────
  useEffect(() => {
    const dom = rendererRef?.current?.domElement;
    if (!dom) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e) => {
      if (!transformRef.current.mode) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.__suppressNextClick = true;
    };

    const onMove = (e) => {
      const tr = transformRef.current;
      if (!dragging || !tr.activeCamera) return;

      const rect = dom.getBoundingClientRect();
      const dx = (e.clientX - lastX) / rect.width;
      const dy = (e.clientY - lastY) / rect.height;
      lastX = e.clientX;
      lastY = e.clientY;

      const cam = tr.activeCamera;

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
        syncMarker(cam);
      }

      if (tr.mode === "rotate") {
        const rotSpeed = 2.5;
        const qx = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          -dy * rotSpeed,
        );
        const qy = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -dx * rotSpeed,
        );
        cam.quaternion.multiplyQuaternions(qy, cam.quaternion);
        cam.quaternion.multiplyQuaternions(qx, cam.quaternion);
        syncMarker(cam);
      }

      if (tr.mode === "scale") {
        const zoomSpeed = 80;
        cam.fov = THREE.MathUtils.clamp(cam.fov + dy * zoomSpeed, 15, 120);
        cam.updateProjectionMatrix();
        const idx = cam.userData.index;
        const marker = cameraMarkersRef.current[idx];
        if (marker) {
          const s = THREE.MathUtils.mapLinear(cam.fov, 15, 120, 0.6, 1.6);
          marker.scale.setScalar(s);
        }
      }
    };

    const onUp = () => {
      dragging = false;
      transformRef.current.mode = null;
      if (controlsRef?.current) controlsRef.current.enabled = true;
    };

    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line
  }, [rendererRef?.current?.domElement, syncMarker]);

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  const cleanupAll = useCallback(() => {
    if (!sceneRef.current) return;
    [
      ...camerasRef.current,
      ...cameraMarkersRef.current,
      ...cameraHelpersRef.current,
    ].forEach((obj) => {
      if (!obj) return;
      obj.geometry?.dispose();
      obj.material?.dispose();
      sceneRef.current.remove(obj);
    });
    camerasRef.current = [];
    cameraMarkersRef.current = [];
    cameraHelpersRef.current = [];
    if (pathLineRef.current) {
      sceneRef.current.remove(pathLineRef.current);
      pathLineRef.current.geometry?.dispose();
      pathLineRef.current.material?.dispose();
      pathLineRef.current = null;
    }
    if (pathDotsRef.current) {
      sceneRef.current.remove(pathDotsRef.current);
      pathDotsRef.current.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      pathDotsRef.current = null;
    }
  }, [sceneRef]);

  // Rebuilds the yellow poly-line through every camera's current position, in
  // camerasRef.current order (i.e. load order for parsed cameras, append order
  // for manual ones). Called whenever the camera list changes shape (build /
  // add / delete). Visibility is controlled separately so toggling it doesn't
  // force a full rebuild.
  const updateCameraPath = useCallback(() => {
    if (!sceneRef.current) return;

    if (pathLineRef.current) {
      sceneRef.current.remove(pathLineRef.current);
      pathLineRef.current.geometry?.dispose();
      pathLineRef.current.material?.dispose();
      pathLineRef.current = null;
    }
    if (pathDotsRef.current) {
      sceneRef.current.remove(pathDotsRef.current);
      pathDotsRef.current.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      pathDotsRef.current = null;
    }

    const cams = camerasRef.current.filter((c) => !c.userData.isManual);
   // Create red dots directly at the camera positions
    const dotGroup = new THREE.Group();

    const dotGeo = new THREE.SphereGeometry(1, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xdc2626,
    });

    cams.forEach((cam) => {
      const dot = new THREE.Mesh(dotGeo, dotMat);

      // EXACT same location as the camera
      dot.position.copy(cam.position);

      dot.raycast = () => {};
      dot.renderOrder = 999;

      dotGroup.add(dot);
    });

    dotGroup.visible = cameraPathVisibleRef.current;

    sceneRef.current.add(dotGroup);
    pathDotsRef.current = dotGroup;
  }, [sceneRef]);
  // ── BUILD cameras ─────────────────────────────────────────────────────────
  const buildCameras = useCallback(
    (positions) => {
      if (!sceneRef.current) return;
      cleanupAll();

      let M = null;
      let rotQuat = null;

      if (matrixAppliedRef.current && matrixRef.current) {
        M = new THREE.Matrix4().set(...matrixRef.current.flat());
        const rotMatrix = new THREE.Matrix4().extractRotation(M);
        rotQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);
      }

      const rawToWorld = pcModel?.userData?.rawToWorld || null;
      const rawRotQuat = rawToWorld
        ? new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().extractRotation(rawToWorld),
          )
        : null;

      positions.forEach((posData, idx) => {
        const cam = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 10000);

        const pos = posData.position.clone();
        const quat = posData.quaternion.clone();

        if (rawToWorld) {
          pos.applyMatrix4(rawToWorld);
          quat.premultiply(rawRotQuat);
        }

        if (M) {
          pos.applyMatrix4(M);
          quat.premultiply(rotQuat);
        }

        cam.position.copy(pos);
        cam.quaternion.copy(quat);

        cam.updateMatrixWorld(true);

        const imageUrl = lookupImage(posData.imageName);

        cam.userData = {
          imageName: posData.imageName,
          image: imageUrl,
          hasImage: !!imageUrl,
          index: idx,
          isManual: posData.isManual || false,
        };

        sceneRef.current.add(cam);
        camerasRef.current.push(cam);

        const geo = new THREE.ConeGeometry(0.3, 0.5, 4);
        geo.rotateX(-Math.PI / 2);
        geo.rotateY(Math.PI);

        const baseColor = posData.isManual
          ? 0x06b6d4
          : imageUrl
            ? 0x8b5cf6
            : 0xf97316;
        const mat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          wireframe: true,
          transparent: true,
          opacity: 0.85,
        });

        const marker = new THREE.Mesh(geo, mat);

        marker.position.copy(cam.position);
        marker.setRotationFromQuaternion(cam.quaternion);
        marker.userData.cameraIndex = idx;
        marker.userData.baseColor = baseColor;
        marker.visible = showCameras !== false;

        sceneRef.current.add(marker);
        cameraMarkersRef.current.push(marker);

        const helper = new THREE.CameraHelper(cam);
        helper.visible = false;

        sceneRef.current.add(helper);
        cameraHelpersRef.current.push(helper);
      });
      updateCameraPath();
      bump();
    },
    [sceneRef, cleanupAll, showCameras, pcModel, updateCameraPath],
  );

  useEffect(() => {
    if (pcModel?.userData?.rawToWorld && originalPosRef.current.length) {
      buildCameras(originalPosRef.current);
    }
    // eslint-disable-next-line
  }, [pcModel]);
  // ── MARKER SIZE LOOP ──────────────────────────────────────────────────────
  useEffect(() => {
    let raf;

    const updateMarkerSize = () => {
      raf = requestAnimationFrame(updateMarkerSize);

      if (!cameraRef.current) return;

      const mainCam = cameraRef.current;

      cameraMarkersRef.current.forEach((marker) => {
        if (!marker) return;

        const distance = mainCam.position.distanceTo(marker.position);
        let scale = distance * 0.06;
        scale = Math.max(0.1, Math.min(scale, 5));
        marker.scale.setScalar(scale);
      });
      if (pathDotsRef.current) {
        pathDotsRef.current.children.forEach((dot) => {
          const distance = mainCam.position.distanceTo(dot.position);
          let scale = distance * 0.008;
          scale = Math.max(0.03, Math.min(scale, 0.35));
          dot.scale.setScalar(scale);
        });
      }
    };

    updateMarkerSize();

    return () => cancelAnimationFrame(raf);
  }, [cameraRef]);
// crt
  // ── PARSE images.txt ──────────────────────────────────────────────────────
  // useEffect(() => {
  //   if (!cameraPositionsFile) {
  //     cleanupAll();
  //     originalPosRef.current = [];
  //     return;
  //   }
  //   // An uploaded Matrix File (.json) for this batch is baked straight into
  //   // the camera positions, same as the manual "Upload Camera Matrix" flow.
  //   if (uploadedCameraMatrix) {
  //     matrixRef.current = uploadedCameraMatrix;
  //     matrixAppliedRef.current = true;
  //   } else {
  //     matrixAppliedRef.current = false;
  //   }
  //   const reader = new FileReader();
  //   reader.onload = (e) => {
  //     const parsed = [];
  //     e.target.result.split("\n").forEach((line) => {
  //       if (!line.trim() || line.startsWith("#")) return;
  //       const p = line.trim().split(/\s+/);
  //       if (p.length < 10) return;
  //       const imageName = p[9];
  //       const nums = [p[1], p[2], p[3], p[4], p[5], p[6], p[7]].map(Number);
  //       if (nums.some(isNaN)) return;
  //       const [qw, qx, qy, qz, tx, ty, tz] = nums;
  //       const q = new THREE.Quaternion(qx, qy, qz, qw);
  //       const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
  //       const Rt = R.clone().transpose();
  //       const C = new THREE.Vector3(tx, ty, tz)
  //         .applyMatrix4(Rt)
  //         .multiplyScalar(-1);
  //       const qr = new THREE.Quaternion().setFromRotationMatrix(Rt);
  //       qr.multiply(
  //         new THREE.Quaternion().setFromAxisAngle(
  //           new THREE.Vector3(1, 0, 0),
  //           Math.PI,
  //         ),
  //       );
  //       parsed.push({ imageName, position: C.clone(), quaternion: qr.clone() });
  //     });
  //     // Order by filename, not by however the lines appeared in images.txt —
  //     // this is what makes the path trace the actual scan sequence instead
  //     // of zig-zagging through the center (COLMAP's IMAGE_ID order != capture
  //     // order).
  //     parsed.sort((a, b) =>
  //       naturalCompare(a.imageName || "", b.imageName || ""),
  //     );
  //     originalPosRef.current = parsed;
  //     buildCameras(parsed);
  //   };
  //   reader.readAsText(cameraPositionsFile);
  // }, [cameraPositionsFile, uploadedCameraMatrix, buildCameras, cleanupAll]);

  // useEffect(() => {
  //   if (!cameraPositionsFile) {
  //     cleanupAll();
  //     originalPosRef.current = [];
  //     return;
  //   }

  //   matrixAppliedRef.current = false;

  //   const reader = new FileReader(); // 🔥 MUST exist here

  //   reader.onload = (e) => {
  //     const parsed = [];
  //     const positions = [];

  //     const lines = e.target.result.split("\n");

  //     lines.forEach((line) => {
  //       if (!line.trim() || line.startsWith("#")) return;

  //       const p = line.trim().split(/\s+/);
  //       if (p.length < 16) return;

  //       const imageName = p[0];

  //       const x = Number(p[1]);
  //       const y = Number(p[2]);
  //       const z = Number(p[3]);

  //       const r11 = Number(p[7]);
  //       const r12 = Number(p[8]);
  //       const r13 = Number(p[9]);
  //       const r21 = Number(p[10]);
  //       const r22 = Number(p[11]);
  //       const r23 = Number(p[12]);
  //       const r31 = Number(p[13]);
  //       const r32 = Number(p[14]);
  //       const r33 = Number(p[15]);

  //       if ([x, y, z, r11, r12, r13, r21, r22, r23, r31, r32, r33].some(isNaN))
  //         return;

  //       positions.push(new THREE.Vector3(x, y, z));

  //       parsed.push({
  //         imageName,
  //         x,
  //         y,
  //         z,
  //         R: [r11, r12, r13, r21, r22, r23, r31, r32, r33],
  //       });
  //     });

  //     // center
  //     const center = new THREE.Vector3();
  //     positions.forEach((p) => center.add(p));
  //     center.divideScalar(positions.length);

  //     const finalParsed = parsed.map((c) => {
  //       const position = new THREE.Vector3(
  //         c.x - center.x,
  //         c.y - center.y,
  //         c.z - center.z,
  //       );

  //       const R = new THREE.Matrix4().set(
  //         c.R[0],
  //         c.R[1],
  //         c.R[2],
  //         0,
  //         c.R[3],
  //         c.R[4],
  //         c.R[5],
  //         0,
  //         c.R[6],
  //         c.R[7],
  //         c.R[8],
  //         0,
  //         0,
  //         0,
  //         0,
  //         1,
  //       );

  //       const quaternion = new THREE.Quaternion().setFromRotationMatrix(R);

  //       return {
  //         imageName: c.imageName,
  //         position,
  //         quaternion,
  //       };
  //     });

  //     originalPosRef.current = finalParsed;
  //     buildCameras(finalParsed);
  //   };

  //   reader.readAsText(cameraPositionsFile);
  // }, [cameraPositionsFile, buildCameras, cleanupAll]);

  // ── PARSE images.txt ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraPositionsFile) {
      cleanupAll();
      originalPosRef.current = [];
      return;
    }
    // An uploaded Matrix File (.json) for this batch is baked straight into
    // the camera positions, same as the manual "Upload Camera Matrix" flow.
    if (uploadedCameraMatrix) {
      matrixRef.current = uploadedCameraMatrix;
      matrixAppliedRef.current = true;
    } else {
      matrixAppliedRef.current = false;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = [];
      // COLMAP images.txt alternates two lines per image: a pose line
      // (IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME) followed by
      // that image's POINTS2D line (a long run of X Y POINT3D_ID triples).
      // We only want pose lines — the POINTS2D line has no NAME field, and
      // its numeric columns were previously being misread as a bogus extra
      // "camera" with a garbage decimal ID. This flag tracks which kind of
      // line we expect next so POINTS2D lines are always skipped.
      let expectingPose = true;

      e.target.result.split("\n").forEach((line) => {
        if (!line.trim() || line.startsWith("#")) return;

        if (!expectingPose) {
          // This is the POINTS2D line for the previous image — skip it and
          // resume expecting a pose line on the next data line.
          expectingPose = true;
          return;
        }

        const p = line.trim().split(/\s+/);
        if (p.length < 10) return; // malformed pose line, keep waiting

        const imageName = p[9];
        // Sanity check: a real NAME token looks like a filename (contains a
        // letter, or ends in a .ext). A bare float (e.g. "533.2426743...")
        // means we've desynced onto a POINTS2D line — skip without
        // flipping expectingPose so we don't cascade the desync further.
        if (!/[A-Za-z]|\.[A-Za-z0-9]+$/.test(imageName)) return;

        const nums = [p[1], p[2], p[3], p[4], p[5], p[6], p[7]].map(Number);
        if (nums.some(isNaN)) return;
        const [qw, qx, qy, qz, tx, ty, tz] = nums;
        const q = new THREE.Quaternion(qx, qy, qz, qw);
        const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
        const Rt = R.clone().transpose();
        const C = new THREE.Vector3(tx, ty, tz)
          .applyMatrix4(Rt)
          .multiplyScalar(-1);
        const qr = new THREE.Quaternion().setFromRotationMatrix(Rt);
        qr.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            Math.PI,
          ),
        );
        parsed.push({ imageName, position: C.clone(), quaternion: qr.clone() });

        // Successfully consumed a pose line — the very next non-comment
        // line is its POINTS2D line, so skip that one.
        expectingPose = false;
      });
      // Order by filename, not by however the lines appeared in images.txt —
      // this is what makes the path trace the actual scan sequence instead
      // of zig-zagging through the center (COLMAP's IMAGE_ID order != capture
      // order).
      parsed.sort((a, b) =>
        naturalCompare(a.imageName || "", b.imageName || ""),
      );
      originalPosRef.current = parsed;
      buildCameras(parsed);
    };
    reader.readAsText(cameraPositionsFile);
  }, [cameraPositionsFile, uploadedCameraMatrix, buildCameras, cleanupAll]);
  // ── show/hide all markers ─────────────────────────────────────────────────
  useEffect(() => {
    cameraMarkersRef.current.forEach((m) => {
      m.visible = showCameras !== false;
    });
  }, [showCameras]);

  // ── IMAGE FOLDER UPLOAD ───────────────────────────────────────────────────
  const handleCameraFolderUpload = useCallback(
    (files) => {
      Array.from(files).forEach((file) => {
        // ── Validate: only image formats allowed ──────────────────────────
        const validImageExts = /\.(jpg|jpeg|png|gif|bmp|webp|tiff|tif)$/i;
        if (!validImageExts.test(file.name)) {
          alert(
            `Invalid image format: "${file.name}". Only image files (jpg, jpeg, png, gif, bmp, webp, tiff) are supported.`,
          );
          return;
        }

        const url = URL.createObjectURL(file);
        [
          file.name,
          file.name.toLowerCase(),
          file.name.toUpperCase(),
          file.name.replace(/\.[^/.]+$/, (e) => e.toLowerCase()),
          file.name.replace(/\.[^/.]+$/, (e) => e.toUpperCase()),
        ].forEach((k) => {
          GLOBAL_IMAGE_MAP[k] = url;
        });
      });
      camerasRef.current.forEach((cam, i) => {
        const url = lookupImage(cam.userData.imageName);
        cam.userData.image = url;
        cam.userData.hasImage = !!url;
        const marker = cameraMarkersRef.current[i];
        if (marker && !cam.userData.isManual) {
          marker.userData.baseColor = url ? 0x8b5cf6 : 0xf97316;
        }
      });
      setSelectedCamera((prev) => {
        if (!prev) return prev;
        const url = lookupImage(prev.name);
        return url !== prev.image ? { ...prev, image: url } : prev;
      });
      bump();
    },
    [bump],
  );

  // ── MATRIX UPLOAD ─────────────────────────────────────────────────────────
  const handleCameraMatrixUpload = useCallback((file) => {
    if (!file) return;

    // ── Validate: allow only .json files ────────────────────────────────
    if (!file.name.toLowerCase().endsWith(".json")) {
      alert(
        `Invalid file format: "${file.name}". Camera matrix must be a .json file.`,
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);

        if (
          !Array.isArray(json) ||
          json.length !== 4 ||
          !json.every((row) => Array.isArray(row) && row.length === 4)
        ) {
          throw new Error("Need 4×4 matrix");
        }

        matrixRef.current = json;
        matrixAppliedRef.current = false;

        alert("Matrix loaded! Click Apply Camera Matrix.");
      } catch (err) {
        alert("Invalid JSON: " + err.message);
      }
    };

    reader.readAsText(file);
  }, []);

  const applyCameraMatrix = useCallback(() => {
    if (!matrixRef.current) {
      alert("No matrix uploaded.");
      return;
    }
    if (!originalPosRef.current.length) {
      alert("No cameras loaded.");
      return;
    }
    matrixAppliedRef.current = true;
    buildCameras(originalPosRef.current);
  }, [buildCameras]);

  // ── LIVE PREVIEW ──────────────────────────────────────────────────────────
  const stopPreview = useCallback(() => {
    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    stopPreview();
    if (!selectedCamera?.camObj || !sceneRef.current) return;
    let r1, r2;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const canvas = previewCanvasRef.current;
        if (!canvas) return;
        const W = 360,
          H = 200;
        if (previewRendererRef.current?.domElement !== canvas) {
          previewRendererRef.current?.dispose();
          previewRendererRef.current = null;
        }
        if (!previewRendererRef.current)
          previewRendererRef.current = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
          });
        const pr = previewRendererRef.current;
        pr.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        pr.setSize(W, H, false);
        pr.setClearColor(0x0d0d14, 1);
        const cam = selectedCamera.camObj;
        cam.aspect = W / H;
        cam.updateProjectionMatrix();
        const loop = () => {
          previewRafRef.current = requestAnimationFrame(loop);
          pr.render(sceneRef.current, cam);
        };
        loop();
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      stopPreview();
    };
  }, [selectedCamera, stopPreview, sceneRef]);

  useEffect(
    () => () => {
      stopPreview();
      previewRendererRef.current?.dispose();
    },
    [],
  );

  // ── ADD CAMERA MANUALLY ───────────────────────────────────────────────────
  const addCameraManually = useCallback(() => {
    if (!sceneRef.current || !cameraRef.current) return;
    manualCameraCounter += 1;
    const label = `Camera ${manualCameraCounter}`;
    const mainCam = cameraRef.current;
    const dir = new THREE.Vector3();
    mainCam.getWorldDirection(dir);
    const spawnPos = mainCam.position.clone().add(dir.multiplyScalar(5));

    const cam = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 10000);
    cam.position.copy(spawnPos);
    cam.quaternion.copy(mainCam.quaternion);
    cam.updateMatrixWorld(true);

    const idx = camerasRef.current.length;
    cam.userData = {
      imageName: label,
      image: null,
      hasImage: false,
      index: idx,
      isManual: true,
    };
    sceneRef.current.add(cam);
    camerasRef.current.push(cam);

    const geo = new THREE.ConeGeometry(1, 2, 4);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI);
    const marker = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      }),
    );
    marker.position.copy(cam.position);
    marker.setRotationFromQuaternion(cam.quaternion);
    marker.userData.cameraIndex = idx;
    marker.userData.baseColor = 0x06b6d4;
    marker.visible = showCameras !== false;
    sceneRef.current.add(marker);
    cameraMarkersRef.current.push(marker);

    const helper = new THREE.CameraHelper(cam);
    helper.visible = false;
    sceneRef.current.add(helper);
    cameraHelpersRef.current.push(helper);

    setActiveCamera(cam);

    setManualCameras((prev) => [
      ...prev,
      { name: label, visible: true, hasImage: false },
    ]);
    updateCameraPath();
  }, [showCameras, setActiveCamera, sceneRef, cameraRef, updateCameraPath]);

  // ── DELETE CAMERA ─────────────────────────────────────────────────────────
  const deleteCamera = useCallback(
    (name) => {
      if (!sceneRef.current) return;
      const idx = camerasRef.current.findIndex(
        (c) => c.userData.imageName === name || c.userData.name === name,
      );
      if (idx === -1) return;

      [
        camerasRef.current[idx],
        cameraMarkersRef.current[idx],
        cameraHelpersRef.current[idx],
      ].forEach((obj) => {
        if (!obj) return;
        obj.geometry?.dispose();
        obj.material?.dispose();
        sceneRef.current.remove(obj);
      });

      camerasRef.current.splice(idx, 1);
      cameraMarkersRef.current.splice(idx, 1);
      cameraHelpersRef.current.splice(idx, 1);

      camerasRef.current.forEach((c, i) => {
        c.userData.index = i;
      });
      cameraMarkersRef.current.forEach((m, i) => {
        m.userData.cameraIndex = i;
      });

      clearActiveCamera(name);
      setSelectedCamera((prev) => (prev?.name === name ? null : prev));
      setManualCameras((prev) => prev.filter((c) => c.name !== name));
      updateCameraPath();
    },
    [sceneRef, clearActiveCamera, updateCameraPath],
  );

  // Keep the ref in sync (read inside updateCameraPath without adding it as a
  // dependency) and flip the actual line's visibility on toggle.
  useEffect(() => {
    cameraPathVisibleRef.current = cameraPathVisible;
   // Camera path = red dots only
    if (pathDotsRef.current) {
      pathDotsRef.current.visible = cameraPathVisible;
    }

    // Make normal camera cones disappear when path is active
    cameraMarkersRef.current.forEach((marker) => {
      if (marker) {
        marker.visible = !cameraPathVisible && showCameras !== false;
      }
    });
  }, [cameraPathVisible, showCameras]);

  const toggleCameraPath = useCallback(() => {
    setCameraPathVisible((v) => !v);
  }, []);
  // ── TOGGLE VISIBILITY ─────────────────────────────────────────────────────
  const toggleCameraVisibility = useCallback((name) => {
    const idx = camerasRef.current.findIndex(
      (c) => c.userData.imageName === name || c.userData.name === name,
    );
    if (idx === -1) return;
    const marker = cameraMarkersRef.current[idx];
    if (marker) marker.visible = !marker.visible;
    setManualCameras((prev) =>
      prev.map((c) => (c.name === name ? { ...c, visible: !c.visible } : c)),
    );
  }, []);

  // ── NEW: color camera dots from the Camera Data table values ──────────────
  // Also swaps each marker's shape from the cone to a round dot (sphere).
  const colorCamerasByColumn = useCallback(
    (tableData, columnKey) => {
      if (!columnKey) return;

      const entries = camerasRef.current
        .map((cam) => {
          const camId = cam.userData.imageName;
          const val = parseFloat(tableData?.[camId]?.[columnKey]);
          return { cam, val };
        })
        .filter((e) => Number.isFinite(e.val));

      if (!entries.length) return;

      const values = entries.map((e) => e.val);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;

      entries.forEach(({ cam, val }) => {
        const marker = cameraMarkersRef.current[cam.userData.index];
        if (!marker) return;

        // Save the original cone geometry once, so Reset can restore it exactly.
        if (!marker.userData.originalGeometry) {
          marker.userData.originalGeometry = marker.geometry;
        }
        // Build (once) and reuse a sphere geometry for this marker.
        if (!marker.userData.dotGeometry) {
          marker.userData.dotGeometry = new THREE.SphereGeometry(0.35, 16, 16);
        }
        marker.geometry = marker.userData.dotGeometry;

        const hex = viridisColor((val - min) / range);
        marker.material.color.set(hex);
        marker.userData.baseColor = new THREE.Color(hex).getHex();
        marker.userData.hasDataColor = true;
      });

      bump();
    },
    [bump],
  );

  // ── NEW: revert dots back to the default black idle cones ─────────────────
  const resetCameraColors = useCallback(() => {
    cameraMarkersRef.current.forEach((marker, idx) => {
      const cam = camerasRef.current[idx];
      if (!marker || !cam) return;

      if (marker.userData.originalGeometry) {
        marker.geometry = marker.userData.originalGeometry;
      }

      const semanticColor = cam.userData.isManual
        ? 0x06b6d4
        : cam.userData.hasImage
          ? 0x8b5cf6
          : 0xf97316;
      marker.material.color.setHex(0x000000);
      marker.userData.baseColor = semanticColor;
      marker.userData.hasDataColor = false;
    });
    bump();
  }, [bump]);

  // ── MANUAL IMAGE UPLOAD ───────────────────────────────────────────────────
  const handleManualCameraImageUpload = useCallback(
    (file, camName) => {
      if (!file || !camName) return;

      // ── Validate: only image formats allowed ──────────────────────────
      const validImageExts = /\.(jpg|jpeg|png|gif|bmp|webp|tiff|tif)$/i;
      if (!validImageExts.test(file.name)) {
        alert(
          `Invalid image format: "${file.name}". Only image files (jpg, jpeg, png, gif, bmp, webp, tiff) are supported.`,
        );
        return;
      }

      const url = URL.createObjectURL(file);
      GLOBAL_IMAGE_MAP[camName] = url;
      GLOBAL_IMAGE_MAP[camName.toLowerCase()] = url;
      const cam = camerasRef.current.find(
        (c) => c.userData.imageName === camName,
      );
      if (cam) {
        cam.userData.image = url;
        cam.userData.hasImage = true;
        const marker = cameraMarkersRef.current[cam.userData.index];
        if (marker) {
          marker.userData.baseColor = 0x8b5cf6;
        }
      }
      setManualCameras((prev) =>
        prev.map((c) => (c.name === camName ? { ...c, hasImage: true } : c)),
      );
      setSelectedCamera((prev) =>
        prev?.name === camName ? { ...prev, image: url } : prev,
      );
      bump();
    },
    [bump],
  );

  // ── CLICK marker on canvas ────────────────────────────────────────────────
  useEffect(() => {
    const dom = rendererRef?.current?.domElement;
    if (!dom) return;

    const onClick = (e) => {
      if (dom.__suppressNextClick) {
        dom.__suppressNextClick = false;
        return;
      }
      const mainCam = cameraRef?.current;
      if (!mainCam) return;

      const rect = dom.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(mouse, mainCam);
      const hits = ray.intersectObjects(cameraMarkersRef.current, false);
      if (!hits.length) return;

      const idx = hits[0].object.userData.cameraIndex;
      const cam = camerasRef.current[idx];
      if (!cam) return;

      // Restore previous selection to black
      if (
        selectedMarkerRef.current &&
        selectedMarkerRef.current !== hits[0].object
      ) {
        selectedMarkerRef.current.material.color.setHex(0x000000);
      }
      // Highlight new selection with its meaningful base color
      hits[0].object.material.color.setHex(
        hits[0].object.userData.baseColor ?? 0xf97316,
      );
      selectedMarkerRef.current = hits[0].object;

      setActiveCamera(cam);

      const imageUrl = lookupImage(cam.userData.imageName);
      setSelectedCamera({
        name: cam.userData.imageName,
        image: imageUrl || null,
        camObj: cam,
        isManual: cam.userData.isManual,
        awaitingImage: cam.userData.isManual && !imageUrl,
      });
    };

    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
    // eslint-disable-next-line
  }, [rendererRef?.current?.domElement, setActiveCamera, cameraRef]);

  // ── HOVER glow ────────────────────────────────────────────────────────────
  useEffect(() => {
    const dom = rendererRef?.current?.domElement;
    if (!dom) return;
    let lastHovered = null;
    const onMove = (e) => {
      const mainCam = cameraRef?.current;
      if (!mainCam) return;
      const rect = dom.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(mouse, mainCam);
      const hits = ray.intersectObjects(cameraMarkersRef.current, false);
      if (hits.length) {
        const m = hits[0].object;
        dom.style.cursor = "pointer";
        if (lastHovered && lastHovered !== m) {
          lastHovered.scale.setScalar(1);
        }
        m.scale.setScalar(1.25);
        lastHovered = m;
      } else {
        dom.style.cursor = "default";
        if (lastHovered) {
          lastHovered.scale.setScalar(1);
          lastHovered = null;
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
    // eslint-disable-next-line
  }, [rendererRef?.current?.domElement, cameraRef]);

  // ── window exposure ───────────────────────────────────────────────────────
  useEffect(() => {
    window.handleCameraFolderUpload = handleCameraFolderUpload;
    window.handleCameraMatrixUpload = handleCameraMatrixUpload;
    window.applyCameraMatrix = applyCameraMatrix;
    window.addCameraManually = addCameraManually;
    window.toggleCameraPath = toggleCameraPath;
  }, [
    handleCameraFolderUpload,
    handleCameraMatrixUpload,
    applyCameraMatrix,
    addCameraManually,
    toggleCameraPath,
  ]);

  return {
    selectedCamera,
    setSelectedCamera,
    previewCanvasRef,
    handleCameraFolderUpload,
    handleCameraMatrixUpload,
    applyCameraMatrix,
    addCameraManually,
    deleteCamera,
    toggleCameraVisibility,
    colorCamerasByColumn,
    resetCameraColors,
    handleManualCameraImageUpload,
    manualCameras,
    allCameras: camerasRef.current, // ← NEW: real posed cameras (DJI batch + manual), THREE.PerspectiveCamera objects with world transforms already applied
    transformRef,
    setActiveCamera,
    clearActiveCamera,
    toggleCameraPath,
    cameraPathVisible,
  };
}
