import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { buildBimVoxels, cellKey } from "./useOverlap";
import { segmentUrlOnce } from "./useConstructionSegmentation";

// What each SAM class (segmentation_service.py) says about the BIM element a
// point overlaps: permanent material means it's built, rebar means work in
// progress, anything else is something standing in front of / on it.
const CLASS_GROUP = {
  concrete: 0,
  structure: 0,
  rebar: 1,
  scaffolding: 2,
  equipment: 2,
  worker: 2,
  ground: 2,
  sky: 2,
};
const GROUPS = ["built", "partial", "clutter"];

// SAM on CPU takes seconds per photo, so cap how many are segmented. Photos
// are picked evenly along the capture sequence.
const MAX_PHOTOS = 24;
// Points projected into each photo (the cloud is strided down to this). The
// overlap count itself always uses every point.
const MAX_LABEL_POINTS = 1_000_000;
// Occlusion test: a point only takes a photo's label if it's within this of
// the nearest point seen in its block of DEPTH_CELL × DEPTH_CELL pixels —
// otherwise it's behind something and the mask there isn't about it.
const DEPTH_CELL = 4;
const DEPTH_TOLERANCE = 0.3; // metres
const DEPTH_TOLERANCE_REL = 0.03; // + share of the distance from the camera

function pickEvenly(items, max) {
  if (items.length <= max) return items;
  return Array.from(
    { length: max },
    (_, i) => items[Math.floor((i * items.length) / max)],
  );
}

// Per-pixel group index (-1 = no mask). Larger masks are painted first so
// smaller, more specific ones (a worker on a slab) win where they overlap.
function buildLabelImage(seg) {
  const { imageWidth: w, imageHeight: h, masks } = seg;
  const labels = new Int8Array(w * h).fill(-1);
  [...masks]
    .sort((a, b) => b.area - a.area)
    .forEach((m) => {
      const group = CLASS_GROUP[m.classKey];
      if (group == null) return;
      const flat = m.segmentation;
      for (let p = 0; p < flat.length; p++) if (flat[p]) labels[p] = group;
    });
  return labels;
}

// Cast one group vote per visible sampled point. `sample` holds the
// point-cloud-local positions; `toClip` maps them straight to clip space.
function voteFromPhoto(sample, toClip, labels, w, h, votes) {
  const e = toClip.elements;
  const n = sample.length / 3;
  const gw = Math.ceil(w / DEPTH_CELL);
  const gh = Math.ceil(h / DEPTH_CELL);
  const nearest = new Float32Array(gw * gh).fill(Infinity);
  const pixelOf = new Int32Array(n).fill(-1);
  const depthOf = new Float32Array(n);

  for (let k = 0; k < n; k++) {
    const x = sample[k * 3];
    const y = sample[k * 3 + 1];
    const z = sample[k * 3 + 2];
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0) continue; // behind the camera
    const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
    const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
    if (nx < -1 || nx >= 1 || ny <= -1 || ny > 1) continue;
    const px = Math.floor(((nx + 1) / 2) * w);
    const py = Math.floor(((1 - ny) / 2) * h);
    const cell = Math.floor(py / DEPTH_CELL) * gw + Math.floor(px / DEPTH_CELL);
    if (cw < nearest[cell]) nearest[cell] = cw;
    pixelOf[k] = py * w + px;
    depthOf[k] = cw;
  }

  let visible = 0;
  for (let k = 0; k < n; k++) {
    const pixel = pixelOf[k];
    if (pixel < 0) continue;
    const px = pixel % w;
    const py = (pixel - px) / w;
    const front =
      nearest[Math.floor(py / DEPTH_CELL) * gw + Math.floor(px / DEPTH_CELL)];
    if (depthOf[k] > front + DEPTH_TOLERANCE + front * DEPTH_TOLERANCE_REL)
      continue;
    const group = labels[pixel];
    if (group < 0) continue;
    votes[k * 3 + group]++;
    visible++;
  }
  return visible;
}

/**
 * "Auto-detect Built Elements": runs SAM on the posed site photos, projects
 * each photo's masks onto the point cloud (with an occlusion test) to label
 * every point as permanent material / rebar / clutter, then counts — per BIM
 * element, using the same voxel overlap as useOverlap — how many of its
 * overlapping points carry each label. The backend turns that into an
 * automatic built / not-built call per element.
 */
export default function useSAMProgressDetection(modelData, allCameras) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [progress, setProgress] = useState(null);

  // modelData is a fresh object every render, so depend on the models
  // themselves; cameras are read through a ref for the same reason.
  // Otherwise runDetection changes each render and ThreeViewer's report
  // effect loops ("Maximum update depth exceeded").
  const { pcModel, bimModel } = modelData || {};
  const camerasRef = useRef(allCameras);
  camerasRef.current = allCameras;

  const runDetection = useCallback(async () => {
    if (!pcModel || !bimModel)
      throw new Error("Load both a BIM and a Point Cloud first.");
    const photos = pickEvenly(
      (camerasRef.current || []).filter(
        (c) => c?.userData?.image && !c.userData.isBubble,
      ),
      MAX_PHOTOS,
    );
    if (!photos.length)
      throw new Error(
        "No posed site photos loaded — load a camera batch with images first.",
      );

    setIsDetecting(true);
    try {
      const posAttr = pcModel.geometry.attributes.position;
      const total = posAttr.count;
      const stride = Math.max(1, Math.ceil(total / MAX_LABEL_POINTS));
      const nSample = Math.ceil(total / stride);
      const sample = new Float32Array(nSample * 3);
      for (let k = 0; k < nSample; k++) {
        const i = k * stride;
        sample[k * 3] = posAttr.getX(i);
        sample[k * 3 + 1] = posAttr.getY(i);
        sample[k * 3 + 2] = posAttr.getZ(i);
      }
      const votes = new Uint16Array(nSample * 3);

      pcModel.updateMatrixWorld(true);
      const projCam = new THREE.PerspectiveCamera();
      const toClip = new THREE.Matrix4();
      let photosUsed = 0;
      let failures = 0;

      for (let p = 0; p < photos.length; p++) {
        const cam = photos[p];
        setProgress(`SAM photo ${p + 1}/${photos.length}…`);
        let seg;
        try {
          seg = await segmentUrlOnce(cam.userData.image);
        } catch (err) {
          // A dead service fails every photo the same way — stop early.
          if (err instanceof TypeError && photosUsed === 0)
            throw new Error(
              "Segmentation service not reachable at http://localhost:8001 — start segmentation_service.py.",
            );
          failures++;
          continue;
        }
        if (!seg?.masks?.length) continue;

        cam.updateMatrixWorld(true);
        projCam.fov = cam.fov;
        projCam.near = cam.near;
        projCam.far = cam.far;
        projCam.aspect = seg.imageWidth / seg.imageHeight;
        projCam.updateProjectionMatrix();
        toClip
          .copy(projCam.projectionMatrix)
          .multiply(cam.matrixWorldInverse)
          .multiply(pcModel.matrixWorld);

        const seen = voteFromPhoto(
          sample,
          toClip,
          buildLabelImage(seg),
          seg.imageWidth,
          seg.imageHeight,
          votes,
        );
        if (seen > 0) photosUsed++;
        // Let the progress text paint between photos.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!photosUsed)
        throw new Error(
          failures
            ? `SAM failed on ${failures} photo(s) and no labels reached the point cloud.`
            : "None of the photos see the point cloud — check the camera alignment.",
        );

      setProgress("Matching labelled points to BIM elements…");
      await new Promise((r) => setTimeout(r, 0));
      const { voxelToElems, elemIds, isIfc } = buildBimVoxels(bimModel);
      if (!isIfc)
        throw new Error("Built detection needs an IFC model (element IDs).");

      const counts = new Map(); // elemIdx -> [points, built, partial, clutter]
      const m = pcModel.matrixWorld;
      const v = new THREE.Vector3();
      let labeledPoints = 0;
      for (let i = 0; i < total; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(
          m,
        );
        const elems = voxelToElems.get(cellKey(v));
        if (!elems) continue;

        let group = -1;
        if (i % stride === 0) {
          const k = (i / stride) * 3;
          const best = Math.max(votes[k], votes[k + 1], votes[k + 2]);
          if (best > 0) group = votes.subarray(k, k + 3).indexOf(best);
        }
        if (group >= 0) labeledPoints++;
        for (let e = 0; e < elems.length; e++) {
          let c = counts.get(elems[e]);
          if (!c) counts.set(elems[e], (c = [0, 0, 0, 0]));
          c[0]++;
          if (group >= 0) c[group + 1]++;
        }
      }

      const elements = {};
      counts.forEach((c, idx) => {
        const expressId = elemIds[idx];
        if (expressId == null) return;
        elements[expressId] = { points: c[0] };
        GROUPS.forEach((g, gi) => (elements[expressId][g] = c[gi + 1]));
      });

      return {
        elements,
        photosUsed,
        photosFailed: failures,
        labeledPoints,
        bimElementCount: elemIds.length,
      };
    } finally {
      setIsDetecting(false);
      setProgress(null);
    }
  }, [pcModel, bimModel]);

  return { runDetection, isDetecting, progress };
}
