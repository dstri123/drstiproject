import { useEffect, useRef, useState } from "react";

/*
 * Animated exploded-axonometric BIM stack for the login hero.
 * Geometry is generated once at module load; all motion runs in a single
 * rAF loop that writes transforms/opacity straight to the DOM (no re-renders).
 */

// ---------- isometric projection ----------
const K = 22;
const C = K * Math.cos(Math.PI / 6);
const S = K * 0.5;
const W = 10;
const D = 8;

const proj = ([x, y, z = 0]) => [(x - y) * C, (x + y) * S - z * K];
const fmt = (n) => n.toFixed(1);
const toPts = (arr) => arr.map((p) => proj(p).map(fmt).join(",")).join(" ");
const toPath = (arr) =>
  arr.map((p, i) => `${i ? "L" : "M"}${proj(p).map(fmt).join(" ")}`).join("");

// ---------- primitives (geometry as data) ----------
const poly = (p, c) => ({ t: "poly", p, c });
const line = (p, c) => ({ t: "path", p, c });

function box(x, y, z, w, d, h, tone = "") {
  return [
    poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], `f-top ${tone}`),
    poly([[x, y + d, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x, y + d, z]], `f-left ${tone}`),
    poly([[x + w, y, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x + w, y, z]], `f-right ${tone}`),
  ];
}

function wall([x1, y1, x2, y2], h, tone, th = 0.16) {
  if (y1 === y2) return box(Math.min(x1, x2), y1 - th / 2, 0, Math.abs(x2 - x1), th, h, tone);
  return box(x1 - th / 2, Math.min(y1, y2), 0, th, Math.abs(y2 - y1), h, tone);
}

// openings on the two viewer-facing exterior walls
const winY = (a, b, z1, z2, c = "win") => {
  const y = 7.7 + 0.09;
  const m = (a + b) / 2;
  return [poly([[a, y, z1], [b, y, z1], [b, y, z2], [a, y, z2]], c), line([[m, y, z1], [m, y, z2]], "mullion")];
};
const winX = (a, b, z1, z2, c = "win") => {
  const x = 9.7 + 0.09;
  const m = (a + b) / 2;
  return [poly([[x, a, z1], [x, b, z1], [x, b, z2], [x, a, z2]], c), line([[x, m, z1], [x, m, z2]], "mullion")];
};

// ---------- shared floor plan ----------
const EXT_BACK = [[0.3, 0.3, 9.7, 0.3], [0.3, 0.3, 0.3, 7.7]];
const EXT_FRONT = [[0.3, 7.7, 9.7, 7.7], [9.7, 0.3, 9.7, 7.7]];
const INT = [
  [4, 0.3, 4, 3.2], [4, 4.2, 4, 7.7], [0.3, 4, 3, 4],
  [7, 0.3, 7, 4.5], [4.6, 4.5, 6.2, 4.5], [7, 4.5, 9.7, 4.5],
];
const GRID = [1, 5, 9].flatMap((x) => [1, 4, 7].map((y) => [x, y])).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
const openings = (h) => [
  ...winY(1, 2.4, h * 0.38, h * 0.82), ...winY(5, 6.4, h * 0.38, h * 0.82), ...winY(7.8, 9, h * 0.38, h * 0.82),
  ...winY(3, 3.7, 0, h * 0.78, "door"),
  ...winX(1.2, 2.6, h * 0.38, h * 0.82), ...winX(5.4, 6.8, h * 0.38, h * 0.82),
];

// ---------- layers ----------
function foundation() {
  const s = [
    ...box(-0.3, -0.3, -0.85, W + 0.6, D + 0.6, 0.3, "t-deep"),
    ...box(0, 0, -0.5, W, D, 0.5, "t-mid"),
    line([[0.5, 0.5], [9.5, 0.5], [9.5, 7.5], [0.5, 7.5], [0.5, 0.5]], "ln-soft"),
    line([[1, 1], [9, 1], [9, 7], [1, 7], [1, 1]], "ln-ghost"),
  ];
  GRID.forEach(([x, y]) => {
    s.push(...box(x - 0.45, y - 0.45, 0, 0.9, 0.9, 0.18));
    s.push(...box(x - 0.15, y - 0.15, 0.18, 0.3, 0.3, 0.45, "t-mid"));
  });
  return s;
}

function architectural() {
  const h = 2.0;
  return [
    ...box(0, 0, -0.15, W, D, 0.15),
    ...EXT_BACK.flatMap((w) => wall(w, h, "t-arch")),
    ...INT.flatMap((w) => wall(w, h, "t-arch")),
    ...EXT_FRONT.flatMap((w) => wall(w, h, "t-arch")),
    ...openings(h),
  ];
}

function mep() {
  return [
    ...box(0, 0, -0.12, W, D, 0.12),
    line([[0.6, 0.6, 1.3], [9.4, 0.6, 1.3], [9.4, 4.6, 1.3]], "conduit"),
    line([[4.6, 0.6, 0], [4.6, 0.6, 1.3]], "conduit"),
    ...box(3, 1.1, 0.75, 0.45, 2.1, 0.32, "t-duct"),
    ...box(0.5, 2.6, 0, 1.3, 1.8, 1.15, "t-eq"),
    ...box(1.8, 3.2, 0.7, 6.8, 0.6, 0.42, "t-duct"),
    ...box(8.1, 3.8, 0.7, 0.5, 1.8, 0.42, "t-duct"),
    ...box(6.4, 3.8, 0.75, 0.45, 2.6, 0.32, "t-duct"),
    ...box(8.1, 5.6, 0, 1.3, 1.3, 0.85, "t-eq"),
    line([[1, 6.8, 0], [1, 6.8, 1.4]], "pipe"),
    line([[1, 6.8, 0.35], [5.2, 6.8, 0.35], [5.2, 5.2, 0.35], [7.6, 5.2, 0.35]], "pipe"),
    line([[1, 7.3, 0.2], [6.2, 7.3, 0.2], [6.2, 7.3, 1.2]], "pipe pipe-2"),
    // animated flow overlays
    line([[1.8, 3.5, 1.12], [8.6, 3.5, 1.12]], "flow"),
    line([[3.22, 3.2, 1.07], [3.22, 1.1, 1.07]], "flow"),
    line([[6.62, 3.8, 1.07], [6.62, 6.4, 1.07]], "flow"),
    line([[1, 6.8, 0.35], [5.2, 6.8, 0.35], [5.2, 5.2, 0.35], [7.6, 5.2, 0.35]], "flow flow-pipe"),
  ];
}

function structural() {
  const s = [
    ...box(0, 0, -0.2, W, D, 0.2),
    line([[0, 0, 2.4], [W, 0, 2.4], [W, D, 2.4], [0, D, 2.4], [0, 0, 2.4]], "ln-ghost"),
  ];
  GRID.forEach(([x, y]) => s.push(...box(x - 0.15, y - 0.15, 0, 0.3, 0.3, 2.2, "t-col")));
  [1, 4, 7].forEach((y) => s.push(...box(0.9, y - 0.1, 2.2, 8.2, 0.2, 0.22, "t-beam")));
  [1, 5, 9].forEach((x) => s.push(...box(x - 0.1, 0.9, 2.2, 0.2, 6.2, 0.22, "t-beam")));
  return s;
}

function bimModel() {
  const h = 2.2;
  const room = (x1, y1, x2, y2, c) => poly([[x1, y1, 0.01], [x2, y1, 0.01], [x2, y2, 0.01], [x1, y2, 0.01]], c);
  return [
    ...box(0, 0, -0.2, W, D, 0.2, "t-mid"),
    room(0.3, 0.3, 4, 4, "room-a"),
    room(0.3, 4, 4, 7.7, "room-b"),
    room(4, 0.3, 7, 4.5, "room-c"),
    room(7, 0.3, 9.7, 4.5, "room-b"),
    room(4, 4.5, 9.7, 7.7, "room-a"),
    ...EXT_BACK.flatMap((w) => wall(w, h, "t-bim")),
    ...INT.flatMap((w) => wall(w, h, "t-bim")),
    ...box(1, 0.8, 0, 1.6, 2, 0.35, "t-furn"),
    ...box(7.3, 0.6, 0, 2.1, 0.6, 0.6, "t-furn"),
    ...box(1, 5.2, 0, 0.6, 1.8, 0.45, "t-furn"),
    ...box(5, 5.4, 0, 1.4, 0.9, 0.5, "t-furn"),
    ...EXT_FRONT.flatMap((w) => wall(w, h, "t-bim")),
    ...openings(h),
  ];
}

// ---------- point cloud ----------
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointCloud() {
  const r = rng(7);
  const pts = [];
  const push = (x, y, z) => {
    const [px, py] = proj([x, y, z]);
    const v = r();
    pts.push({ x: fmt(px), y: fmt(py), r: (0.6 + r() * 0.85).toFixed(2), g: Math.floor(r() * 4), tone: v < 0.15 ? 2 : v < 0.45 ? 1 : 0 });
  };
  const h = 2.2;
  [...EXT_BACK, ...INT, ...EXT_FRONT].forEach(([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.round(len * h * 9);
    for (let i = 0; i < n; i++) {
      const u = r();
      const j = (r() - 0.5) * 0.12;
      push(x1 + (x2 - x1) * u + (y1 === y2 ? 0 : j), y1 + (y2 - y1) * u + (y1 === y2 ? j : 0), Math.pow(r(), 0.8) * h);
    }
  });
  for (let i = 0; i < 120; i++) push(0.3 + r() * 9.4, 0.3 + r() * 7.4, r() * 0.05);
  for (let i = 0; i < 260; i++) {
    const e = EXT_BACK.concat(EXT_FRONT)[Math.floor(r() * 4)];
    const u = r();
    push(e[0] + (e[2] - e[0]) * u, e[1] + (e[3] - e[1]) * u, h + (r() - 0.5) * 0.08);
  }
  for (let i = 0; i < 45; i++) push(-0.6 + r() * 11.2, -0.6 + r() * 9.2, r() * 2.8);
  return pts;
}

// ---------- scene config ----------
const OX = 290;
const TOP = 96;
const GAP = 128;
const ASM_GAP = 46;
const CENTER = TOP + 2.5 * GAP;
const LX = 584;
const CORNER_R = proj([W, 0]);
const CORNER_L = proj([0, D]);
const LEADER_X1 = OX + CORNER_R[0] + 6;
const LEADER_X2 = LX - 14;
const LEADER_LEN = LEADER_X2 - LEADER_X1;
const BOTTOM_Y = TOP + 5 * GAP;

const compile = (shapes) => shapes.map((s) => ({ t: s.t, d: s.t === "poly" ? toPts(s.p) : toPath(s.p), c: s.c }));

// index 0 = top of the stack
const LAYERS = [
  { key: "cloud", title: "POINT CLOUD", items: ["Laser scan / Photogrammetry", "Existing conditions capture"], cloud: pointCloud() },
  { key: "bim", title: "BIM MODEL", items: ["3D intelligent model", "Parametric elements", "Information-rich data"], shapes: compile(bimModel()) },
  { key: "struct", title: "STRUCTURAL LAYER", items: ["Columns", "Beams", "Slabs", "Structural connections"], shapes: compile(structural()) },
  { key: "mep", title: "MEP SYSTEMS", items: ["HVAC (Ducts)", "Plumbing (Pipes)", "Electrical (Conduits)", "Equipment"], shapes: compile(mep()) },
  { key: "arch", title: "ARCHITECTURAL LAYER", items: ["Walls", "Doors & Windows", "Partitions", "Finishes"], shapes: compile(architectural()) },
  { key: "found", title: "FOUNDATION LAYER", items: ["Footings", "Foundation walls", "Ground slab"], shapes: compile(foundation()) },
];

const FOOTPRINT = toPts([[0, 0], [W, 0], [W, D], [0, D]]);
const BEAM = toPts([[-0.5, -0.5], [W + 0.5, -0.5], [W + 0.5, D + 0.5], [-0.5, D + 0.5]]);
const GROUND = (() => {
  const d = [];
  for (let i = -4; i <= 14; i++) d.push(toPath([[i, -4], [i, 12]]));
  for (let j = -4; j <= 12; j++) d.push(toPath([[-4, j], [14, j]]));
  return d.join("");
})();

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

const STYLE = `
.bimh polygon, .bimh path { stroke-linejoin: round; }
.bimh .f-top   { fill: rgba(224,234,255,.62); stroke: #4a78e6; stroke-width: .75; }
.bimh .f-left  { fill: rgba(170,196,248,.42); stroke: #4a78e6; stroke-width: .75; }
.bimh .f-right { fill: rgba(122,160,240,.38); stroke: #4a78e6; stroke-width: .75; }
.bimh .f-top.t-mid   { fill: rgba(210,224,254,.7); }
.bimh .f-left.t-mid  { fill: rgba(118,156,238,.55); }
.bimh .f-right.t-mid { fill: rgba(88,130,230,.5); }
.bimh .f-top.t-deep   { fill: rgba(96,140,235,.5); stroke: #2f5fd6; }
.bimh .f-left.t-deep  { fill: rgba(47,95,214,.75); stroke: #2f5fd6; }
.bimh .f-right.t-deep { fill: rgba(37,79,190,.75); stroke: #2f5fd6; }
.bimh .t-arch { fill-opacity: .55; }
.bimh .f-top.t-bim  { fill: #c9dafd; stroke: #2f5fd6; }
.bimh .f-left.t-bim { fill: rgba(150,182,246,.72); stroke: #2f5fd6; }
.bimh .f-right.t-bim{ fill: rgba(112,152,240,.66); stroke: #2f5fd6; }
.bimh .f-top.t-furn { fill: rgba(147,180,246,.55); }
.bimh .f-left.t-col, .bimh .f-right.t-col { fill: rgba(96,140,235,.55); stroke: #2f5fd6; }
.bimh .f-top.t-beam { fill: rgba(170,196,248,.85); stroke: #2f5fd6; }
.bimh .f-left.t-beam, .bimh .f-right.t-beam { fill: rgba(96,140,235,.55); stroke: #2f5fd6; }
.bimh .f-top.t-duct { fill: #b9ccfb; stroke: #1d4ed8; stroke-width: .9; }
.bimh .f-left.t-duct { fill: #6f97ee; stroke: #1d4ed8; stroke-width: .9; }
.bimh .f-right.t-duct { fill: #4d7ce6; stroke: #1d4ed8; stroke-width: .9; }
.bimh .f-top.t-eq { fill: #9db7f7; stroke: #1e40af; }
.bimh .f-left.t-eq { fill: #4a74df; stroke: #1e40af; }
.bimh .f-right.t-eq { fill: #3460cf; stroke: #1e40af; }
.bimh .room-a { fill: rgba(59,130,246,.14); stroke: none; }
.bimh .room-b { fill: rgba(99,102,241,.12); stroke: none; }
.bimh .room-c { fill: rgba(14,165,233,.14); stroke: none; }
.bimh .win  { fill: rgba(239,246,255,.95); stroke: #2563eb; stroke-width: .7; }
.bimh .door { fill: rgba(30,64,175,.22); stroke: #2563eb; stroke-width: .7; }
.bimh .mullion { fill: none; stroke: #2563eb; stroke-width: .5; }
.bimh .ln-soft  { fill: none; stroke: #a9c1f5; stroke-width: .8; stroke-dasharray: 3 3; }
.bimh .ln-ghost { fill: none; stroke: #8fb0f3; stroke-width: .7; stroke-dasharray: 2 4; }
.bimh .pipe    { fill: none; stroke: #0891b2; stroke-width: 2.4; stroke-linecap: round; }
.bimh .pipe-2  { stroke: #22a5c6; stroke-width: 1.6; }
.bimh .conduit { fill: none; stroke: #6366f1; stroke-width: 1.3; stroke-dasharray: 6 3; }
.bimh .flow { fill: none; stroke: #e0f7ff; stroke-width: 2.2; stroke-linecap: round; stroke-dasharray: 1 13; animation: bimh-flow 1.1s linear infinite; }
.bimh .flow-pipe { stroke: #a5f3fc; stroke-width: 1.6; animation-duration: .8s; }
.bimh .hl { fill: url(#bimh-hl); stroke: #22d3ee; stroke-width: 1.6; }
.bimh .beam-plane { fill: url(#bimh-beam); stroke: #06b6d4; stroke-width: 1.4; }
.bimh .beam-trail { fill: none; stroke: #22d3ee; stroke-width: 1; }
.bimh .guide { stroke: #7fa2ee; stroke-width: 1; stroke-dasharray: 2 5; }
.bimh .pulse { fill: #06b6d4; }
.bimh .pc-0 { fill: #2563eb; } .bimh .pc-1 { fill: #3b82f6; } .bimh .pc-2 { fill: #1e3a8a; }
.bimh .tw { animation: bimh-twinkle 3.2s ease-in-out infinite; }
.bimh .tw-1 { animation-delay: -.8s; } .bimh .tw-2 { animation-delay: -1.6s; } .bimh .tw-3 { animation-delay: -2.4s; }
.bimh .layer-inner, .bimh .label-inner { transition: opacity .35s ease; }
.bimh .is-dim { opacity: .22; }
.bimh .leader { stroke: #3b6fe0; stroke-width: 1; stroke-dasharray: ${LEADER_LEN.toFixed(1)}; }
.bimh .leader-dot { fill: #1d4ed8; }
.bimh .lbl-num   { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; fill: #8aa3db; letter-spacing: .04em; }
.bimh .lbl-title { font-size: 15px; font-weight: 650; letter-spacing: .07em; fill: #1d4ed8; transition: fill .3s; }
.bimh .lbl-item  { font-size: 12.5px; fill: #475569; transition: fill .3s; }
.bimh .label-inner.is-hot .lbl-title { fill: #0b3bb8; }
.bimh .label-inner.is-hot .lbl-item { fill: #0f172a; }
.bimh .label-inner.is-hot .leader { stroke: #06b6d4; stroke-width: 1.6; }
.bimh .caption { font-size: 11.5px; letter-spacing: .14em; fill: #64748b; }
.bimh .caption-strong { fill: #1d4ed8; font-weight: 650; }
.bimh .fade-in { animation: bimh-fade 1.4s ease .5s both; }
@keyframes bimh-flow { to { stroke-dashoffset: -28; } }
@keyframes bimh-twinkle { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
@keyframes bimh-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .bimh * { animation: none !important; } }
`;

export default function BIMLayersHero() {
  const [hovered, setHovered] = useState(null);
  const hoverRef = useRef(null);
  const wrapRef = useRef(null);
  const layerRefs = useRef([]);
  const hlRefs = useRef([]);
  const labelRefs = useRef([]);
  const labelTextRefs = useRef([]);
  const leaderRefs = useRef([]);
  const beamRef = useRef(null);
  const pulseRefs = useRef([]);
  const tiltTarget = useRef({ x: 0, y: 0 });

  const hover = (j) => {
    hoverRef.current = j;
    setHovered(j);
  };

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const lift = LAYERS.map(() => 0);
    const tilt = { x: 0, y: 0 };
    let raf;

    const frame = (now) => {
      const t = reduce ? 60 : (now - start) / 1000;

      // scan beam: sweeps top→bottom every 7s once the intro has settled
      let beamY = -999;
      let beamA = 0;
      if (!reduce && t > 3.2) {
        const ph = ((t - 3.2) % 7) / 4.2;
        if (ph <= 1) {
          beamY = lerp(TOP - 40, BOTTOM_Y + 40, easeInOutSine(ph));
          beamA = Math.pow(Math.sin(ph * Math.PI), 0.6);
        }
      }
      if (beamRef.current) {
        beamRef.current.setAttribute("transform", `translate(${OX} ${beamY.toFixed(2)})`);
        beamRef.current.style.opacity = beamA.toFixed(3);
      }

      const settle = clamp01((t - 2.3) / 1.2);
      LAYERS.forEach((_, j) => {
        const finalY = TOP + j * GAP;
        const asmY = CENTER + (j - 2.5) * ASM_GAP;
        const fade = clamp01((t - 0.1 - (5 - j) * 0.08) / 0.6);
        const p = easeOutQuart(clamp01((t - 0.95 - Math.abs(j - 2.5) * 0.05) / 1.5));
        lift[j] += ((hoverRef.current === j ? -14 : 0) - lift[j]) * (reduce ? 1 : 0.12);
        const y = lerp(asmY, finalY, p) + Math.sin(t * 1.05 + j * 0.75) * 3.2 * settle + lift[j];

        const el = layerRefs.current[j];
        if (el) {
          el.setAttribute("transform", `translate(${OX} ${y.toFixed(2)})`);
          el.style.opacity = fade.toFixed(3);
        }

        const scanI = beamA * clamp01(1 - Math.abs(beamY - (y + 60)) / 70);
        const hl = Math.max(scanI, hoverRef.current === j ? 0.75 : 0);
        if (hlRefs.current[j]) hlRefs.current[j].style.opacity = hl.toFixed(3);

        const lp = clamp01((t - 2.05 - j * 0.12) / 0.75);
        const le = easeOutCubic(lp);
        if (labelRefs.current[j]) {
          labelRefs.current[j].setAttribute("transform", `translate(0 ${(y - finalY).toFixed(2)})`);
          labelRefs.current[j].style.opacity = clamp01(lp * 2).toFixed(3);
        }
        if (leaderRefs.current[j]) leaderRefs.current[j].style.strokeDashoffset = ((1 - le) * LEADER_LEN).toFixed(1);
        if (labelTextRefs.current[j]) labelTextRefs.current[j].setAttribute("transform", `translate(${((1 - le) * 16).toFixed(2)} 0)`);
      });

      // data pulses travelling down the vertical guides
      pulseRefs.current.forEach((el, i) => {
        if (!el) return;
        const ph = (t * 0.22 + i * 0.5) % 1;
        const x = OX + (i % 2 ? CORNER_R[0] : CORNER_L[0]);
        const y0 = TOP + (i % 2 ? CORNER_R[1] : CORNER_L[1]);
        el.setAttribute("transform", `translate(${x.toFixed(1)} ${(y0 + ph * 5 * GAP).toFixed(1)})`);
        el.style.opacity = reduce ? "0" : (settle * Math.sin(ph * Math.PI)).toFixed(3);
      });

      // gentle pointer parallax
      if (wrapRef.current && !reduce) {
        tilt.x += (tiltTarget.current.x - tilt.x) * 0.06;
        tilt.y += (tiltTarget.current.y - tilt.y) * 0.06;
        wrapRef.current.style.transform = `perspective(1800px) rotateX(${(-tilt.y * 4).toFixed(3)}deg) rotateY(${(tilt.x * 5).toFixed(3)}deg)`;
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    tiltTarget.current = { x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 };
  };
  const onLeave = () => {
    tiltTarget.current = { x: 0, y: 0 };
    hover(null);
  };

  // bottom layers first so upper layers sit visually on top
  const order = LAYERS.map((_, j) => j).reverse();

  return (
    <div className="relative w-full h-full" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div ref={wrapRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: "50% 50%" }}>
        <svg
          className="bimh w-full h-full select-none"
          viewBox="0 0 880 1030"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Exploded BIM model: point cloud, BIM model, structural, MEP, architectural and foundation layers"
        >
          <style>{STYLE}</style>
          <defs>
            <radialGradient id="bimh-hl" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.06" />
            </radialGradient>
            <radialGradient id="bimh-beam" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.45" />
              <stop offset="70%" stopColor="#22d3ee" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="bimh-ground-fade" cx="50%" cy="45%" r="50%">
              <stop offset="0%" stopColor="#fff" stopOpacity="1" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <mask id="bimh-ground-mask">
              <rect x="-340" y="-110" width="720" height="430" fill="url(#bimh-ground-fade)" />
            </mask>
          </defs>

          {/* ground grid under the stack */}
          <g transform={`translate(${OX} ${BOTTOM_Y + 30})`} className="fade-in">
            <path d={GROUND} mask="url(#bimh-ground-mask)" fill="none" stroke="#c3d3f6" strokeWidth="0.6" />
          </g>

          {/* vertical guides */}
          <g className="fade-in">
            <line className="guide" x1={OX + CORNER_L[0]} y1={TOP + CORNER_L[1] - 40} x2={OX + CORNER_L[0]} y2={BOTTOM_Y + CORNER_L[1]} />
            <line className="guide" x1={OX + CORNER_R[0]} y1={TOP + CORNER_R[1] - 40} x2={OX + CORNER_R[0]} y2={BOTTOM_Y + CORNER_R[1]} />
          </g>

          {/* layers */}
          {order.map((j) => {
            const L = LAYERS[j];
            const dim = hovered !== null && hovered !== j;
            return (
              <g
                key={L.key}
                ref={(el) => (layerRefs.current[j] = el)}
                style={{ opacity: 0 }}
                onMouseEnter={() => hover(j)}
              >
                <g className={`layer-inner ${dim ? "is-dim" : ""}`}>
                  {L.cloud ? (
                    <>
                      <polygon points={FOOTPRINT} fill="rgba(59,130,246,0.03)" className="ln-ghost" />
                      {[0, 1, 2, 3].map((g) => (
                        <g key={g} className={`tw tw-${g}`}>
                          {L.cloud.filter((p) => p.g === g).map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={p.r} className={`pc-${p.tone}`} />
                          ))}
                        </g>
                      ))}
                    </>
                  ) : (
                    L.shapes.map((s, i) =>
                      s.t === "poly" ? <polygon key={i} points={s.d} className={s.c} /> : <path key={i} d={s.d} className={s.c} />
                    )
                  )}
                  <polygon ref={(el) => (hlRefs.current[j] = el)} points={FOOTPRINT} className="hl" style={{ opacity: 0 }} />
                </g>
              </g>
            );
          })}

          {/* scan beam */}
          <g ref={beamRef} style={{ opacity: 0 }} pointerEvents="none">
            <polygon points={BEAM} className="beam-trail" transform="translate(0 -14)" opacity="0.25" />
            <polygon points={BEAM} className="beam-trail" transform="translate(0 -7)" opacity="0.45" />
            <polygon points={BEAM} className="beam-plane" />
          </g>

          {[0, 1, 2, 3].map((i) => (
            <circle key={i} ref={(el) => (pulseRefs.current[i] = el)} r="3" className="pulse" style={{ opacity: 0 }} />
          ))}

          {/* labels */}
          {LAYERS.map((L, j) => {
            const ay = TOP + j * GAP + CORNER_R[1];
            const hot = hovered === j;
            const dim = hovered !== null && !hot;
            return (
              <g
                key={L.key}
                ref={(el) => (labelRefs.current[j] = el)}
                style={{ opacity: 0, cursor: "default" }}
                onMouseEnter={() => hover(j)}
              >
                <g className={`label-inner ${hot ? "is-hot" : ""} ${dim ? "is-dim" : ""}`}>
                  <rect x={LEADER_X1} y={ay - 18} width={880 - LEADER_X1} height={L.items.length * 17 + 30} fill="transparent" />
                  <circle cx={LEADER_X1 - 2} cy={ay} r="3.5" className="leader-dot" />
                  <line ref={(el) => (leaderRefs.current[j] = el)} x1={LEADER_X1} y1={ay} x2={LEADER_X2} y2={ay} className="leader" />
                  <g ref={(el) => (labelTextRefs.current[j] = el)}>
                    <text x={LX} y={ay + 5} className="lbl-num">{String(j + 1).padStart(2, "0")}</text>
                    <text x={LX + 26} y={ay + 5} className="lbl-title">{L.title}</text>
                    {L.items.map((it, k) => (
                      <text key={it} x={LX + 26} y={ay + 26 + k * 17} className="lbl-item">• {it}</text>
                    ))}
                  </g>
                </g>
              </g>
            );
          })}

          <text x={OX + 20} y={1012} textAnchor="middle" className="caption fade-in">
            <tspan className="caption-strong">BUILDING INFORMATION</tspan>
            <tspan>{"  ·  QUANTITIES · SCHEDULES · 4D/5D/6D · LIFECYCLE"}</tspan>
          </text>
        </svg>
      </div>

      {/* HUD */}
      <div className="pointer-events-none absolute top-5 left-5 flex items-center gap-1.5 rounded-full border border-blue-100 bg-white/80 px-2.5 py-1 shadow-sm backdrop-blur">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
        </span>
        <span className="text-[9.5px] font-semibold tracking-[0.12em] text-blue-700">C TWIN</span>
        <span className="font-mono text-[8.5px] text-slate-400">IFC 4.3 · LOD 400</span>
      </div>
    </div>
  );
}
