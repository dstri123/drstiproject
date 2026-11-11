import { useEffect, useState, useCallback, useRef } from "react";
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

// Sample count points uniformly over the visible mesh surfaces of root in
// world space (area-weighted), so large flat walls/slabs are represented
// fairly instead of by their few vertices. Falls back to vertices when the
// model has no triangles.
function sampleWorldSurface(root, count = 60000) {
  if (!root) return [];
  root.updateMatrixWorld(true);
  const meshes = [];
  const collect = (child) => {
    if (child.isMesh && child.geometry?.attributes?.position)
      meshes.push(child);
  };
  root.traverseVisible(collect);
  if (!meshes.length) root.traverse(collect);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tris = []; // per mesh: { mesh, pos, idx, cumulative areas, end }
  let totalArea = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    if (n < 1) continue;
    const cumulative = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const i0 = idx ? idx.getX(3 * i) : 3 * i;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(
        pos,
        idx ? idx.getX(3 * i + 1) : 3 * i + 1,
      ).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(
        pos,
        idx ? idx.getX(3 * i + 2) : 3 * i + 2,
      ).applyMatrix4(mesh.matrixWorld);
      totalArea += b.sub(a).cross(c.sub(a)).length() / 2;
      cumulative[i] = totalArea;
    }
    tris.push({ mesh, idx, pos, cumulative, end: totalArea });
  }
  if (!totalArea) return extractWorldPoints(root, count);

  const out = [];
  const v = new THREE.Vector3();
  for (let s = 0; s < count; s++) {
    const r = Math.random() * totalArea;
    const t = tris[firstAbove(tris.length, (i) => tris[i].end, r)];
    const k = 3 * firstAbove(t.cumulative.length, (i) => t.cumulative[i], r);
    a.fromBufferAttribute(t.pos, t.idx ? t.idx.getX(k) : k);
    b.fromBufferAttribute(t.pos, t.idx ? t.idx.getX(k + 1) : k + 1);
    c.fromBufferAttribute(t.pos, t.idx ? t.idx.getX(k + 2) : k + 2);
    // Uniform barycentric sample.
    let u = Math.random();
    let w = Math.random();
    if (u + w > 1) {
      u = 1 - u;
      w = 1 - w;
    }
    v.copy(a)
      .addScaledVector(b.sub(a), u)
      .addScaledVector(c.sub(a), w)
      .applyMatrix4(t.mesh.matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

// Index of the first entry (in an ascending sequence) whose value is > r.
function firstAbove(length, valueAt, r) {
  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (valueAt(mid) <= r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const roundPoints = (pts) =>
  pts.map((p) => p.map((x) => Math.round(x * 1e4) / 1e4));

// “84% of building on BIM · error ≈ 17 cm” — building_fit ignores trees,
// ground and clutter; error is the median distance (model units, assumed m).
export function describeAutoFit(c) {
  if (!c) return "";
  if (c.building_fit == null)
    return `${Math.round((c.fitness || 0) * 100)}% of cloud on BIM`;
  let text = `${Math.round(c.building_fit * 100)}% of building on BIM`;
  if (c.error != null) {
    text +=
      c.error < 1
        ? ` · error ≈ ${Math.round(c.error * 100)} cm`
        : ` · error ≈ ${c.error.toFixed(2)} m`;
  }
  return text;
}

// Shared with the sidebar via window (like the other alignment actions).
function publishAutoAlignState(state) {
  window.autoAlignState = state;
  window.dispatchEvent(new CustomEvent("autoalign-state", { detail: state }));
}

function matrix4FromNested(T) {
  const m = new THREE.Matrix4();
  m.set(
    T[0][0],
    T[0][1],
    T[0][2],
    T[0][3],
    T[1][0],
    T[1][1],
    T[1][2],
    T[1][3],
    T[2][0],
    T[2][1],
    T[2][2],
    T[2][3],
    T[3][0],
    T[3][1],
    T[3][2],
    T[3][3],
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

  const {
    bimPoints = [],
    pcPoints = [],
    onMatrixChange,
    onAlignmentLocked,
    uploadedAlignmentMatrix,
  } = props;

  const [matrix, setMatrix] = useState(null);
  const appliedPcModelRef = useRef(null);
  // Nested-array matrix last actually applied to appliedPcModelRef.current —
  // tracked by value (not just by the point-cloud model instance) so a
  // corrected Matrix File re-uploaded and marked "latest" for the same,
  // already-loaded point cloud gets applied too, not silently ignored.
  const appliedMatrixRef = useRef(null);

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

  // Auto-apply an uploaded Matrix File (.json) to the point cloud as soon as
  // both it and the point cloud are available — this is what ties the BIM
  // model and point cloud together from batch upload data, without requiring
  // the manual "Upload Matrix" flow in the sidebar. Keyed off the pcModel
  // instance so re-loading a different point cloud (date/version switch)
  // re-applies it, but a later manual gizmo nudge isn't fought.
  useEffect(() => {
    if (!pcModel || !uploadedAlignmentMatrix) return;
    const sameModel = appliedPcModelRef.current === pcModel;
    const sameMatrix =
      sameModel &&
      appliedMatrixRef.current &&
      JSON.stringify(appliedMatrixRef.current) ===
        JSON.stringify(uploadedAlignmentMatrix);
    if (sameMatrix) return;

    // applyMatrix4 composes onto the model's CURRENT transform rather than
    // replacing it — if this same point cloud already had an earlier
    // uploaded matrix applied (e.g. a corrected alignment matrix was
    // re-uploaded and marked latest without the point cloud itself
    // changing), undo that one first so the two don't stack.
    if (sameModel && appliedMatrixRef.current) {
      pcModel.applyMatrix4(
        matrix4FromNested(appliedMatrixRef.current).invert(),
      );
    }

    applyMatrixToModel(uploadedAlignmentMatrix);
    appliedPcModelRef.current = pcModel;
    appliedMatrixRef.current = uploadedAlignmentMatrix;
    lockAlignment();
    setMatrix(uploadedAlignmentMatrix);
    onMatrixChange?.(uploadedAlignmentMatrix);
    toast.success("Point cloud aligned using the uploaded matrix file.");
  }, [
    pcModel,
    uploadedAlignmentMatrix,
    applyMatrixToModel,
    lockAlignment,
    onMatrixChange,
    toast,
  ]);

  const alignGeometry = useCallback(() => {
    const result = computeAlignmentMatrix();
    if (!result) return;

    setMatrix(result);
    onMatrixChange?.(result);
    applyMatrixToModel(result);
    lockAlignment();
    toast.success("Geometry aligned from picked points.");
  }, [
    computeAlignmentMatrix,
    onMatrixChange,
    applyMatrixToModel,
    lockAlignment,
    toast,
  ]);

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
  }, [
    pcModel,
    bimModel,
    bimPoints,
    pcPoints,
    onMatrixChange,
    lockAlignment,
    toast,
  ]);

  // ================= AUTO ALIGN =================
  // One click, no picks: the server samples features, matches them, runs
  // RANSAC + ICP (with a scale search for unscaled photogrammetry clouds) and
  // returns ranked candidate poses. We apply the best and keep the others so
  // the user can “Try Next Result” or “Undo”.
  // { before: Matrix4 of the cloud before aligning, candidates, index }
  const autoRef = useRef(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const publishAuto = useCallback((busy) => {
    const run = autoRef.current;
    const current = run?.candidates[run.index];
    publishAutoAlignState({
      busy,
      count: run?.candidates.length || 0,
      index: run?.index ?? -1,
      fitness: current?.fitness,
      fitText: describeAutoFit(current),
      scale: current?.scale,
      confidence: run?.index === 0 ? run.confidence : null,
      ambiguous: run?.ambiguous,
    });
  }, []);

  // A different cloud or BIM invalidates the stored candidates.
  useEffect(() => {
    autoRef.current = null;
    publishAuto(false);
  }, [pcModel, bimModel, publishAuto]);

  const showAutoCandidate = useCallback(
    (index) => {
      const run = autoRef.current;
      if (!run || !pcModel) return;
      const T = run.candidates[index].transform;
      pcModel.matrix.copy(run.before);
      pcModel.matrix.decompose(
        pcModel.position,
        pcModel.quaternion,
        pcModel.scale,
      );
      pcModel.applyMatrix4(matrix4FromNested(T));
      pcModel.updateMatrixWorld(true);
      run.index = index;
      setMatrix(T);
      onMatrixChange?.(T);
      lockAlignment();
      publishAuto(false);
    },
    [pcModel, onMatrixChange, lockAlignment, publishAuto],
  );

  const autoAlign = useCallback(async () => {
    if (autoBusy) return;
    if (!pcModel || !bimModel) {
      toast.info("Load both a BIM model and a point cloud before Auto Align.");
      return;
    }

    // Picked pairs (if any) become a starting guess; otherwise fully automatic.
    let init = null;
    if (bimPoints.length >= 3 && bimPoints.length === pcPoints.length) {
      init = computeAlignmentMatrix();
    }

    // Re-running starts from the original pose, not a previous result —
    // unless picks were made, which are only valid at the current pose.
    if (autoRef.current && !init) {
      pcModel.matrix.copy(autoRef.current.before);
      pcModel.matrix.decompose(
        pcModel.position,
        pcModel.quaternion,
        pcModel.scale,
      );
      pcModel.updateMatrixWorld(true);
    }

    pcModel.updateMatrix();
    const before = pcModel.matrix.clone();
    const target = sampleWorldSurface(bimModel, 60000);
    const source = extractWorldPoints(pcModel, 60000);
    if (source.length < 100 || target.length < 100) {
      toast.error("Not enough geometry to auto-align.");
      return;
    }

    setAutoBusy(true);
    publishAuto(true);
    toast.info(
      init
        ? "Auto aligning from your picked points…"
        : "Auto aligning — matching features, RANSAC, ICP… (may take ~30 s)",
    );
    try {
      const res = await API.post("processing/align/auto/", {
        source: roundPoints(source),
        target: roundPoints(target),
        init_transform: init,
      });
      autoRef.current = {
        before,
        candidates: res.data.candidates,
        confidence: res.data.confidence,
        ambiguous: res.data.ambiguous,
        index: 0,
      };
      showAutoCandidate(0);

      const msg = `Auto aligned — ${describeAutoFit(res.data)} (confidence: ${res.data.confidence}).`;
      if (res.data.confidence === "high") toast.success(msg);
      else
        toast.info(
          `${msg} Check it; use "Try Next Result", or pick 3 point pairs and run Auto Align again.`,
        );
    } catch (err) {
      console.error("Auto align failed", err);
      toast.error(
        err.response?.data?.error ||
          (err.response
            ? `Auto alignment failed (HTTP ${err.response.status}).`
            : "Auto alignment failed — could not reach the backend. Is the Django server running?"),
      );
      publishAuto(false);
    } finally {
      setAutoBusy(false);
    }
  }, [
    autoBusy,
    pcModel,
    bimModel,
    bimPoints,
    pcPoints,
    computeAlignmentMatrix,
    showAutoCandidate,
    publishAuto,
    toast,
  ]);

  const tryNextAutoAlign = useCallback(() => {
    const run = autoRef.current;
    if (!run || run.candidates.length < 2) {
      toast.info("No other alignment results to try.");
      return;
    }
    const next = (run.index + 1) % run.candidates.length;
    showAutoCandidate(next);
    toast.info(
      `Result ${next + 1} of ${run.candidates.length} — ${describeAutoFit(run.candidates[next])}.`,
    );
  }, [showAutoCandidate, toast]);

  const undoAutoAlign = useCallback(() => {
    const run = autoRef.current;
    if (!run || !pcModel) return;
    pcModel.matrix.copy(run.before);
    pcModel.matrix.decompose(
      pcModel.position,
      pcModel.quaternion,
      pcModel.scale,
    );
    pcModel.updateMatrixWorld(true);
    autoRef.current = null;
    setMatrix(null);
    publishAuto(false);
    toast.info("Auto alignment undone.");
  }, [pcModel, publishAuto, toast]);

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
  }, [
    pcModel,
    bimPoints,
    pcPoints,
    computeAlignmentMatrix,
    onMatrixChange,
    toast,
  ]);

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
        toast.info(
          "Load a point cloud (or run an alignment) before exporting.",
        );
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
    window.autoAlign = autoAlign;
    window.tryNextAutoAlign = tryNextAutoAlign;
    window.undoAutoAlign = undoAutoAlign;
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
