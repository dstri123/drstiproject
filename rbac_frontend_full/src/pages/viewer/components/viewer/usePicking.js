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

  // Draws (or redraws) the marker's circle + number onto an existing canvas.
  const drawMarkerCanvas = (canvas, color, labelNum) => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (labelNum != null) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(labelNum), 32, 34);
    }
  };

  // ✅ memoized
  const addMarker = useCallback(
    (position, color = "lime", size = 2, labelNum = null) => {
      if (!sceneRef.current) return null;

      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;

      drawMarkerCanvas(canvas, color, labelNum);

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
        // 0-based index into bimPoints/pcPoints — kept in sync via relabelMarkers
        pointIndex: labelNum != null ? labelNum - 1 : null,
      };

      sceneRef.current.add(sprite);
      spritesRef.current.push(sprite);

      return sprite;
    },
    [sceneRef],
  );

  // Renumbers all remaining markers of a given type (1, 2, 3…) after a
  // deletion, so on-model labels and pointIndex stay in sync with the array.
  const relabelMarkers = useCallback((type) => {
    const markers = spritesRef.current.filter((m) => m.userData.type === type);
    markers.forEach((marker, i) => {
      const canvas = marker.material.map?.image;
      const color = type === "bim" ? "lime" : "red";
      if (canvas) {
        drawMarkerCanvas(canvas, color, i + 1);
        marker.material.map.needsUpdate = true;
      }
      marker.userData.pointIndex = i;
    });
  }, []);

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

      // marker remove — click an existing marker again to delete it
      const markerHits = raycaster.current.intersectObjects(spritesRef.current);

      if (markerHits.length > 0) {
        const marker = markerHits[0].object;
        const type = marker.userData.type;
        const removedIndex = marker.userData.pointIndex;

        sceneRef.current.remove(marker);
        spritesRef.current = spritesRef.current.filter((m) => m !== marker);

        if (type === "bim") {
          setBimPoints((prev) => {
            const updated = prev.filter((_, i) => i !== removedIndex);
            onBimPointsChange?.(updated);
            return updated;
          });
        } else if (type === "pc") {
          setPcPoints((prev) => {
            const updated = prev.filter((_, i) => i !== removedIndex);
            onPcPointsChange?.(updated);
            return updated;
          });
        }

        // Renumber the remaining markers of this type so labels/list line up
        relabelMarkers(type);
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

          // Read WORLD transform, not local — FBX/IFC meshes almost always
          // have identity local transform (position/rotation baked into
          // vertices, or held on a parent group), so mesh.position etc. would
          // always read as [0,0,0]/[1,1,1]. World transform reflects where
          // the element actually sits in the scene.
          mesh.updateMatrixWorld(true);
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          const worldScale = new THREE.Vector3();
          mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
          const worldEuler = new THREE.Euler().setFromQuaternion(
            worldQuat,
            "XYZ",
          );

          onElementSelect?.({
            name: mesh.name || "Unnamed",
            type: mesh.type,
            position: worldPos.toArray(),
            rotation: [worldEuler.x, worldEuler.y, worldEuler.z],
            scale: worldScale.toArray(),
            visible: mesh.visible,
            overlappingPoints:
              window.__overlapCountsByUuid?.get(mesh.uuid) ?? 0,
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
    relabelMarkers,
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
