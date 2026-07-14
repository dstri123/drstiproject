import { useEffect, useRef, useState, useCallback } from "react";
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
    },
    [sceneRef, cleanupAll, showCameras, pcModel],
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
    };

    updateMarkerSize();

    return () => cancelAnimationFrame(raf);
  }, [cameraRef]);

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
      e.target.result.split("\n").forEach((line) => {
        if (!line.trim() || line.startsWith("#")) return;
        const p = line.trim().split(/\s+/);
        if (p.length < 10) return;
        const imageName = p[9];
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
      });
      originalPosRef.current = parsed;
      buildCameras(parsed);
    };
    reader.readAsText(cameraPositionsFile);
  }, [cameraPositionsFile, uploadedCameraMatrix, buildCameras, cleanupAll]);

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
  }, [showCameras, setActiveCamera, sceneRef, cameraRef]);

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
    },
    [sceneRef, clearActiveCamera],
  );

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
  }, [
    handleCameraFolderUpload,
    handleCameraMatrixUpload,
    applyCameraMatrix,
    addCameraManually,
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
    handleManualCameraImageUpload,
    manualCameras,
    transformRef,
    setActiveCamera,
    clearActiveCamera,
  };
}
