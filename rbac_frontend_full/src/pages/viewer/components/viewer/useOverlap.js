import { useEffect, useCallback, useRef } from "react";
import * as THREE from "three";

// Voxel cell size in metres — also the overlap tolerance. A point counts as
// "overlapping" if it falls in the same cell as some BIM surface vertex.
const VOXEL = 0.15;

const cellKey = (v) =>
  `${Math.floor(v.x / VOXEL)},${Math.floor(v.y / VOXEL)},${Math.floor(v.z / VOXEL)}`;

const matrixSig = (obj) => (obj ? obj.matrixWorld.elements.join(",") : "");

/**
 * Efficient overlap highlight.
 *
 * The old version was O(points × BIM-elements) twice — billions of ops on the
 * main thread. This builds a VOXEL SPATIAL HASH of the BIM surface once
 * (Set of occupied cells + cell→element map), then each point is a single O(1)
 * hash lookup → ~O(points) total. The BIM hash is cached and only rebuilt when
 * the BIM actually moves, so re-highlighting after dragging the point cloud is
 * just the point pass. Also re-runs on drag-end during manual alignment.
 *
 * CHANGED — per-element overlap point counts are now pushed to React state via
 * `setOverlapCounts` instead of being stashed on `window.__overlapCountsByUuid`
 * / `window.__overlapCountsByExpressID`. The old window-global approach never
 * triggered a re-render, so any UI (like the sidebar) reading those counts
 * would always show stale/zero values.
 */
export default function useOverlap(sceneData, modelData, props) {
  const { pcModel, bimModel } = modelData;
  const {
    highlightOverlap,
    setOverlapElementCount,
    setOverlapElementNames, // optional callback, resolved element names
    setOverlapCounts, // NEW — optional callback: ({byUuid, byExpressID}) => void
  } = props;

  const bimCacheRef = useRef({
    sig: null,
    occupied: null,
    voxelToElems: null,
    elemNames: null,
    elemUuids: null,
    elemIds: null, // expressID or mesh index
    isIfc: false,
  });
  const lastSigRef = useRef("");

  // Build (or reuse) the BIM surface voxel hash.
  const getBimVoxels = useCallback(() => {
    if (!bimModel)
      return {
        occupied: new Set(),
        voxelToElems: new Map(),
        elemNames: [],
        elemUuids: [],
        elemIds: [],
        isIfc: false,
      };
    bimModel.updateMatrixWorld(true);
    const sig = matrixSig(bimModel);
    if (bimCacheRef.current.sig === sig && bimCacheRef.current.occupied) {
      return bimCacheRef.current;
    }
    const occupied = new Set();
    const voxelToElems = new Map();
    const elemNames = [];
    const elemUuids = [];
    const elemIds = [];
    const elemExpressIdToIndex = new Map();
    let elemIndex = 0;
    let isIfc = false;
    const v = new THREE.Vector3();

    bimModel.traverse((c) => {
      if (!c.isMesh || !c.geometry?.attributes?.position) return;
      const geom = c.geometry;
      const expressIDAttr = geom.attributes?.expressID;
      const indexArray = geom.index?.array;
      const pos = geom.attributes.position;

      if (expressIDAttr) {
        isIfc = true;
      }

      c.updateMatrixWorld(true);
      const m = c.matrixWorld;
      const stride = Math.max(1, Math.floor(pos.count / 150000));

      for (let vi = 0; vi < pos.count; vi += stride) {
        const vertexIndex = indexArray ? indexArray[vi] : vi;
        v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(m);
        const key = cellKey(v);
        occupied.add(key);

        let elemIdx = null;
        if (expressIDAttr) {
          const expressID = expressIDAttr.array[vertexIndex];
          if (expressID == null) continue;
          elemIdx = elemExpressIdToIndex.get(expressID);
          if (elemIdx == null) {
            elemIdx = elemIndex++;
            elemExpressIdToIndex.set(expressID, elemIdx);
            const ifcType =
              typeof c.getIfcType === "function"
                ? c.getIfcType(expressID)
                : null;
            elemNames[elemIdx] =
              (ifcType ? `${ifcType} #${expressID}` : `IFC #${expressID}`) ||
              `Element ${elemIdx + 1}`;
            elemIds[elemIdx] = expressID;
            elemUuids[elemIdx] = c.uuid;
          }
        } else {
          if (typeof c.userData?.elementIndex === "number") {
            elemIdx = c.userData.elementIndex;
          } else {
            elemIdx = elemIndex++;
            const cName = typeof c.name === "string" ? c.name.trim() : "";
            const parentName =
              typeof c.parent?.name === "string" ? c.parent.name.trim() : "";
            const userDataName =
              typeof c.userData?.elementName === "string"
                ? c.userData.elementName.trim()
                : "";
            elemNames[elemIdx] =
              cName || parentName || userDataName || `Element ${elemIdx + 1}`;
            elemIds[elemIdx] = null;
            elemUuids[elemIdx] = c.uuid;
          }
        }

        let arr = voxelToElems.get(key);
        if (!arr) {
          arr = [];
          voxelToElems.set(key, arr);
        }
        if (arr[arr.length - 1] !== elemIdx) arr.push(elemIdx);
      }
    });

    bimCacheRef.current = {
      sig,
      occupied,
      voxelToElems,
      elemNames,
      elemUuids,
      elemIds,
      isIfc,
    };
    return bimCacheRef.current;
  }, [bimModel]);

  const highlightOverlappingPoints = useCallback(() => {
    if (!pcModel || !bimModel) return;
    const geom = pcModel.geometry;
    const posAttr = geom.attributes.position;
    const colAttr = geom.attributes.color;
    if (!posAttr || !colAttr) return;

    if (!geom.userData.originalColors) {
      geom.userData.originalColors = colAttr.array.slice();
    }
    // Start from the original colours so re-runs don't accumulate green.
    colAttr.array.set(geom.userData.originalColors);

    const { occupied, voxelToElems, elemNames, elemUuids, elemIds, isIfc } =
      getBimVoxels();
    pcModel.updateMatrixWorld(true);
    const m = pcModel.matrixWorld;
    const v = new THREE.Vector3();
    const hitElems = new Set();
    const hitCounts = new Map(); // elemIndex -> point count
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(m);
      const key = cellKey(v);
      if (occupied.has(key)) {
        colAttr.setXYZ(i, 0, 1, 0); // green
        const elems = voxelToElems.get(key);
        if (elems) {
          for (let e = 0; e < elems.length; e++) {
            hitElems.add(elems[e]);
            hitCounts.set(elems[e], (hitCounts.get(elems[e]) || 0) + 1);
          }
        }
      }
    }
    colAttr.needsUpdate = true;
    setOverlapElementCount(hitElems.size);

    // CHANGED — each entry now carries its point count alongside the name
    // (was just the name string before), so the sidebar list can show
    // "IFCBEAM #101193 — 342 pts" instead of only the name.
    setOverlapElementNames?.(
      Array.from(hitElems)
        .map((idx) => ({
          name: elemNames?.[idx] ?? `Element ${idx + 1}`,
          count: hitCounts.get(idx) || 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );

    // CHANGED — build per-element count maps and push them to React state
    // via the setOverlapCounts callback instead of window globals.
    const countsByUuid = new Map();
    const countsByExpressID = new Map();
    hitCounts.forEach((cnt, idx) => {
      const uuid = elemUuids?.[idx];
      if (uuid) countsByUuid.set(uuid, cnt);
      if (isIfc && elemIds?.[idx] != null) {
        countsByExpressID.set(elemIds[idx], cnt);
      }
    });
    setOverlapCounts?.({
      byUuid: countsByUuid,
      byExpressID: countsByExpressID,
    });

    lastSigRef.current = matrixSig(bimModel) + "|" + matrixSig(pcModel);
  }, [
    pcModel,
    bimModel,
    getBimVoxels,
    setOverlapElementCount,
    setOverlapElementNames,
    setOverlapCounts, // NEW
  ]);

  // Toggle on/off.
  useEffect(() => {
    if (!pcModel) return;
    if (highlightOverlap) {
      highlightOverlappingPoints();
    } else {
      const geom = pcModel.geometry;
      if (geom.userData.originalColors) {
        geom.attributes.color.array.set(geom.userData.originalColors);
        geom.attributes.color.needsUpdate = true;
      }
      setOverlapElementNames?.([]);
      // CHANGED — counts are intentionally NOT cleared here. Turning the
      // green highlight off shouldn't erase the last computed per-element
      // point counts; the sidebar should keep showing them. If you want the
      // numbers to disappear when toggled off, uncomment the next line:
      // setOverlapCounts?.({ byUuid: new Map(), byExpressID: new Map() });
    }
  }, [
    highlightOverlap,
    highlightOverlappingPoints,
    pcModel,
    setOverlapElementNames,
  ]);

  // Recompute when a model is moved (drag-end) during manual alignment — only
  // if the highlight is on AND the world transforms actually changed.
  useEffect(() => {
    const renderer = sceneData?.rendererRef?.current;
    if (!renderer || !renderer.domElement) return;
    const canvas = renderer.domElement;
    let timer = null;
    const onUp = () => {
      if (!highlightOverlap || !pcModel || !bimModel) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        pcModel.updateMatrixWorld(true);
        bimModel.updateMatrixWorld(true);
        const sig = matrixSig(bimModel) + "|" + matrixSig(pcModel);
        if (sig !== lastSigRef.current) highlightOverlappingPoints();
      }, 120);
    };
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerup", onUp);
      clearTimeout(timer);
    };
  }, [
    sceneData,
    highlightOverlap,
    pcModel,
    bimModel,
    highlightOverlappingPoints,
  ]);
}