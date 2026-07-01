import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import API from "../../api/axios";

/**
 * SPIKE / PROTOTYPE — not wired into the real viewer.
 *
 * Proves the "real map under Three.js models" approach without touching the
 * working ThreeViewer: a MapLibre GL base map (OSM raster tiles via our backend
 * proxy, so COEP doesn't block them) with a Three.js *custom layer* rendered
 * into the same WebGL context and camera-synced to the map. A 20 m box is
 * placed at a chosen lng/lat at true metric scale — pan/zoom/tilt the map and
 * the box stays geo-locked and correctly sized against the streets.
 *
 * If this feels right, we graduate it: swap the demo box for the project's
 * BIM + point-cloud groups, and add a Mapbox/MapTiler key for real 3D terrain.
 */

// OSM raster tiles routed through our proxy (adds CORP header + disk cache).
const TILE_URL =
  API.defaults.baseURL.replace(/\/$/, "") +
  "/processing/osm-tile/{z}/{x}/{y}.png";

export default function MapGroundSpike() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  // Demo building location (Bangalore — same area as the project samples).
  const [origin] = useState({ lng: 77.5946, lat: 12.9716, altitude: 0 });

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [origin.lng, origin.lat],
      zoom: 17,
      pitch: 60, // tilt for the 3D site-context feel
      bearing: -20,
      antialias: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

    // Mercator anchor for the model origin + the metres→mercator scale factor.
    const merc = maplibregl.MercatorCoordinate.fromLngLat(
      [origin.lng, origin.lat],
      origin.altitude,
    );
    const modelTransform = {
      translateX: merc.x,
      translateY: merc.y,
      translateZ: merc.z,
      // MapLibre's Y is down vs three.js Y up; rotate the model upright.
      rotateX: Math.PI / 2,
      scale: merc.meterInMercatorCoordinateUnits(),
    };

    const customLayer = {
      id: "three-model",
      type: "custom",
      renderingMode: "3d",
      onAdd(_map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        // Lights
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(0, -70, 100).normalize();
        this.scene.add(dir);

        // Demo "building": a 20 m × 20 m × 30 m box sitting on the ground.
        const W = 20, D = 20, H = 30;
        const geo = new THREE.BoxGeometry(W, H, D);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x4f7cff,
          roughness: 0.7,
          metalness: 0.1,
        });
        const box = new THREE.Mesh(geo, mat);
        box.position.set(0, H / 2, 0); // base on the ground plane
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x1e293b }),
        );
        box.add(edges);
        this.scene.add(box);

        this.renderer = new THREE.WebGLRenderer({
          canvas: _map.getCanvas(),
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
        this.map = _map;
      },
      render(_gl, matrix) {
        const rotationX = new THREE.Matrix4().makeRotationAxis(
          new THREE.Vector3(1, 0, 0),
          modelTransform.rotateX,
        );
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(
            modelTransform.translateX,
            modelTransform.translateY,
            modelTransform.translateZ,
          )
          .scale(
            new THREE.Vector3(
              modelTransform.scale,
              -modelTransform.scale,
              modelTransform.scale,
            ),
          )
          .multiply(rotationX);

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
      },
    };

    map.on("style.load", () => {
      map.addLayer(customLayer);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [origin]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 5,
          background: "rgba(255,255,255,0.92)",
          padding: "10px 14px",
          borderRadius: 12,
          boxShadow: "0 10px 24px rgba(15,23,42,0.15)",
          fontSize: 13,
          maxWidth: 280,
        }}
      >
        <strong>MapLibre + Three.js spike</strong>
        <div style={{ color: "#475569", marginTop: 4 }}>
          A 20×20×30 m box geo-locked at {origin.lat}, {origin.lng}. Drag to
          pan, right-drag to tilt/rotate, scroll to zoom — the box stays at true
          scale on the street map.
        </div>
      </div>
    </div>
  );
}
