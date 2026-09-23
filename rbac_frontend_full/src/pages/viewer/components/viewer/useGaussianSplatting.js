import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import JSZip from "jszip";
import API from "../../../../api/axios";

// Renders each splat as the actual projected 2D gaussian (EWA splatting, as in
// Kerbl et al. 2023 "3D Gaussian Splatting for Real-Time Radiance Field
// Rendering") instead of a plain isotropic circular blob: the 3D covariance
// built from aScale/aRotation is transformed into camera space and projected
// through the perspective Jacobian into a 2D covariance, which the fragment
// shader uses for a correctly oriented, anisotropic falloff. uFocal (pixel-
// space focal length) is kept in sync with the actual canvas size/camera via
// the Points object's onBeforeRender hook below.
const vertexShader = `
  attribute vec3 aScale;
  attribute vec4 aRotation;
  attribute float aOpacity;
  uniform vec2 uFocal;
  varying vec3 vColor;
  varying float vOpacity;
  varying vec3 vConic;
  varying float vPointSize;

  mat3 quatToMat3(vec4 q) {
    float x = q.x, y = q.y, z = q.z, w = q.w;
    vec3 col0 = vec3(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w));
    vec3 col1 = vec3(2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w));
    vec3 col2 = vec3(2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y));
    return mat3(col0, col1, col2);
  }

  void main() {
    vColor = color;
    vOpacity = aOpacity;

    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 projected = projectionMatrix * viewPosition;

    mat3 rot = quatToMat3(aRotation);
    mat3 scaledRot = mat3(rot[0] * aScale.x, rot[1] * aScale.y, rot[2] * aScale.z);
    mat3 covWorld = scaledRot * transpose(scaledRot);

    mat3 viewRot = mat3(modelViewMatrix);
    mat3 covView = viewRot * covWorld * transpose(viewRot);

    float vz = max(-viewPosition.z, 1e-4);
    mat3 jacobian = mat3(
      vec3(uFocal.x / vz, 0.0, 0.0),
      vec3(0.0, uFocal.y / vz, 0.0),
      vec3(-uFocal.x * viewPosition.x / (vz * vz), -uFocal.y * viewPosition.y / (vz * vz), 0.0)
    );
    mat3 cov2d = jacobian * covView * transpose(jacobian);

    float a = cov2d[0][0] + 0.3;
    float b = cov2d[0][1];
    float c = cov2d[1][1] + 0.3;
    float det = max(a * c - b * b, 1e-6);
    vConic = vec3(c / det, -b / det, a / det);

    float mid = 0.5 * (a + c);
    float spread = sqrt(max(mid * mid - det, 0.0));
    float lambdaMax = max(mid + spread, 1e-6);
    float pointSize = clamp(3.0 * sqrt(lambdaMax) * 2.0, 2.0, 160.0);

    vPointSize = pointSize;
    gl_PointSize = pointSize;
    gl_Position = projected;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vOpacity;
  varying vec3 vConic;
  varying float vPointSize;
  void main() {
    vec2 offset = (gl_PointCoord - 0.5) * vPointSize;
    float maha = vConic.x * offset.x * offset.x + 2.0 * vConic.y * offset.x * offset.y
      + vConic.z * offset.y * offset.y;
    float gaussian = exp(-0.5 * maha);
    if (gaussian < 1.0 / 255.0) discard;
    gl_FragColor = vec4(vColor, gaussian * vOpacity);
  }
`;

// Splats are only correctly composited back-to-front (painter's algorithm),
// so this reorders every geometry attribute in place by current camera-space
// depth. It's an O(N log N) main-thread sort — fine for periodic re-sorts,
// so callers should throttle how often it runs rather than calling every frame.
function sortSplatsByDepth(object, camera) {
  const geometry = object.geometry;
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  if (!count) return;

  object.updateWorldMatrix(true, false);
  const viewMatrix = new THREE.Matrix4().multiplyMatrices(
    camera.matrixWorldInverse,
    object.matrixWorld,
  );
  const m = viewMatrix.elements;
  const pos = posAttr.array;
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const base = i * 3;
    depths[i] =
      m[2] * pos[base] + m[6] * pos[base + 1] + m[10] * pos[base + 2] + m[14];
  }

  const order = new Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  order.sort((a, b) => depths[a] - depths[b]);

  const permute = (attribute, itemSize) => {
    if (!attribute) return;
    const src = attribute.array;
    const dst = new src.constructor(src.length);
    for (let i = 0; i < count; i += 1) {
      const from = order[i] * itemSize;
      const to = i * itemSize;
      for (let k = 0; k < itemSize; k += 1) dst[to + k] = src[from + k];
    }
    src.set(dst);
    attribute.needsUpdate = true;
  };
  permute(posAttr, 3);
  permute(geometry.attributes.color, 3);
  permute(geometry.attributes.aScale, 3);
  permute(geometry.attributes.aRotation, 4);
  permute(geometry.attributes.aOpacity, 1);
}

function attachDepthSorting(object, material) {
  const lastCameraPos = new THREE.Vector3();
  const lastCameraQuat = new THREE.Quaternion();
  let lastSortTime = 0;
  let hasSorted = false;
  const sizeScratch = new THREE.Vector2();

  object.onBeforeRender = (rendererArg, _sceneArg, cameraArg) => {
    rendererArg.getSize(sizeScratch);
    const pixelRatio = rendererArg.getPixelRatio();
    const width = sizeScratch.x * pixelRatio;
    const height = sizeScratch.y * pixelRatio;
    const elements = cameraArg.projectionMatrix.elements;
    material.uniforms.uFocal.value.set(
      (elements[0] * width) / 2,
      (elements[5] * height) / 2,
    );

    const now = performance.now();
    const moved =
      !hasSorted ||
      cameraArg.position.distanceToSquared(lastCameraPos) > 1e-6 ||
      1 - Math.abs(cameraArg.quaternion.dot(lastCameraQuat)) > 1e-6;
    if (moved && now - lastSortTime > 100) {
      sortSplatsByDepth(object, cameraArg);
      lastCameraPos.copy(cameraArg.position);
      lastCameraQuat.copy(cameraArg.quaternion);
      lastSortTime = now;
      hasSorted = true;
    }
  };
}

async function readSource(source) {
  if (!source) throw new Error("A COLMAP file is required.");
  if (typeof source.arrayBuffer === "function") return source.arrayBuffer();
  const response = await fetch(source.url || source);
  if (!response.ok)
    throw new Error(`Unable to read ${source.name || "COLMAP file"}.`);
  return response.arrayBuffer();
}

async function addImages(zip, images) {
  for (const item of images) {
    if (!item?.image) continue;
    const response = await fetch(item.image);
    if (response.ok)
      zip.file(
        item.original_path || item.original_name || item.name,
        await response.blob(),
      );
  }
}

function parseGaussianPly(buffer) {
  const bytes = new Uint8Array(buffer);
  const headerBytes = new Uint8Array(
    buffer,
    0,
    Math.min(bytes.length, 1024 * 1024),
  );
  const headerText = new TextDecoder().decode(headerBytes);
  const marker = "end_header\n";
  const headerEnd = headerText.indexOf(marker);
  if (headerEnd < 0)
    throw new Error("The trainer returned an invalid Gaussian PLY.");
  const header = headerText.slice(0, headerEnd);
  const count = Number(header.match(/element vertex (\d+)/)?.[1]);
  if (!count || !header.includes("binary_little_endian"))
    throw new Error("Only binary Gaussian PLY files are supported.");
  const data = new DataView(buffer, headerEnd + marker.length);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const opacities = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 14 * 4;
    for (let axis = 0; axis < 3; axis += 1)
      positions[index * 3 + axis] = data.getFloat32(offset + axis * 4, true);
    for (let axis = 0; axis < 3; axis += 1)
      colours[index * 3 + axis] = Math.max(
        0,
        Math.min(1, data.getFloat32(offset + (3 + axis) * 4, true) + 0.5),
      );
    opacities[index] = Math.max(
      0,
      Math.min(1, data.getFloat32(offset + 6 * 4, true)),
    );
    for (let axis = 0; axis < 3; axis += 1)
      scales[index * 3 + axis] = Math.exp(
        data.getFloat32(offset + (7 + axis) * 4, true),
      );
    rotations[index * 4] = data.getFloat32(offset + 11 * 4, true);
    rotations[index * 4 + 1] = data.getFloat32(offset + 12 * 4, true);
    rotations[index * 4 + 2] = data.getFloat32(offset + 13 * 4, true);
    rotations[index * 4 + 3] = data.getFloat32(offset + 10 * 4, true);
  }
  return { count, positions, colours, scales, rotations, opacities };
}

// Spherical-harmonics DC-term constant used by the standard 3D Gaussian
// Splatting PLY format (official inria/gsplat/nerfstudio exports) to convert
// the stored f_dc_* coefficients into an RGB color.
const SH_C0 = 0.28209479177387814;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

const PLY_TYPE_SIZES = {
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
  uchar: 1,
  uint8: 1,
  char: 1,
  int8: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
};

// Parses a standard 3D Gaussian Splatting .ply (the format written by the
// official training repo, gsplat, nerfstudio splatfacto, Postshot, etc.) so a
// model trained OUTSIDE this app can be dropped straight into the viewer.
// Unlike `parseGaussianPly` above (which only understands this app's own
// fixed 14-float COLMAP-trainer layout), this reads the header to find each
// property's byte offset, so it tolerates extra fields (normals, higher-order
// spherical-harmonic f_rest_* coefficients) that real trainers include.
function parseGaussianPlyGeneric(buffer) {
  const bytes = new Uint8Array(buffer);
  const headerBytes = new Uint8Array(
    buffer,
    0,
    Math.min(bytes.length, 4 * 1024 * 1024),
  );
  const headerText = new TextDecoder().decode(headerBytes);
  const marker = "end_header\n";
  const headerEnd = headerText.indexOf(marker);
  if (headerEnd < 0)
    throw new Error("Invalid PLY header — no end_header found.");
  const header = headerText.slice(0, headerEnd);
  const lines = header
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const formatLine = lines.find((line) => line.startsWith("format"));
  if (!formatLine || !formatLine.includes("binary_little_endian")) {
    throw new Error(
      "Only binary_little_endian Gaussian PLY files are supported.",
    );
  }

  const vertexLine = lines.find((line) => line.startsWith("element vertex"));
  const count = Number(vertexLine?.split(/\s+/)[2]);
  if (!count) throw new Error("PLY file has no vertices.");

  // Collect only the properties belonging to the "vertex" element — a PLY can
  // declare further elements (e.g. "face") afterward that we don't care about.
  const properties = [];
  let inVertexElement = false;
  for (const line of lines) {
    if (line.startsWith("element vertex")) {
      inVertexElement = true;
      continue;
    }
    if (line.startsWith("element")) {
      inVertexElement = false;
      continue;
    }
    if (inVertexElement && line.startsWith("property")) {
      const parts = line.split(/\s+/);
      properties.push({ type: parts[1], name: parts[2] });
    }
  }
  if (!properties.length) throw new Error("PLY file has no vertex properties.");

  let stride = 0;
  const offsetByName = {};
  for (const prop of properties) {
    const size = PLY_TYPE_SIZES[prop.type];
    if (!size) throw new Error(`Unsupported PLY property type: ${prop.type}`);
    offsetByName[prop.name] = { offset: stride, type: prop.type };
    stride += size;
  }

  for (const key of ["x", "y", "z"]) {
    if (!(key in offsetByName))
      throw new Error(`PLY file is missing required property "${key}".`);
  }
  const hasGaussianFields = [
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ].every((key) => key in offsetByName);
  if (!hasGaussianFields) {
    throw new Error(
      "PLY file does not contain Gaussian splat attributes (opacity/scale/rot).",
    );
  }
  const hasDc = ["f_dc_0", "f_dc_1", "f_dc_2"].every(
    (key) => key in offsetByName,
  );

  const data = new DataView(buffer, headerEnd + marker.length);
  const readFloat = (rowOffset, name) => {
    const prop = offsetByName[name];
    const at = rowOffset + prop.offset;
    switch (prop.type) {
      case "float":
      case "float32":
        return data.getFloat32(at, true);
      case "double":
      case "float64":
        return data.getFloat64(at, true);
      case "uchar":
      case "uint8":
        return data.getUint8(at);
      case "char":
      case "int8":
        return data.getInt8(at);
      case "short":
        return data.getInt16(at, true);
      case "ushort":
        return data.getUint16(at, true);
      case "int":
        return data.getInt32(at, true);
      case "uint":
        return data.getUint32(at, true);
      default:
        return 0;
    }
  };

  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const opacities = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const rowOffset = index * stride;
    positions[index * 3] = readFloat(rowOffset, "x");
    positions[index * 3 + 1] = readFloat(rowOffset, "y");
    positions[index * 3 + 2] = readFloat(rowOffset, "z");

    if (hasDc) {
      colours[index * 3] = Math.max(
        0,
        Math.min(1, 0.5 + SH_C0 * readFloat(rowOffset, "f_dc_0")),
      );
      colours[index * 3 + 1] = Math.max(
        0,
        Math.min(1, 0.5 + SH_C0 * readFloat(rowOffset, "f_dc_1")),
      );
      colours[index * 3 + 2] = Math.max(
        0,
        Math.min(1, 0.5 + SH_C0 * readFloat(rowOffset, "f_dc_2")),
      );
    } else {
      colours[index * 3] =
        colours[index * 3 + 1] =
        colours[index * 3 + 2] =
          0.7;
    }

    // Real trainers store the pre-activation opacity/scale (a sigmoid/exp is
    // applied at render time), unlike this app's own trainer which bakes the
    // activation in before writing — see `parseGaussianPly` above.
    opacities[index] = sigmoid(readFloat(rowOffset, "opacity"));
    scales[index * 3] = Math.exp(readFloat(rowOffset, "scale_0"));
    scales[index * 3 + 1] = Math.exp(readFloat(rowOffset, "scale_1"));
    scales[index * 3 + 2] = Math.exp(readFloat(rowOffset, "scale_2"));

    const qw = readFloat(rowOffset, "rot_0");
    const qx = readFloat(rowOffset, "rot_1");
    const qy = readFloat(rowOffset, "rot_2");
    const qz = readFloat(rowOffset, "rot_3");
    const qlen = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz) || 1;
    rotations[index * 4] = qx / qlen;
    rotations[index * 4 + 1] = qy / qlen;
    rotations[index * 4 + 2] = qz / qlen;
    rotations[index * 4 + 3] = qw / qlen;
  }

  return { count, positions, colours, scales, rotations, opacities };
}

function createGaussianObject(model) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(model.positions, 3),
  );
  geometry.setAttribute("color", new THREE.BufferAttribute(model.colours, 3));
  geometry.setAttribute("aScale", new THREE.BufferAttribute(model.scales, 3));
  geometry.setAttribute(
    "aRotation",
    new THREE.BufferAttribute(model.rotations, 4),
  );
  geometry.setAttribute(
    "aOpacity",
    new THREE.BufferAttribute(model.opacities, 1),
  );
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uFocal: { value: new THREE.Vector2(1000, 1000) },
    },
  });
  const object = new THREE.Points(geometry, material);
  object.name = "Trained 3D Gaussian Splatting model";
  object.renderOrder = 2;
  object.userData.pointCount = model.count;
  attachDepthSorting(object, material);
  return object;
}

export default function useGaussianSplatting(sceneData, modelData, props) {
  const { sceneRef, sceneReady, cameraRef, controlsRef } = sceneData;
  const { pcModel } = modelData;
  const {
    gaussianPointFile,
    gaussianCamerasFile,
    gaussianPlyFile,
    cameraPositionsFile,
    cameraImages = [],
  } = props;
  const groupRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const [error, setError] = useState(null);

  const removeSplats = useCallback(() => {
    const group = groupRef.current;
    if (!group) return;
    group.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    sceneRef.current?.remove(group);
    groupRef.current = null;
    setPointCount(0);
  }, [sceneRef]);

  const buildSplats = useCallback(async () => {
    if (
      !sceneRef.current ||
      !gaussianPointFile ||
      !gaussianCamerasFile ||
      !cameraPositionsFile ||
      !cameraImages.length
    ) {
      const message =
        "Upload cameras.txt, images.txt, points3d.txt, and the matching construction images.";
      setError(message);
      throw new Error(message);
    }
    setIsLoading(true);
    setError(null);
    try {
      removeSplats();
      const zip = new JSZip();
      await addImages(zip, cameraImages);
      const form = new FormData();
      form.append(
        "cameras",
        new Blob([await readSource(gaussianCamerasFile)], {
          type: "text/plain",
        }),
        "cameras.txt",
      );
      form.append(
        "images_txt",
        new Blob([await readSource(cameraPositionsFile)], {
          type: "text/plain",
        }),
        "images.txt",
      );
      form.append(
        "points",
        new Blob([await readSource(gaussianPointFile)], { type: "text/plain" }),
        "points3d.txt",
      );
      form.append(
        "images",
        await zip.generateAsync({ type: "blob" }),
        "images.zip",
      );
      form.append("iterations", "120");
      const response = await API.post("processing/gaussian/train/", form, {
        timeout: 0,
      });
      const plyResponse = await fetch(response.data.url);
      if (!plyResponse.ok)
        throw new Error("The trained Gaussian model could not be downloaded.");
      const object = createGaussianObject(
        parseGaussianPly(await plyResponse.arrayBuffer()),
      );
      const group = new THREE.Group();
      group.name = "COLMAP trained Gaussian Splatting";
      group.add(object);
      if (pcModel) {
        group.position.copy(pcModel.position);
        group.quaternion.copy(pcModel.quaternion);
        group.scale.copy(pcModel.scale);
      }
      sceneRef.current.add(group);
      groupRef.current = group;
      setPointCount(object.userData.pointCount);
      setIsVisible(true);
      return group;
    } catch (buildError) {
      const serverError = buildError.response?.data?.error;
      setError(
        serverError || buildError.message || "Could not train Gaussian splats.",
      );
      setIsVisible(false);
      throw buildError;
    } finally {
      setIsLoading(false);
    }
  }, [
    cameraImages,
    cameraPositionsFile,
    gaussianCamerasFile,
    gaussianPointFile,
    pcModel,
    removeSplats,
    sceneRef,
  ]);

  // Frame the camera on whatever was just loaded — an independently trained
  // model has its own coordinate frame and may sit far outside the current
  // view, so without this the splats can load successfully but be invisible.
  const frameCameraOn = useCallback(
    (object) => {
      const cam = cameraRef?.current;
      const ctrl = controlsRef?.current;
      if (!cam || !ctrl) return;
      const sphere = new THREE.Box3()
        .setFromObject(object)
        .getBoundingSphere(new THREE.Sphere());
      if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
      const dist = sphere.radius * 2.5;
      ctrl.target.copy(sphere.center);
      cam.position.set(
        sphere.center.x + dist,
        sphere.center.y + dist * 0.6,
        sphere.center.z + dist,
      );
      cam.near = Math.max(0.01, dist / 1000);
      cam.far = Math.max(cam.far, dist * 20);
      cam.updateProjectionMatrix();
      cam.lookAt(sphere.center);
      ctrl.update();
    },
    [cameraRef, controlsRef],
  );

  // Load an already-trained Gaussian .ply straight from disk — no server
  // round-trip. Used when the user supplies their own trained model instead
  // of the COLMAP-files-in/train-on-the-server flow above.
  const loadSplatsFromFile = useCallback(
    async (file) => {
      if (!sceneRef.current || !file) {
        const message = "Select a trained Gaussian .ply file first.";
        setError(message);
        throw new Error(message);
      }
      setIsLoading(true);
      setError(null);
      try {
        removeSplats();
        const buffer = await file.arrayBuffer();
        const object = createGaussianObject(parseGaussianPlyGeneric(buffer));
        const group = new THREE.Group();
        group.name = "Uploaded Gaussian Splatting model";
        group.add(object);
        sceneRef.current.add(group);
        groupRef.current = group;
        setPointCount(object.userData.pointCount);
        setIsVisible(true);
        frameCameraOn(group);
        return group;
      } catch (buildError) {
        setError(buildError.message || "Could not load the Gaussian PLY file.");
        setIsVisible(false);
        throw buildError;
      } finally {
        setIsLoading(false);
      }
    },
    [frameCameraOn, removeSplats, sceneRef],
  );

  const toggleGaussianSplatting = useCallback(async () => {
    if (isVisible) {
      removeSplats();
      setIsVisible(false);
      return false;
    }
    try {
      if (gaussianPlyFile) {
        await loadSplatsFromFile(gaussianPlyFile);
      } else {
        await buildSplats();
      }
      return true;
    } catch {
      return false;
    }
  }, [
    buildSplats,
    gaussianPlyFile,
    isVisible,
    loadSplatsFromFile,
    removeSplats,
  ]);

  useEffect(() => {
    if (!sceneReady) return undefined;
    removeSplats();
    setIsVisible(false);
    setError(null);
    return undefined;
  }, [
    gaussianPointFile,
    gaussianCamerasFile,
    gaussianPlyFile,
    cameraPositionsFile,
    sceneReady,
    removeSplats,
  ]);
  useEffect(() => () => removeSplats(), [removeSplats]);

  return {
    toggleGaussianSplatting,
    isGaussianVisible: isVisible,
    isGaussianLoading: isLoading,
    gaussianPointCount: pointCount,
    gaussianError: error,
  };
}