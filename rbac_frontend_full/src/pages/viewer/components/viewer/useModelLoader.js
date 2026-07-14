import { useEffect, useState, useCallback, useRef } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import API from "../../../../api/axios";

// ─── Constants ────────────────────────────────────────────────────────────────
const COMPRESSION_THRESHOLD_BYTES = 700 * 1024 * 1024; // 700 MB
const RETAIN_RATIO = 0.7;

// ─── RANSAC config ────────────────────────────────────────────────────────────
const RANSAC_ITERATIONS = 200; // iterations per plane extraction
const RANSAC_THRESHOLD = 0.05; // distance (world units) to count as inlier
const RANSAC_MIN_INLIERS = 0.03; // min fraction of remaining points for a plane
const MAX_PLANES = 8; // extract up to 8 planes
const RANSAC_SAMPLE_SIZE = 50000; // work on a subsample for speed, then label all

// ─── Segment colours ──────────────────────────────────────────────────────────
const SEGMENT_PALETTE = [
  [0.2, 0.85, 0.4], // green
  [1.0, 0.9, 0.2], // yellow
  [0.25, 0.75, 1.0], // cyan / light blue
  [1.0, 0.25, 0.7], // pink / magenta
  [0.3, 0.55, 1.0], // blue
  [0.2, 0.9, 0.8], // teal
  [1.0, 0.55, 0.2], // orange
  [0.8, 0.3, 1.0], // purple
];
const COLOR_UNASSIGNED = [0.55, 0.55, 0.55]; // grey for points not on any plane

// ─── BIM element colours ──────────────────────────────────────────────────────
// Fallback palette when the FBX carries no usable material colour. Each mesh
// picks a colour by hashing its element name, so walls / slabs / windows etc.
// stay visually distinct instead of one flat blue.
const BIM_ELEMENT_PALETTE = [
  0xc8bfae, // warm beige (walls)
  0x9aa5b1, // blue grey (slabs)
  0x8c7b6c, // brown (structure)
  0xa9c0a6, // sage (landscape)
  0x7f96ad, // steel blue (glazing frames)
  0xbfa6a0, // clay (brick)
  0x96b1b8, // teal grey (MEP)
  0xb5aa8f, // sand (finishes)
  0x8e9aaf, // slate (railings)
  0xc2b59b, // stone
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Pick a material colour for a BIM mesh: keep the colour authored in the FBX
// when it is meaningful, otherwise fall back to the palette by element name.
function bimColorFor(child) {
  const orig = Array.isArray(child.material)
    ? child.material[0]
    : child.material;
  if (orig?.color) {
    const { r, g, b } = orig.color;
    const isDefaultWhite = r > 0.95 && g > 0.95 && b > 0.95;
    const isNearBlack = r + g + b < 0.06;
    if (!isDefaultWhite && !isNearBlack) return orig.color.clone();
  }
  const idx = hashString(child.name || "element") % BIM_ELEMENT_PALETTE.length;
  return new THREE.Color(BIM_ELEMENT_PALETTE[idx]);
}

// ─── Orientation heuristic ────────────────────────────────────────────────────
// Scanner point clouds (and some FBX exports) are Z-up while three.js is Y-up,
// which makes models load lying down / upside down. For building data the
// vertical extent is almost always the smallest, so when the Y extent clearly
// exceeds the Z extent the data is treated as Z-up and rotated upright.
function autoUpright(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  if (size.y > size.z * 1.2) {
    object.rotation.x = -Math.PI / 2; // map +Z (old up) onto +Y
    object.updateMatrixWorld(true);
    console.info("[Viewer] Z-up data detected — rotated upright.");
    return true;
  }
  return false;
}

// ─── RANSAC plane segmentation ────────────────────────────────────────────────
//
//  Algorithm (iterative plane extraction):
//
//  repeat up to MAX_PLANES times on the remaining unassigned points:
//    1. Randomly sample 3 points → fit a plane (normal + distance)
//    2. Count inliers: points within RANSAC_THRESHOLD of that plane
//    3. Keep the plane with the most inliers after RANSAC_ITERATIONS trials
//    4. Assign those inliers a colour and remove them from the candidate set
//    5. Stop early if no plane found with enough inliers
//
//  To keep it fast in-browser, RANSAC runs on a random subsample of at most
//  RANSAC_SAMPLE_SIZE points, then every point in the full cloud is tested
//  against the extracted planes at the end.
//
function ransacSegment(geometry) {
  const pos = geometry.attributes.position;
  const total = pos.count;

  // ── Build a flat array of {x,y,z,origIndex} for the working set ───────────
  // Use a subsample for the RANSAC search to keep it fast
  const step = Math.max(1, Math.floor(total / RANSAC_SAMPLE_SIZE));
  const sample = [];
  // Read through getX/getY/getZ (not .array) so this works regardless of the
  // attribute storage type — Float32 or quantized Float16.
  for (let i = 0; i < total; i += step) {
    sample.push({
      x: pos.getX(i),
      y: pos.getY(i),
      z: pos.getZ(i),
      idx: i,
    });
  }

  const sampleSize = sample.length;
  const planeLabels = new Int8Array(sampleSize).fill(-1); // -1 = unassigned
  const planes = []; // { nx, ny, nz, d }

  let remaining = Array.from({ length: sampleSize }, (_, i) => i); // indices into sample[]

  // ── Iterative plane extraction ─────────────────────────────────────────────
  for (let planeIdx = 0; planeIdx < MAX_PLANES; planeIdx++) {
    if (remaining.length < 3) break;

    const minInliers = Math.max(
      3,
      Math.floor(remaining.length * RANSAC_MIN_INLIERS),
    );
    let bestPlane = null;
    let bestInliers = [];

    for (let iter = 0; iter < RANSAC_ITERATIONS; iter++) {
      // 1. Sample 3 random points from remaining
      const a = sample[remaining[randInt(remaining.length)]];
      const b = sample[remaining[randInt(remaining.length)]];
      const c = sample[remaining[randInt(remaining.length)]];

      // 2. Compute plane normal via cross product of (b-a) × (c-a)
      const abx = b.x - a.x,
        aby = b.y - a.y,
        abz = b.z - a.z;
      const acx = c.x - a.x,
        acy = c.y - a.y,
        acz = c.z - a.z;
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-10) continue; // degenerate — skip
      nx /= len;
      ny /= len;
      nz /= len;

      // Plane equation: nx*x + ny*y + nz*z = d
      const d = nx * a.x + ny * a.y + nz * a.z;

      // 3. Find inliers
      const inliers = [];
      for (let ri = 0; ri < remaining.length; ri++) {
        const p = sample[remaining[ri]];
        const dist = Math.abs(nx * p.x + ny * p.y + nz * p.z - d);
        if (dist < RANSAC_THRESHOLD) inliers.push(remaining[ri]);
      }

      if (inliers.length > bestInliers.length) {
        bestInliers = inliers;
        bestPlane = { nx, ny, nz, d };
        // Early exit if we have a dominant plane
        if (bestInliers.length > remaining.length * 0.5) break;
      }
    }

    // 4. Accept plane if it has enough inliers
    if (!bestPlane || bestInliers.length < minInliers) break;

    planes.push(bestPlane);
    const inlierSet = new Set(bestInliers);

    for (const ri of bestInliers) planeLabels[ri] = planeIdx;

    // 5. Remove inliers from remaining set
    remaining = remaining.filter((ri) => !inlierSet.has(ri));
  }

  // ── Now label ALL points in the full cloud against extracted planes ─────────
  // Output Uint8 (0–255) to match the quantized colour attribute.
  const result = new Uint8Array(total * 3);

  for (let i = 0; i < total; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    let bestLabel = -1;
    let bestDist = RANSAC_THRESHOLD;

    for (let pi = 0; pi < planes.length; pi++) {
      const p = planes[pi];
      const dist = Math.abs(p.nx * x + p.ny * y + p.nz * z - p.d);
      if (dist < bestDist) {
        bestDist = dist;
        bestLabel = pi;
      }
    }

    const c =
      bestLabel >= 0
        ? SEGMENT_PALETTE[bestLabel % SEGMENT_PALETTE.length]
        : COLOR_UNASSIGNED;

    result[i * 3] = Math.round(c[0] * 255);
    result[i * 3 + 1] = Math.round(c[1] * 255);
    result[i * 3 + 2] = Math.round(c[2] * 255);
  }

  console.info(
    `[RANSAC] Detected ${planes.length} planes from ${total.toLocaleString()} points.`,
  );
  planes.forEach((p, i) => {
    const label =
      Math.abs(p.ny) > 0.7
        ? p.ny > 0
          ? "floor"
          : "ceiling"
        : Math.abs(p.nx) > Math.abs(p.nz)
          ? p.nx > 0
            ? "east wall"
            : "west wall"
          : p.nz > 0
            ? "north wall"
            : "south wall";
    console.info(
      `  Plane ${i}: ${label}  normal=(${p.nx.toFixed(2)}, ${p.ny.toFixed(2)}, ${p.nz.toFixed(2)})`,
    );
  });

  return result;
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

// ─── Subsample geometry ───────────────────────────────────────────────────────
function subsampleGeometry(geometry, retainRatio) {
  const positions = geometry.attributes.position;
  const colors = geometry.attributes.color;
  const normals = geometry.attributes.normal;
  const total = positions.count;
  const step = Math.max(1, Math.round(1 / retainRatio));
  const kept = Math.ceil(total / step);

  const newPos = new Float32Array(kept * 3);
  const newCol = colors ? new Float32Array(kept * 3) : null;
  const newNrm = normals ? new Float32Array(kept * 3) : null;

  let out = 0;
  for (let i = 0; i < total; i += step) {
    const s = i * 3,
      d = out * 3;
    newPos[d] = positions.array[s];
    newPos[d + 1] = positions.array[s + 1];
    newPos[d + 2] = positions.array[s + 2];
    if (newCol) {
      newCol[d] = colors.array[s];
      newCol[d + 1] = colors.array[s + 1];
      newCol[d + 2] = colors.array[s + 2];
    }
    if (newNrm) {
      newNrm[d] = normals.array[s];
      newNrm[d + 1] = normals.array[s + 1];
      newNrm[d + 2] = normals.array[s + 2];
    }
    out++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(newPos, 3));
  if (newCol) geo.setAttribute("color", new THREE.BufferAttribute(newCol, 3));
  if (newNrm) geo.setAttribute("normal", new THREE.BufferAttribute(newNrm, 3));
  return geo;
}

// ─── Compress point-cloud geometry in memory ──────────────────────────────────
// Halves GPU/CPU memory for a cloud by quantizing attributes:
//   • position  Float32 (12 B/pt) → Float16  (6 B/pt)
//   • color     Float32 (12 B/pt) → Uint8    (3 B/pt)
//   • normals are dropped entirely (points don't shade, 12 B/pt freed)
// Positions are only quantized when the caller hasn't got a saved transform —
// see the load path — so a recenter can keep coords near the origin where
// half-float precision is good (georeferenced clouds with huge coords would
// otherwise lose precision). Returns the centroid the geometry was shifted by.
function optimizePointGeometry(geo, { quantizePositions }) {
  // Points never use normals — free them.
  if (geo.attributes.normal) geo.deleteAttribute("normal");

  // Colours → Uint8 normalized.
  const col = geo.attributes.color;
  if (col && !(col.array instanceof Uint8Array)) {
    const src = col.array; // 0..1 floats from PLYLoader
    const u8 = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) {
      u8[i] = Math.max(0, Math.min(255, Math.round(src[i] * 255)));
    }
    geo.setAttribute("color", new THREE.Uint8BufferAttribute(u8, 3, true));
  }

  // ALWAYS recenter the geometry to its centroid — deterministic per file, so
  // the object's saved position/quaternion/scale mean the same thing on every
  // load. (Do it even when we keep Float32, otherwise a saved transform applied
  // to a non-recentered reload would misplace the cloud.)
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const centroid = geo.boundingBox.getCenter(new THREE.Vector3());
  const src = pos.array;

  if (quantizePositions) {
    // Recenter + store as half-float in one pass (12 B/pt → 6 B/pt).
    const toHalf = THREE.DataUtils.toHalfFloat;
    const u16 = new Uint16Array(src.length);
    for (let i = 0; i < pos.count; i++) {
      u16[i * 3] = toHalf(src[i * 3] - centroid.x);
      u16[i * 3 + 1] = toHalf(src[i * 3 + 1] - centroid.y);
      u16[i * 3 + 2] = toHalf(src[i * 3 + 2] - centroid.z);
    }
    geo.setAttribute("position", new THREE.Float16BufferAttribute(u16, 3));
  } else {
    // Keep Float32 (better alignment precision for already-aligned clouds) but
    // still recenter so the frame matches the quantized path.
    for (let i = 0; i < pos.count; i++) {
      src[i * 3] -= centroid.x;
      src[i * 3 + 1] -= centroid.y;
      src[i * 3 + 2] -= centroid.z;
    }
    pos.needsUpdate = true;
  }

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return centroid;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export default function useModelLoader(sceneData, props) {
  const { sceneRef, cameraRef, controlsRef } = sceneData;
  const {
    bimFile,
    pointFile,
    bimVisible,
    pcVisible,
    setBimElementCount,
    onError,
  } = props;

  const [bimModel, setBimModel] = useState(null);
  const [pcModel, setPcModel] = useState(null);
  const [error, setError] = useState(null);
  const [isSegmented, setIsSegmented] = useState(false);
  const [wasCompressed, setWasCompressed] = useState(false);
  const [isSegmenting, setIsSegmenting] = useState(false); // loading state
  const [isConvertingIfc, setIsConvertingIfc] = useState(false);
  const [isLoadingBim, setIsLoadingBim] = useState(false);
  const [isLoadingPc, setIsLoadingPc] = useState(false);

  const [colorRefs] = useState(() => ({ original: null, segment: null }));

  // Remembers each model's transform right after auto-placement, so the
  // "Reset" button can undo manual rotations/moves without reloading the file.
  const initialTransformsRef = useRef(new Map());

  const isValidFBX = (f) => f?.name?.toLowerCase().endsWith(".fbx");
  const isValidIFC = (f) => f?.name?.toLowerCase().endsWith(".ifc");
  const isValidBIM = (f) => isValidFBX(f) || isValidIFC(f);

  // Formats accepted by the point-cloud loader path.
  // PLY is rendered natively; all others are converted to PLY via the backend.
  const PC_EXTENSIONS = [
    ".ply",
    ".las",
    ".laz",
    ".plz",
    ".e57",
    ".pts",
    ".xyz",
  ];
  const getExt = (f) => f?.name?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const isValidPointCloud = (f) => PC_EXTENSIONS.includes(getExt(f));
  const isNativePLY = (f) => getExt(f) === ".ply";

  // BIM/point-cloud files can be tens to hundreds of MB, fetched at the same
  // time as ~50 map tile requests to the same origin — under that connection
  // contention the browser occasionally drops the request outright with a
  // raw "Failed to fetch" (no HTTP status at all). Retry a couple of times
  // before giving up, since the server itself isn't the problem.
  const fetchWithRetry = async (url, attempts = 6) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fetch(url);
      } catch (err) {
        lastErr = err;
        console.warn(
          `fetchWithRetry: attempt ${i + 1}/${attempts} failed for ${url}`,
          err,
        );
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));
        }
      }
    }
    throw lastErr;
  };

  const resolveBlob = async (source) => {
    if (!source) return null;
    if (source instanceof Blob) return source;
    if (source?.url) {
      const response = await fetchWithRetry(source.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch remote asset: ${response.status} ${response.statusText}`,
        );
      }
      return await response.blob();
    }
    return null;
  };

  const createBlobUrl = async (source) => {
    const blob = await resolveBlob(source);
    return blob ? URL.createObjectURL(blob) : null;
  };

  // Send an IFC blob to the backend (ifcopenshell) and get a GLB back that
  // the standard GLTF loader can render.
  const convertIfcToGlbUrl = async (source) => {
    const blob = await resolveBlob(source);
    if (!blob) throw new Error("Unable to read IFC file.");
    const formData = new FormData();
    formData.append("file", blob, source?.name || "model.ifc");
    const res = await API.post("processing/tools/ifc-to-glb/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      responseType: "blob",
    });
    return URL.createObjectURL(res.data);
  };

  const applySavedTransform = (object, transform) => {
    if (!object || !transform || typeof transform !== "object") return;

    console.debug("[useModelLoader] applySavedTransform", transform);
    if (Array.isArray(transform.position) && transform.position.length === 3) {
      object.position.fromArray(transform.position);
    }
    if (
      Array.isArray(transform.quaternion) &&
      transform.quaternion.length === 4
    ) {
      object.quaternion.fromArray(transform.quaternion);
    }
    if (Array.isArray(transform.scale) && transform.scale.length === 3) {
      object.scale.fromArray(transform.scale);
    }
    object.updateMatrix();
    object.updateMatrixWorld(true);
    // log world transform after applying
    try {
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      const ws = new THREE.Vector3();
      object.getWorldPosition(wp);
      object.getWorldQuaternion(wq);
      object.getWorldScale(ws);
      console.debug("[useModelLoader] object world transform", {
        position: wp.toArray(),
        quaternion: wq.toArray(),
        scale: ws.toArray(),
      });
    } catch (e) {
      console.debug("[useModelLoader] world transform log failed", e);
    }
  };

  const fitCameraToObjects = useCallback(
    (objects) => {
      if (!cameraRef?.current) return;
      const list = (Array.isArray(objects) ? objects : [objects]).filter(
        Boolean,
      );
      if (!list.length) return;

      const box = new THREE.Box3();
      list.forEach((obj) => {
        obj.updateMatrixWorld(true);
        box.expandByObject(obj);
      });
      if (box.isEmpty()) return;

      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.8;

      cameraRef.current.position.set(
        center.x + cameraZ,
        center.y + cameraZ,
        center.z + cameraZ,
      );
      cameraRef.current.near = Math.max(maxDim / 1000, 0.01);
      cameraRef.current.far = Math.max(maxDim * 50, 5000);
      cameraRef.current.lookAt(center);
      cameraRef.current.updateProjectionMatrix();

      if (controlsRef?.current) {
        controlsRef.current.target.copy(center);
        // zoom limits scale with the model so zooming never feels stuck
        controlsRef.current.minDistance = maxDim * 0.01;
        controlsRef.current.maxDistance = maxDim * 20;
        controlsRef.current.update();
      }
    },
    [cameraRef, controlsRef],
  );

  const fitCameraToObject = fitCameraToObjects;

  // ─── Lights ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 10, 10);
    scene.add(ambient, dirLight);
    return () => {
      scene.remove(ambient, dirLight);
    };
  }, [sceneRef]);

  // ─── Load FBX ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sceneRef.current) return;
    if (bimModel) {
      sceneRef.current.remove(bimModel);
      setBimModel(null);
      setBimElementCount?.(0);
    }
    if (!bimFile) return;
    if (!isValidBIM(bimFile)) {
      onError?.("Only FBX and IFC formats are supported for BIM");
      return;
    }

    setIsLoadingBim(true);

    let objectUrl = null;
    let isCancelled = false;

    // Shared setup for a loaded BIM object regardless of source format.
    // skipUpright: server-converted IFC is already rotated to Y-up, so the
    // orientation heuristic must not run on it.
    const setupBimObject = (object, skipUpright = false) => {
      if (isCancelled || !sceneRef.current) return;
      let meshCount = 0;
      object.traverse((child) => {
        if (child.isMesh) {
          meshCount++;
          const hasVertexColors = Boolean(child.geometry?.attributes?.color);
          child.material = new THREE.MeshStandardMaterial({
            color: hasVertexColors ? 0xffffff : bimColorFor(child),
            vertexColors: hasVertexColors,
            roughness: 0.8,
            metalness: 0.05,
            side: THREE.DoubleSide, // IFC faces are often inverted
          });

          // Thin dark edge lines give the clean "technical drawing" look
          // (like IFCtoFDS) without removing the per-element colors that
          // picking/segmentation rely on. The 30° threshold keeps only real
          // creases so curved surfaces don't turn into a mess of lines.
          try {
            const edgesGeom = new THREE.EdgesGeometry(child.geometry, 30);
            const edgeLines = new THREE.LineSegments(
              edgesGeom,
              new THREE.LineBasicMaterial({
                color: 0x334155,
                transparent: true,
                opacity: 0.35,
              }),
            );
            edgeLines.name = "__bim_edges";
            // Don't let edge lines intercept clicks meant for the surface.
            edgeLines.raycast = () => {};
            child.add(edgeLines);
          } catch (e) {
            // ignore edge build failures on degenerate geometry
          }
        }
      });
      setBimElementCount?.(meshCount);
      // If a saved transform exists, apply it exactly as-saved.
      // Otherwise auto-orient and center the model in the scene.
      if (bimFile?.transform) {
        applySavedTransform(object, bimFile.transform);
      } else {
        if (!skipUpright) autoUpright(object);
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);
        object.updateMatrixWorld(true);
      }
      sceneRef.current.add(object);
      setBimModel(object);
      initialTransformsRef.current.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });

      if (cameraRef?.current) {
        fitCameraToObject(object);
        if (controlsRef?.current) {
          controlsRef.current.enableZoom = true;
        }
      }
      setIsLoadingBim(false);
    };

    const loadModel = async () => {
      try {
        setError(null);

        if (isValidIFC(bimFile)) {
          // IFC: convert on the server to GLB, then load with GLTFLoader
          setIsConvertingIfc(true);
          try {
            objectUrl = await convertIfcToGlbUrl(bimFile);
          } finally {
            setIsConvertingIfc(false);
          }
          if (isCancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          new GLTFLoader().load(
            objectUrl,
            (gltf) => setupBimObject(gltf.scene, true),
            undefined,
            (err) => {
              console.error("GLB Load Error:", err);
              onError?.("Failed to display converted IFC model");
              setIsLoadingBim(false);
            },
          );
        } else {
          objectUrl = await createBlobUrl(bimFile);
          if (!objectUrl) {
            throw new Error("Unable to resolve BIM source to a blob URL.");
          }
          if (isCancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          new FBXLoader().load(objectUrl, setupBimObject, undefined, (err) => {
            console.error("FBX Load Error:", err);
            const message =
              "Failed to load BIM file. It may be corrupted or in an unsupported format.";
            setError(message);
            onError?.(message);
            setIsLoadingBim(false);
          });
        }
      } catch (err) {
        console.error("BIM load error:", err);
        const serverError =
          err.response?.data instanceof Blob
            ? "IFC conversion failed on the server"
            : err.response?.data?.error;
        const message =
          serverError || err.message || "Failed to load BIM file.";
        setError(message);
        onError?.(message);
        setIsLoadingBim(false);
      }
    };

    loadModel();

    return () => {
      isCancelled = true;
      setIsLoadingBim(false);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // eslint-disable-next-line
  }, [bimFile]);

  // ─── Load Point Cloud ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sceneRef.current) return;
    // Switching to a different date/version leaves the previous cloud in the
    // scene otherwise — unlike the BIM effect above, this one used to only
    // clear pcModel when pointFile went away entirely, not when it changed to
    // another file, so two point clouds could render stacked on top of each
    // other.
    if (pcModel) {
      sceneRef.current.remove(pcModel);
      pcModel.geometry?.dispose();
      pcModel.material?.dispose();
      setPcModel(null);
      setIsSegmented(false);
      colorRefs.original = null;
      colorRefs.segment = null;
    }
    if (!pointFile) return;
    if (!isValidPointCloud(pointFile)) {
      onError?.(
        `Unsupported point cloud format "${getExt(pointFile)}". ` +
          "Supported: PLY, LAS, LAZ, PLZ, E57, PTS, XYZ.",
      );
      return;
    }

    setIsSegmented(false);
    setWasCompressed(false);
    colorRefs.original = null;
    colorRefs.segment = null;
    setError(null);
    setIsLoadingPc(true);

    let objectUrl = null;
    let isCancelled = false;

    const loadPoints = async () => {
      try {
        // PLY files are loaded directly; all other formats are converted to PLY
        // by the backend (with RGB colors preserved) before PLYLoader runs.
        if (isNativePLY(pointFile)) {
          objectUrl = await createBlobUrl(pointFile);
        } else {
          const blob = await resolveBlob(pointFile);
          if (!blob) throw new Error("Unable to read point cloud file.");
          const formData = new FormData();
          formData.append("file", blob, pointFile?.name || "cloud.las");
          let res;
          try {
            res = await API.post(
              "processing/tools/pointcloud-to-ply/",
              formData,
              {
                headers: { "Content-Type": "multipart/form-data" },
                responseType: "blob",
              },
            );
          } catch (axiosErr) {
            // Parse a JSON error body that was returned as a blob.
            let msg = axiosErr?.message || "Conversion failed.";
            try {
              const text = await axiosErr.response?.data?.text?.();
              const parsed = JSON.parse(text || "{}");
              if (parsed.error) msg = parsed.error;
            } catch (_) {}
            throw new Error(msg);
          }
          objectUrl = URL.createObjectURL(res.data);
        }

        if (!objectUrl) {
          throw new Error(
            "Unable to resolve point cloud source to a blob URL.",
          );
        }

        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        const needsCompress = pointFile.size > COMPRESSION_THRESHOLD_BYTES;

        new PLYLoader().load(
          objectUrl,
          (geometry) => {
            // Do NOT call computeVertexNormals() on point clouds

            let finalGeo = geometry;
            if (needsCompress) {
              console.info(
                `[PLY] ${(pointFile.size / 1024 / 1024).toFixed(0)} MB > 700 MB — subsampling to ${(RETAIN_RATIO * 100).toFixed(0)}%`,
              );
              finalGeo = subsampleGeometry(geometry, RETAIN_RATIO);
              geometry.dispose();
              setWasCompressed(true);
            }

            if (!finalGeo.attributes.color) {
              const whites = new Float32Array(
                finalGeo.attributes.position.count * 3,
              ).fill(1);
              finalGeo.setAttribute(
                "color",
                new THREE.BufferAttribute(whites, 3),
              );
            }

            // Compress in memory: colours → Uint8 always; positions → Float16
            // (recentered) only when there's no saved transform to honour, so
            // half-float precision stays good. ~24 B/pt → ~9 B/pt.
            // optimizePointGeometry(finalGeo, {
            //   quantizePositions: !pointFile?.transform,
            // });
            const geomCentroid = optimizePointGeometry(finalGeo, {
              quantizePositions: !pointFile?.transform,
            });
            // Save original colours (now Uint8, a quarter of the old Float32
            // copy) so the segmentation toggle can restore them.
            colorRefs.original = new Uint8Array(
              finalGeo.attributes.color.array,
            );

            // optimizePointGeometry already recomputed bounds; guard against a
            // NaN sphere (malformed PLY) so the renderer never culls the cloud.
            if (
              !finalGeo.boundingSphere ||
              !Number.isFinite(finalGeo.boundingSphere.radius)
            ) {
              finalGeo.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 0, 0),
                1e6,
              );
            }

            // Point size must scale with the cloud, otherwise a fixed 0.02
            // world-unit size is sub-pixel on large (building-scale) clouds and
            // the whole cloud looks invisible until you zoom right in. Derive a
            // size from the bounding-box diagonal so points are always visible.
            const bbSize = finalGeo.boundingBox
              ? finalGeo.boundingBox.getSize(new THREE.Vector3())
              : new THREE.Vector3(1, 1, 1);
            const diag = bbSize.length() || 1;
            const pointSize = Math.max(diag * 0.0025, 0.01);

            // Render with original colours immediately
            const material = new THREE.PointsMaterial({
              size: pointSize,
              sizeAttenuation: true,
              vertexColors: true,
            });
            const points = new THREE.Points(finalGeo, material);
            // Large/irregular point clouds can get a bad (or stale) bounding
            // sphere, which makes the renderer's frustum check incorrectly
            // cull the whole cloud as soon as the camera moves — appearing
            // as the cloud randomly "disappearing". It's small enough that
            // skipping frustum culling costs nothing visually.
            points.frustumCulled = false;
            if (pointFile?.transform) {
              applySavedTransform(points, pointFile.transform);
            } else {
              // auto-orient (scanner clouds are usually Z-up), then center
              autoUpright(points);
              const pBox = new THREE.Box3().setFromObject(points);
              const pCenter = pBox.getCenter(new THREE.Vector3());
              points.position.sub(pCenter);
              points.updateMatrixWorld(true);
              const centroidShift = new THREE.Matrix4().makeTranslation(
                -geomCentroid.x,
                -geomCentroid.y,
                -geomCentroid.z,
              );
              points.userData.rawToWorld = points.matrixWorld
                .clone()
                .multiply(centroidShift);
            }
            sceneRef.current.add(points);
            setPcModel(points);
            initialTransformsRef.current.set(points, {
              position: points.position.clone(),
              quaternion: points.quaternion.clone(),
              scale: points.scale.clone(),
            });

            if (cameraRef?.current) {
              fitCameraToObject(points);
              if (controlsRef?.current) {
                controlsRef.current.enableZoom = true;
              }
            }

            // Run RANSAC asynchronously so it doesn't block the render
            // Use setTimeout to yield to the browser first
            setTimeout(() => {
              try {
                colorRefs.segment = ransacSegment(finalGeo);
              } catch (e) {
                console.error("RANSAC segmentation failed:", e);
              }
            }, 100);

            URL.revokeObjectURL(objectUrl);
            setIsLoadingPc(false);
          },
          undefined,
          (err) => {
            console.error("PLY load error:", err);
            const message =
              "Failed to load point cloud file. It may be corrupted or in an unsupported PLY format.";
            setError(message);
            onError?.(message);
            URL.revokeObjectURL(objectUrl);
            setIsLoadingPc(false);
          },
        );
      } catch (err) {
        console.error("Point cloud load error:", err);
        const message = err.message || "Failed to load point cloud.";
        setError(message);
        onError?.(message);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setIsLoadingPc(false);
      }
    };

    loadPoints();

    return () => {
      isCancelled = true;
      setIsLoadingPc(false);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // eslint-disable-next-line
  }, [pointFile]);

  // ─── Scale normalisation ───────────────────────────────────────────────────
  // BIM exports are frequently in millimetres while point clouds are in
  // metres, so the BIM loads enormous next to the cloud. When both models are
  // present (and neither carries a saved transform) the BIM is rescaled so its
  // bounding box matches the point cloud's, then both are framed together.
  // This keeps point picking + Kabsch alignment intact: the rescale is baked
  // into the BIM object's transform before any points are picked.
  useEffect(() => {
    if (!bimModel || !pcModel) return;
    if (bimFile?.transform || pointFile?.transform) return;

    const bimBox = new THREE.Box3().setFromObject(bimModel);
    const pcBox = new THREE.Box3().setFromObject(pcModel);
    if (bimBox.isEmpty() || pcBox.isEmpty()) return;

    const bimSize = bimBox.getSize(new THREE.Vector3());
    const pcSize = pcBox.getSize(new THREE.Vector3());
    const bimDim = Math.max(bimSize.x, bimSize.y, bimSize.z);
    const pcDim = Math.max(pcSize.x, pcSize.y, pcSize.z);
    if (bimDim < 1e-9 || pcDim < 1e-9) return;

    const ratio = pcDim / bimDim;
    if (Math.abs(1 - ratio) > 0.15) {
      bimModel.scale.multiplyScalar(ratio);
      bimModel.updateMatrixWorld(true);
      // re-center after rescaling so both models overlap at the origin
      const newBox = new THREE.Box3().setFromObject(bimModel);
      const newCenter = newBox.getCenter(new THREE.Vector3());
      bimModel.position.sub(newCenter);
      bimModel.updateMatrixWorld(true);
      console.info(
        `[Viewer] BIM rescaled ×${ratio.toFixed(4)} to match point cloud size ` +
          `(BIM ${bimDim.toFixed(1)} → ${pcDim.toFixed(1)} units).`,
      );
      // "Reset" should restore to this auto-scaled placement, not the
      // pre-rescale (often huge) transform captured at load time.
      initialTransformsRef.current.set(bimModel, {
        position: bimModel.position.clone(),
        quaternion: bimModel.quaternion.clone(),
        scale: bimModel.scale.clone(),
      });
    }

    fitCameraToObjects([bimModel, pcModel]);
    // eslint-disable-next-line
  }, [bimModel, pcModel]);

  // ─── Reset a single model's transform to its auto-placed state ────────────
  const resetTransform = useCallback(
    (model) => {
      if (!model) return;
      const initial = initialTransformsRef.current.get(model);
      if (!initial) return;
      model.position.copy(initial.position);
      model.quaternion.copy(initial.quaternion);
      model.scale.copy(initial.scale);
      model.updateMatrixWorld(true);
      fitCameraToObjects([bimModel, pcModel]);
    },
    [bimModel, pcModel, fitCameraToObjects],
  );

  // ─── Per-model scale ───────────────────────────────────────────────────────
  // Sets a model's scale to `factor` × its auto-placed (initial) scale, scaling
  // about its current centre so it doesn't jump. factor 1 = original size.
  // Works for either model, so you can size the point cloud to the BIM or
  // vice-versa. The scale is baked into the transform and saved by "Save".
  const setModelScale = useCallback((model, factor) => {
    if (!model) return;
    const initial = initialTransformsRef.current.get(model);
    if (!initial) return;
    const f = Math.max(0.05, Number(factor) || 1);

    const before = new THREE.Box3()
      .setFromObject(model)
      .getCenter(new THREE.Vector3());
    model.scale.copy(initial.scale).multiplyScalar(f);
    model.updateMatrixWorld(true);
    const after = new THREE.Box3()
      .setFromObject(model)
      .getCenter(new THREE.Vector3());
    // keep the model centred where it was before rescaling
    model.position.add(before.sub(after));
    model.updateMatrixWorld(true);
  }, []);

  // ─── Per-model opacity ─────────────────────────────────────────────────────
  // Sets the transparency of a single model (BIM or point cloud) by walking
  // its materials. value is 0 (invisible) … 1 (fully opaque).
  const setModelOpacity = useCallback((model, value) => {
    if (!model) return;
    const opacity = Math.min(1, Math.max(0, Number(value)));
    model.traverse((child) => {
      if (!child.material) return;
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      mats.forEach((m) => {
        m.transparent = opacity < 1;
        m.opacity = opacity;
        // point clouds: keep far points from punching through near ones
        if (child.isPoints) m.depthWrite = opacity >= 1;
        m.needsUpdate = true;
      });
    });
  }, []);

  // ─── Fit view ────────────────────────────────────────────────────────────────
  const fitAll = useCallback(() => {
    fitCameraToObjects([bimModel, pcModel]);
  }, [bimModel, pcModel, fitCameraToObjects]);

  // ─── Toggle segmentation ───────────────────────────────────────────────────
  const toggleSegmentation = useCallback(() => {
    if (!pcModel || !colorRefs.original) return;

    const next = !isSegmented;

    if (next) {
      // If RANSAC hasn't finished yet, run it now (blocking, but only once)
      if (!colorRefs.segment) {
        setIsSegmenting(true);
        setTimeout(() => {
          try {
            colorRefs.segment = ransacSegment(pcModel.geometry);
          } catch (e) {
            console.error("RANSAC failed:", e);
            setIsSegmenting(false);
            return;
          }
          const colorAttr = pcModel.geometry.attributes.color;
          colorAttr.array.set(colorRefs.segment);
          colorAttr.needsUpdate = true;
          setIsSegmented(true);
          setIsSegmenting(false);
        }, 50);
        return;
      }

      const colorAttr = pcModel.geometry.attributes.color;
      colorAttr.array.set(colorRefs.segment);
      colorAttr.needsUpdate = true;
    } else {
      const colorAttr = pcModel.geometry.attributes.color;
      colorAttr.array.set(colorRefs.original);
      colorAttr.needsUpdate = true;
    }

    setIsSegmented(next);
    // eslint-disable-next-line
  }, [pcModel, isSegmented]);

  // ─── Visibility ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (bimModel) bimModel.visible = bimVisible;
  }, [bimVisible, bimModel]);
  useEffect(() => {
    if (pcModel) pcModel.visible = pcVisible;
  }, [pcVisible, pcModel]);

  // ─── Cleanup on file removal ───────────────────────────────────────────────
  useEffect(() => {
    if (!bimFile && bimModel && sceneRef.current) {
      sceneRef.current.remove(bimModel);
      setBimModel(null);
      setBimElementCount?.(0);
    }
    // eslint-disable-next-line
  }, [bimFile]);

  useEffect(() => {
    if (!pointFile && pcModel && sceneRef.current) {
      sceneRef.current.remove(pcModel);
      pcModel.geometry?.dispose();
      pcModel.material?.dispose();
      setPcModel(null);
      setIsSegmented(false);
      colorRefs.original = null;
      colorRefs.segment = null;
    }
    // eslint-disable-next-line
  }, [pointFile]);

  return {
    bimModel,
    pcModel,
    error,
    toggleSegmentation,
    isSegmented,
    isSegmenting, // true while RANSAC is running — use for button loading state
    wasCompressed,
    fitAll,
    resetTransform, // restore a single model (BIM or PC) to its auto-placed transform
    setModelOpacity, // (model, 0..1) change a single model's transparency
    setModelScale, // (model, factor) scale a model relative to its initial size
    isConvertingIfc, // true while the server converts an uploaded IFC to GLB
    isLoadingBim, // true while the BIM file is being parsed/placed
    isLoadingPc, // true while the point cloud file is being parsed/placed
    isLoadingModel: isLoadingBim || isLoadingPc || isConvertingIfc,
  };
}
