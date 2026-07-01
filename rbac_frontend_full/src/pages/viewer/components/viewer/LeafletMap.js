import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icons reference image files by relative URL, which
// break under bundlers. Point them at the CDN copies so the pin always shows.
const ICON = L.icon({
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/**
 * A small OpenStreetMap (Leaflet) panel with a draggable pin.
 * - `lat`/`lng`/`zoom` position the view.
 * - dragging the pin or clicking the map calls `onMove(lat, lng)`.
 */
export default function LeafletMap({
  lat,
  lng,
  zoom = 16,
  height = 180,
  onMove,
  // Tile URL template. Defaults to OSM directly, but the viewer passes a
  // same-origin backend proxy so tiles load under cross-origin isolation (COEP).
  tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // True while tiles are still fetching, so we can show a loading spinner.
  const [loading, setLoading] = useState(true);

  // Initialise once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const startLat = Number.isFinite(lat) ? lat : 0;
    const startLng = Number.isFinite(lng) ? lng : 0;

    const map = L.map(containerRef.current, {
      center: [startLat, startLng],
      zoom,
      attributionControl: false,
      zoomControl: true,
      // Free exploration: scroll to zoom, drag to pan anywhere. inertia keeps
      // panning smooth so the user can "walk" across the map.
      scrollWheelZoom: true,
      dragging: true,
      inertia: true,
      worldCopyJump: true, // wrap seamlessly when panning across the globe
    });
    // The map sits inside a scrollable panel — stop wheel events from scrolling
    // the panel so the wheel zooms the map instead.
    L.DomEvent.disableScrollPropagation(containerRef.current);

    const tiles = L.tileLayer(tileUrl, {
      maxZoom: 19,
      crossOrigin: true,
      // keep already-loaded tiles while new ones stream in (async, no flicker)
      keepBuffer: 4,
      updateWhenIdle: false,
    });
    // Drive the loading spinner from the tile layer's fetch lifecycle.
    tiles.on("loading", () => setLoading(true));
    tiles.on("load", () => setLoading(false));
    tiles.addTo(map);

    const marker = L.marker([startLat, startLng], {
      draggable: true,
      icon: ICON,
    }).addTo(map);

    marker.on("dragend", () => {
      const { lat: mLat, lng: mLng } = marker.getLatLng();
      onMoveRef.current?.(mLat, mLng);
    });
    map.on("click", (e) => {
      marker.setLatLng(e.latlng);
      onMoveRef.current?.(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Grab-hand cursor for panning: open hand at rest, closed hand while
    // dragging — same feel as the 3D canvas.
    const mapEl = map.getContainer();
    mapEl.style.cursor = "grab";
    map.on("dragstart", () => {
      mapEl.style.cursor = "grabbing";
    });
    map.on("dragend", () => {
      mapEl.style.cursor = "grab";
    });

    // Leaflet needs a size recalculation once it's visible in the panel.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []); // init once

  // Keep the view + pin in sync when the lat/lng/zoom props change externally
  // (e.g. the user types coordinates into the fields).
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // Always keep the pin in sync, but DON'T yank the view if the user has
    // freely panned to a spot that still contains the new point — only recenter
    // when the target is off-screen (e.g. the user typed new coordinates).
    marker.setLatLng([lat, lng]);
    if (!map.getBounds().contains([lat, lng])) {
      map.setView([lat, lng], zoom || map.getZoom());
    }
  }, [lat, lng, zoom]);

  // A full-height map (background mode) shouldn't have rounded corners/border.
  const isFull = height === "100%";
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: isFull ? 0 : 12,
        overflow: "hidden",
        border: isFull ? "none" : "1px solid rgba(148,163,184,0.28)",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 500,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
            fontSize: 11,
            color: "#475569",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              border: "2px solid #cbd5e1",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              display: "inline-block",
              animation: "lmspin 0.7s linear infinite",
            }}
          />
          Loading map…
          <style>{`@keyframes lmspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </div>
  );
}
