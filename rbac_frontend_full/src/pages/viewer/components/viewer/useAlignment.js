import { useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { kabschAlgorithm } from "../../utils/kabsch";
import API from "../../../../api/axios";
import { useToast } from "../../../../components/ToastContainer";

// Collect up to `maxPoints` of a model's vertices in world space, evenly
// strided. Works for the BIM group (meshes) and the point cloud (Points), and
// is attribute-type-agnostic (handles quantized Float16 positions).
function extractWorldPoints(root, maxPoints = 20000) {
  if (!root) return [];
  root.updateMatrixWorld(true);
  const chunks = [];
  let total = 0;
  root.traverse((child) => {
    if (!(child.isMesh || child.isPoints)) return;
    const attr = child.geometry?.attributes?.position;
    if (!attr) return;
    chunks.push({ attr, matrix: child.matrixWorld });
    total += attr.count;
  });
  if (!total) return [];
  const stride = Math.max(1, Math.floor(total / maxPoints));
  const out = [];
  const v = new THREE.Vector3();
  for (const { attr, matrix } of chunks) {
    for (let i = 0; i < attr.count; i += stride) {
      v.fromBufferAttribute(attr, i).applyMatrix4(matrix);
      out.push([v.x, v.y, v.z]);
    }
  }
  return out;
}

function matrix4FromNested(T) {
  const m = new THREE.Matrix4();
  m.set(
    T[0][0], T[0][1], T[0][2], T[0][3],
    T[1][0], T[1][1], T[1][2], T[1][3],
    T[2][0], T[2][1], T[2][2], T[2][3],
    T[3][0], T[3][1], T[3][2], T[3][3],
  );
  return m;
}

// Three.Matrix4.elements is column-major; convert to a row-major nested array.
function nestedFromMatrix4(m) {
  const e = m.elements;
  return [
    [e[0], e[4], e[8], e[12]],
    [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]],
    [e[3], e[7], e[11], e[15]],
  ];
}

export default function useAlignment(sceneData, modelData, props) {
  const { pcModel, bimModel } = modelData;
  const toast = useToast();

  const { bimPoints = [], pcPoints = [], onMatrixChange, onAlignmentLocked } = props;

  const [matrix, setMatrix] = useState(null);

  // Once BIM + point cloud are registered to each other, they form one rigid
  // unit. Compute their shared common point (combined world centre) and notify
  // the viewer so subsequent group ops (scale/rotate/geo place) pivot there.
  const lockAlignment = useCallback(() => {
    const models = [bimModel, pcModel].filter(Boolean);
    if (models.length < 2) return;
    const box = new THREE.Box3();
    for (const m of models) {
      m.updateMatrixWorld(true);
      box.union(new THREE.Box3().setFromObject(m));
    }
    if (box.isEmpty()) return;
    const pivot = box.getCenter(new THREE.Vector3());
    onAlignmentLocked?.(pivot);
  }, [bimModel, pcModel, onAlignmentLocked]);

  // ================= ALIGN GEOMETRY =================
  const computeAlignmentMatrix = useCallback(() => {
    if (!pcModel) {
      toast.info("Load a point cloud before aligning.");
      return null;
    }
    if (bimPoints.length < 3 || pcPoints.length < 3) {
      toast.info(
        `Pick at least 3 points on each model (BIM: ${bimPoints.length}, ` +
          `Point Cloud: ${pcPoints.length}).`,
      );
      return null;
    }
    // Kabsch needs matching pairs — counts must be EQUAL, in pick order
    // (BIM #1 ↔ Cloud #1, #2 ↔ #2, …). Guard so a stray extra click can't crash.
    if (bimPoints.length !== pcPoints.length) {
      toast.error(
        `Point counts must match: BIM has ${bimPoints.length}, Point Cloud has ` +
          `${pcPoints.length}. Use "Stop Picking" and re-pick equal points ` +
          `(1↔1, 2↔2, 3↔3).`,
      );
      return null;
    }

    const src = pcPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const dst = bimPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));

    try {
      const { R, t, scale } = kabschAlgorithm(src, dst);
      return [
        [scale * R[0][0], scale * R[0][1], scale * R[0][2], t[0]],
        [scale * R[1][0], scale * R[1][1], scale * R[1][2], t[1]],
        [scale * R[2][0], scale * R[2][1], scale * R[2][2], t[2]],
        [0, 0, 0, 1],
      ];
    } catch (err) {
      console.error("Kabsch failed", err);
      toast.error(err.message || "Alignment computation failed.");
      return null;
    }
  }, [pcModel, bimPoints, pcPoints, toast]);

  const applyMatrixToModel = useCallback(
    (matrixArray) => {
      if (!matrixArray || !pcModel) return;
      const m = new THREE.Matrix4();
      m.set(
        matrixArray[0][0],
        matrixArray[0][1],
        matrixArray[0][2],
        matrixArray[0][3],
        matrixArray[1][0],
        matrixArray[1][1],
        matrixArray[1][2],
        matrixArray[1][3],
        matrixArray[2][0],
        matrixArray[2][1],
        matrixArray[2][2],
        matrixArray[2][3],
        matrixArray[3][0],
        matrixArray[3][1],
        matrixArray[3][2],
        matrixArray[3][3],
      );
      pcModel.applyMatrix4(m);
    },
    [pcModel],
  );

  const alignGeometry = useCallback(() => {
    const result = computeAlignmentMatrix();
    if (!result) return;

    setMatrix(result);
    onMatrixChange?.(result);
    applyMatrixToModel(result);
    lockAlignment();
    toast.success("Geometry aligned from picked points.");
  }, [computeAlignmentMatrix, onMatrixChange, applyMatrixToModel, lockAlignment, toast]);

  // Real dense ICP: refine on the server (numpy/scipy) using both full clouds.
  // Seeds with the coarse Kabsch pick-align when ≥3 point pairs are available.
  const alignGeometryICP = useCallback(async () => {
    if (!pcModel || !bimModel) {
      toast.info("Load both a BIM model and a point cloud before ICP align.");
      return;
    }

    // Coarse initial guess from picked pairs (optional but greatly helps ICP).
    let init = null;
    if (pcModel && bimPoints.length >= 3 && pcPoints.length >= 3) {
      const src = pcPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const dst = bimPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const { R, t, scale } = kabschAlgorithm(src, dst);
      init = [
        [scale * R[0][0], scale * R[0][1], scale * R[0][2], t[0]],
        [scale * R[1][0], scale * R[1][1], scale * R[1][2], t[1]],
        [scale * R[2][0], scale * R[2][1], scale * R[2][2], t[2]],
        [0, 0, 0, 1],
      ];
    }

    const source = extractWorldPoints(pcModel, 20000);
    const target = extractWorldPoints(bimModel, 20000);
    if (source.length < 3 || target.length < 3) {
      toast.error("Not enough geometry to run ICP.");
      return;
    }

    try {
      toast.info("Running ICP alignment on the server…");
      const res = await API.post("processing/align/icp/", {
        source,
        target,
        init_transform: init,
        with_scale: false,
      });
      const T = res.data.transform;
      // T maps the cloud's current world points onto the BIM — apply directly.
      pcModel.applyMatrix4(matrix4FromNested(T));
      pcModel.updateMatrixWorld(true);

      setMatrix(T);
      onMatrixChange?.(T);
      lockAlignment();
      const fit = Math.round((res.data.fitness || 0) * 100);
      toast.success(
        `ICP aligned — ${fit}% overlap, RMSE ${(res.data.rmse || 0).toFixed(3)}.`,
      );
    } catch (err) {
      console.error("ICP align failed", err);
      toast.error(err.response?.data?.error || "ICP alignment failed.");
    }
  }, [pcModel, bimModel, bimPoints, pcPoints, onMatrixChange, lockAlignment, toast]);

  // ================= GENERATE MATRIX =================
  // With 3+ picked pairs → Kabsch matrix from the picks.
  // Otherwise → capture the point cloud's CURRENT transform (whatever the
  // auto-normalization / ICP / gizmo produced), so you get a matrix with no
  // manual picking required.
  const generateMatrix = useCallback(() => {
    if (pcModel && bimPoints.length >= 3 && pcPoints.length >= 3) {
      const result = computeAlignmentMatrix();
      if (!result) return;
      setMatrix(result);
      onMatrixChange?.(result);
      toast.success("Matrix generated from picked points.");
      return;
    }

    if (!pcModel) {
      toast.info("Load a point cloud first to generate a matrix.");
      return;
    }

    pcModel.updateMatrixWorld(true);
    const result = nestedFromMatrix4(pcModel.matrixWorld);
    setMatrix(result);
    onMatrixChange?.(result);
    toast.success("Matrix generated from the current point-cloud position.");
  }, [pcModel, bimPoints, pcPoints, computeAlignmentMatrix, onMatrixChange, toast]);

  // ================= EXPORT MATRIX =================
  // Always produces a file: uses the generated matrix if present, otherwise
  // falls back to the point cloud's current transform (auto/ICP/gizmo result),
  // so Export works one-click without needing Generate first.
  const exportMatrix = useCallback(() => {
    let data = matrix;
    if (!data) {
      if (pcModel) {
        pcModel.updateMatrixWorld(true);
        data = nestedFromMatrix4(pcModel.matrixWorld);
      } else {
        toast.info("Load a point cloud (or run an alignment) before exporting.");
        return;
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = "alignment_matrix.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Matrix exported as alignment_matrix.json.");
  }, [matrix, pcModel, toast]);

  // ================= APPLY MATRIX =================
  const applyUploadedMatrix = useCallback(
    (uploadedMatrix) => {
      if (!pcModel || !uploadedMatrix) {
        alert("Missing model or matrix");
        return;
      }

      const m = new THREE.Matrix4();

      m.set(
        uploadedMatrix[0][0],
        uploadedMatrix[0][1],
        uploadedMatrix[0][2],
        uploadedMatrix[0][3],
        uploadedMatrix[1][0],
        uploadedMatrix[1][1],
        uploadedMatrix[1][2],
        uploadedMatrix[1][3],
        uploadedMatrix[2][0],
        uploadedMatrix[2][1],
        uploadedMatrix[2][2],
        uploadedMatrix[2][3],
        uploadedMatrix[3][0],
        uploadedMatrix[3][1],
        uploadedMatrix[3][2],
        uploadedMatrix[3][3],
      );

      pcModel.applyMatrix4(m);
      lockAlignment();

      alert("Matrix applied!");
    },
    [pcModel, lockAlignment],
  );

  // ================= EXPOSE TO SIDEBAR =================
  useEffect(() => {
    window.alignGeometry = alignGeometry;
    window.alignGeometryICP = alignGeometryICP;
    window.generateMatrix = generateMatrix;
    window.exportMatrix = exportMatrix;
    window.applyUploadedMatrix = applyUploadedMatrix;
    window.resetAll = () => window.location.reload();
  }, [
    alignGeometry,
    alignGeometryICP,
    generateMatrix,
    exportMatrix,
    applyUploadedMatrix,
  ]);

  return {
    alignGeometry,
    alignGeometryICP,
    generateMatrix,
    exportMatrix,
    applyUploadedMatrix,
  };
}
