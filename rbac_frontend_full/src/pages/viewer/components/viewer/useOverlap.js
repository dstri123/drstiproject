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
 */
export default function useOverlap(sceneData, modelData, props) {
  const { pcModel, bimModel } = modelData;
  const { highlightOverlap, setOverlapElementCount } = props;

  const bimCacheRef = useRef({ sig: null, occupied: null, voxelToElems: null });
  const lastSigRef = useRef("");

  // Build (or reuse) the BIM surface voxel hash.
  const getBimVoxels = useCallback(() => {
    if (!bimModel) return { occupied: new Set(), voxelToElems: new Map() };
    bimModel.updateMatrixWorld(true);
    const sig = matrixSig(bimModel);
    if (bimCacheRef.current.sig === sig && bimCacheRef.current.occupied) {
      return bimCacheRef.current;
    }
    const occupied = new Set();
    const voxelToElems = new Map();
    const v = new THREE.Vector3();
    let elemIndex = 0;
    bimModel.traverse((c) => {
      if (!c.isMesh || !c.geometry?.attributes?.position) return;
      const idx = elemIndex++;
      const pos = c.geometry.attributes.position;
      c.updateMatrixWorld(true);
      const m = c.matrixWorld;
      // Stride huge meshes so building stays bounded.
      const stride = Math.max(1, Math.floor(pos.count / 150000));
      for (let i = 0; i < pos.count; i += stride) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
        const key = cellKey(v);
        occupied.add(key);
        let arr = voxelToElems.get(key);
        if (!arr) {
          arr = [];
          voxelToElems.set(key, arr);
        }
        if (arr[arr.length - 1] !== idx) arr.push(idx);
      }
    });
    bimCacheRef.current = { sig, occupied, voxelToElems };
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

    const { occupied, voxelToElems } = getBimVoxels();
    pcModel.updateMatrixWorld(true);
    const m = pcModel.matrixWorld;
    const v = new THREE.Vector3();
    const hitElems = new Set();
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(m);
      const key = cellKey(v);
      if (occupied.has(key)) {
        colAttr.setXYZ(i, 0, 1, 0); // green
        const elems = voxelToElems.get(key);
        if (elems) for (let e = 0; e < elems.length; e++) hitElems.add(elems[e]);
      }
    }
    colAttr.needsUpdate = true;
    setOverlapElementCount(hitElems.size);
    lastSigRef.current = matrixSig(bimModel) + "|" + matrixSig(pcModel);
  }, [pcModel, bimModel, getBimVoxels, setOverlapElementCount]);

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
    }
  }, [highlightOverlap, highlightOverlappingPoints, pcModel]);

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
  }, [sceneData, highlightOverlap, pcModel, bimModel, highlightOverlappingPoints]);
}
