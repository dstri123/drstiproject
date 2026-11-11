import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Loader, Maximize2, Pause, Play } from "lucide-react";
import API from "../../api/axios";
import { fetchAsArrayBuffer, getFileUrl, parseIfc } from "@/lib/ifcModel";
import { isoDay } from "./scheduleParser";

// 4D view: the project's IFC model coloured by schedule status. The server
// links every IFC element (by express ID) to its activity with the same rules
// the dashboard uses for measured progress (processing/progress/schedule-4d),
// so this view and the Main Table / Gantt always agree.
//
// "Planned" mode shows the plan on the slider date (built / in progress /
// not started); "Actual" mode shows each element's measured status from the
// latest Progress Assessment, with not-built elements whose activity should
// already be finished flagged red.

const DAY_MS = 86400000;

// Element colour states. Ghost states aren't drawn solid: they go to a faint
// see-through mesh so the built / planned part of the model stands out.
const STATES = {
  done: { label: "Built (per plan)", color: "#cbd5e1" },
  active: { label: "In progress (per plan)", color: "#f59e0b" },
  future: { label: "Not started", ghost: true },
  a_done: { label: "Built", color: "#22c55e" },
  a_progress: { label: "Partly built", color: "#f59e0b" },
  a_behind: { label: "Not built, planned done by scan", color: "#ef4444" },
  a_notdue: { label: "Not built, not due yet", ghost: true },
  a_nodata: { label: "Not measured", ghost: true },
  selected: { label: "Selected activity", color: "#2563eb" },
  filtered: { label: "Hidden by filters", ghost: true },
  unlinked: { label: "Not in schedule", ghost: true },
};
const LEGEND = {
  planned: ["done", "active", "future", "selected", "filtered", "unlinked"],
  actual: ["a_done", "a_progress", "a_behind", "a_notdue", "a_nodata", "selected", "filtered", "unlinked"],
};
const STATE_RGB = Object.fromEntries(
  Object.entries(STATES)
    .filter(([, s]) => !s.ghost)
    .map(([k, s]) => [k, new THREE.Color(s.color)]),
);

function elementState(act, { mode, date, selectedId, visibleIds, measured, scanDate }) {
  if (!act) return "unlinked";
  if (act.id === selectedId) return "selected";
  if (visibleIds && !visibleIds.has(act.id)) return "filtered";
  if (mode === "actual") {
    if (!measured) return "a_nodata";
    if (measured === "completed") return "a_done";
    if (measured === "in_progress") return "a_progress";
    return scanDate && act.finish <= scanDate ? "a_behind" : "a_notdue";
  }
  if (date > act.finish) return "done";
  if (date >= act.start) return "active";
  return "future";
}

function plannedStateLabel(act, date) {
  if (date > act.finish) return "Finished (per plan)";
  if (date >= act.start) return "In progress (per plan)";
  return "Not started (per plan)";
}

// Split web-ifc's merged IFC mesh into a solid + a ghost mesh that share its
// vertex buffers; paint() only rewrites the colours and the two index lists.
function buildModel(ifcModel) {
  const src = ifcModel.geometry;
  src.computeBoundingBox();
  src.computeBoundingSphere();
  const index = src.index.array;
  const vertexExp = src.getAttribute("expressID").array;
  const triExp = new Uint32Array(index.length / 3);
  for (let t = 0; t < triExp.length; t++) triExp[t] = vertexExp[index[t * 3]];
  const color = new THREE.BufferAttribute(new Float32Array(src.getAttribute("position").count * 3), 3);

  const make = (material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", src.getAttribute("position"));
    g.setAttribute("normal", src.getAttribute("normal"));
    g.setAttribute("color", color);
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(index.length), 1));
    g.boundingBox = src.boundingBox;
    g.boundingSphere = src.boundingSphere;
    return new THREE.Mesh(g, material);
  };
  const solid = make(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const ghost = make(
    new THREE.MeshLambertMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ghost.renderOrder = 1;
  return { solid, ghost, index, triExp, vertexExp, color, box: src.boundingBox, elements: Array.from(new Set(triExp)) };
}

function paint(model, stateOf) {
  const { solid, ghost, index, triExp, vertexExp, color } = model;
  const rgb = new Map(); // expressID -> THREE.Color, or null when ghosted
  const counts = {};
  model.elements.forEach((exp) => {
    const st = stateOf(exp);
    counts[st] = (counts[st] || 0) + 1;
    rgb.set(exp, STATE_RGB[st] || null);
  });

  const col = color.array;
  for (let v = 0; v < vertexExp.length; v++) {
    const c = rgb.get(vertexExp[v]);
    if (!c) continue;
    col[v * 3] = c.r;
    col[v * 3 + 1] = c.g;
    col[v * 3 + 2] = c.b;
  }
  color.needsUpdate = true;

  const s = solid.geometry.index;
  const g = ghost.geometry.index;
  let ns = 0;
  let ng = 0;
  for (let t = 0; t < triExp.length; t++) {
    const i = t * 3;
    if (rgb.get(triExp[t])) {
      s.array[ns++] = index[i];
      s.array[ns++] = index[i + 1];
      s.array[ns++] = index[i + 2];
    } else {
      g.array[ng++] = index[i];
      g.array[ng++] = index[i + 1];
      g.array[ng++] = index[i + 2];
    }
  }
  s.needsUpdate = true;
  g.needsUpdate = true;
  solid.geometry.setDrawRange(0, ns);
  ghost.geometry.setDrawRange(0, ng);
  return counts;
}

function disposeModel(model) {
  if (!model) return;
  [model.solid, model.ghost].forEach((m) => {
    m.removeFromParent();
    m.geometry.dispose();
    m.material.dispose();
  });
}

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const barBtn = (active) => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  background: active ? "#eff6ff" : "#fff",
  color: active ? "#2563eb" : "#334155",
  fontSize: 12,
  fontWeight: active ? 600 : 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

export default function Schedule4DView({
  projectId,
  activities,
  visibleIds,
  selectedId,
  onSelect,
  scheduleStart,
  scheduleFinish,
  today,
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);

  const [bims, setBims] = useState([]);
  const [bimId, setBimId] = useState(null);
  const [link, setLink] = useState(null); // schedule-4d response
  const [modelVersion, setModelVersion] = useState(0);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("planned");
  const [counts, setCounts] = useState({});
  const [playing, setPlaying] = useState(false);

  const totalDays = Math.max(0, Math.round((scheduleFinish - scheduleStart) / DAY_MS));
  const [dayIdx, setDayIdx] = useState(() =>
    Math.min(totalDays, Math.max(0, Math.round((today - scheduleStart) / DAY_MS))),
  );
  const date = isoDay(new Date(scheduleStart.getTime() + dayIdx * DAY_MS));

  const actById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const selected = selectedId ? actById.get(selectedId) : null;
  const selectedCount = useMemo(
    () => (link && selectedId ? Object.values(link.elements).filter((id) => id === selectedId).length : 0),
    [link, selectedId],
  );
  const hasActual = Boolean(link && link.scan_date && Object.keys(link.actual).length);

  // ── Scene ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f1f5f9");
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight || 1, 0.1, 10000);
    camera.position.set(60, 50, 60);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(40, 80, 30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-40, 20, -30);
    scene.add(fill);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeModel(modelRef.current);
      modelRef.current = null;
      renderer.dispose();
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const fitView = () => {
    const model = modelRef.current;
    if (!model) return;
    const size = model.box.getSize(new THREE.Vector3());
    const center = model.box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) || 30;
    const camera = cameraRef.current;
    camera.near = Math.max(d / 1000, 0.01);
    camera.far = d * 50;
    camera.updateProjectionMatrix();
    camera.position.set(center.x + d * 0.9, center.y + d * 0.7, center.z + d * 0.9);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  };

  // ── IFC models for this project ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    API.get(`projects/${projectId}/bim/`)
      .then((res) => {
        if (cancelled) return;
        const ifcs = (res.data || []).filter((b) => /\.ifc$/i.test(b.file?.split("?")[0] || ""));
        setBims(ifcs);
        if (ifcs.length) setBimId(ifcs[0].id);
        else setError("No IFC model uploaded for this project yet — upload one under Project → 3D Data.");
      })
      .catch(() => !cancelled && setError("Couldn't load the project's BIM models."));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Load the chosen model + its element ↔ activity links ──────────────────
  useEffect(() => {
    const bim = bims.find((b) => b.id === bimId);
    if (!bim) return;
    let cancelled = false;
    setError("");
    setLoading("Loading model and linking it to the schedule…");
    disposeModel(modelRef.current);
    modelRef.current = null;
    setLink(null);

    Promise.all([
      API.get(`processing/progress/schedule-4d/${projectId}/`, { params: { bim: bim.id } }),
      fetchAsArrayBuffer(getFileUrl(bim.file)).then(parseIfc),
    ])
      .then(([linkRes, ifcModel]) => {
        const model = buildModel(ifcModel);
        // Only the geometry arrays are needed — free web-ifc's copy right away.
        ifcModel.close();
        if (cancelled) {
          disposeModel(model);
          return;
        }
        sceneRef.current.add(model.solid, model.ghost);
        modelRef.current = model;
        setLink(linkRes.data);
        setModelVersion((v) => v + 1);
        fitView();
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[4D] load failed", e);
        setError(e.response?.data?.error || `Couldn't load the model: ${e.message}`);
      })
      .finally(() => !cancelled && setLoading(""));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [bims, bimId, projectId]);

  // ── Recolour on any change ─────────────────────────────────────────────────
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !link) return;
    const ctx = { mode, date, selectedId, visibleIds, scanDate: link.scan_date };
    setCounts(
      paint(model, (exp) =>
        elementState(actById.get(link.elements[exp]), { ...ctx, measured: link.actual[exp] }),
      ),
    );
  }, [modelVersion, link, mode, date, selectedId, visibleIds, actById]);

  // ── Playback: run through the whole schedule in ~12 s ─────────────────────
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round(totalDays / 120));
    const timer = setInterval(() => {
      setDayIdx((d) => {
        if (d >= totalDays) {
          setPlaying(false);
          return d;
        }
        return Math.min(totalDays, d + step);
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, totalDays]);

  // ── Click an element → select its activity ────────────────────────────────
  const downRef = useRef(null);
  const onPointerDown = (e) => (downRef.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e) => {
    const down = downRef.current;
    const model = modelRef.current;
    if (!down || !model || !link) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // orbit drag
    const rect = mountRef.current.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cameraRef.current);
    const hits = ray.intersectObjects([model.solid, model.ghost], false);
    // Prefer the first solid element; ghosts are see-through.
    const hit = hits.find((h) => h.object === model.solid) || hits[0];
    if (!hit) return onSelect(null);
    const aid = link.elements[model.vertexExp[hit.face.a]] || null;
    onSelect(aid && aid === selectedId ? null : aid);
  };

  const legendKeys = LEGEND[mode].filter((k) => counts[k] || ["selected", "filtered"].indexOf(k) < 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* ---------- 4D toolbar ---------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" }}>
        {bims.length > 1 && (
          <select
            value={bimId ?? ""}
            onChange={(e) => setBimId(Number(e.target.value))}
            style={{ ...barBtn(false), maxWidth: 220 }}
            title="IFC model to colour"
          >
            {bims.map((b) => (
              <option key={b.id} value={b.id}>
                {b.description || b.file.split("/").pop()} · {b.date}
              </option>
            ))}
          </select>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          <button style={barBtn(mode === "planned")} onClick={() => setMode("planned")}>
            Planned
          </button>
          <button
            style={{ ...barBtn(mode === "actual"), opacity: hasActual ? 1 : 0.5, cursor: hasActual ? "pointer" : "not-allowed" }}
            disabled={!hasActual}
            title={hasActual ? `Measured on the ${fmtDate(link.scan_date)} scan` : "Run a Progress Assessment to see measured progress"}
            onClick={() => {
              setPlaying(false);
              setMode("actual");
            }}
          >
            Actual{hasActual && ` (scan ${fmtDate(link.scan_date)})`}
          </button>
        </div>

        {mode === "planned" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 260 }}>
            <button
              style={barBtn(playing)}
              onClick={() => {
                if (!playing && dayIdx >= totalDays) setDayIdx(0);
                setPlaying((p) => !p);
              }}
              title={playing ? "Pause" : "Play the schedule"}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <input
              type="range"
              min={0}
              max={totalDays}
              value={dayIdx}
              onChange={(e) => {
                setPlaying(false);
                setDayIdx(Number(e.target.value));
              }}
              style={{ flex: 1, accentColor: "#2563eb" }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", minWidth: 96, textAlign: "right" }}>{fmtDate(date)}</span>
          </div>
        ) : (
          <span style={{ flex: 1, fontSize: 12, color: "#64748b" }}>
            Measured status of each element on the latest scan; red = should be built by then but isn't.
          </span>
        )}
        <button style={barBtn(false)} onClick={fitView} title="Fit the model">
          <Maximize2 size={14} />
        </button>
      </div>

      {/* ---------- viewport ---------- */}
      <div
        ref={mountRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}
      >
        {(loading || error) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: error ? "#b91c1c" : "#334155", display: "flex", gap: 8, alignItems: "center", maxWidth: 420, boxShadow: "0 8px 24px rgba(15,23,42,0.08)" }}>
              {loading && !error && <Loader size={16} />}
              {error || loading}
            </div>
          </div>
        )}

        {link && (
          <div style={{ position: "absolute", left: 12, bottom: 12, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#334155", minWidth: 220 }}>
            {legendKeys.map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: STATES[k].ghost ? "transparent" : STATES[k].color,
                    border: STATES[k].ghost ? "1px dashed #94a3b8" : "none",
                  }}
                />
                <span style={{ flex: 1 }}>{STATES[k].label}</span>
                <span style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{(counts[k] || 0).toLocaleString()}</span>
              </div>
            ))}
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #f1f5f9", color: "#94a3b8", fontSize: 11 }}>
              {link.linked_count.toLocaleString()} of {link.element_count.toLocaleString()} elements linked · click one to select its activity
            </div>
          </div>
        )}

        {selected && (
          <div style={{ position: "absolute", right: 12, top: 12, width: 260, background: "#fff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#334155", boxShadow: "0 8px 24px rgba(15,23,42,0.08)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#2563eb", fontWeight: 700 }}>{selected.id} · {selected.level}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selected.name}</div>
              </div>
              <button onClick={() => onSelect(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, lineHeight: 1 }} title="Clear selection">
                ×
              </button>
            </div>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px" }}>
              <span style={{ color: "#94a3b8" }}>Planned</span>
              <span>{fmtDate(selected.start)} – {fmtDate(selected.finish)}</span>
              <span style={{ color: "#94a3b8" }}>On {fmtDate(date)}</span>
              <span>{plannedStateLabel(selected, date)}</span>
              {selected.progress && selected.actual?.matched > 0 && (
                <>
                  <span style={{ color: "#94a3b8" }}>Measured</span>
                  <span>{selected.actual.actual_pct}% · {selected.progress.label}</span>
                </>
              )}
              <span style={{ color: "#94a3b8" }}>Elements</span>
              <span>{selectedCount.toLocaleString()} in this model{selected.ifcTypes && ` (${selected.ifcTypes})`}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
