import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  categorizeIfcType,
  categorizeElementName,
} from "./useModelLoader";

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
  const selectedIfcSubsetRef = useRef(null);
  const role = localStorage.getItem("role");

  const clearIfcSubset = useCallback(() => {
    if (!sceneRef.current || !selectedIfcSubsetRef.current) return;
    const oldSubset = selectedIfcSubsetRef.current;
    if (bimModel && typeof bimModel.removeSubset === "function") {
      try {
        bimModel.removeSubset(oldSubset.material, "selectedIfcElement");
      } catch (e) {
        console.warn("Failed to remove previous IFC subset", e);
      }
    }
    if (oldSubset.parent) {
      oldSubset.parent.remove(oldSubset);
    }
    oldSubset.geometry?.dispose();
    if (Array.isArray(oldSubset.material)) {
      oldSubset.material.forEach((mat) => mat.dispose());
    } else {
      oldSubset.material?.dispose();
    }
    selectedIfcSubsetRef.current = null;
  }, [sceneRef, bimModel]);

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

        clearIfcSubset();
        if (highlightedRef.current) {
          highlightedRef.current.material =
            highlightedRef.current.userData.originalMaterial;
          highlightedRef.current = null;
        }

        if (hits.length > 0) {
          const rawHit = hits[0].object;
          const faceIndex = hits[0].faceIndex;
          const selectedMesh =
            rawHit.isMesh || rawHit.isPoints
              ? rawHit
              : rawHit.getObjectByProperty("isMesh", true) ||
                rawHit.getObjectByProperty("isPoints", true) ||
                rawHit;

          const getExpressID = (mesh, faceIdx) => {
            if (!mesh || faceIdx == null) return null;
            const geometry = mesh.geometry;
            const expressIDAttr = geometry?.attributes?.expressID;
            if (!expressIDAttr) return null;

            const indexArray = geometry.index?.array;
            const resolveId = (idx) => expressIDAttr.array[idx];
            if (indexArray) {
              const i0 = indexArray[faceIdx * 3];
              const i1 = indexArray[faceIdx * 3 + 1];
              const i2 = indexArray[faceIdx * 3 + 2];
              const ids = [resolveId(i0), resolveId(i1), resolveId(i2)];
              return ids[0] === ids[1] && ids[1] === ids[2]
                ? ids[0]
                : ids.find((id) => id != null) ?? null;
            }

            const i0 = faceIdx * 3;
            const i1 = i0 + 1;
            const i2 = i0 + 2;
            const ids = [resolveId(i0), resolveId(i1), resolveId(i2)];
            return ids[0] === ids[1] && ids[1] === ids[2]
              ? ids[0]
              : ids.find((id) => id != null) ?? null;
          };

          let subset = null;
          let expressID = getExpressID(selectedMesh, faceIndex);

          if (
            expressID == null &&
            selectedMesh.geometry?.attributes?.expressID &&
            typeof bimModel?.getExpressId === "function" &&
            typeof bimModel?.createSubset === "function" &&
            faceIndex != null
          ) {
            try {
              expressID = bimModel.getExpressId(selectedMesh.geometry, faceIndex);
            } catch (err) {
              console.warn("Failed to resolve IFC expressID", err);
            }
          }

          if (expressID != null) {
            const subsetMaterial = new THREE.MeshStandardMaterial({
              color: 0xff0000,
              transparent: true,
              opacity: 0.8,
              depthTest: false,
              depthWrite: false,
            });
            try {
              subset = bimModel.createSubset({
                ids: [expressID],
                material: subsetMaterial,
                customID: "selectedIfcElement",
              });
              subset.userData = {
                isIfcSelectionSubset: true,
                expressID,
              };
              selectedIfcSubsetRef.current = subset;
            } catch (err) {
              console.warn("IFC subset selection failed", err);
              subset = null;
            }
          }

          if (!subset) {
            if (!selectedMesh.userData.originalMaterial && selectedMesh.material) {
              selectedMesh.userData.originalMaterial = selectedMesh.material;
            }
            if (selectedMesh.material) {
              selectedMesh.material = new THREE.MeshStandardMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.8,
              });
            }
            highlightedRef.current = selectedMesh;
          }

          const elementType =
            expressID != null && typeof bimModel?.getIfcType === "function"
              ? bimModel.getIfcType(expressID)
              : selectedMesh.type;

          selectedMesh.updateMatrixWorld(true);
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          const worldScale = new THREE.Vector3();
          selectedMesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
          const worldEuler = new THREE.Euler().setFromQuaternion(
            worldQuat,
            "XYZ",
          );

          const expressOverlapCount =
            expressID != null
              ? window.__overlapCountsByExpressID?.get(expressID)
              : undefined;
          const meshOverlapCount = window.__overlapCountsByUuid?.get(
            selectedMesh.uuid,
          );

          // Same category + display-name derivation the sidebar's "BIM
          // Element Categories" breakdown uses when it builds its lists
          // (see setupBimObject in useModelLoader.js) — so the sidebar can
          // expand the right category and highlight this exact list entry.
          const category =
            expressID != null
              ? categorizeIfcType(elementType)
              : categorizeElementName(selectedMesh.name);
          const elementLabel =
            expressID != null
              ? `${elementType || "IFC"} #${expressID}`
              : selectedMesh.name || "Unnamed";

          onElementSelect?.({
            name: selectedMesh.name || "Unnamed",
            type: elementType,
            expressID,
            category,
            elementLabel,
            position: worldPos.toArray(),
            rotation: [worldEuler.x, worldEuler.y, worldEuler.z],
            scale: worldScale.toArray(),
            visible: selectedMesh.visible,
            overlappingPoints:
              expressOverlapCount != null
                ? expressOverlapCount
                : meshOverlapCount ?? 0,
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
