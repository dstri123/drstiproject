import React, { useRef, useEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { useParams } from "react-router-dom";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import BlenderViewportGizmo from "../viewer/components/gizmo/BlenderViewportGizmo";
import Header from "../viewer/layout/Header";
import IconToolbar from "../viewer/layout/IconToolbar";
import ContextPanel from "../viewer/layout/Sidebar";
import API from "../../api/axios";
import { createProjectSlug, getProjectIdFromSlug } from "@/lib/utils";
import { fetchAsArrayBuffer, getFileUrl, parseIfc } from "@/lib/ifcModel";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  FolderOpen,
  Eye,
  EyeOff,
} from "lucide-react";

const calBtnStyle = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 5,
  border: "none",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "0.02em",
};

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── MonthCalendar popup (rendered via portal so it escapes overflow:hidden) ──
function MonthCalendar({
  uploadsByDate,
  selectedDate,
  onDateSelect,
  onClose,
  accent,
  anchorEl,
}) {
  const popupRef = useRef(null);
  const todayStr = toDateStr(new Date());

  // Initialise to the month that contains the most recent upload (or today)
  const [viewMonth, setViewMonth] = useState(() => {
    const dates = Object.keys(uploadsByDate).sort();
    if (dates.length > 0) {
      const [y, m] = dates[dates.length - 1].split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  });

  // Anchor position — recalculate if anchorEl changes
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    // Flip up if not enough space below
    const calH = 280;
    const top =
      rect.bottom + 6 + calH > window.innerHeight
        ? rect.top - calH - 6
        : rect.bottom + 6;
    setPos({ top, left: rect.left });
  }, [anchorEl]);

  // Close on outside click / Escape
  useEffect(() => {
    const onDown = (e) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target) &&
        anchorEl &&
        !anchorEl.contains(e.target)
      )
        onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorEl]);

  const year = viewMonth.getFullYear();
  const monthIdx = viewMonth.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  // Monday-first offset
  const firstDow = (() => {
    const d = new Date(year, monthIdx, 1).getDay();
    return d === 0 ? 6 : d - 1;
  })();

  // Build flat cell array: null = empty pad, number = day-of-month
  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const navBtn = (onClick, Icon) => (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "1px solid #e2e8f0",
        borderRadius: 5,
        cursor: "pointer",
        padding: "3px 6px",
        color: "#64748b",
        display: "flex",
        alignItems: "center",
        transition: "background 0.12s",
      }}
    >
      <Icon size={13} />
    </button>
  );

  return ReactDOM.createPortal(
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.14)",
        padding: "14px 12px 12px",
        width: 248,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      {/* Month navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        {navBtn(
          () => setViewMonth(new Date(year, monthIdx - 1, 1)),
          ChevronLeft,
        )}
        <span
          style={{
            fontWeight: 700,
            fontSize: 13,
            color: "#0f172a",
            letterSpacing: "0.01em",
          }}
        >
          {monthLabel}
        </span>
        {navBtn(
          () => setViewMonth(new Date(year, monthIdx + 1, 1)),
          ChevronRight,
        )}
      </div>

      {/* Weekday headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          marginBottom: 4,
        }}
      >
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: 9,
              fontWeight: 700,
              color: "#94a3b8",
              padding: "2px 0",
              letterSpacing: "0.06em",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
        }}
      >
        {cells.map((day, idx) => {
          if (day === null)
            return <div key={`pad-${idx}`} style={{ height: 32 }} />;

          const mm = String(monthIdx + 1).padStart(2, "0");
          const dd = String(day).padStart(2, "0");
          const dateStr = `${year}-${mm}-${dd}`;
          const uploads = uploadsByDate[dateStr];
          const hasBim = (uploads?.bim?.length ?? 0) > 0;
          const hasPc = (uploads?.pc?.length ?? 0) > 0;
          const hasAny = hasBim || hasPc;
          const isSel = dateStr === selectedDate;
          const isToday = dateStr === todayStr;

          return (
            <div
              key={dateStr}
              onClick={() => {
                if (!hasAny) return;
                onDateSelect(dateStr, uploads);
                onClose();
              }}
              title={
                hasAny
                  ? `${uploads.bim.length} BIM · ${uploads.pc.length} Point Cloud`
                  : "No uploads"
              }
              style={{
                height: 32,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 7,
                cursor: hasAny ? "pointer" : "default",
                background: isSel
                  ? accent
                  : isToday && !isSel
                    ? `${accent}15`
                    : "transparent",
                border: `1px solid ${isSel ? accent : isToday && !isSel ? accent : "transparent"}`,
                opacity: hasAny ? 1 : 0.28,
                transition: "background 0.12s, border-color 0.12s",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: hasAny ? 700 : 400,
                  color: isSel ? "#fff" : isToday ? accent : "#0f172a",
                  lineHeight: 1,
                }}
              >
                {day}
              </span>

              {/* Upload indicator dots */}
              {hasAny && (
                <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                  {hasBim && (
                    <div
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: "50%",
                        background: isSel
                          ? "rgba(255,255,255,0.85)"
                          : "#3b82f6",
                      }}
                    />
                  )}
                  {hasPc && (
                    <div
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: "50%",
                        background: isSel
                          ? "rgba(255,255,255,0.85)"
                          : "#10b981",
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid #f1f5f9",
          justifyContent: "center",
        }}
      >
        {[
          ["#3b82f6", "BIM"],
          ["#10b981", "Point Cloud"],
        ].map(([color, label]) => (
          <span
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 9,
              color: "#94a3b8",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: color,
                display: "inline-block",
              }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─── CompareScene ─────────────────────────────────────────────────────────────
// One shared 3D scene with two independently-chosen models (Side A / Side B).
// Each side: pick a date, then pick which model on that date (BIM or Point
// Cloud). A 3D clip PLANE (like the section box) is driven by the slider — Side
// A is kept left of the plane, Side B right of it — so moving the slider wipes
// between them in true 3D. A manual alignment panel (X/Y/Z rotation, opacity,
// scale) lets you nudge each side here; models load in their saved geo-aligned
// pose first.
const SIDE_ACCENT = { A: "#3b82f6", B: "#10b981" };
const DEFAULT_ALIGN = {
  rx: 0,
  ry: 0,
  rz: 0,
  px: 0,
  py: 0,
  pz: 0,
  opacity: 1,
  scale: 1,
};
const deg2rad = (d) => (d * Math.PI) / 180;

// Give a BIM model the clean, light "technical drawing" look: pale near-white
// surfaces + thin dark edge lines on every element (like the viewer).
function applyCleanBim(root) {
  root.traverse((c) => {
    if (!c.isMesh) return;
    c.material = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    try {
      const edges = new THREE.EdgesGeometry(c.geometry, 30);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: 0x64748b,
          transparent: true,
          opacity: 0.55,
        }),
      );
      line.name = "__clean_edges";
      c.add(line);
    } catch (e) {
      // ignore degenerate geometry
    }
  });
}

// Dragging a clip handle into the last OVERLAY_ZONE of the viewport "closes"
// that side: instead of clipping it away, both sides are drawn whole and the
// closing side is superimposed as a ghost whose opacity ramps from GHOST_MIN
// (just entered the zone) to GHOST_MAX (handle at the edge).
const OVERLAY_ZONE = 0.1;
const GHOST_MIN = 0.25;
const GHOST_MAX = 0.7;

// Orient a curtain plane pair so it passes through the camera and the
// handle's line on screen: Side A keeps what is left of (or below) the line,
// Side B what is right of (or above) it. Being screen-based, the wipe follows
// the handle exactly no matter where each model sits in the world — a
// world-space plane would cut a model away entirely when the two dates'
// models don't overlap (e.g. a BIM and a not-yet-aligned point cloud).
// axis "v": f = handle x as a 0..1 fraction from the left;
// axis "h": f = handle y as a 0..1 fraction from the top.
const _curtainP1 = new THREE.Vector3();
const _curtainP2 = new THREE.Vector3();
const _curtainProbe = new THREE.Vector3();
function setScreenCurtain(camera, planeA, planeB, axis, f) {
  if (!planeA || !planeB) return;
  camera.updateMatrixWorld();
  if (axis === "v") {
    const x = 2 * f - 1;
    _curtainP1.set(x, -1, 0.5).unproject(camera);
    _curtainP2.set(x, 1, 0.5).unproject(camera);
    _curtainProbe.set(x - 0.5, 0, 0.5).unproject(camera);
  } else {
    const y = 1 - 2 * f;
    _curtainP1.set(-1, y, 0.5).unproject(camera);
    _curtainP2.set(1, y, 0.5).unproject(camera);
    _curtainProbe.set(0, y - 0.5, 0.5).unproject(camera);
  }
  planeA.setFromCoplanarPoints(camera.position, _curtainP1, _curtainP2);
  if (planeA.distanceToPoint(_curtainProbe) < 0) planeA.negate();
  planeB.copy(planeA).negate();
}

const applySavedTransform = (object, t) => {
  if (!object || !t || typeof t !== "object") return;
  if (Array.isArray(t.position) && t.position.length === 3)
    object.position.fromArray(t.position);
  if (Array.isArray(t.quaternion) && t.quaternion.length === 4)
    object.quaternion.fromArray(t.quaternion);
  if (Array.isArray(t.scale) && t.scale.length === 3)
    object.scale.fromArray(t.scale);
  object.updateMatrix();
  object.updateMatrixWorld(true);
};

function disposeObject(obj) {
  obj.traverse((n) => {
    // IFC models also live in web-ifc's WASM heap until closed; without this
    // every date switch leaks a whole model there.
    if (n.ifcManager && typeof n.close === "function") n.close();
    if (n.geometry) n.geometry.dispose();
    if (n.material)
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) =>
        m.dispose(),
      );
  });
}

// Load one uploaded model (kind "bim" | "pc") in its saved geo-aligned pose.
// Each material remembers its own opacity in userData.baseOpacity so the
// opacity slider / overlay ghosting can scale it without losing the BIM look.
async function loadModel(kind, item) {
  const url = getFileUrl(item.file);
  let obj;
  if (kind === "pc") {
    // Determine extension from the stored file path.
    const storedExt = (item.file || "").split(".").pop().toLowerCase();
    let plyBuffer;

    if (storedExt === "ply") {
      // PLY: fetch into an ArrayBuffer and parse directly.
      plyBuffer = await fetchAsArrayBuffer(url);
    } else {
      // Non-PLY (LAS/LAZ/PTS/XYZ): download raw, convert to PLY on the
      // backend so PLYLoader can render it with colors preserved.
      const rawBuffer = await fetchAsArrayBuffer(url);
      const filename = (item.file || "cloud.las").split("/").pop();
      const fd = new FormData();
      fd.append("file", new Blob([rawBuffer]), filename);
      const convRes = await API.post(
        "processing/tools/pointcloud-to-ply/",
        fd,
        { headers: { "Content-Type": "multipart/form-data" }, responseType: "arraybuffer" }
      );
      plyBuffer = convRes.data;
    }

    const geometry = new PLYLoader().parse(plyBuffer);
    if (!geometry.attributes.color) {
      const n = geometry.attributes.position.count;
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3),
      );
    }
    // Same size rule as the Viewer (relative to the cloud's extent), but with
    // a pixel floor: here the camera is often framed on a much larger BIM on
    // the other side, and pure world-size points would shrink below a pixel
    // and the cloud would seem not to load at all.
    geometry.computeBoundingBox();
    const diag = geometry.boundingBox.getSize(new THREE.Vector3()).length();
    const material = new THREE.PointsMaterial({
      size: Math.max(diag * 0.0025, 0.01),
      vertexColors: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <logdepthbuf_vertex>",
        "gl_PointSize = max( gl_PointSize, 1.5 );\n#include <logdepthbuf_vertex>",
      );
    };
    obj = new THREE.Points(geometry, material);
  } else {
    // Fetch straight into an ArrayBuffer and parse it — no Blob URL. Blob
    // storage is shared with the (still mounted) Viewer and runs out, which
    // fails even a small IFC with "Failed to fetch" / net::ERR_FAILED 200.
    const ext = url.split("?")[0].split(".").pop().toLowerCase();
    const buffer = await fetchAsArrayBuffer(url);
    if (ext === "fbx") {
      obj = new FBXLoader().parse(buffer, "");
    } else if (ext === "glb" || ext === "gltf") {
      obj = (await new GLTFLoader().parseAsync(buffer, "")).scene;
    } else {
      obj = await parseIfc(buffer);
    }
  }

  applySavedTransform(obj, item.transform);
  // BIM gets the clean "white + edge lines" technical look; point clouds
  // keep their real colours.
  if (kind === "bim") applyCleanBim(obj);
  obj.traverse((n) => {
    if (!n.material) return;
    (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => {
      m.userData.baseOpacity = m.transparent ? m.opacity : 1;
    });
  });
  return obj;
}

function CompareScene({ uploadsByDate, initialDate }) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const rafRef = useRef(null);

  // Per-side loaded object + its base matrix / world centre (for centre-pivot
  // rotation) and the clip plane assigned to its materials.
  const objRef = { A: useRef(null), B: useRef(null) };
  const baseRef = { A: useRef(null), B: useRef(null) };
  const centerRef = { A: useRef(null), B: useRef(null) };
  // Two clip directions: vertical curtain (X axis) and horizontal curtain (Y).
  // Each has an A-plane and B-plane and can be toggled on/off independently.
  const vPlane = { A: useRef(null), B: useRef(null) };
  const hPlane = { A: useRef(null), B: useRef(null) };

  const vClipRef = useRef(0.5);
  const hClipRef = useRef(0.5);
  const [vClip, setVClip] = useState(0.5);
  const [hClip, setHClip] = useState(0.5);
  const [vOn, setVOn] = useState(true);
  const [hOn, setHOn] = useState(false);
  const vOnRef = useRef(true);
  const hOnRef = useRef(false);

  const [pick, setPick] = useState({
    A: { date: null, sel: "" },
    B: { date: null, sel: "" },
  });
  const [loading, setLoading] = useState({ A: false, B: false });
  const [err, setErr] = useState({ A: "", B: "" });
  const [notice, setNotice] = useState({ A: "", B: "" });
  const [align, setAlign] = useState({
    A: { ...DEFAULT_ALIGN },
    B: { ...DEFAULT_ALIGN },
  });
  // Mirror of `align` readable from drag handlers without re-binding them.
  const alignRef = useRef(align);
  // Side currently ghosted over the other ('A' | 'B'), or null when split.
  const [overlay, setOverlay] = useState(null);
  // Bumped on every load so a slow, superseded load doesn't land in the scene.
  const loadTokenRef = { A: useRef(0), B: useRef(0) };
  const [calOpen, setCalOpen] = useState(null); // 'A' | 'B' | null
  const [panelOpen, setPanelOpen] = useState(true);
  const calRef = { A: useRef(null), B: useRef(null) };

  // ── Scene setup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eef2f6");
    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / mount.clientHeight,
      0.1,
      8000,
    );
    camera.position.set(25, 25, 25);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true; // enable per-material clip planes
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = "grab";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(20, 40, 20);
    scene.add(dir);

    // Curtain planes; oriented every frame by setScreenCurtain.
    vPlane.A.current = new THREE.Plane();
    vPlane.B.current = new THREE.Plane();
    hPlane.A.current = new THREE.Plane();
    hPlane.B.current = new THREE.Plane();

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const onDown = () => (renderer.domElement.style.cursor = "grabbing");
    const onUp = () => (renderer.domElement.style.cursor = "grab");
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      controls.update();
      setScreenCurtain(camera, vPlane.A.current, vPlane.B.current, "v", vClipRef.current);
      setScreenCurtain(camera, hPlane.A.current, hPlane.B.current, "h", hClipRef.current);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      // Skip when hidden (e.g. an ancestor set to display:none while
      // navigating to another page but keeping this mounted) — 0x0 would
      // set camera.aspect to NaN, corrupting the projection matrix.
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      controls.dispose();
      // Free GPU memory: dispose every geometry/material/texture, then drop the
      // WebGL context so leaving Analytics doesn't leak (big point clouds!).
      try {
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material)
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
              for (const k in m) {
                if (m[k] && m[k].isTexture) m[k].dispose();
              }
              m.dispose();
            });
        });
        scene.clear();
      } catch (e) {
        console.warn("CompareScene dispose failed", e);
      }
      if (renderer.domElement.parentNode)
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch (e) {
        /* ignore */
      }
    };
    // eslint-disable-next-line
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const eachMaterial = (obj, fn) => {
    obj.traverse((n) => {
      if (n.material)
        (Array.isArray(n.material) ? n.material : [n.material]).forEach(fn);
    });
  };

  // Which side (if any) has its handle dragged into the edge zone, and how far
  // in (t: 0 → just entered, 1 → at the edge).
  const closingSide = () => {
    const v = vClipRef.current;
    const h = hClipRef.current;
    if (vOnRef.current) {
      // Handle at the left edge leaves no room for A, right edge none for B.
      if (v <= OVERLAY_ZONE) return { side: "A", t: 1 - v / OVERLAY_ZONE };
      if (v >= 1 - OVERLAY_ZONE)
        return { side: "B", t: (v - (1 - OVERLAY_ZONE)) / OVERLAY_ZONE };
    }
    if (hOnRef.current) {
      // B keeps the top part, A the bottom part.
      if (h <= OVERLAY_ZONE) return { side: "B", t: 1 - h / OVERLAY_ZONE };
      if (h >= 1 - OVERLAY_ZONE)
        return { side: "A", t: (h - (1 - OVERLAY_ZONE)) / OVERLAY_ZONE };
    }
    return null;
  };

  // Push clip planes + opacity onto each side's materials. A fragment is kept
  // only if inside ALL planes, so with both curtains on you get a quadrant
  // reveal; with one on, a clean wipe. In overlay mode nothing is clipped and
  // the closing side is drawn see-through on top of the other.
  const refreshMaterials = useCallback(() => {
    const ov = closingSide();
    for (const s of ["A", "B"]) {
      const obj = objRef[s].current;
      if (!obj) continue;
      const planes = [];
      if (!ov) {
        if (vOnRef.current && vPlane[s].current) planes.push(vPlane[s].current);
        if (hOnRef.current && hPlane[s].current) planes.push(hPlane[s].current);
      }
      const ghost =
        ov && ov.side === s ? GHOST_MIN + (GHOST_MAX - GHOST_MIN) * ov.t : 1;
      const opacity = alignRef.current[s].opacity * ghost;
      eachMaterial(obj, (m) => {
        m.clippingPlanes = planes;
        const o = (m.userData.baseOpacity ?? 1) * opacity;
        const transparent = o < 1;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = o;
        m.depthWrite = ghost === 1;
      });
    }
    setOverlay(ov ? ov.side : null);
    // eslint-disable-next-line
  }, []);

  // The curtain planes themselves are rebuilt from the camera every frame (see
  // setScreenCurtain in the render loop); this only re-applies them, plus
  // opacity / overlay state, to the materials.
  const updateClip = useCallback(() => {
    refreshMaterials();
  }, [refreshMaterials]);

  const fitToAll = useCallback(() => {
    const box = new THREE.Box3();
    let any = false;
    for (const s of ["A", "B"]) {
      if (objRef[s].current) {
        box.union(new THREE.Box3().setFromObject(objRef[s].current));
        any = true;
      }
    }
    if (!any || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) * 1.8 || 30;
    cameraRef.current.position.set(center.x + d, center.y + d, center.z + d);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
    // eslint-disable-next-line
  }, []);

  const disposeSide = (s) => {
    const obj = objRef[s].current;
    if (obj && sceneRef.current) {
      disposeObject(obj);
      sceneRef.current.remove(obj);
    }
    objRef[s].current = null;
    baseRef[s].current = null;
    centerRef[s].current = null;
  };

  // Apply rotation(about centre)/scale for a side from its align state
  // (opacity is applied by refreshMaterials via updateClip).
  const applyAlign = useCallback((s, a) => {
    const obj = objRef[s].current;
    const base = baseRef[s].current;
    const c = centerRef[s].current;
    if (!obj || !base || !c) return;
    const e = new THREE.Euler(deg2rad(a.rx), deg2rad(a.ry), deg2rad(a.rz), "XYZ");
    const R = new THREE.Matrix4().makeRotationFromEuler(e);
    const S = new THREE.Matrix4().makeScale(a.scale, a.scale, a.scale);
    const T = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z);
    const Ti = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
    // Move offset (left/right = X, up/down = Y, fwd/back = Z) applied last.
    const O = new THREE.Matrix4().makeTranslation(a.px, a.py, a.pz);
    const M = new THREE.Matrix4()
      .multiply(O)
      .multiply(T)
      .multiply(R)
      .multiply(S)
      .multiply(Ti)
      .multiply(base);
    M.decompose(obj.position, obj.quaternion, obj.scale);
    obj.updateMatrixWorld(true);
    updateClip();
    // eslint-disable-next-line
  }, [updateClip]);

  const commitAlign = (next) => {
    alignRef.current = next;
    setAlign(next);
  };

  // ── Load a side's chosen model(s) ────────────────────────────────────────────
  // sel is "all" (every BIM + point cloud uploaded on that date) or "bim:i" /
  // "pc:i" for a single model. Everything for a side lives in one Group so the
  // alignment sliders move the whole date together.
  const loadSide = useCallback(
    async (s, dateStr, sel) => {
      const day = uploadsByDate[dateStr];
      if (!day || !sel) return;
      let items;
      if (sel === "all") {
        items = [
          ...(day.bim || []).map((it) => ["bim", it]),
          ...(day.pc || []).map((it) => ["pc", it]),
        ];
      } else {
        const [kind, idxStr] = sel.split(":");
        const item = day[kind]?.[parseInt(idxStr, 10) || 0];
        items = item ? [[kind, item]] : [];
      }
      if (!items.length) return;

      const token = ++loadTokenRef[s].current;
      setErr((e) => ({ ...e, [s]: "" }));
      setLoading((l) => ({ ...l, [s]: true }));
      disposeSide(s);

      const results = await Promise.allSettled(
        items.map(([kind, item]) => loadModel(kind, item)),
      );
      if (token !== loadTokenRef[s].current || !sceneRef.current) {
        // A newer pick for this side started meanwhile — drop these.
        results.forEach(
          (r) => r.status === "fulfilled" && disposeObject(r.value),
        );
        return;
      }

      const group = new THREE.Group();
      let failed = 0;
      let reason = "";
      results.forEach((r) => {
        if (r.status === "fulfilled") group.add(r.value);
        else {
          failed++;
          reason = reason || r.reason?.message || String(r.reason);
          console.error(`[Analytics] side ${s} load failed`, r.reason);
        }
      });

      if (group.children.length) {
        sceneRef.current.add(group);
        objRef[s].current = group;
        group.updateMatrixWorld(true);
        baseRef[s].current = group.matrix.clone();
        centerRef[s].current = new THREE.Box3()
          .setFromObject(group)
          .getCenter(new THREE.Vector3());
        // Reset this side's alignment for the new model(s). If they don't
        // overlap the other side at all (e.g. a BIM and a point cloud that
        // were never aligned/saved in the Viewer), the screen wipe would hide
        // one of them entirely — so start this side centred on the other via
        // the move offsets (visible in the Align panel, undone by Reset).
        let next = { ...DEFAULT_ALIGN };
        const other = objRef[s === "A" ? "B" : "A"].current;
        let centred = false;
        if (other) {
          const mine = new THREE.Box3().setFromObject(group);
          const theirs = new THREE.Box3().setFromObject(other);
          if (!mine.isEmpty() && !theirs.isEmpty() && !mine.intersectsBox(theirs)) {
            const d = theirs
              .getCenter(new THREE.Vector3())
              .sub(mine.getCenter(new THREE.Vector3()));
            next = { ...next, px: d.x, py: d.y, pz: d.z };
            centred = true;
          }
        }
        commitAlign({ ...alignRef.current, [s]: next });
        applyAlign(s, next);
        setNotice((n) => ({
          ...n,
          [s]: centred ? "Not aligned with other side — auto-centred" : "",
        }));
        fitToAll();
      }
      if (failed)
        setErr((er) => ({
          ...er,
          [s]:
            (failed === items.length
              ? "Could not load"
              : `${failed} of ${items.length} failed`) + ` — ${reason}`,
        }));
      setLoading((l) => ({ ...l, [s]: false }));
    },
    // eslint-disable-next-line
    [uploadsByDate, applyAlign, fitToAll],
  );

  // React to clip toggles: re-assign active planes + refresh constants.
  useEffect(() => {
    vOnRef.current = vOn;
    hOnRef.current = hOn;
    updateClip();
  }, [vOn, hOn, updateClip]);

  // ── Date / model selection ────────────────────────────────────────────────────
  const modelOptions = (dateStr) => {
    const u = uploadsByDate[dateStr];
    if (!u) return [];
    const opts = [];
    const total = (u.bim?.length || 0) + (u.pc?.length || 0);
    if (total > 1) opts.push({ value: "all", label: `All models (${total})` });
    (u.bim || []).forEach((it, i) =>
      opts.push({
        value: `bim:${i}`,
        label: `BIM · ${it.description || it.file?.split("/").pop() || "model"}`,
      }),
    );
    (u.pc || []).forEach((it, i) =>
      opts.push({
        value: `pc:${i}`,
        label: `Point Cloud · ${it.description || it.file?.split("/").pop() || "cloud"}`,
      }),
    );
    return opts;
  };

  const onPickDate = (s) => (dateStr) => {
    const opts = modelOptions(dateStr);
    const sel = opts[0]?.value || "";
    setPick((p) => ({ ...p, [s]: { date: dateStr, sel } }));
    setCalOpen(null);
    if (sel) loadSide(s, dateStr, sel);
  };

  // Once the upload dates arrive, fill both sides so the page never starts on
  // a blank "Pick date" screen: Side A gets the date already open in the
  // Viewer (see PersistentWorkspace) or else the second-latest date, and Side
  // B the latest other date. Fires once only — later Viewer date changes
  // don't retroactively overwrite a comparison set up here by hand.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (autoPickedRef.current) return;
    const dates = Object.keys(uploadsByDate).sort();
    if (!dates.length) return;
    autoPickedRef.current = true;
    const a =
      initialDate && uploadsByDate[initialDate]
        ? initialDate
        : dates[Math.max(0, dates.length - 2)];
    const b = [...dates].reverse().find((d) => d !== a);
    onPickDate("A")(a);
    if (b) onPickDate("B")(b);
    // eslint-disable-next-line
  }, [initialDate, uploadsByDate]);

  const onPickModel = (s) => (e) => {
    const sel = e.target.value;
    setPick((p) => ({ ...p, [s]: { ...p[s], sel } }));
    loadSide(s, pick[s].date, sel);
  };

  // ── Align slider change ────────────────────────────────────────────────────────
  const setAlignField = (s, field, value) => {
    const al = alignRef.current;
    const next = { ...al, [s]: { ...al[s], [field]: value } };
    commitAlign(next);
    applyAlign(s, next[s]);
  };
  const resetAlign = (s) => {
    const next = { ...alignRef.current, [s]: { ...DEFAULT_ALIGN } };
    commitAlign(next);
    applyAlign(s, next[s]);
    setNotice((n) => ({ ...n, [s]: "" }));
  };

  // ── Clip drag — 'v' (vertical line, X) or 'h' (horizontal line, Y) ─────────────
  const draggingRef = useRef(null); // 'v' | 'h' | null
  useEffect(() => {
    const onMove = (ev) => {
      if (!draggingRef.current || !mountRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      if (draggingRef.current === "v") {
        const f = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        vClipRef.current = f;
        setVClip(f);
      } else {
        const f = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        hClipRef.current = f;
        setHClip(f);
      }
      updateClip();
    };
    const onUp = () => (draggingRef.current = null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateClip]);

  // ── UI bits ─────────────────────────────────────────────────────────────────
  const sidePicker = (s) => {
    const accent = SIDE_ACCENT[s];
    const p = pick[s];
    const opts = p.date ? modelOptions(p.date) : [];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: accent, fontWeight: 700, fontSize: 11 }}>
          {s === "A" ? "LEFT — A" : "RIGHT — B"}
        </span>
        <button
          ref={calRef[s]}
          onClick={() => setCalOpen((o) => (o === s ? null : s))}
          style={{
            ...calBtnStyle,
            background: p.date ? `${accent}18` : "#f1f5f9",
            color: p.date ? accent : "#64748b",
            border: `1px solid ${p.date ? accent : "transparent"}`,
          }}
        >
          <CalendarDays size={12} strokeWidth={2} />
          {p.date || "Pick date"}
        </button>
        {opts.length > 0 && (
          <select
            value={p.sel}
            onChange={onPickModel(s)}
            style={{
              fontSize: 11,
              padding: "4px 6px",
              borderRadius: 6,
              border: `1px solid ${accent}55`,
              color: "#334155",
              background: "#fff",
              maxWidth: 180,
            }}
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {loading[s] && (
          <span style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700 }}>
            LOADING…
          </span>
        )}
        {notice[s] && !loading[s] && !err[s] && (
          <span
            title="This side's model doesn't overlap the other side's, so it was moved onto it for comparison. Align the models in the Viewer and save, or press Reset in the Align panel to put it back."
            style={{ color: "#d97706", fontSize: 10, fontWeight: 600 }}
          >
            ⓘ {notice[s]}
          </span>
        )}
        {err[s] && !loading[s] && (
          <span
            title={err[s]}
            style={{
              color: "#ef4444",
              fontSize: 10,
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            ⚠ {err[s]}
          </span>
        )}
        {calOpen === s && (
          <MonthCalendar
            uploadsByDate={uploadsByDate}
            selectedDate={p.date}
            onDateSelect={onPickDate(s)}
            onClose={() => setCalOpen(null)}
            accent={accent}
            anchorEl={calRef[s].current}
          />
        )}
      </div>
    );
  };

  const alignControls = (s) => {
    const accent = SIDE_ACCENT[s];
    const a = align[s];
    const row = (label, field, min, max, step, suffix) => (
      <div
        key={field}
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}
      >
        <span style={{ width: 52, fontSize: 10, color: "#475569" }}>{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={a[field]}
          onChange={(e) => setAlignField(s, field, parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: accent }}
        />
        <span
          style={{ width: 42, textAlign: "right", fontSize: 10, color: "#0f172a" }}
        >
          {field === "opacity"
            ? `${Math.round(a[field] * 100)}%`
            : field === "scale"
              ? `${a[field].toFixed(2)}×`
              : `${Math.round(a[field])}${suffix}`}
        </span>
      </div>
    );
    return (
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ color: accent, fontWeight: 700, fontSize: 11 }}>
            {s === "A" ? "Side A" : "Side B"}
          </span>
          <button
            onClick={() => resetAlign(s)}
            style={{
              fontSize: 9,
              padding: "2px 8px",
              borderRadius: 5,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#64748b",
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
        {row("Rot X", "rx", -180, 180, 1, "°")}
        {row("Rot Y", "ry", -180, 180, 1, "°")}
        {row("Rot Z", "rz", -180, 180, 1, "°")}
        {row("⇆ L/R", "px", -100, 100, 0.5, " m")}
        {row("⇅ Up/Dn", "py", -100, 100, 0.5, " m")}
        {row("⊙ F/B", "pz", -100, 100, 0.5, " m")}
        {row("Opacity", "opacity", 0, 1, 0.01, "")}
        {row("Scale", "scale", 0.1, 5, 0.05, "")}
      </div>
    );
  };

  const vpct = Math.round(vClip * 100);
  const toggleBtn = (label, on, onClick) => (
    <button
      onClick={onClick}
      style={{
        ...calBtnStyle,
        background: on ? "#eef2ff" : "#f1f5f9",
        color: on ? "#4f46e5" : "#94a3b8",
        border: `1px solid ${on ? "#c7d2fe" : "transparent"}`,
      }}
    >
      {label}: {on ? "On" : "Off"}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Control bar */}
      <div
        style={{
          minHeight: 44,
          flexShrink: 0,
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "6px 14px",
          flexWrap: "wrap",
        }}
      >
        {sidePicker("A")}
        <div style={{ width: 1, height: 22, background: "#e5e7eb" }} />
        {sidePicker("B")}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {toggleBtn("Vert clip", vOn, () => setVOn((o) => !o))}
          {toggleBtn("Horiz clip", hOn, () => setHOn((o) => !o))}
          <button
            onClick={() => setPanelOpen((o) => !o)}
            style={{
              ...calBtnStyle,
              background: panelOpen ? "#eef2ff" : "#f1f5f9",
              color: panelOpen ? "#4f46e5" : "#64748b",
              border: "1px solid transparent",
            }}
          >
            {panelOpen ? "Hide align" : "Align"}
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div
        ref={mountRef}
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background: "#eef2f6",
        }}
      >
        <div style={overlayLabel("left", SIDE_ACCENT.A)}>
          A · {pick.A.date || "—"}
        </div>
        <div style={overlayLabel("right", SIDE_ACCENT.B)}>
          B · {pick.B.date || "—"}
        </div>
        {overlay && (
          <div
            style={{
              ...overlayLabel("left", SIDE_ACCENT[overlay]),
              left: "50%",
              transform: "translateX(-50%)",
              background: SIDE_ACCENT[overlay],
              color: "#fff",
            }}
          >
            OVERLAY · {overlay} ({pick[overlay].date || "—"}) ghosted over{" "}
            {overlay === "A" ? "B" : "A"} · drag handle back to split
          </div>
        )}

        {/* Vertical clip handle (drives the X clip plane) */}
        {vOn && (
          <div
            onMouseDown={() => (draggingRef.current = "v")}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${vClip * 100}%`,
              width: 0,
              zIndex: 20,
              cursor: "col-resize",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: -1.5,
                width: 3,
                background: "#ffffff",
                boxShadow: "0 0 0 1px rgba(15,23,42,0.25)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: -13,
                transform: "translateY(-50%)",
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 2px 8px rgba(15,23,42,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#475569",
              }}
            >
              <ChevronLeft size={11} />
              <ChevronRight size={11} />
            </div>
          </div>
        )}

        {/* Horizontal clip handle (drives the Y clip plane) */}
        {hOn && (
          <div
            onMouseDown={() => (draggingRef.current = "h")}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${hClip * 100}%`,
              height: 0,
              zIndex: 20,
              cursor: "row-resize",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: -1.5,
                height: 3,
                background: "#ffffff",
                boxShadow: "0 0 0 1px rgba(15,23,42,0.25)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: -13,
                transform: "translateX(-50%)",
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 2px 8px rgba(15,23,42,0.3)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#475569",
              }}
            >
              <ChevronLeft size={11} style={{ transform: "rotate(90deg)" }} />
              <ChevronRight size={11} style={{ transform: "rotate(90deg)" }} />
            </div>
          </div>
        )}

        {/* Manual alignment panel */}
        {panelOpen && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 25,
              width: 250,
              maxHeight: "calc(100% - 20px)",
              overflowY: "auto",
              background: "rgba(255,255,255,0.97)",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              boxShadow: "0 12px 32px rgba(15,23,42,0.16)",
              padding: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#0f172a",
                marginBottom: 8,
              }}
            >
              Manual Alignment
            </div>
            {alignControls("A")}
            {alignControls("B")}
            <div
              style={{
                fontSize: 10,
                color: "#94a3b8",
                marginTop: 4,
                lineHeight: 1.4,
              }}
            >
              Rotations pivot around each model’s centre. Models load in their
              saved geo-aligned pose; nudge here to compare.
            </div>
          </div>
        )}

        <BlenderViewportGizmo cameraRef={cameraRef} controlsRef={controlsRef} />
      </div>

      {/* Bottom clip readout */}
      <div
        style={{
          flexShrink: 0,
          height: 26,
          background: "#fff",
          borderTop: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
          fontSize: 10,
          color: "#94a3b8",
        }}
      >
        Drag a handle to move the 3D clip plane · vertical {vpct}% / {100 - vpct}%
        {hOn ? ` · horizontal ${Math.round(hClip * 100)}%` : ""}
        {" · drag a handle to the edge to overlay both dates"}
      </div>
    </div>
  );
}

function overlayLabel(side, color) {
  return {
    position: "absolute",
    top: 8,
    [side]: 10,
    zIndex: 15,
    padding: "3px 9px",
    borderRadius: 6,
    background: "rgba(255,255,255,0.9)",
    border: `1px solid ${color}55`,
    color,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    pointerEvents: "none",
  };
}


export default function AnalyticsPage({
  routeParam: routeParamProp,
  initialDate,
} = {}) {
  // Accepts routeParam as a prop (from PersistentWorkspace, which keeps this
  // page mounted across navigation to the Viewer/Progress) — falls back to
  // the route param so this still works if ever rendered directly by a
  // matched <Route>.
  const params = useParams();
  const routeParam = routeParamProp ?? params.slug;

  // The route param is usually a name-only slug ("a2b") with no id in it, so
  // resolve it against the project list the same way the Viewer does —
  // otherwise Analytics would end up with no project id and no upload dates.
  const [projectId, setProjectId] = useState(() =>
    getProjectIdFromSlug(routeParam),
  );
  const [projectName, setProjectName] = useState("");
  const [uploadsByDate, setUploadsByDate] = useState({});
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const role = localStorage.getItem("role") || "viewer";
  const [activePanel, setActivePanel] = useState(null);

  useEffect(() => {
    setProjectId(getProjectIdFromSlug(routeParam));
    setProjectName("");
    if (!routeParam) return;
    let cancelled = false;
    API.get("projects/")
      .then((res) => {
        if (cancelled) return;
        const project = (res.data || []).find(
          (p) =>
            String(p.id) === String(routeParam) ||
            p.slug === routeParam ||
            createProjectSlug(p) === routeParam,
        );
        if (project) {
          setProjectId(project.id);
          setProjectName(project.project_name);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[Analytics] could not fetch projects", e);
        setFetchError("Could not load project");
      });
    return () => {
      cancelled = true;
    };
  }, [routeParam]);

  useEffect(() => {
    if (!projectId) {
      setUploadsByDate({});
      return;
    }
    setFetching(true);
    setFetchError("");
    Promise.all([
      API.get(`projects/${projectId}/bim/`),
      API.get(`projects/${projectId}/pointcloud/`),
    ])
      .then(([bimRes, pcRes]) => {
        const byDate = {};
        const merge = (items, type) => {
          (items || []).forEach((item) => {
            if (!item.date) return;
            if (!byDate[item.date]) byDate[item.date] = { bim: [], pc: [] };
            byDate[item.date][type].push(item);
          });
        };
        merge(bimRes.data, "bim");
        merge(pcRes.data, "pc");
        setUploadsByDate(byDate);
      })
      .catch((e) => {
        console.error("[Analytics] could not fetch uploads", e);
        setUploadsByDate({});
        setFetchError(
          e?.response?.status
            ? `Could not load uploads (server returned ${e.response.status})`
            : "Could not load uploads (server unreachable)",
        );
      })
      .finally(() => setFetching(false));
  }, [projectId]);

  const uploadDateCount = Object.keys(uploadsByDate).length;

  const handleSelectPanel = (panelId) =>
    setActivePanel((prev) => (prev === panelId ? null : panelId));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 52,
        display: "flex",
        flexDirection: "column",
        background: "#f0f4f8",
        overflow: "hidden",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <Header />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <IconToolbar
          activePanel={activePanel}
          onSelectPanel={handleSelectPanel}
          role={role}
          projectSlug={routeParam}
        />

        {activePanel && (
          <div
            style={{
              width: 216,
              flexShrink: 0,
              background: "#ffffff",
              borderRight: "1px solid #e5e7eb",
              boxShadow: "2px 0 12px rgba(0,0,0,0.04)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <ContextPanel
              activePanel={activePanel}
              onClosePanel={() => setActivePanel(null)}
              role={role}
              bimVisible={false}
              pcVisible={false}
              setBimVisible={() => {}}
              setPcVisible={() => {}}
              setBimFile={() => {}}
              setPointFile={() => {}}
              setCameraPositionsFile={() => {}}
              showCameras={false}
              setShowCameras={() => {}}
              selectedElement={null}
              highlightOverlap={false}
              setHighlightOverlap={() => {}}
              bimElementCount={0}
              overlapElementCount={0}
              bimPoints={[]}
              pcPoints={[]}
              sectionBoxActive={false}
              toggleSegmentation={() => {}}
              isSegmented={false}
              isSegmenting={false}
              wasCompressed={false}
              manualCameras={[]}
              onToggleManualCamera={() => {}}
              onDeleteManualCamera={() => {}}
            />
          </div>
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Project info bar */}
          <div
            style={{
              height: 36,
              flexShrink: 0,
              background: "#ffffff",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
            }}
          >
            <FolderOpen size={13} color="#6b7280" strokeWidth={1.8} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>
              {projectName || (projectId ? `Project #${projectId}` : routeParam)}
            </span>
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              · Day-wise comparison (wipe between two dates)
            </span>
            {fetching && (
              <span
                style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}
              >
                LOADING…
              </span>
            )}
            {!fetching && uploadDateCount > 0 && (
              <span style={{ fontSize: 10, color: "#6b7280" }}>
                · {uploadDateCount} date{uploadDateCount !== 1 ? "s" : ""} with
                uploads
              </span>
            )}
            {!fetching && fetchError && (
              <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>
                · ⚠ {fetchError}
              </span>
            )}
            {!fetching && !fetchError && projectId && uploadDateCount === 0 && (
              <span style={{ fontSize: 10, color: "#9ca3af" }}>
                · No BIM / point cloud uploads in this project yet — add them
                under Project → 3D Data
              </span>
            )}
          </div>

          {/* Curtain comparison */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <CompareScene
              key={projectId}
              uploadsByDate={uploadsByDate}
              initialDate={initialDate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
