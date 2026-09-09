import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

const MAX_POINTS = 180000;
const MAX_IMAGE_POINTS = 60000;

const SPLAT_VERTEX_SHADER = `
  attribute float aSize;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * 300.0 / max(-mvPosition.z, 0.1), 1.5, 28.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SPLAT_FRAGMENT_SHADER = `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float gaussian = exp(-dot(p, p) * 8.0);
    if (gaussian < 0.02) discard;
    gl_FragColor = vec4(vColor, gaussian * 0.82);
  }
`;

async function readText(source) {
  if (!source) return "";
  if (typeof source.text === "function") return source.text();
  if (source instanceof Blob) return source.text();
  if (source.url) {
    const response = await fetch(source.url);
    if (!response.ok)
      throw new Error(`Unable to read ${source.name || "file"}.`);
    return response.text();
  }
  return "";
}

function parsePoint3D(text) {
  const points = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;

    const values = parts.slice(1, 8).map(Number);
    if (values.some((value) => !Number.isFinite(value))) continue;
    points.push({
      x: values[0],
      y: values[1],
      z: values[2],
      r: values[3],
      g: values[4],
      b: values[5],
      error: Math.max(0, values[6]),
    });
    if (points.length >= MAX_POINTS) break;
  }

  if (!points.length)
    throw new Error("No 3D points were found in point3d.txt.");
  return points;
}

function createSplatObject(points) {
  const center = new THREE.Vector3();
  points.forEach((point) =>
    center.add(new THREE.Vector3(point.x, point.y, point.z)),
  );
  center.multiplyScalar(1 / points.length);

  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  const sizes = new Float32Array(points.length);
  const bounds = new THREE.Box3();

  points.forEach((point, index) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    bounds.expandByPoint(new THREE.Vector3(x, y, z));

    colors[index * 3] = point.r / 255;
    colors[index * 3 + 1] = point.g / 255;
    colors[index * 3 + 2] = point.b / 255;
    sizes[index] = 0.015;
  });

  const span = Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1);
  const splatSize = Math.max(span * 0.0035, 0.002);
  sizes.fill(splatSize);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    vertexShader: SPLAT_VERTEX_SHADER,
    fragmentShader: SPLAT_FRAGMENT_SHADER,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const splats = new THREE.Points(geometry, material);
  splats.name = "Gaussian Splat Preview";
  splats.renderOrder = 2;
  splats.userData.pointCount = points.length;
  return { splats };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Unable to read uploaded image: ${url}`));
    image.src = url;
  });
}

async function createImageSplatObject(images) {
  const points = [];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser cannot sample uploaded images.");

  for (const item of images) {
    if (points.length >= MAX_IMAGE_POINTS) break;
    const image = await loadImage(item.image);
    const sampleWidth = Math.min(96, image.width || 1);
    const sampleHeight = Math.max(
      1,
      Math.round(sampleWidth * (image.height / Math.max(image.width, 1))),
    );
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const imageIndex = images.indexOf(item);
    const angle = (imageIndex / Math.max(images.length, 1)) * Math.PI * 2;
    const radius = 1.8;
    const centerX = Math.cos(angle) * radius;
    const centerZ = Math.sin(angle) * radius;
    const planeWidth = 2.4;
    const planeHeight = planeWidth * (sampleHeight / sampleWidth);

    for (let y = 0; y < sampleHeight && points.length < MAX_IMAGE_POINTS; y++) {
      for (
        let x = 0;
        x < sampleWidth && points.length < MAX_IMAGE_POINTS;
        x++
      ) {
        const pixelIndex = (y * sampleWidth + x) * 4;
        if (pixels[pixelIndex + 3] < 20) continue;
        const localX = (x / Math.max(sampleWidth - 1, 1) - 0.5) * planeWidth;
        const localY = (0.5 - y / Math.max(sampleHeight - 1, 1)) * planeHeight;
        points.push({
          x: centerX + localX * Math.cos(angle),
          y: localY,
          z: centerZ + localX * Math.sin(angle),
          r: pixels[pixelIndex],
          g: pixels[pixelIndex + 1],
          b: pixels[pixelIndex + 2],
          error: 0,
        });
      }
    }
  }

  if (!points.length)
    throw new Error("No pixels were found in uploaded images.");
  return createSplatObject(points);
}

export default function useGaussianSplatting(sceneData, modelData, props) {
  const { sceneRef, sceneReady } = sceneData;
  const { pcModel } = modelData;
  const { gaussianPointFile, gaussianCamerasFile, cameraImages = [] } = props;
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
    if (!sceneRef.current || (!gaussianPointFile && !cameraImages.length)) {
      throw new Error("Upload project images or choose a point3d.txt file.");
    }

    setIsLoading(true);
    setError(null);
    try {
      removeSplats();
      const group = new THREE.Group();
      group.name = "Image-derived Gaussian Splat Preview";
      let totalPointCount = 0;
      if (gaussianPointFile) {
        const points = parsePoint3D(await readText(gaussianPointFile));
        const { splats } = createSplatObject(points);
        group.add(splats);
        totalPointCount += points.length;
      }
      if (cameraImages.length) {
        const { splats } = await createImageSplatObject(cameraImages);
        group.add(splats);
        totalPointCount += splats.userData.pointCount;
      }
      group.position.set(0, 0, 0);

      // Keep the preview in the same transform frame as the loaded cloud.
      if (pcModel) {
        group.position.add(pcModel.position);
        group.quaternion.copy(pcModel.quaternion);
        group.scale.copy(pcModel.scale);
      }
      sceneRef.current.add(group);
      groupRef.current = group;
      setPointCount(totalPointCount);
      setIsVisible(true);
      return group;
    } catch (buildError) {
      setError(buildError.message || "Could not build Gaussian splats.");
      setIsVisible(false);
      throw buildError;
    } finally {
      setIsLoading(false);
    }
  }, [gaussianPointFile, pcModel, removeSplats, sceneRef]);

  const toggleGaussianSplatting = useCallback(async () => {
    if (isVisible) {
      removeSplats();
      setIsVisible(false);
      return false;
    }
    try {
      await buildSplats();
      return true;
    } catch {
      return false;
    }
  }, [buildSplats, isVisible, removeSplats]);

  useEffect(() => {
    if (!sceneReady) return undefined;
    removeSplats();
    setIsVisible(false);
    setError(null);
    return undefined;
  }, [gaussianPointFile, gaussianCamerasFile, sceneReady, removeSplats]);

  useEffect(() => () => removeSplats(), [removeSplats]);

  return {
    toggleGaussianSplatting,
    isGaussianVisible: isVisible,
    isGaussianLoading: isLoading,
    gaussianPointCount: pointCount,
    gaussianError: error,
  };
}