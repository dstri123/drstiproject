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
import { getProjectIdFromSlug } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  FolderOpen,
  Eye,
  EyeOff,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const MEDIA_BASE = "http://127.0.0.1:8000";

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

// ─── File fetcher ─────────────────────────────────────────────────────────────
// Downloads a media file from the backend as a Blob URL.
// Using fetch (not the Three.js XHR loader) ensures the auth token is sent and
// the response is fully buffered before being handed to IFCLoader/PLYLoader —
// the same mechanism used when a user uploads a local file.
async function fetchAsBlob(url) {
  const token = localStorage.getItem("token") || localStorage.getItem("access");
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Server returned ${res.status} for ${url}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Convert an .ifc (server URL) to a GLB blob URL via the backend converter —
// the same endpoint the Viewer uses (with its disk cache), so the browser
// never loads web-ifc/WASM here.
async function ifcUrlToGlbBlobUrl(ifcServerUrl) {
  const tmpUrl = await fetchAsBlob(ifcServerUrl);
  const ifcBlob = await (await fetch(tmpUrl)).blob();
  URL.revokeObjectURL(tmpUrl);
  const fd = new FormData();
  fd.append("file", ifcBlob, "model.ifc");
  const res = await API.post("processing/tools/ifc-to-glb/", fd, {
    responseType: "blob",
  });
  return URL.createObjectURL(res.data);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Build a full URL for a Django media file.
// Django DRF FileField serialises to the upload_to-relative path
// e.g. "bim_files/As_Planned.ifc" → must become
//      http://127.0.0.1:8000/media/bim_files/As_Planned.ifc
function getFileUrl(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith("http://") || filePath.startsWith("https://"))
    return filePath;
  const withSlash = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const withMedia = withSlash.startsWith("/media/")
    ? withSlash
    : `/media${withSlash}`;
  return `${MEDIA_BASE}${withMedia}`;
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

function CompareScene({ uploadsByDate }) {
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
  const [align, setAlign] = useState({
    A: { ...DEFAULT_ALIGN },
    B: { ...DEFAULT_ALIGN },
  });
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

    // Vertical curtain (X): A keeps x<=cx (normal -X), B keeps x>=cx (+X).
    vPlane.A.current = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    vPlane.B.current = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    // Horizontal curtain (Y): A keeps y<=cy (normal -Y), B keeps y>=cy (+Y).
    hPlane.A.current = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    hPlane.B.current = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

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
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
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

  const updateClip = useCallback(() => {
    const box = new THREE.Box3();
    let any = false;
    for (const s of ["A", "B"]) {
      if (objRef[s].current) {
        box.union(new THREE.Box3().setFromObject(objRef[s].current));
        any = true;
      }
    }
    if (!any || box.isEmpty()) return;
    // Vertical curtain along X.
    const cx = box.min.x + vClipRef.current * (box.max.x - box.min.x);
    if (vPlane.A.current) vPlane.A.current.constant = cx; // A keeps x<=cx
    if (vPlane.B.current) vPlane.B.current.constant = -cx; // B keeps x>=cx
    // Horizontal curtain along Y (handle top→bottom maps high→low Y).
    const cy = box.min.y + (1 - hClipRef.current) * (box.max.y - box.min.y);
    if (hPlane.A.current) hPlane.A.current.constant = cy; // A keeps y<=cy
    if (hPlane.B.current) hPlane.B.current.constant = -cy; // B keeps y>=cy
    // eslint-disable-next-line
  }, []);

  // Assign the active clip planes to each side's materials based on the
  // vertical/horizontal toggles. A fragment is kept only if inside ALL planes,
  // so with both on you get a quadrant reveal; with one on, a clean wipe.
  const reassignPlanes = useCallback(() => {
    for (const s of ["A", "B"]) {
      const obj = objRef[s].current;
      if (!obj) continue;
      const planes = [];
      if (vOnRef.current && vPlane[s].current) planes.push(vPlane[s].current);
      if (hOnRef.current && hPlane[s].current) planes.push(hPlane[s].current);
      eachMaterial(obj, (m) => {
        m.clippingPlanes = planes;
      });
    }
    // eslint-disable-next-line
  }, []);

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
      eachMaterial(obj, (m) => m.dispose());
      obj.traverse((n) => n.geometry && n.geometry.dispose());
      sceneRef.current.remove(obj);
    }
    objRef[s].current = null;
    baseRef[s].current = null;
    centerRef[s].current = null;
  };

  // Apply rotation(about centre)/scale/opacity for a side from its align state.
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
    eachMaterial(obj, (m) => {
      m.transparent = true;
      m.opacity = a.opacity;
    });
    updateClip();
    // eslint-disable-next-line
  }, [updateClip]);

  // ── Load a side's chosen model ───────────────────────────────────────────────
  const loadSide = useCallback(
    async (s, dateStr, sel) => {
      if (!dateStr || !sel) return;
      const [kind, idxStr] = sel.split(":");
      const idx = parseInt(idxStr, 10) || 0;
      const item = uploadsByDate[dateStr]?.[kind]?.[idx];
      if (!item) return;

      setErr((e) => ({ ...e, [s]: "" }));
      setLoading((l) => ({ ...l, [s]: true }));
      disposeSide(s);

      const finish = (obj) => {
        // saved geo-aligned pose first.
        applySavedTransform(obj, item.transform);
        // BIM gets the clean "white + edge lines" technical look; point clouds
        // keep their real colours.
        if (kind === "bim") applyCleanBim(obj);
        sceneRef.current.add(obj);
        objRef[s].current = obj;
        obj.updateMatrixWorld(true);
        baseRef[s].current = obj.matrix.clone();
        centerRef[s].current = new THREE.Box3()
          .setFromObject(obj)
          .getCenter(new THREE.Vector3());
        // reset this side's alignment to neutral for the new model
        setAlign((al) => ({ ...al, [s]: { ...DEFAULT_ALIGN } }));
        reassignPlanes();
        updateClip();
        fitToAll();
      };

      try {
        const url = getFileUrl(item.file);
        if (kind === "pc") {
          // Determine extension from the stored file path.
          const storedExt = (item.file || "").split(".").pop().toLowerCase();
          let plyBlobUrl;

          if (storedExt === "ply") {
            // PLY: fetch and hand directly to PLYLoader.
            plyBlobUrl = await fetchAsBlob(url);
          } else {
            // Non-PLY (LAS/LAZ/PTS/XYZ): download raw, convert to PLY on the
            // backend so PLYLoader can render it with colors preserved.
            const token =
              localStorage.getItem("token") || localStorage.getItem("access");
            const rawRes = await fetch(url, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!rawRes.ok)
              throw new Error(`Server returned ${rawRes.status} for ${url}`);
            const rawBlob = await rawRes.blob();
            const filename = (item.file || "cloud.las").split("/").pop();
            const fd = new FormData();
            fd.append("file", rawBlob, filename);
            const convRes = await API.post(
              "processing/tools/pointcloud-to-ply/",
              fd,
              { headers: { "Content-Type": "multipart/form-data" }, responseType: "blob" }
            );
            plyBlobUrl = URL.createObjectURL(convRes.data);
          }

          await new Promise((resolve, reject) =>
            new PLYLoader().load(
              plyBlobUrl,
              (geometry) => {
                if (!geometry.attributes.color) {
                  const n = geometry.attributes.position.count;
                  geometry.setAttribute(
                    "color",
                    new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3),
                  );
                }
                const pts = new THREE.Points(
                  geometry,
                  new THREE.PointsMaterial({ size: 0.03, vertexColors: true }),
                );
                finish(pts);
                resolve();
              },
              undefined,
              reject,
            ),
          );
          URL.revokeObjectURL(plyBlobUrl);
        } else {
          const ext = url.split("?")[0].split(".").pop().toLowerCase();
          if (ext === "fbx") {
            const blob = await fetchAsBlob(url);
            await new Promise((resolve, reject) =>
              new FBXLoader().load(
                blob,
                (m) => {
                  finish(m);
                  resolve();
                },
                undefined,
                reject,
              ),
            );
            URL.revokeObjectURL(blob);
          } else if (ext === "glb" || ext === "gltf") {
            const blob = await fetchAsBlob(url);
            await new Promise((resolve, reject) =>
              new GLTFLoader().load(
                blob,
                (g) => {
                  finish(g.scene);
                  resolve();
                },
                undefined,
                reject,
              ),
            );
            URL.revokeObjectURL(blob);
          } else {
            const glbUrl = await ifcUrlToGlbBlobUrl(url);
            await new Promise((resolve, reject) =>
              new GLTFLoader().load(
                glbUrl,
                (g) => {
                  finish(g.scene);
                  resolve();
                },
                undefined,
                reject,
              ),
            );
            URL.revokeObjectURL(glbUrl);
          }
        }
      } catch (e) {
        console.error(`[Analytics] side ${s} load failed`, e);
        setErr((er) => ({ ...er, [s]: "Could not load" }));
      } finally {
        setLoading((l) => ({ ...l, [s]: false }));
      }
    },
    [uploadsByDate, updateClip, fitToAll, reassignPlanes],
  );

  // React to clip toggles: re-assign active planes + refresh constants.
  useEffect(() => {
    vOnRef.current = vOn;
    hOnRef.current = hOn;
    reassignPlanes();
    updateClip();
  }, [vOn, hOn, reassignPlanes, updateClip]);

  // ── Date / model selection ────────────────────────────────────────────────────
  const modelOptions = (dateStr) => {
    const u = uploadsByDate[dateStr];
    if (!u) return [];
    const opts = [];
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

  const onPickModel = (s) => (e) => {
    const sel = e.target.value;
    setPick((p) => ({ ...p, [s]: { ...p[s], sel } }));
    loadSide(s, pick[s].date, sel);
  };

  // ── Align slider change ────────────────────────────────────────────────────────
  const setAlignField = (s, field, value) => {
    setAlign((al) => {
      const next = { ...al, [s]: { ...al[s], [field]: value } };
      applyAlign(s, next[s]);
      return next;
    });
  };
  const resetAlign = (s) => {
    setAlign((al) => {
      const next = { ...al, [s]: { ...DEFAULT_ALIGN } };
      applyAlign(s, next[s]);
      return next;
    });
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
        {err[s] && !loading[s] && (
          <span style={{ color: "#ef4444", fontSize: 10 }}>⚠ {err[s]}</span>
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


export default function AnalyticsPage() {
  // Same route-param format as the Viewer (`${id}_${name}`) — reuse its helper
  // so Analytics resolves to the same project id, and therefore the same
  // upload dates shown on Project → 3D Data.
  const { slug: routeParam } = useParams();
  const projectId = getProjectIdFromSlug(routeParam);

  const [projectName, setProjectName] = useState("");
  const [uploadsByDate, setUploadsByDate] = useState({});
  const [fetching, setFetching] = useState(false);
  const role = localStorage.getItem("role") || "viewer";
  const [activePanel, setActivePanel] = useState(null);

  useEffect(() => {
    if (!projectId) {
      setProjectName("");
      return;
    }
    API.get("projects/")
      .then((res) => {
        const project = (res.data || []).find(
          (p) => String(p.id) === String(projectId),
        );
        if (project) setProjectName(project.project_name);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setUploadsByDate({});
      return;
    }
    setFetching(true);
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
      .catch(() => setUploadsByDate({}))
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
              {projectName || `Project #${projectId}`}
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
            {!fetching && projectId && uploadDateCount === 0 && (
              <span style={{ fontSize: 10, color: "#9ca3af" }}>
                · No uploads found
              </span>
            )}
          </div>

          {/* Curtain comparison */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <CompareScene uploadsByDate={uploadsByDate} />
          </div>
        </div>
      </div>
    </div>
  );
}
