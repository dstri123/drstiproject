import { useCallback, useRef, useState } from "react";
import * as THREE from "three";

const POINT_CLOUD_SEMANTIC_CLASSES = {
  ground: { id: 0, label: "Ground", color: [101, 67, 33], emoji: ":large_brown_square:" },
  slab: { id: 1, label: "Slab", color: [169, 169, 169], emoji: ":rock:" },
  wall: { id: 2, label: "Wall", color: [70, 100, 160], emoji: ":building_construction:" },
  column: { id: 3, label: "Column", color: [220, 120, 30], emoji: ":bricks:" },
  beam: { id: 4, label: "Beam", color: [230, 190, 0], emoji: ":triangular_ruler:" },
  scaffolding: {
    id: 5,
    label: "Scaffolding",
    color: [160, 60, 20],
    emoji: ":nut_and_bolt:",
  },
  equipment: {
    id: 6,
    label: "Equipment / Machinery",
    color: [210, 40, 40],
    emoji: ":construction:",
  },
  concrete: {
    id: 7,
    label: "Concrete / Cement",
    color: [135, 206, 235],
    emoji: ":bricks:",
  },
};

function buildSemanticColorMap(geometry) {
  const posAttr = geometry.attributes.position;
  const total = posAttr.count;
  const box = new THREE.Box3().setFromBufferAttribute(posAttr);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const verticalAxis =
    size.y >= size.z && size.y >= size.x ? "y" : size.z >= size.x ? "z" : "x";
  const verticalIndex = verticalAxis === "y" ? 1 : verticalAxis === "z" ? 2 : 0;
  const verticalMin = box.min[verticalAxis];
  const verticalMax = box.max[verticalAxis];
  const verticalSpan = Math.max(verticalMax - verticalMin, 1e-6);
  const maxFootprint = Math.max(size.x, size.z, 1e-6);
  const counts = Object.fromEntries(
    Object.keys(POINT_CLOUD_SEMANTIC_CLASSES).map((k) => [k, 0]),
  );

  const colorArr = new Uint8Array(total * 3);

  for (let i = 0; i < total; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const v = posAttr.getComponent(i, verticalIndex);
    const vNorm = (v - verticalMin) / verticalSpan;

    const dx = x - center.x;
    const dz = z - center.z;
    const footprint = Math.max(Math.abs(dx), Math.abs(dz));
    const xSpread = Math.abs(dx) / Math.max(size.x, 1e-6);
    const zSpread = Math.abs(dz) / Math.max(size.z, 1e-6);

    let key = "concrete";

    if (vNorm < 0.12) {
      key = "ground";
    } else if (
      vNorm >= 0.18 &&
      vNorm <= 0.38 &&
      footprint < maxFootprint * 0.35
    ) {
      key = "slab";
    } else if (
      vNorm >= 0.25 &&
      vNorm <= 0.72 &&
      Math.min(xSpread, zSpread) < 0.12
    ) {
      key = "wall";
    } else if (vNorm >= 0.45 && footprint < maxFootprint * 0.18) {
      key = "column";
    } else if (
      vNorm >= 0.22 &&
      vNorm <= 0.72 &&
      Math.max(xSpread, zSpread) > 0.35
    ) {
      key = "beam";
    } else if (vNorm >= 0.35 && Math.min(xSpread, zSpread) < 0.08) {
      key = "scaffolding";
    } else if (vNorm > 0.75) {
      key = "equipment";
    }

    counts[key] += 1;
    const [r, g, b] = POINT_CLOUD_SEMANTIC_CLASSES[key].color;
    colorArr[i * 3] = r;
    colorArr[i * 3 + 1] = g;
    colorArr[i * 3 + 2] = b;
  }

  return {
    colorArr,
    stats: Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({
        key,
        label: POINT_CLOUD_SEMANTIC_CLASSES[key].label,
        color: POINT_CLOUD_SEMANTIC_CLASSES[key].color,
        count,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Sidebar SAM button: paint a semantic construction-style colour map directly
 * onto the point cloud geometry. This button is intentionally point-cloud-only.
 * The preview panel handles image-only semantic segmentation when a camera is
 * selected and the user clicks its Segmented state.
 */
export default function usePointCloudSAMSegmentation(modelData) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [isSemanticActive, setIsSemanticActive] = useState(false);
  const [semanticSummary, setSemanticSummary] = useState(null);

  const semanticColorsRef = useRef(null);
  const originalColorsRef = useRef(null);

  const runSegmentation = useCallback(async () => {
    const pcModel = modelData?.pcModel;
    if (!pcModel) throw new Error("Load a point cloud first.");

    setIsRunning(true);
    setProgress("Building point-cloud semantic colours…");

    const geometry = pcModel.geometry;
    const { colorArr, stats } = buildSemanticColorMap(geometry);

    originalColorsRef.current = new Uint8Array(geometry.attributes.color.array);
    semanticColorsRef.current = colorArr;
    setSemanticSummary(stats);
    setIsRunning(false);
    setProgress(null);
    return colorArr;
  }, [modelData?.pcModel]);

  const toggleSemanticSegmentation = useCallback(async () => {
    const pcModel = modelData?.pcModel;
    if (!pcModel) return;
    const colorAttr = pcModel.geometry.attributes.color;

    if (isSemanticActive) {
      if (originalColorsRef.current) {
        colorAttr.array.set(originalColorsRef.current);
        colorAttr.needsUpdate = true;
      }
      setIsSemanticActive(false);
      return;
    }

    const colors = semanticColorsRef.current || (await runSegmentation());
    if (!colors) return;
    colorAttr.array.set(colors);
    colorAttr.needsUpdate = true;
    setIsSemanticActive(true);
  }, [isSemanticActive, modelData?.pcModel, runSegmentation]);

  return {
    toggleSemanticSegmentation,
    isSemanticActive,
    isRunning,
    progress,
    semanticSummary,
  };
}