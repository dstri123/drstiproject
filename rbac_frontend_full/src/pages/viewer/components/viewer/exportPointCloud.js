import * as THREE from "three";
import API from "../../../../api/axios";

// Section-box "Export PLY": the server crops the ORIGINAL upload (full
// density + precision, not the subsampled/half-float copy on screen) to the
// box, so the browser only sends where the cloud sits and where the box is.

// Raw file coords -> viewer world. useModelLoader recentres the geometry on
// `geomCentroid`, so a raw point p is drawn at matrixWorld * (p - centroid).
// Uses the live matrix, so unsaved moves / geo placement are honoured.
export function buildRawToWorld(pcModel) {
  const centroid = pcModel?.userData?.geomCentroid;
  if (!pcModel || !centroid) return null;
  pcModel.updateMatrixWorld(true);
  return pcModel.matrixWorld
    .clone()
    .multiply(
      new THREE.Matrix4().makeTranslation(-centroid.x, -centroid.y, -centroid.z),
    );
}

// Why the current cloud can't be exported, or null when it can.
export function exportBlocker(pcModel, pointFile) {
  if (!pcModel || !pointFile) return "Load a point cloud first.";
  if (!pointFile.id && !pointFile.mergeId)
    return "Only point clouds saved to the project can be exported.";
  if (!pcModel.userData?.geomCentroid)
    return "The point cloud is still loading.";
  return null;
}

async function errorMessage(err) {
  let msg = err?.message || "Export failed.";
  try {
    // responseType "blob" turns the JSON error body into a Blob.
    const text = await err?.response?.data?.text?.();
    const parsed = JSON.parse(text || "{}");
    if (parsed.error) msg = parsed.error;
  } catch (_) {}
  return msg;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download the part of the cloud inside `box` (a THREE.Box3 in viewer world,
 * or null for the whole cloud) as PLY.
 * frame: "original" (scan coordinates) | "aligned" (viewer placement, Z-up).
 * Resolves to the file name; rejects with an Error carrying the server's
 * message.
 */
export async function exportCroppedPly({ pcModel, pointFile, box, frame = "original" }) {
  const blocker = exportBlocker(pcModel, pointFile);
  if (blocker) throw new Error(blocker);
  const rawToWorld = buildRawToWorld(pcModel);

  let res;
  try {
    res = await API.post(
      "processing/tools/pointcloud-export/",
      {
        ...(pointFile.mergeId
          ? { merge_id: pointFile.mergeId }
          : { pointcloud_id: pointFile.id }),
        raw_to_world: Array.from(rawToWorld.elements),
        box: box && !box.isEmpty()
          ? { min: box.min.toArray(), max: box.max.toArray() }
          : null,
        frame,
      },
      { responseType: "blob" },
    );
  } catch (err) {
    throw new Error(await errorMessage(err));
  }

  const name =
    /filename="([^"]+)"/.exec(res.headers?.["content-disposition"] || "")?.[1] ||
    `pointcloud_${frame}.ply`;
  saveBlob(res.data, name);
  return name;
}
