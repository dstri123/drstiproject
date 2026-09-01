import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  MapPin,
  Save,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  Scissors,
  SlidersHorizontal,
  Loader2,
  Route,
  Table2,
  X,
} from "lucide-react";
import * as THREE from "three";
import { useToast } from "../../../../components/ToastContainer";
import useSceneSetup from "./useSceneSetup";
import useModelLoader from "./useModelLoader";
import usePicking from "./usePicking";
import useAlignment from "./useAlignment";
import useOverlap from "./useOverlap";
import usePointCloudSAMSegmentation from "./usePointCloudSAMSegmentation";
import useCameraSystem from "./useCameraSystem";
import CameraPreviewPanel from "./CameraPreviewPanel";
import useTransformControls from "./useTransformControls";
import useObjectSelection from "./useObjectSelection";
import BlenderViewportGizmo from "../gizmo/BlenderViewportGizmo";
import CompassRing from "../gizmo/CompassRing";
import useBlenderTransformGizmo from "../gizmo/useBlenderTransformGizmo";
import SectionBoxManager from "./sectionbox/SectionBoxManager";
import ClipBar from "./ClipBar";
import LeafletMap from "./LeafletMap";
import API from "../../../../api/axios";

// Same-origin-ish backend proxy for OSM tiles, so tile requests go through
// our own API instead of directly to the OSM CDN. {z}/{x}/{y} are filled by
// Leaflet.
const OSM_TILE_PROXY =
  API.defaults.baseURL.replace(/\/$/, "") +
  "/processing/osm-tile/{z}/{x}/{y}.png";

// A plain, borderless icon button matching the left IconToolbar's flat style
// (no card background/shadow) — used for the Adjust Model / Section Box
// toggles so they read as lightweight, inline tools rather than floating
// cards.
function FlatToolbarButton({ icon, label, onClick, active = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      {active && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 2,
            height: 18,
            background: "#3b82f6",
            borderRadius: "0 2px 2px 0",
          }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={label}
        aria-label={label}
        style={{
          width: "100%",
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: active
            ? "rgba(59,130,246,0.07)"
            : hovered
              ? "rgba(0,0,0,0.03)"
              : "transparent",
          border: "none",
          cursor: "pointer",
          color: active ? "#3b82f6" : hovered ? "#4b5563" : "#c4cad4",
          transition: "color 0.12s ease, background 0.12s ease",
          padding: 0,
          borderRadius: 0,
          pointerEvents: "auto",
        }}
      >
        {icon}
      </button>
    </div>
  );
}

// Thin separator between toolbar groups.
function ToolbarDivider() {
  return (
    <div
      style={{
        width: 28,
        height: 1,
        background: "rgba(15, 23, 42, 0.12)",
        margin: "2px 0",
      }}
    />
  );
}

function ThreeViewer({
  onManualCamerasChange,
  onModelDataChange,
  selectedObject,
  setSelectedObject,
  onModelsChanged,
  onSavePosition,
  onSaveGeo,
  saveStatus,
  ...props
}) {
  const { error, info, success } = useToast();
  const mountRef = useRef();
  const mapMeshRef = useRef(null);
  const sectionPlaneRef = useRef(null);
  const [geoMapOpen, setGeoMapOpen] = useState(false);
  const [geoLocation, setGeoLocation] = useState({
    latitude: "12.9716",
    longitude: "77.5946",
    altitude: "0",
    scale: "1",
    // Closer default zoom so the map ground is ~700 m (not ~2.8 km) and roads
    // around the building are crisp and at a sensible scale.
    zoom: "18",
  });

  // Seed the map with the project's creation-time coordinates once they load.
  // Only override the placeholder default — don't stomp on user edits.
  const geoSeededRef = useRef(false);
  useEffect(() => {
    if (geoSeededRef.current) return;
    const lat = props.initialLatitude;
    const lng = props.initialLongitude;
    if (lat == null || lng == null || lat === "" || lng === "") return;
    geoSeededRef.current = true;
    setGeoLocation((prev) => ({
      ...prev,
      latitude: String(lat),
      longitude: String(lng),
      altitude:
        props.initialAltitude != null && props.initialAltitude !== ""
          ? String(props.initialAltitude)
          : prev.altitude,
      scale:
        props.initialScale != null && props.initialScale !== ""
          ? String(props.initialScale)
          : prev.scale,
      zoom:
        props.initialZoom != null && props.initialZoom !== ""
          ? String(props.initialZoom)
          : prev.zoom,
    }));
    if (
      props.initialFootprintArea != null &&
      props.initialFootprintArea !== ""
    ) {
      setFootprintArea(Number(props.initialFootprintArea));
    }
  }, [
    props.initialLatitude,
    props.initialLongitude,
    props.initialAltitude,
    props.initialScale,
    props.initialZoom,
    props.initialFootprintArea,
  ]);

  const [sectionBoxActive, setSectionBoxActive] = useState(false);

  const sceneData = useSceneSetup(mountRef);

  const MAPBOX_TOKEN =
    process.env.REACT_APP_MAPBOX_ACCESS_TOKEN ||
    localStorage.getItem("MAPBOX_ACCESS_TOKEN") ||
    localStorage.getItem("MAPBOX_TOKEN");
  const MAPBOX_STYLE = "streets-v11";
  const useMapbox = Boolean(MAPBOX_TOKEN);

  const getOpenStreetMapIframeUrl = (lat, lng, zoom) => {
    const z = parseInt(zoom, 10) || 16;
    const clat = Number.isFinite(Number(lat)) ? Number(lat) : 0;
    const clng = Number.isFinite(Number(lng)) ? Number(lng) : 0;
    // The main openstreetmap.org page sends X-Frame-Options and refuses to be
    // embedded in an <iframe> ("refused to connect"). The /export/embed.html
    // endpoint is the supported embeddable map and CAN be framed. It needs a
    // bbox, which we derive from the centre + zoom (smaller span = higher zoom).
    const span = (360 / Math.pow(2, z)) * 1.5;
    const latSpan = span * 0.6;
    const minLon = clng - span / 2;
    const maxLon = clng + span / 2;
    const minLat = clat - latSpan / 2;
    const maxLat = clat + latSpan / 2;
    return (
      `https://www.openstreetmap.org/export/embed.html` +
      `?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}` +
      `&layer=mapnik&marker=${clat}%2C${clng}`
    );
  };

  const getMapboxStaticUrl = (lat, lng, zoom, size = 1200) => {
    if (!MAPBOX_TOKEN) return null;
    const z = parseInt(zoom, 10) || 16;
    const clat = Number.isFinite(Number(lat)) ? lat : 0;
    const clng = Number.isFinite(Number(lng)) ? lng : 0;
    return `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLE}/static/${clng},${clat},${z}/${size}x${size}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`;
  };

  // State to hold the generated map image used as a texture (data URL or remote image URL)
  const [geoMapImageUrl, setGeoMapImageUrl] = useState(null);
  // Real-world width (metres) covered by the map texture, so the 3D ground
  // plane is sized to true scale and the BIM/point-cloud footprint matches the
  // roads underneath. Updated whenever lat/zoom change.
  const [groundMeters, setGroundMeters] = useState(120);
  // Approximate footprint area (m²) of the placed BIM/point-cloud, shown in the
  // panel so users can sense the building size relative to the map.
  const [footprintArea, setFootprintArea] = useState(null);
  // Once the user edits the footprint by hand, stop auto-overwriting it on
  // Place Models — their entered value wins.
  const footprintEditedRef = useRef(false);
  // Each model's original matrix, captured once so the Scale slider multiplies
  // the BIM + point cloud together about one shared pivot (they stay locked as
  // a single unit), and can be reset to 1×.
  const scaleBaseRef = useRef(new Map());
  const scalePivotRef = useRef(null);
  // Set once BIM + point cloud are aligned to each other: the shared "common
  // point" they pivot around as a single rigid unit for scale/rotate/geo place.
  const [alignmentLocked, setAlignmentLocked] = useState(false);
  const commonPivotRef = useRef(null);
  const handleAlignmentLocked = useCallback((pivot) => {
    commonPivotRef.current = pivot;
    // Re-capture scale bases so subsequent scaling pivots around the new
    // aligned common point.
    scaleBaseRef.current = new Map();
    scalePivotRef.current = pivot.clone();
    setAlignmentLocked(true);
  }, []);

  // Web-Mercator ground resolution: metres represented by one texture pixel at
  // a given latitude/zoom. Times the texture pixel size = real-world extent.
  const mapMetersForTexture = (lat, zoom, texPx = 1200) => {
    // Clamp to 19 so the plane size matches the clamped texture zoom.
    const z = Math.min(parseInt(zoom, 10) || 16, 19);
    const latRad = ((Number(lat) || 0) * Math.PI) / 180;
    const metersPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, z);
    return texPx * metersPerPixel;
  };
  const [geoMapIframeUrl, setGeoMapIframeUrl] = useState(() => {
    const lat = parseFloat(geoLocation.latitude);
    const lng = parseFloat(geoLocation.longitude);
    const zoom = parseInt(geoLocation.zoom, 10) || 16;
    if (useMapbox) {
      return (
        getMapboxStaticUrl(lat, lng, zoom, 800) ||
        getOpenStreetMapIframeUrl(lat, lng, zoom)
      );
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return getOpenStreetMapIframeUrl(0, 0, 1);
    }
    return getOpenStreetMapIframeUrl(lat, lng, zoom);
  });

  // Generate a stitched map image by fetching OSM tiles and drawing them into a canvas.
  // This avoids relying on the staticmap.openstreetmap.de service.
  const generateStitchedMapDataUrl = async (lat, lon, zoom, size = 1200) => {
    // OSM tiles only exist up to zoom 19 — clamp so a higher value (e.g. a
    // saved 20) still renders instead of leaving the ground blank.
    const z = Math.min(parseInt(zoom, 10) || 16, 19);
    const clat = Number.isFinite(Number(lat)) ? Number(lat) : 0;
    const clng = Number.isFinite(Number(lon)) ? Number(lon) : 0;

    // helper: convert lat/lon to tile coords
    const lon2tile = (lon, z) =>
      Math.floor(((lon + 180) / 360) * Math.pow(2, z));
    const lat2tile = (lat, z) => {
      const latRad = (lat * Math.PI) / 180;
      return Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
          2) *
          Math.pow(2, z),
      );
    };

    try {
      const tileSize = 256;
      // number of tiles to fetch across (square). Keep odd to center on a tile.
      const tilesAcross = Math.max(1, Math.min(7, Math.ceil(size / tileSize)));
      const half = Math.floor(tilesAcross / 2);

      const centerX = lon2tile(clng, z);
      const centerY = lat2tile(clat, z);

      const canvas = document.createElement("canvas");
      canvas.width = tilesAcross * tileSize;
      canvas.height = tilesAcross * tileSize;
      const ctx = canvas.getContext("2d");

      const tilePromises = [];
      for (let dx = -half; dx <= half; dx++) {
        for (let dy = -half; dy <= half; dy++) {
          const tx = centerX + dx;
          const ty = centerY + dy;
          const px = (dx + half) * tileSize;
          const py = (dy + half) * tileSize;
          // Fetch through our backend proxy: direct OSM tiles are blocked by
          // the viewer's cross-origin isolation (COEP), and the proxy adds the
          // CORP header + caches tiles so the canvas stays untainted.
          const url = OSM_TILE_PROXY.replace("{z}", z)
            .replace("{x}", tx)
            .replace("{y}", ty);
          const p = fetch(url, { mode: "cors" })
            .then((r) => {
              if (!r.ok)
                throw new Error(`Tile ${z}/${tx}/${ty} returned ${r.status}`);
              return r.blob();
            })
            .then((blob) => createImageBitmap(blob))
            .then((imgBitmap) => {
              try {
                ctx.drawImage(imgBitmap, px, py, tileSize, tileSize);
              } catch (e) {
                // ignore draw errors per tile
              }
            })
            .catch(() => {
              // draw a light neutral background for a missing tile (not dark,
              // so gaps don't make the whole map look black/blue).
              ctx.fillStyle = "#e5e7eb";
              ctx.fillRect(px, py, tileSize, tileSize);
            });
          tilePromises.push(p);
        }
      }

      await Promise.all(tilePromises);

      // Scale/crop to requested size (centered)
      if (canvas.width !== size || canvas.height !== size) {
        const out = document.createElement("canvas");
        out.width = size;
        out.height = size;
        const outCtx = out.getContext("2d");
        const sx = (canvas.width - size) / 2;
        const sy = (canvas.height - size) / 2;
        outCtx.drawImage(canvas, sx, sy, size, size, 0, 0, size, size);
        return out.toDataURL("image/png");
      }

      return canvas.toDataURL("image/png");
    } catch (e) {
      return null;
    }
  };

  // Recompute the map texture centred on the pin, so the model (placed at the
  // scene centre) always sits exactly at the pin location on the map.
  useEffect(() => {
    const lat = parseFloat(geoLocation.latitude);
    const lng = parseFloat(geoLocation.longitude);
    const zoom = parseInt(geoLocation.zoom, 10) || 16;

    // Larger texture (more tiles) covers more ground so zooming out still
    // shows map instead of empty background beyond the plane edge.
    const TEX_PX = 1792;
    // Keep the 3D ground plane sized to the real extent of the map texture.
    setGroundMeters(mapMetersForTexture(lat, zoom, TEX_PX));

    let cancelled = false;

    (async () => {
      if (useMapbox) {
        const previewUrl =
          getMapboxStaticUrl(lat || 0, lng || 0, zoom, 800) ||
          getOpenStreetMapIframeUrl(lat || 0, lng || 0, zoom);
        const imageUrl = getMapboxStaticUrl(lat || 0, lng || 0, zoom, 1200);
        if (!cancelled) {
          setGeoMapIframeUrl(previewUrl);
          setGeoMapImageUrl(imageUrl);
        }
        return;
      }

      setGeoMapIframeUrl(getOpenStreetMapIframeUrl(lat || 0, lng || 0, zoom));
      try {
        const dataUrl = await generateStitchedMapDataUrl(
          lat,
          lng,
          zoom,
          TEX_PX,
        );
        if (!cancelled && dataUrl) {
          setGeoMapImageUrl(dataUrl);
        }
        // fallback: if tile stitching failed, use staticmap service as a last resort
        if (!cancelled && !dataUrl) {
          const fallback = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat || 0},${lng || 0}&zoom=${zoom}&size=1200x1200&maptype=mapnik`;
          setGeoMapImageUrl(fallback);
        }
      } catch (e) {
        if (!cancelled) {
          const fallback = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat || 0},${lng || 0}&zoom=${zoom}&size=1200x1200&maptype=mapnik`;
          setGeoMapImageUrl(fallback);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    geoLocation.latitude,
    geoLocation.longitude,
    geoLocation.zoom,
    useMapbox,
  ]);

  const modelData = useModelLoader(sceneData, {
    ...props,
    setBimElementCount: props.setBimElementCount,
    onError: error,
  });

  // ── Section box (blue draggable crop box) + X/Y/Z slider bar ──────────────
  // Both drive ONE SectionBoxManager so the box and the sliders stay in sync.
  const sectionManagerRef = useRef(null);
  const [clipState, setClipState] = useState(null); // { bounds, clip }

  useEffect(() => {
    const scene = sceneData.sceneRef?.current;
    const camera = sceneData.cameraRef?.current;
    const renderer = sceneData.rendererRef?.current;
    const dom = renderer?.domElement;
    if (!scene || !camera || !renderer) return;

    sectionManagerRef.current = new SectionBoxManager({
      scene,
      camera,
      renderer,
      domElement: dom,
      objects: [modelData.bimModel, modelData.pcModel],
      onExtentsChange: (extents) => setClipState(extents),
    });

    return () => {
      try {
        sectionManagerRef.current?.dispose();
      } catch (e) {}
      sectionManagerRef.current = null;
    };
  }, [
    sceneData.sceneRef,
    sceneData.cameraRef,
    sceneData.rendererRef,
    modelData.bimModel,
    modelData.pcModel,
  ]);

  // Whether the visual crop box (edges/handles) is shown. Clipping stays on
  // regardless — this just hides the blue box for a clean view.
  const [boxVisible, setBoxVisible] = useState(true);

  // Adapter so <ClipBar> can drive the section box manager directly.
  const clipData = {
    bounds: clipState?.bounds || null,
    clip: clipState?.clip || null,
    setAxisClip: (axis, which, value) =>
      sectionManagerRef.current?.setAxis(axis, which, value),
    reset: () => sectionManagerRef.current?.reset(),
    boxVisible,
    setBoxVisible: (v) => {
      setBoxVisible(v);
      sectionManagerRef.current?.setBoxVisible(v);
    },
  };

  // Toggle the section box (blue crop box + X/Y/Z sliders). Shared by the
  // on-canvas "SB" button and the sidebar "Enable/Disable Section Box" button
  // (which calls window.toggleSectionBox).
  const toggleSectionBox = useCallback(() => {
    const mgr = sectionManagerRef.current;
    if (!mgr) return;
    setSectionBoxActive((active) => {
      if (active) mgr.disable();
      else mgr.enable();
      return !active;
    });
  }, []);

  useEffect(() => {
    window.toggleSectionBox = toggleSectionBox;
    return () => {
      delete window.toggleSectionBox;
    };
  }, [toggleSectionBox]);

  useEffect(() => {
    props.onSectionBoxChange?.({ enabled: sectionBoxActive, offset: 0 });
  }, [sectionBoxActive, props]);

  const applyGeoLocation = () => {
    try {
      const latitude = parseFloat(geoLocation.latitude);
      const longitude = parseFloat(geoLocation.longitude);
      const altitude = parseFloat(geoLocation.altitude) || 0;
      const scale = parseFloat(geoLocation.scale) || 1;

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        error("Enter valid latitude and longitude values.");
        return;
      }

      // Pull the models live from the scene each click so repeated placements
      // never act on a stale/missing reference (a cause of the button seeming
      // to "stop working" after the first use).
      const bimModel = modelData?.bimModel || null;
      const pcModel = modelData?.pcModel || null;
      if (!bimModel && !pcModel) {
        info("Load a BIM or PointCloud model before placing geolocation.");
        return;
      }

      // The map texture is centred on the pin, so the building goes to the scene
      // centre (X/Z = 0) — i.e. exactly under the pin. Altitude sets the height.
      const targetPosition = new THREE.Vector3(0, altitude, 0);

      // Treat BIM + point cloud as ONE group: compute their COMBINED bounding
      // box and move both by the SAME translation. This preserves their relative
      // geo-alignment (they stay locked together) instead of centring each model
      // separately on the pin, which would pull them apart.
      const groupBox = new THREE.Box3();
      let haveBox = false;
      for (const m of [bimModel, pcModel]) {
        if (!m) continue;
        groupBox.union(new THREE.Box3().setFromObject(m));
        haveBox = true;
      }
      if (!haveBox) return;

      const groupCenter = groupBox.getCenter(new THREE.Vector3());
      // Centre the group on the pin (X/Z) and rest its BASE on the map ground at
      // the given altitude (rather than burying half below the plane).
      const translation = new THREE.Vector3(
        targetPosition.x - groupCenter.x,
        altitude - groupBox.min.y,
        targetPosition.z - groupCenter.z,
      );
      const moveMatrix = new THREE.Matrix4().makeTranslation(
        translation.x,
        translation.y,
        translation.z,
      );
      if (bimModel) bimModel.applyMatrix4(moveMatrix);
      if (pcModel) pcModel.applyMatrix4(moveMatrix);

      // Footprint area = combined X–Z extent in m² (geometry assumed in metres).
      // Only auto-fill if the user hasn't typed their own value.
      if (!footprintEditedRef.current) {
        const size = groupBox.getSize(new THREE.Vector3());
        setFootprintArea(Math.round(Math.abs(size.x * size.z) * 100) / 100);
      }

      // Frame the camera on the building so it reads at a sensible scale against
      // the map (like a site-context view) instead of staying zoomed out on the
      // whole 2-3 km map plane where the building looks like a speck. This also
      // makes "Place Models" visibly do something after the pin is moved.
      const cam = sceneData.cameraRef?.current;
      const ctrls = sceneData.controlsRef?.current;
      if (cam && ctrls) {
        const placedBox = new THREE.Box3();
        if (bimModel) placedBox.union(new THREE.Box3().setFromObject(bimModel));
        if (pcModel) placedBox.union(new THREE.Box3().setFromObject(pcModel));
        const c = placedBox.getCenter(new THREE.Vector3());
        const sphere = placedBox.getBoundingSphere(new THREE.Sphere());
        const dist = Math.max(sphere.radius * 2.6, 20);
        ctrls.target.copy(c);
        cam.position.set(c.x + dist * 0.7, c.y + dist * 0.9, c.z + dist * 0.7);
        cam.near = Math.max(0.1, dist / 500);
        cam.far = Math.max(5000, dist * 50);
        cam.updateProjectionMatrix();
        cam.lookAt(c);
        ctrls.update();
      }

      // Persist the edited coordinates back to the project record so they
      // survive a reload and seed the panel next time it's opened.
      onSaveGeo?.({
        latitude,
        longitude,
        altitude,
        scale,
        zoom: parseInt(geoLocation.zoom, 10) || 16,
        footprint_area: footprintArea,
      });

      success(
        `Models placed at ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (alt ${altitude.toFixed(2)}).`,
      );
    } catch (err) {
      console.error("applyGeoLocation failed", err);
      error("Could not place models. See console for details.");
    }
  };

  // Reset the Map Location panel + restore the models to their pre-geo state
  // (captured base transforms), so the user can recover if a placement/scale
  // went wrong.
  const resetGeoLocation = () => {
    for (const m of [modelData?.bimModel, modelData?.pcModel]) {
      if (!m) continue;
      const base = scaleBaseRef.current.get(m);
      if (base) {
        base.decompose(m.position, m.quaternion, m.scale);
        m.updateMatrixWorld(true);
      }
    }
    scalePivotRef.current = null;
    footprintEditedRef.current = false;
    setFootprintArea(null);
    // Reset the editable fields back to the project's seeded values (or
    // sensible defaults), keeping the saved lat/lng.
    setGeoLocation((prev) => ({
      ...prev,
      altitude: "0",
      scale: "1",
    }));
    info("Map location reset.");
  };

  useEffect(() => {
    const scene = sceneData.sceneRef?.current;
    if (!scene || !geoMapOpen) return;

    const textureLoader = new THREE.TextureLoader();
    const url = geoMapImageUrl;
    // ensure cross-origin is allowed for external tile servers
    try {
      textureLoader.setCrossOrigin?.("anonymous");
    } catch (e) {
      // ignore if not supported
    }

    const loadTextureOntoMaterial = (material) => {
      if (!material) return;
      if (material.map) {
        try {
          material.map.dispose();
        } catch (e) {
          // ignore dispose errors
        }
      }
      material.map = null;
      material.color?.setHex?.(0xe5e7eb);
      material.opacity = 0.9;
      material.transparent = true;
      material.needsUpdate = true;

      // No image yet (still stitching tiles) — keep the light placeholder
      // rather than firing the loader with a null url, which would flash the
      // scary "Map unavailable" fallback on first open.
      if (!url) return;

      textureLoader.load(
        url,
        (tex) => {
          material.map = tex;
          material.opacity = 1;
          material.transparent = false;
          material.needsUpdate = true;
        },
        undefined,
        (err) => {
          try {
            const size = 512;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#e5e7eb";
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = "#6b7280";
            ctx.font = "20px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Map unavailable", size / 2, size / 2 - 10);
            ctx.font = "12px sans-serif";
            ctx.fillText("Unable to fetch tiles", size / 2, size / 2 + 18);
            const fallbackTex = new THREE.CanvasTexture(canvas);
            material.map = fallbackTex;
            material.opacity = 1;
            material.transparent = false;
            material.needsUpdate = true;
          } catch (e) {
            material.color.setHex(0x1f2937);
            material.opacity = 0.22;
            material.transparent = true;
            material.needsUpdate = true;
          }
          console.warn(
            "ThreeViewer: failed to load map texture, using fallback.",
            err,
          );
        },
      );
    };

    if (mapMeshRef.current) {
      loadTextureOntoMaterial(mapMeshRef.current.material);
      // Re-size the existing plane to the current real-world extent.
      try {
        mapMeshRef.current.geometry.dispose();
        mapMeshRef.current.geometry = new THREE.PlaneGeometry(
          groundMeters,
          groundMeters,
        );
      } catch (e) {
        // ignore resize errors
      }
      return;
    }

    // create plane with a safe placeholder material immediately so renderer never sees a null material
    const placeholderMaterial = new THREE.MeshBasicMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(groundMeters, groundMeters),
      placeholderMaterial,
    );

    loadTextureOntoMaterial(placeholderMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, -0.01, 0);
    // The map ground must not be selectable/pickable — clicking it should never
    // attach a transform gizmo or get treated as a model (which flashed blue).
    plane.raycast = () => {};
    plane.name = "__geo_map_ground";
    scene.add(plane);
    mapMeshRef.current = plane;

    return () => {
      if (mapMeshRef.current) {
        scene.remove(mapMeshRef.current);
        try {
          mapMeshRef.current.geometry.dispose();
          if (mapMeshRef.current.material) {
            if (mapMeshRef.current.material.map) {
              mapMeshRef.current.material.map.dispose();
            }
            mapMeshRef.current.material.dispose();
          }
        } catch (e) {
          // ignore dispose errors
        }
        mapMeshRef.current = null;
      }
    };
  }, [geoMapOpen, geoMapImageUrl, groundMeters, sceneData.sceneRef]);

  // ── Pass segmentation state up to App ────────────────────────────────────
  // ── Pass RANSAC segmentation state up to App ─────────────────────────────
  useEffect(() => {
    onModelDataChange?.({
      toggleSegmentation: modelData.toggleSegmentation,
      isSegmented: modelData.isSegmented,
      isSegmenting: modelData.isSegmenting,
      wasCompressed: modelData.wasCompressed,
    });
  }, [
    modelData.toggleSegmentation,
    modelData.isSegmented,
    modelData.isSegmenting,
    modelData.wasCompressed,
    onModelDataChange,
  ]);

  // Report the loaded model objects up to ViewerPage so "Save position" can
  // read their current transforms. Without this the parent never learns the
  // models exist and the Save handler silently bails out.
  useEffect(() => {
    onModelsChanged?.({
      bimModel: modelData.bimModel || null,
      pcModel: modelData.pcModel || null,
    });
  }, [modelData.bimModel, modelData.pcModel, onModelsChanged]);

  // ── Individual model selection (click-to-select + Blender gizmo) ──────────
  // ViewerPage does not currently own this state, so fall back to a local
  // copy when the parent doesn't pass selectedObject/setSelectedObject.
  const [localSelectedObject, setLocalSelectedObject] = useState(null);
  const activeSelectedObject =
    selectedObject !== undefined ? selectedObject : localSelectedObject;
  const setActiveSelectedObject = setSelectedObject || setLocalSelectedObject;

  const selectedLabel =
    activeSelectedObject === modelData.bimModel
      ? "BIM Model"
      : activeSelectedObject === modelData.pcModel
        ? "Point Cloud"
        : activeSelectedObject
          ? "Element"
          : null;

  const selectModel = useCallback(
    (model) => {
      setActiveSelectedObject((prev) => (prev === model ? null : model));
    },
    [setActiveSelectedObject],
  );

  // ── Grid toggle ────────────────────────────────────────────────────────────
  // Hidden by default (incl. during load) — the user turns it on via the grid
  // button when they want it.
  const [gridVisible, setGridVisible] = useState(false);
  const toggleGrid = useCallback(() => {
    setGridVisible((v) => !v);
  }, []);

  // Single source of truth for grid + axes visibility: shown only when the grid
  // toggle is on AND we're not in geo mode (where the map ground replaces it).
  useEffect(() => {
    const show = gridVisible && !geoMapOpen;
    if (sceneData.gridRef?.current) sceneData.gridRef.current.visible = show;
    if (sceneData.axesRef?.current) sceneData.axesRef.current.visible = show;
  }, [gridVisible, geoMapOpen, sceneData.gridRef, sceneData.axesRef]);

  // Live scale: resize the BIM + point cloud TOGETHER as one unit in real time
  // as the Scale slider moves. Both are scaled about a single shared pivot (the
  // combined centre at base scale) so their relative alignment is preserved —
  // they never drift apart.
  useEffect(() => {
    if (!geoMapOpen) return;
    const s = parseFloat(geoLocation.scale);
    if (!Number.isFinite(s) || s <= 0) return;
    const models = [modelData?.bimModel, modelData?.pcModel].filter(Boolean);
    if (!models.length) return;

    // Capture base matrices once (models at their base size).
    for (const m of models) {
      if (!scaleBaseRef.current.has(m)) {
        m.updateMatrixWorld(true);
        scaleBaseRef.current.set(m, m.matrix.clone());
      }
    }
    // Pivot: the locked alignment common point if available, else the combined
    // centre. Using the common point keeps BIM + cloud locked as one unit.
    if (scalePivotRef.current == null) {
      if (commonPivotRef.current) {
        scalePivotRef.current = commonPivotRef.current.clone();
      } else {
        const baseBox = new THREE.Box3();
        for (const m of models)
          baseBox.union(new THREE.Box3().setFromObject(m));
        scalePivotRef.current = baseBox.getCenter(new THREE.Vector3());
      }
    }

    const p = scalePivotRef.current;
    const T = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
    const Tinv = new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z);
    const S = new THREE.Matrix4().makeScale(s, s, s);
    const TS = new THREE.Matrix4().multiplyMatrices(T, S).multiply(Tinv);

    for (const m of models) {
      const base = scaleBaseRef.current.get(m);
      const next = new THREE.Matrix4().multiplyMatrices(TS, base);
      next.decompose(m.position, m.quaternion, m.scale);
      m.updateMatrixWorld(true);
    }

    // Re-seat the group's base on the map ground at the current altitude, so
    // scaling never leaves a vertical gap (model floating) or buries it.
    const seatBox = new THREE.Box3();
    for (const m of models) seatBox.union(new THREE.Box3().setFromObject(m));
    const alt = parseFloat(geoLocation.altitude) || 0;
    const dy = alt - seatBox.min.y;
    if (Number.isFinite(dy) && Math.abs(dy) > 1e-6) {
      for (const m of models) {
        m.position.y += dy;
        m.updateMatrixWorld(true);
      }
    }
  }, [geoLocation.scale, geoLocation.altitude, geoMapOpen, modelData]);

  // ── Per-model rotation ─────────────────────────────────────────────────────
  // Rotates a model around a world axis through its own bounding-box center,
  // so each model can be uprighted/pre-aligned individually before point
  // picking. The rotation is baked into the object's transform, which keeps
  // the picking + Kabsch alignment pipeline and Save Position consistent.
  const [rotatePanelOpen, setRotatePanelOpen] = useState(false);
  // Per-model opacity (keyed by panel label). 1 = fully opaque.
  const [opacity, setOpacity] = useState({ "BIM Model": 1, "Point Cloud": 1 });
  const changeOpacity = useCallback(
    (label, model, value) => {
      setOpacity((prev) => ({ ...prev, [label]: value }));
      modelData.setModelOpacity?.(model, value);
    },
    [modelData],
  );

  // ── Camera data table (Camera ID + user-defined columns) ─────────────────
  const [cameraTableOpen, setCameraTableOpen] = useState(false);
  // Extra columns beyond "Camera ID", e.g. ["Notes", "Status"]
  const [cameraTableColumns, setCameraTableColumns] = useState([]);
  // { [cameraId]: { [columnName]: value } }
  const [cameraTableData, setCameraTableData] = useState({});
  const [colorByColumn, setColorByColumn] = useState(null); // NEW

  // Camera IDs come from every posed camera currently in the scene
  // (parsed from the camera positions file + any manually added ones).
  // const cameraIds = (allCameras || [])
  //   .map((cam) => cam.userData?.imageName || cam.userData?.name)
  //   .filter(Boolean);

  const addCameraTableColumn = useCallback(() => {
    const name = window.prompt("New column name:");
    const key = name?.trim();
    if (!key) return;
    setCameraTableColumns((prev) =>
      prev.includes(key) ? prev : [...prev, key],
    );
  }, []);

  const removeCameraTableColumn = useCallback((key) => {
    setCameraTableColumns((prev) => prev.filter((c) => c !== key));
    setCameraTableData((prev) => {
      const next = {};
      for (const [camId, row] of Object.entries(prev)) {
        const { [key]: _drop, ...rest } = row;
        next[camId] = rest;
      }
      return next;
    });
  }, []);

  const updateCameraTableCell = useCallback((camId, key, value) => {
    setCameraTableData((prev) => ({
      ...prev,
      [camId]: { ...(prev[camId] || {}), [key]: value },
    }));
  }, []);
  // Per-model scale factor (1 = auto-placed size).
  const [scaleFactor, setScaleFactor] = useState({
    "BIM Model": 1,
    "Point Cloud": 1,
  });
  const changeScale = useCallback(
    (label, model, value) => {
      setScaleFactor((prev) => ({ ...prev, [label]: value }));
      modelData.setModelScale?.(model, value);
    },
    [modelData],
  );
  const rotateModel = useCallback((model, axis, deg) => {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const angle = THREE.MathUtils.degToRad(deg);
    const axisVec = new THREE.Vector3(
      axis === "x" ? 1 : 0,
      axis === "y" ? 1 : 0,
      axis === "z" ? 1 : 0,
    );
    model.position.sub(center);
    model.position.applyAxisAngle(axisVec, angle);
    model.position.add(center);
    model.rotateOnWorldAxis(axisVec, angle);
    model.updateMatrixWorld(true);
  }, []);

  // Per-model rotation angle per axis (degrees), driven by the sliders. We
  // apply the *delta* from the previous slider value so the model rotates
  // smoothly as the user drags, and the readout shows the absolute angle.
  const [rotation, setRotation] = useState({
    "BIM Model": { x: 0, y: 0, z: 0 },
    "Point Cloud": { x: 0, y: 0, z: 0 },
  });
  const changeRotation = useCallback(
    (label, model, axis, nextDeg) => {
      setRotation((prev) => {
        const cur = prev[label] || { x: 0, y: 0, z: 0 };
        const delta = nextDeg - (cur[axis] ?? 0);
        if (model && delta) rotateModel(model, axis, delta);
        return { ...prev, [label]: { ...cur, [axis]: nextDeg } };
      });
    },
    [rotateModel],
  );

  // ── Zoom controls ──────────────────────────────────────────────────────────
  // Dolly the camera toward/away from the orbit target. factor < 1 zooms in.
  const zoomBy = useCallback(
    (factor) => {
      const cam = sceneData.cameraRef?.current;
      const ctr = sceneData.controlsRef?.current;
      if (!cam || !ctr) return;
      const offset = cam.position.clone().sub(ctr.target);
      const nextLen = THREE.MathUtils.clamp(
        offset.length() * factor,
        ctr.minDistance || 0.01,
        ctr.maxDistance || Infinity,
      );
      offset.setLength(nextLen);
      cam.position.copy(ctr.target).add(offset);
      ctr.update();
    },
    [sceneData.cameraRef, sceneData.controlsRef],
  );

  const pickingData = usePicking(sceneData, modelData, props);

  const { alignGeometry, alignGeometryICP } = useAlignment(
    sceneData,
    modelData,
    {
      ...props,
      bimPoints: pickingData?.bimPoints || [],
      pcPoints: pickingData?.pcPoints || [],
      onAlignmentLocked: handleAlignmentLocked,
    },
  );

  useOverlap(sceneData, modelData, {
    ...props,
    setOverlapElementCount: props.setOverlapElementCount,
    resetPicking: pickingData.resetPicking,
  });

  const cameraData = useCameraSystem(sceneData, modelData, props);

  const {
    selectedCamera,
    setSelectedCamera,
    previewCanvasRef,
    handleManualCameraImageUpload,
    manualCameras,
    allCameras, // ← NEW
    deleteCamera,
    toggleCameraVisibility,
    toggleCameraPath,
    cameraPathVisible,
    colorCamerasByColumn,
    resetCameraColors,
  } = cameraData;

  // ← add this right here
  const cameraIds = (allCameras || [])
    .map((cam) => cam.userData?.imageName || cam.userData?.name)
    .filter(Boolean);

  // ── NEW: paste multi-line clipboard content into a column ─────────────────
  const handleColumnPaste = useCallback(
    (e, startCamId, col) => {
      const text = e.clipboardData?.getData("text");
      if (!text || !text.includes("\n")) return;

      e.preventDefault();
      const values = text
        .split(/\r?\n/)
        .filter((v, i, arr) => !(i === arr.length - 1 && v === ""));

      const startIdx = cameraIds.indexOf(startCamId);
      if (startIdx === -1) return;

      setCameraTableData((prev) => {
        const next = { ...prev };
        values.forEach((val, i) => {
          const camId = cameraIds[startIdx + i];
          if (!camId) return;
          next[camId] = { ...(next[camId] || {}), [col]: val.trim() };
        });
        return next;
      });
    },
    [cameraIds],
  );

  useEffect(() => {
    onManualCamerasChange?.({
      manualCameras,
      onDeleteManualCamera: deleteCamera,
      onToggleManualCamera: toggleCameraVisibility,
    });
  }, [
    manualCameras,
    deleteCamera,
    toggleCameraVisibility,
    onManualCamerasChange,
  ]);

  // ── SAM construction segmentation (needs manualCameras, so must live here) ─
  const samData = usePointCloudSAMSegmentation(
    modelData,
    // manualCameras,
    allCameras,
  );

  useEffect(() => {
    onModelDataChange?.({
      toggleSemanticSegmentation: samData.toggleSemanticSegmentation,
      isSemanticActive: samData.isSemanticActive,
      isSamRunning: samData.isRunning,
      samProgress: samData.progress,
      semanticSummary: samData.semanticSummary,
    });
  }, [
    samData.toggleSemanticSegmentation,
    samData.isSemanticActive,
    samData.isRunning,
    samData.progress,
    samData.semanticSummary,
    onModelDataChange,
  ]);

  useTransformControls(sceneData);

  // ── Blender-style gizmos ─────────────────────────────────────────────────
  useObjectSelection(
    sceneData.sceneRef,
    sceneData.cameraRef,
    sceneData.rendererRef,
    modelData,
    setActiveSelectedObject,
  );
  useBlenderTransformGizmo(sceneData, activeSelectedObject);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* In geo mode the map is rendered as a textured ground plane INSIDE the
          3D scene (see the map-mesh effect), so the BIM + point cloud sit on it
          at true scale with the roads visible underneath. No fullscreen overlay
          is drawn here — that would hide the 3D models. The small panel map
          below remains the location picker. */}

      <div
        ref={mountRef}
        style={{ position: "absolute", inset: 0, zIndex: 1, cursor: "grab" }}
      />

      {sceneData.sceneError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#F3F4F6",
          }}
        >
          <div
            style={{
              maxWidth: 440,
              textAlign: "center",
              padding: "20px 24px",
              borderRadius: 12,
              background: "#fff",
              border: "1px solid rgba(148,163,184,0.4)",
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
              fontSize: 13,
              color: "#0f172a",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              3D viewer unavailable
            </div>
            {sceneData.sceneError}
          </div>
        </div>
      )}

      {(modelData.isLoadingBim || modelData.isLoadingPc) &&
        !modelData.isConvertingIfc && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              background: "rgba(255,255,255,0.55)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 18px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.96)",
                border: "1px solid rgba(148,163,184,0.4)",
                boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
              }}
            >
              <Loader2 size={18} className="animate-spin" />
              {modelData.isLoadingBim && modelData.isLoadingPc
                ? "Loading BIM model and point cloud…"
                : modelData.isLoadingBim
                  ? "Loading BIM model…"
                  : "Loading point cloud…"}
            </div>
          </div>
        )}

      {/* {modelData.isConvertingIfc && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 25,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background: "rgba(255,255,255,0.7)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "22px 30px",
              borderRadius: 16,
              maxWidth: 360,
              textAlign: "center",
              background: "rgba(255,255,255,0.98)",
              border: "1px solid rgba(148,163,184,0.4)",
              boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)",
              color: "#0f172a",
            }}
          >
            <Loader2 size={34} className="animate-spin" />
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Converting IFC model…
            </div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              The IFC file is being converted on the server so it can be
              displayed. This can take a while the first time for large models —
              please wait.
            </div>
          </div>
        </div>
      )} */}

      {selectedLabel && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderRadius: 12,
            background: "rgba(29,78,216,0.95)",
            border: "1px solid rgba(148,163,184,0.4)",
            boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
            fontSize: 13,
            fontWeight: 600,
            color: "#ffffff",
            pointerEvents: "auto",
            maxWidth: "min(560px, calc(100% - 220px))",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            Selected: {selectedLabel} — drag the colored arrows/rings to move or
            rotate it
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveSelectedObject(null);
            }}
            title="Clear selection"
            style={{
              border: "none",
              background: "rgba(255,255,255,0.2)",
              color: "#ffffff",
              borderRadius: 8,
              padding: "2px 8px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          display: "flex",
          pointerEvents: "auto",
        }}
      >
        {/* Solid white rail behind the flat icon buttons — flush against the
            top-right corner and full height, matching the left IconToolbar's
            background exactly (color, border, spacing, alignment). */}
        <div
          style={{
            width: 44,
            height: "100%",
            background: "#ffffff",
            borderLeft: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 6,
            paddingBottom: 6,
            gap: 1,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* Group: model adjust + section box */}
        <FlatToolbarButton
          icon={
            <SlidersHorizontal
              size={16}
              strokeWidth={rotatePanelOpen ? 2.2 : 1.8}
            />
          }
          label="Adjust models (rotate / opacity / scale)"
          active={rotatePanelOpen}
          onClick={(e) => {
            e.stopPropagation();
            setRotatePanelOpen((open) => !open);
          }}
        />
        <FlatToolbarButton
          icon={
            <Scissors size={16} strokeWidth={sectionBoxActive ? 2.2 : 1.8} />
          }
          label="Section box — crop with the blue box / X·Y·Z sliders"
          active={sectionBoxActive}
          onClick={(e) => {
            e.stopPropagation();
            toggleSectionBox();
          }}
        />

        <ToolbarDivider />

        {/* Group: camera navigation */}
        <FlatToolbarButton
          icon={<ZoomIn size={16} strokeWidth={1.8} />}
          label="Zoom in"
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(0.7);
          }}
        />
        <FlatToolbarButton
          icon={<ZoomOut size={16} strokeWidth={1.8} />}
          label="Zoom out"
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(1.43);
          }}
        />
        <FlatToolbarButton
          icon={<Maximize2 size={16} strokeWidth={1.8} />}
          label="Fit models in view"
          onClick={(e) => {
            e.stopPropagation();
            modelData.fitAll?.();
          }}
        />
        <FlatToolbarButton
          icon={<Grid3x3 size={16} strokeWidth={gridVisible ? 2.2 : 1.8} />}
          label={gridVisible ? "Hide grid" : "Show grid"}
          active={gridVisible}
          onClick={(e) => {
            e.stopPropagation();
            toggleGrid();
          }}
        />
        <FlatToolbarButton
          icon={
            <Route size={16} strokeWidth={cameraPathVisible ? 2.2 : 1.8} />
          }
          label={cameraPathVisible ? "Hide camera path" : "Show camera path"}
          active={cameraPathVisible}
          onClick={(e) => {
            e.stopPropagation();
            toggleCameraPath();
          }}
        />

        <FlatToolbarButton
          icon={<Table2 size={16} strokeWidth={cameraTableOpen ? 2.2 : 1.8} />}
          label="Camera data table"
          active={cameraTableOpen}
          onClick={(e) => {
            e.stopPropagation();
            setCameraTableOpen((open) => {
              console.log("cameraTableOpen ->", !open);
              return !open;
            });
          }}
        />

        <ToolbarDivider />

        {/* Group: place on map + save */}
        <FlatToolbarButton
          icon={<MapPin size={16} strokeWidth={geoMapOpen ? 2.2 : 1.8} />}
          label="Place models on a map location"
          active={geoMapOpen}
          onClick={(event) => {
            event.stopPropagation();
            setGeoMapOpen((open) => !open);
          }}
        />
        {onSavePosition && (
          <FlatToolbarButton
            icon={
              <Save
                size={16}
                strokeWidth={saveStatus === "saving" ? 2.2 : 1.8}
              />
            }
            label="Save current position & orientation"
            active={saveStatus === "saving"}
            onClick={(event) => {
              event.stopPropagation();
              info("Saving current position & orientation…");
              onSavePosition?.();
            }}
          />
        )}
        </div>

      </div>

        {geoMapOpen && (
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 68,
              zIndex: 9999,
              pointerEvents: "auto",
              width: 260,
              padding: 12,
              borderRadius: 16,
              background: "rgba(255,255,255,0.96)",
              border: "1px solid rgba(148,163,184,0.32)",
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
              color: "#0f172a",
              // Cap the panel height so it never runs past short laptop
              // screens — fields scroll, the action button stays pinned below.
              maxHeight: "min(78vh, 560px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>Map Location</span>
              {alignmentLocked && (
                <span
                  title="BIM + point cloud are aligned and grouped — they scale, rotate and place as one unit."
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#15803d",
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  ● Grouped
                </span>
              )}
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              <div style={{ marginBottom: 10 }}>
                <LeafletMap
                  lat={parseFloat(geoLocation.latitude)}
                  lng={parseFloat(geoLocation.longitude)}
                  zoom={parseInt(geoLocation.zoom, 10) || 16}
                  height={130}
                  tileUrl={OSM_TILE_PROXY}
                  onMove={(lat, lng) =>
                    setGeoLocation((prev) => ({
                      ...prev,
                      latitude: lat.toFixed(6),
                      longitude: lng.toFixed(6),
                    }))
                  }
                />
                <div
                  style={{
                    fontSize: 11,
                    color: "#64748b",
                    marginTop: 5,
                  }}
                >
                  Drag the pin or click the map to set the location.
                </div>
              </div>
              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                Latitude
                <input
                  value={geoLocation.latitude}
                  onChange={(event) =>
                    setGeoLocation((prev) => ({
                      ...prev,
                      latitude: event.target.value,
                    }))
                  }
                  placeholder="e.g. 12.9716"
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: 8,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    outline: "none",
                  }}
                />
              </label>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                Longitude
                <input
                  value={geoLocation.longitude}
                  onChange={(event) =>
                    setGeoLocation((prev) => ({
                      ...prev,
                      longitude: event.target.value,
                    }))
                  }
                  placeholder="e.g. 77.5946"
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: 8,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    outline: "none",
                  }}
                />
              </label>
              {/* Altitude as a −100…+100 m slider — lift the model up or sink it
                down to close any vertical gap with the ground. */}
              <label
                style={{
                  display: "block",
                  marginBottom: 10,
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                <span
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>Altitude</span>
                  <strong>
                    {(parseFloat(geoLocation.altitude) || 0).toFixed(0)} m
                  </strong>
                </span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={parseFloat(geoLocation.altitude) || 0}
                  onChange={(event) =>
                    setGeoLocation((prev) => ({
                      ...prev,
                      altitude: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: 6,
                    accentColor: "#2563eb",
                  }}
                />
              </label>
              {/* Scale as a 0–50 slider (model size multiplier). */}
              <label
                style={{
                  display: "block",
                  marginBottom: 10,
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                <span
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>Scale</span>
                  <strong>
                    {(parseFloat(geoLocation.scale) || 0).toFixed(1)}×
                  </strong>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={50}
                  step={0.1}
                  value={parseFloat(geoLocation.scale) || 1}
                  onChange={(event) =>
                    setGeoLocation((prev) => ({
                      ...prev,
                      scale: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: 6,
                    accentColor: "#2563eb",
                  }}
                />
              </label>
              {/* Zoom as a slider. Max 19 because OSM tiles only exist up to
                zoom 19 — higher leaves the map blank ("no map"). */}
              <label
                style={{
                  display: "block",
                  marginBottom: 10,
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                <span
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>Zoom</span>
                  <strong>{parseInt(geoLocation.zoom, 10) || 16}</strong>
                </span>
                <input
                  type="range"
                  min={14}
                  max={19}
                  step={1}
                  value={parseInt(geoLocation.zoom, 10) || 16}
                  onChange={(event) =>
                    setGeoLocation((prev) => ({
                      ...prev,
                      zoom: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: 6,
                    accentColor: "#2563eb",
                  }}
                />
              </label>
            </div>
            <div
              style={{
                flexShrink: 0,
                marginTop: 8,
              }}
            >
              <label style={{ fontSize: 12, color: "#475569" }}>
                Building Footprint (m²)
                <input
                  type="number"
                  value={footprintArea ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    footprintEditedRef.current = true;
                    setFootprintArea(v === "" ? null : parseFloat(v));
                  }}
                  placeholder="e.g. 2500"
                  style={{
                    width: "100%",
                    marginTop: 4,
                    padding: 8,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    outline: "none",
                    fontSize: 13,
                  }}
                />
              </label>
            </div>
            <div
              style={{ flexShrink: 0, display: "flex", gap: 8, marginTop: 10 }}
            >
              <button
                onClick={resetGeoLocation}
                title="Undo placement/scale and reset the panel"
                style={{
                  flex: "0 0 auto",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#475569",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Reset
              </button>
              <button
                onClick={applyGeoLocation}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 12,
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Place Models
              </button>
            </div>
          </div>
        )}
        {cameraTableOpen && (
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 68,
              zIndex: 9999,
              pointerEvents: "auto",
              width: 360,
              maxHeight: "min(70vh, 480px)",
              padding: 14,
              borderRadius: 16,
              background: "rgba(255,255,255,0.96)",
              border: "1px solid rgba(148,163,184,0.32)",
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
              color: "#0f172a",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700 }}>Camera Data</div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  addCameraTableColumn();
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  color: "#0f172a",
                  cursor: "pointer",
                }}
              >
                + Column
              </button>
            </div>
            {cameraTableColumns.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}
                >
                  Color by:
                </span>
                <select
                  value={colorByColumn || ""}
                  onChange={(e) => setColorByColumn(e.target.value || null)}
                  style={{
                    fontSize: 11,
                    padding: "3px 6px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                  }}
                >
                  <option value="">Select column</option>
                  {cameraTableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!colorByColumn}
                  onClick={(e) => {
                    e.stopPropagation();
                    colorCamerasByColumn(cameraTableData, colorByColumn);
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: colorByColumn ? "#2563eb" : "#f1f5f9",
                    color: colorByColumn ? "#fff" : "#94a3b8",
                    cursor: colorByColumn ? "pointer" : "not-allowed",
                  }}
                >
                  Apply Colors
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetCameraColors();
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#0f172a",
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
              </div>
            )}

            <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        position: "sticky",
                        top: 0,
                        background: "#f1f5f9",
                        textAlign: "left",
                        padding: "6px 8px",
                        borderBottom: "1px solid #e2e8f0",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Camera ID
                    </th>
                    {cameraTableColumns.map((col) => (
                      <th
                        key={col}
                        style={{
                          position: "sticky",
                          top: 0,
                          background: "#f1f5f9",
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e2e8f0",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>{col}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCameraTableColumn(col);
                            }}
                            title={`Remove column "${col}"`}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "#94a3b8",
                              cursor: "pointer",
                              display: "grid",
                              placeItems: "center",
                              padding: 0,
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cameraIds.length === 0 && (
                    <tr>
                      <td
                        colSpan={1 + cameraTableColumns.length}
                        style={{ padding: "12px 8px", color: "#94a3b8" }}
                      >
                        No cameras loaded yet — load a camera positions file or
                        add a camera manually.
                      </td>
                    </tr>
                  )}
                  {cameraIds.map((camId) => (
                    <tr key={camId}>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #f1f5f9",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {camId}
                      </td>
                      {cameraTableColumns.map((col) => (
                        <td
                          key={col}
                          style={{
                            padding: "4px 6px",
                            borderBottom: "1px solid #f1f5f9",
                          }}
                        >
                          <input
                            value={cameraTableData[camId]?.[col] ?? ""}
                            onChange={(e) =>
                              updateCameraTableCell(camId, col, e.target.value)
                            }
                            onPaste={(e) => handleColumnPaste(e, camId, col)}
                            placeholder="—"
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              fontSize: 11,
                              borderRadius: 6,
                              border: "1px solid #e2e8f0",
                              outline: "none",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {cameraTableColumns.length === 0 && cameraIds.length > 0 && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>
                Click "+ Column" to add fields (e.g. Notes, Status) that you can
                fill in per camera.
              </div>
            )}
          </div>
        )}

      {rotatePanelOpen && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 68,
            zIndex: 9999,
            width: 270,
            padding: 14,
            borderRadius: 16,
            background: "rgba(255,255,255,0.96)",
            border: "1px solid rgba(148,163,184,0.32)",
            boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
            color: "#0f172a",
            maxHeight: "calc(100vh - 32px)",
            overflowY: "auto",
            pointerEvents: "auto",
          }}
        >
          {[
            { label: "BIM Model", model: modelData.bimModel },
            { label: "Point Cloud", model: modelData.pcModel },
          ].map(({ label, model }) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: model ? "#0f172a" : "#9ca3af",
                  }}
                >
                  {label} {!model && "(not loaded)"}
                </div>
                <button
                  type="button"
                  disabled={!model}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectModel(model);
                  }}
                  title={`Select ${label} for direct drag rotate/move`}
                  style={{
                    padding: "3px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background:
                      model && activeSelectedObject === model
                        ? "#1d4ed8"
                        : model
                          ? "#f8fafc"
                          : "#f1f5f9",
                    color:
                      model && activeSelectedObject === model
                        ? "#ffffff"
                        : model
                          ? "#0f172a"
                          : "#cbd5e1",
                    cursor: model ? "pointer" : "not-allowed",
                  }}
                >
                  {activeSelectedObject === model ? "Selected" : "Select"}
                </button>
                <button
                  type="button"
                  disabled={!model}
                  onClick={(e) => {
                    e.stopPropagation();
                    modelData.resetTransform?.(model);
                    setScaleFactor((prev) => ({ ...prev, [label]: 1 }));
                    setRotation((prev) => ({
                      ...prev,
                      [label]: { x: 0, y: 0, z: 0 },
                    }));
                  }}
                  title={`Reset ${label} rotation/position/scale to its loaded placement`}
                  style={{
                    marginLeft: 6,
                    padding: "3px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: model ? "#f8fafc" : "#f1f5f9",
                    color: model ? "#0f172a" : "#cbd5e1",
                    cursor: model ? "pointer" : "not-allowed",
                  }}
                >
                  Reset
                </button>
              </div>
              {["x", "y", "z"].map((axis) => {
                const axisColor =
                  axis === "x"
                    ? "#dc2626"
                    : axis === "y"
                      ? "#16a34a"
                      : "#2563eb";
                const deg = rotation[label]?.[axis] ?? 0;
                return (
                  <div
                    key={axis}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        fontSize: 12,
                        fontWeight: 700,
                        color: axisColor,
                      }}
                    >
                      {axis.toUpperCase()}
                    </span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      disabled={!model}
                      value={deg}
                      onChange={(e) =>
                        changeRotation(
                          label,
                          model,
                          axis,
                          Number(e.target.value),
                        )
                      }
                      style={{
                        flex: 1,
                        accentColor: axisColor,
                        cursor: model ? "pointer" : "not-allowed",
                      }}
                    />
                    <span
                      style={{
                        width: 40,
                        textAlign: "right",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#64748b",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {deg}°
                    </span>
                  </div>
                );
              })}
              {/* Opacity / transparency */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                <span
                  style={{
                    width: 54,
                    fontSize: 11,
                    fontWeight: 700,
                    color: model ? "#0f172a" : "#cbd5e1",
                  }}
                >
                  Opacity
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={!model}
                  value={opacity[label] ?? 1}
                  onChange={(e) =>
                    changeOpacity(label, model, Number(e.target.value))
                  }
                  style={{
                    flex: 1,
                    accentColor: "#2563eb",
                    cursor: model ? "pointer" : "not-allowed",
                  }}
                />
                <span
                  style={{
                    width: 34,
                    textAlign: "right",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#64748b",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round((opacity[label] ?? 1) * 100)}%
                </span>
              </div>
              {/* Scale */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                <span
                  style={{
                    width: 54,
                    fontSize: 11,
                    fontWeight: 700,
                    color: model ? "#0f172a" : "#cbd5e1",
                  }}
                >
                  Scale
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.05}
                  disabled={!model}
                  value={scaleFactor[label] ?? 1}
                  onChange={(e) =>
                    changeScale(label, model, Number(e.target.value))
                  }
                  style={{
                    flex: 1,
                    accentColor: "#16a34a",
                    cursor: model ? "pointer" : "not-allowed",
                  }}
                />
                <span
                  style={{
                    width: 34,
                    textAlign: "right",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#64748b",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {(scaleFactor[label] ?? 1).toFixed(2)}×
                </span>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Rotations are baked into each model — use Save to persist. Click
            "Select" (or click the model directly in the 3D view) to get
            free-drag arrows/rings for fine rotation and positioning.
          </div>
        </div>
      )}

      {sectionBoxActive && <ClipBar {...clipData} />}

      <CameraPreviewPanel
        selectedCamera={selectedCamera}
        setSelectedCamera={setSelectedCamera}
        previewCanvasRef={previewCanvasRef}
        handleManualCameraImageUpload={handleManualCameraImageUpload}
      />
      <BlenderViewportGizmo
        cameraRef={sceneData.cameraRef}
        controlsRef={sceneData.controlsRef}
      />
      <CompassRing cameraRef={sceneData.cameraRef} />
    </div>
  );
}

export default ThreeViewer;
