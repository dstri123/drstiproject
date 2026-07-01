// import { useEffect, useRef, useState } from "react";
// import * as THREE from "three";

// export default function usePicking(sceneData, modelData, props) {
//   const { sceneRef, cameraRef, rendererRef } = sceneData;
//   const { bimModel, pcModel } = modelData;

//   const { onBimPointsChange, onPcPointsChange, onElementSelect } = props;

//   const raycaster = useRef(new THREE.Raycaster());
//   const mouse = useRef(new THREE.Vector2());
//   const spritesRef = useRef([]);

//   const [bimPoints, setBimPoints] = useState([]);
//   const [pcPoints, setPcPoints] = useState([]);
//   const [pickingMode, setPickingMode] = useState(null);

//   const highlightedRef = useRef(null);

//   const role = localStorage.getItem("role");

//   // ================= MARKER =================
//   const addMarker = (position, color = "lime", size = 2) => {
//     if (!sceneRef.current) return null;

//     const canvas = document.createElement("canvas");
//     canvas.width = 64;
//     canvas.height = 64;

//     const ctx = canvas.getContext("2d");

//     ctx.beginPath();
//     ctx.arc(32, 32, 28, 0, Math.PI * 2);
//     ctx.fillStyle = "white";
//     ctx.fill();

//     ctx.beginPath();
//     ctx.arc(32, 32, 22, 0, Math.PI * 2);
//     ctx.fillStyle = color;
//     ctx.fill();

//     const texture = new THREE.CanvasTexture(canvas);

//     const material = new THREE.SpriteMaterial({
//       map: texture,
//       depthTest: false,
//       depthWrite: false,
//     });

//     const sprite = new THREE.Sprite(material);

//     sprite.position.copy(position);
//     sprite.scale.set(size, size, size);
//     sprite.renderOrder = 999;

//     sprite.userData = {
//       isPickingMarker: true,
//       type: color === "lime" ? "bim" : "pc",
//       index: color === "lime" ? bimPoints.length : pcPoints.length,
//     };
//     sceneRef.current.add(sprite);

//     // 🔥 IMPORTANT (so clearMarkers can remove it)
//     spritesRef.current.push(sprite);

//     return sprite;
//   };

//   // ================= CLEAR MARKERS =================
//   const clearMarkers = () => {
//     if (!sceneRef.current) return;

//     spritesRef.current.forEach((marker) => {
//       sceneRef.current.remove(marker);
//     });

//     spritesRef.current = [];

//     setBimPoints([]);
//     setPcPoints([]);

//     onBimPointsChange?.([]);
//     onPcPointsChange?.([]);
//   };

//   // expose globally so Sidebar can call it
//   useEffect(() => {
//     window.clearMarkers = clearMarkers;
//   }, []);

//   // ================= MARKER SCALE =================
//   useEffect(() => {
//     let frame;

//     const updateMarkerScale = () => {
//       if (!cameraRef.current) return;

//       spritesRef.current.forEach((marker) => {
//         if (!marker.userData.isPickingMarker) return;

//         const distance = cameraRef.current.position.distanceTo(marker.position);
//         const scaleFactor = distance * 0.03;

//         marker.scale.setScalar(scaleFactor);
//       });

//       frame = requestAnimationFrame(updateMarkerScale);
//     };

//     updateMarkerScale();

//     return () => cancelAnimationFrame(frame);
//   }, []);

//   // ================= CLICK HANDLER =================
//   useEffect(() => {
//     const handleClick = (e) => {
//       if (!cameraRef.current || !rendererRef.current) return;

//       const rect = rendererRef.current.domElement.getBoundingClientRect();

//       mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
//       mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

//       raycaster.current.setFromCamera(mouse.current, cameraRef.current);

//       // ================= REMOVE MARKER =================
//       const markerHits = raycaster.current.intersectObjects(
//         spritesRef.current,
//         true,
//       );

//       if (markerHits.length > 0) {
//         const marker = markerHits[0].object;

//         const markerIndex = spritesRef.current.indexOf(marker);

//         if (markerIndex !== -1) {
//           sceneRef.current.remove(marker);
//           spritesRef.current.splice(markerIndex, 1);
//         }

//         if (marker.userData.type === "bim") {
//           const updated = bimPoints.filter(
//             (_, i) => i !== marker.userData.index,
//           );
//           setBimPoints(updated);
//           onBimPointsChange?.(updated);
//         }

//         if (marker.userData.type === "pc") {
//           const updated = pcPoints.filter(
//             (_, i) => i !== marker.userData.index,
//           );
//           setPcPoints(updated);
//           onPcPointsChange?.(updated);
//         }

//         return;
//       }

//       // ================= METADATA MODE =================
//       if (!pickingMode && bimModel) {
//         const hits = raycaster.current.intersectObject(bimModel, true);

//         if (highlightedRef.current) {
//           highlightedRef.current.material =
//             highlightedRef.current.userData.originalMaterial;
//           highlightedRef.current = null;
//         }

//         if (hits.length > 0) {
//           const mesh = hits[0].object;

//           if (!mesh.userData.originalMaterial) {
//             mesh.userData.originalMaterial = mesh.material;
//           }

//           mesh.material = new THREE.MeshStandardMaterial({
//             color: 0xff0000,
//             transparent: true,
//             opacity: 0.8,
//           });

//           highlightedRef.current = mesh;

//           const meta = {
//             name: mesh.name || "Unnamed",
//             type: mesh.type,
//             position: [
//               mesh.position.x.toFixed(3),
//               mesh.position.y.toFixed(3),
//               mesh.position.z.toFixed(3),
//             ],
//             rotation: [
//               mesh.rotation.x.toFixed(3),
//               mesh.rotation.y.toFixed(3),
//               mesh.rotation.z.toFixed(3),
//             ],
//             scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
//             visible: mesh.visible,
//           };

//           onElementSelect?.(meta);
//         } else {
//           onElementSelect?.(null);
//         }

//         return;
//       }

//       // 🔒 BLOCK PICKING FOR VIEWER
//       if (role === "viewer") {
//         console.log("Viewer cannot pick points");
//         return;
//       }

//       // ================= BIM PICK =================
//       if (pickingMode === "bim" && bimModel) {
//         const hits = raycaster.current.intersectObject(bimModel, true);

//         if (hits.length > 0) {
//           const hit = hits[0];
//           const p = hit.point.clone();

//           if (hit.face) {
//             const normal = hit.face.normal.clone();
//             normal.transformDirection(hit.object.matrixWorld);

//             p.add(normal.multiplyScalar(0.2));
//           }

//           addMarker(p, "lime");

//           const updated = [...bimPoints, p];

//           setBimPoints(updated);

//           onBimPointsChange?.(updated);
//         }
//       }

//       // ================= POINT CLOUD PICK =================
//       if (pickingMode === "pc" && pcModel) {
//         raycaster.current.params.Points = { threshold: 0.5 };

//         const hits = raycaster.current.intersectObject(pcModel, true);

//         if (hits.length > 0) {
//           const p = hits[0].point.clone();

//           addMarker(p, "red");

//           const updated = [...pcPoints, p];

//           setPcPoints(updated);

//           onPcPointsChange?.(updated);
//         }
//       }
//     };

//     rendererRef.current?.domElement.addEventListener("click", handleClick);

//     return () => {
//       rendererRef.current?.domElement.removeEventListener("click", handleClick);
//     };
//   }, [bimModel, pcModel, bimPoints, pcPoints, pickingMode]);

//   // ================= SIDEBAR CONTROL =================
//   useEffect(() => {
//     window.setPickingMode = setPickingMode;
//   }, []);

//   useEffect(() => {
//     if (!rendererRef.current) return;

//     const canvas = rendererRef.current.domElement;

//     if (pickingMode === "bim" || pickingMode === "pc") {
//       canvas.style.cursor = "pointer"; // ☝️ hand cursor
//     } else {
//       canvas.style.cursor = "default"; // normal cursor
//     }
//   }, [pickingMode]);

//   return { bimPoints, pcPoints, pickingMode };
// }

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

export default function usePicking(sceneData, modelData, props) {
  const { sceneRef, cameraRef, rendererRef } = sceneData;
  const { bimModel, pcModel } = modelData;

  const { onBimPointsChange, onPcPointsChange, onElementSelect } = props;

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const spritesRef = useRef([]);

  const [bimPoints, setBimPoints] = useState([]);
  const [pcPoints, setPcPoints] = useState([]);
  const [pickingMode, setPickingMode] = useState(null);

  const highlightedRef = useRef(null);
  const role = localStorage.getItem("role");

  // ✅ memoized
  const addMarker = useCallback(
    (position, color = "lime", size = 2, labelNum = null) => {
      if (!sceneRef.current) return null;

      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;

      const ctx = canvas.getContext("2d");

      ctx.beginPath();
      ctx.arc(32, 32, 28, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(32, 32, 22, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Draw the correspondence number (1, 2, 3…) so BIM #n ↔ Cloud #n is clear.
      if (labelNum != null) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 30px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(labelNum), 32, 34);
      }

      const texture = new THREE.CanvasTexture(canvas);

      const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
      });

      const sprite = new THREE.Sprite(material);

      sprite.position.copy(position);
      sprite.scale.set(size, size, size);
      sprite.renderOrder = 999;

      sprite.userData = {
        isPickingMarker: true,
        type: color === "lime" ? "bim" : "pc",
      };

      sceneRef.current.add(sprite);
      spritesRef.current.push(sprite);

      return sprite;
    },
    [sceneRef],
  );

  const clearMarkers = useCallback(() => {
    if (!sceneRef.current) return;

    spritesRef.current.forEach((marker) => {
      sceneRef.current.remove(marker);
    });

    spritesRef.current = [];

    setBimPoints([]);
    setPcPoints([]);

    onBimPointsChange?.([]);
    onPcPointsChange?.([]);
  }, [sceneRef, onBimPointsChange, onPcPointsChange]);

  // expose globally
  useEffect(() => {
    window.clearMarkers = clearMarkers;
  }, [clearMarkers]);

  // marker scaling
  useEffect(() => {
    let frame;

    const update = () => {
      if (!cameraRef.current) return;

      spritesRef.current.forEach((marker) => {
        const d = cameraRef.current.position.distanceTo(marker.position);
        marker.scale.setScalar(d * 0.03);
      });

      frame = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(frame);
  }, [cameraRef]);

  // ✅ FIXED click handler
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    const handleClick = (e) => {
      if (!cameraRef.current) return;

      const rect = canvas.getBoundingClientRect();

      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(mouse.current, cameraRef.current);

      // marker remove
      const markerHits = raycaster.current.intersectObjects(spritesRef.current);

      if (markerHits.length > 0) {
        const marker = markerHits[0].object;
        sceneRef.current.remove(marker);
        spritesRef.current = spritesRef.current.filter((m) => m !== marker);
        return;
      }

      // metadata
      if (!pickingMode && bimModel) {
        const hits = raycaster.current.intersectObject(bimModel, true);

        if (highlightedRef.current) {
          highlightedRef.current.material =
            highlightedRef.current.userData.originalMaterial;
          highlightedRef.current = null;
        }

        if (hits.length > 0) {
          const mesh = hits[0].object;

          if (!mesh.userData.originalMaterial) {
            mesh.userData.originalMaterial = mesh.material;
          }

          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.8,
          });

          highlightedRef.current = mesh;

          onElementSelect?.({
            name: mesh.name || "Unnamed",
          });
        }

        return;
      }

      if (role === "viewer") return;

      if (pickingMode === "bim" && bimModel) {
        const hits = raycaster.current.intersectObject(bimModel, true);
        if (hits.length > 0) {
          const p = hits[0].point.clone();
          addMarker(p, "lime", 2, bimPoints.length + 1);

          const updated = [...bimPoints, p];
          setBimPoints(updated);
          onBimPointsChange?.(updated);
        }
      }

      if (pickingMode === "pc" && pcModel) {
        // Point picking only registers if the ray's Points threshold roughly
        // matches the cloud's point spacing/scale; the default (1) misses
        // entirely on large clouds. Derive it from the cloud's world size.
        pcModel.geometry.computeBoundingSphere?.();
        const sphere = pcModel.geometry.boundingSphere;
        const worldScale = pcModel.scale?.x || 1;
        raycaster.current.params.Points.threshold = sphere
          ? Math.max(sphere.radius * worldScale * 0.02, 0.05)
          : 1;
        const hits = raycaster.current.intersectObject(pcModel, true);
        if (hits.length > 0) {
          const p = hits[0].point.clone();
          addMarker(p, "red", 2, pcPoints.length + 1);

          const updated = [...pcPoints, p];
          setPcPoints(updated);
          onPcPointsChange?.(updated);
        }
      }
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [
    cameraRef,
    rendererRef,
    bimModel,
    pcModel,
    pickingMode,
    bimPoints,
    pcPoints,
    addMarker,
    onBimPointsChange,
    onPcPointsChange,
    onElementSelect,
    sceneRef,
    role,
  ]);

  useEffect(() => {
    window.setPickingMode = setPickingMode;
  }, []);

  // Expose the active picking mode so click-to-select (useObjectSelection) can
  // stand down while the user is picking alignment points.
  useEffect(() => {
    window.__pickingMode = pickingMode;
    return () => {
      window.__pickingMode = null;
    };
  }, [pickingMode]);

  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    // Crosshair while picking alignment points (precise clicks); otherwise the
    // grab hand for orbit/pan navigation — including over the BIM/point-cloud.
    canvas.style.cursor =
      pickingMode === "bim" || pickingMode === "pc" ? "crosshair" : "grab";
  }, [pickingMode, rendererRef]);

  return { bimPoints, pcPoints, pickingMode, clearMarkers };
}
