import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import {
  useConstructionSegmentation,
  CONSTRUCTION_CLASSES,
} from "./useConstructionSegmentation";

/**
 * Projects SAM+CLIP construction-class masks (2D, from posed camera photos)
 * onto the loaded point cloud, producing a per-point semantic label.
 *
 * `manualCameras` here is actually `allCameras` from useCameraSystem.js —
 * an array of real THREE.PerspectiveCamera objects (position/quaternion/
 * projection matrix already applied), each with cam.userData.image (photo
 * URL) and cam.userData.imageName.
 */
export default function usePointCloudSAMSegmentation(
  modelData,
  manualCameras,
  options = {},
) {
  const { segmentImage, checkHealth } = useConstructionSegmentation(options);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [isSemanticActive, setIsSemanticActive] = useState(false);

  const semanticColorsRef = useRef(null); // cache so re-toggling doesn't re-run SAM
  const originalColorsRef = useRef(null);

  const runSegmentation = useCallback(async () => {
    const pcModel = modelData?.pcModel;
    if (!pcModel) throw new Error("Load a point cloud first.");

    const healthy = await checkHealth();
    if (!healthy) {
      throw new Error(
        "Segmentation service unreachable. Start segmentation_service.py (port 8001) and try again.",
      );
    }
    if (!manualCameras?.length) {
      throw new Error(
        "No posed camera photos found — upload/align cameras first.",
      );
    }

    setIsRunning(true);
    const geometry = pcModel.geometry;
    const posAttr = geometry.attributes.position;
    const total = posAttr.count;
    const classKeys = Object.keys(CONSTRUCTION_CLASSES);
    const numClasses = classKeys.length;
    const votes = new Float32Array(total * numClasses);

    pcModel.updateMatrixWorld(true);
    const pcMatrix = pcModel.matrixWorld;

    for (let ci = 0; ci < manualCameras.length; ci++) {
      const cam = manualCameras[ci]; // real THREE.PerspectiveCamera from useCameraSystem
      const imageUrl = cam.userData?.image;
      if (!imageUrl) continue; // skip cameras with no linked photo

      setProgress(
        `Segmenting photo ${ci + 1}/${manualCameras.length} (${cam.userData?.imageName || ""})`,
      );

      let result;
      try {
        const blob = await (await fetch(imageUrl)).blob();
        result = await segmentImage(blob);
      } catch (e) {
        console.warn(`[SAM] failed for camera "${cam.userData?.imageName}"`, e);
        continue;
      }
      if (!result?.masks?.length) continue;

      const { masks, imageWidth, imageHeight } = result;
      cam.updateMatrixWorld(true); // already correct, cheap safety re-assert

      const viewProj = new THREE.Matrix4().multiplyMatrices(
        cam.projectionMatrix,
        cam.matrixWorldInverse,
      );

      const v = new THREE.Vector3();
      for (let i = 0; i < total; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        v.applyMatrix4(pcMatrix); // local -> world
        v.applyMatrix4(viewProj); // world -> NDC (THREE does the perspective divide)

        if (v.z < -1 || v.z > 1) continue; // behind near/far plane
        if (v.x < -1 || v.x > 1) continue; // outside horizontal frustum
        if (v.y < -1 || v.y > 1) continue; // outside vertical frustum

        const px = Math.round(((v.x + 1) / 2) * (imageWidth - 1));
        const py = Math.round(((1 - v.y) / 2) * (imageHeight - 1)); // NDC-up vs image-row-down
        const pixelIndex = py * imageWidth + px;

        // NOTE: no occlusion/depth test — a point behind a wall but still
        // inside this camera's frustum can incorrectly pick up a vote if a
        // mask happens to cover that pixel. Fine as a first pass since votes
        // are fused across many cameras, but flagging it as a known gap.
        for (const m of masks) {
          if (m.segmentation[pixelIndex]) {
            votes[i * numClasses + m.classId] += m.confidence ?? 1;
            break; // first matching mask wins for this camera
          }
        }
      }
    }

    // Reduce votes -> per-point label -> color buffer
    const colorArr = new Uint8Array(total * 3);
    for (let i = 0; i < total; i++) {
      let bestClass = -1;
      let bestVote = 0;
      for (let c = 0; c < numClasses; c++) {
        const val = votes[i * numClasses + c];
        if (val > bestVote) {
          bestVote = val;
          bestClass = c;
        }
      }
      if (bestClass >= 0) {
        const key = classKeys.find(
          (k) => CONSTRUCTION_CLASSES[k].id === bestClass,
        );
        const [r, g, b] = CONSTRUCTION_CLASSES[key].color;
        colorArr[i * 3] = r;
        colorArr[i * 3 + 1] = g;
        colorArr[i * 3 + 2] = b;
      } else {
        colorArr[i * 3] = 90;
        colorArr[i * 3 + 1] = 90;
        colorArr[i * 3 + 2] = 90; // unseen by any camera
      }
    }

    originalColorsRef.current = new Uint8Array(geometry.attributes.color.array);
    semanticColorsRef.current = colorArr;
    setIsRunning(false);
    setProgress(null);
    return colorArr;
  }, [modelData?.pcModel, manualCameras, segmentImage, checkHealth]);

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

  return { toggleSemanticSegmentation, isSemanticActive, isRunning, progress };
}
