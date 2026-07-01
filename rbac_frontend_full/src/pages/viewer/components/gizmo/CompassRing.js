import React, { useRef, useEffect } from "react";
import * as THREE from "three";

const SIZE = 120;
const C = SIZE / 2;
const R_CARD = 46; // cardinal point length (N/E/S/W)
const R_ORD = 30; // intercardinal length (NE/SE/SW/NW)
const R_SEC = 22; // secondary 16-point tick length (NNE, etc.)
const LABEL_R = 50;

// Real-world convention used by the geo placement code:
//   +Z = North, +X = East, Y = up. The rose rotates with the camera heading
//   so the points always indicate true world directions. Passive indicator.

// One compass point as two triangles split down the middle, giving the
// classic light/dark 3D look. `a` is the screen angle (0 = up), `len` the tip
// distance, `w` the half-width of the base near the centre.
function drawPoint(ctx, a, len, w, light, dark) {
  const dir = [Math.cos(a), Math.sin(a)];
  const perp = [-Math.sin(a), Math.cos(a)];
  const tip = [C + dir[0] * len, C + dir[1] * len];
  const bL = [C + perp[0] * w, C + perp[1] * w];
  const bR = [C - perp[0] * w, C - perp[1] * w];

  ctx.beginPath();
  ctx.moveTo(C, C);
  ctx.lineTo(bL[0], bL[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.closePath();
  ctx.fillStyle = dark;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(C, C);
  ctx.lineTo(bR[0], bR[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.closePath();
  ctx.fillStyle = light;
  ctx.fill();
}

const CARDINALS = [
  { label: "N", deg: 0, color: "#e5433b" },
  { label: "E", deg: 90, color: "#1f2937" },
  { label: "S", deg: 180, color: "#1f2937" },
  { label: "W", deg: 270, color: "#1f2937" },
];
const ORDINALS = [
  { label: "NE", deg: 45 },
  { label: "SE", deg: 135 },
  { label: "SW", deg: 225 },
  { label: "NW", deg: 315 },
];

export default function CompassRing({ cameraRef }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const fwd = new THREE.Vector3();

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const camera = cameraRef?.current;

      let heading = 0;
      if (camera) {
        camera.getWorldDirection(fwd);
        heading = Math.atan2(fwd.x, fwd.z); // bearing clockwise from +Z (North)
      }
      // Screen angle for a world bearing `deg`: 0 = up, rotated by -heading.
      const toScreen = (deg) =>
        (deg * Math.PI) / 180 - heading - Math.PI / 2;

      // Faint backing disc
      ctx.beginPath();
      ctx.arc(C, C, LABEL_R + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148,163,184,0.55)";
      ctx.stroke();

      // Secondary 16-point ticks (NNE, ENE, ...) — thin grey
      for (let i = 0; i < 16; i++) {
        if (i % 2 === 0) continue; // skip the 8 already drawn as main points
        const a = toScreen(i * 22.5);
        drawPoint(ctx, a, R_SEC, 3, "#d1d5db", "#9ca3af");
      }

      // Intercardinal points (NE/SE/SW/NW) — grey
      for (const o of ORDINALS) {
        const a = toScreen(o.deg);
        drawPoint(ctx, a, R_ORD, 5, "#e5e7eb", "#6b7280");
      }

      // Cardinal points (N/E/S/W) — black/white, N tinted red
      for (const c of CARDINALS) {
        const a = toScreen(c.deg);
        const light = c.label === "N" ? "#f0a9a4" : "#f8fafc";
        const dark = c.label === "N" ? "#e5433b" : "#1f2937";
        drawPoint(ctx, a, R_CARD, 7, light, dark);
      }

      // Centre hub
      ctx.beginPath();
      ctx.arc(C, C, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#334155";
      ctx.fill();

      // Cardinal labels
      ctx.font = "bold 11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const c of CARDINALS) {
        const a = toScreen(c.deg);
        const lx = C + Math.cos(a) * LABEL_R;
        const ly = C + Math.sin(a) * LABEL_R;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, lx, ly);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [cameraRef]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{
        // Sit just above the X/Y/Z navigation gizmo in the bottom-right.
        position: "absolute",
        bottom: 150,
        right: 20,
        zIndex: 30,
        pointerEvents: "none",
      }}
    />
  );
}
