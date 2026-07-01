import React, { useRef, useEffect } from "react";
import * as THREE from "three";

const SIZE = 120;
const CENTER = SIZE / 2;
const AXIS_LEN = 38;

const AXES = [
  { name: "X", dir: [1, 0, 0], color: "#ef4444" },
  { name: "Y", dir: [0, 1, 0], color: "#22c55e" },
  { name: "Z", dir: [0, 0, 1], color: "#3b82f6" },
];

// The three great-circle rings (gyroscope look): each lies in the plane
// spanned by the OTHER two world axes, coloured by this axis.
const RINGS = [
  { color: "#ef4444", a: [0, 1, 0], b: [0, 0, 1] },
  { color: "#22c55e", a: [1, 0, 0], b: [0, 0, 1] },
  { color: "#3b82f6", a: [1, 0, 0], b: [0, 1, 0] },
];

function getProjected(camera) {
  const m = camera.matrixWorldInverse.clone();
  m.setPosition(0, 0, 0);
  const pts = [];
  for (const ax of AXES) {
    const [dx, dy, dz] = ax.dir;
    const posV = new THREE.Vector3(dx, dy, dz).applyMatrix4(m);
    const negV = new THREE.Vector3(-dx, -dy, -dz).applyMatrix4(m);
    pts.push({
      label: ax.name,
      color: ax.color,
      v: posV,
      neg: false,
      key: ax.name + "+",
    });
    pts.push({
      label: ax.name,
      color: ax.color,
      v: negV,
      neg: true,
      key: ax.name + "-",
    });
  }
  return pts.sort((a, b) => a.v.z - b.v.z);
}

function getHitAxis(mx, my, camera) {
  const m = camera.matrixWorldInverse.clone();
  m.setPosition(0, 0, 0);
  for (const ax of AXES) {
    for (const sign of [1, -1]) {
      const [dx, dy, dz] = ax.dir;
      const v = new THREE.Vector3(dx * sign, dy * sign, dz * sign).applyMatrix4(
        m,
      );
      const tx = CENTER + v.x * AXIS_LEN;
      const ty = CENTER - v.y * AXIS_LEN;
      if (Math.hypot(mx - tx, my - ty) < 12) {
        return {
          name: ax.name,
          dir: ax.dir,
          sign,
          key: ax.name + (sign > 0 ? "+" : "-"),
        };
      }
    }
  }
  return null;
}

export default function BlenderViewportGizmo({ cameraRef, controlsRef }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const hoveredRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Project a unit world direction to canvas coords (camera-rotation only).
    const projectDir = (m, x, y, z) => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
      return { x: CENTER + v.x * AXIS_LEN, y: CENTER - v.y * AXIS_LEN, z: v.z };
    };

    const draw = () => {
      const camera = cameraRef?.current;
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Soft circular backing.
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, AXIS_LEN + 16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148,163,184,0.35)";
      ctx.stroke();

      if (camera) {
        const m = camera.matrixWorldInverse.clone();
        m.setPosition(0, 0, 0);

        // ── Great-circle rings (thin, behind the axes) ──
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        for (const ring of RINGS) {
          ctx.beginPath();
          for (let i = 0; i <= 48; i++) {
            const t = (i / 48) * Math.PI * 2;
            const c = Math.cos(t);
            const s = Math.sin(t);
            const p = projectDir(
              m,
              ring.a[0] * c + ring.b[0] * s,
              ring.a[1] * c + ring.b[1] * s,
              ring.a[2] * c + ring.b[2] * s,
            );
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = ring.color;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // ── Axis arrows (+) and diamond handles (−), painted far → near ──
        const pts = getProjected(camera);
        for (const p of pts) {
          const tx = CENTER + p.v.x * AXIS_LEN;
          const ty = CENTER - p.v.y * AXIS_LEN;
          const depth = (p.v.z + 1) / 2;
          const alpha = 0.45 + depth * 0.55;
          const isHov = hoveredRef.current === p.key;
          ctx.globalAlpha = alpha;

          if (!p.neg) {
            // Stem
            ctx.beginPath();
            ctx.moveTo(CENTER, CENTER);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = isHov ? 4 : 3;
            ctx.lineCap = "round";
            ctx.stroke();
            // Arrowhead
            const dx = tx - CENTER;
            const dy = ty - CENTER;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const px = -uy;
            const py = ux;
            const h = isHov ? 10 : 8;
            ctx.beginPath();
            ctx.moveTo(tx + ux * h, ty + uy * h);
            ctx.lineTo(tx - ux * h * 0.3 + px * h * 0.7, ty - uy * h * 0.3 + py * h * 0.7);
            ctx.lineTo(tx - ux * h * 0.3 - px * h * 0.7, ty - uy * h * 0.3 - py * h * 0.7);
            ctx.closePath();
            ctx.fillStyle = p.color;
            ctx.fill();
            // Axis letter (X / Y / Z) just beyond the arrowhead.
            ctx.globalAlpha = Math.max(alpha, 0.7);
            ctx.fillStyle = p.color;
            ctx.font = `bold ${isHov ? 12 : 11}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(p.label, tx + ux * (h + 7), ty + uy * (h + 7));
          } else {
            // Negative direction: small diamond handle (hollow until hover)
            const r = isHov ? 7 : 5.5;
            ctx.beginPath();
            ctx.moveTo(tx, ty - r);
            ctx.lineTo(tx + r, ty);
            ctx.lineTo(tx, ty + r);
            ctx.lineTo(tx - r, ty);
            ctx.closePath();
            ctx.fillStyle = isHov ? p.color : "#ffffff";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = p.color;
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;
      // Center pivot dot.
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#94a3b8";
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [cameraRef]);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const camera = cameraRef?.current;
    if (!canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    const hit = getHitAxis(e.clientX - rect.left, e.clientY - rect.top, camera);
    hoveredRef.current = hit?.key ?? null;
    canvas.style.cursor = hit ? "pointer" : "default";
  };

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    const camera = cameraRef?.current;
    const controls = controlsRef?.current;
    if (!canvas || !camera || !controls) return;
    const rect = canvas.getBoundingClientRect();
    const hit = getHitAxis(e.clientX - rect.left, e.clientY - rect.top, camera);
    if (!hit) return;

    const dist = camera.position.distanceTo(controls.target);
    const [dx, dy, dz] = hit.dir;
    const snap = new THREE.Vector3(
      dx * hit.sign * dist,
      dy * hit.sign * dist,
      dz * hit.sign * dist,
    ).add(controls.target);

    // Smooth animate to snap position
    const startPos = camera.position.clone();
    const startTime = performance.now();
    const duration = 280;

    const animSnap = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(startPos, snap, ease);
      camera.lookAt(controls.target);
      controls.update();
      if (t < 1) requestAnimationFrame(animSnap);
    };
    requestAnimationFrame(animSnap);
  };

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{
        // Bottom-right corner so it never sits under the top-right toolbar
        // (which would hide it and block its clicks). Click an axis tip
        // (X/Y/Z, + or -) to snap the view to look down that axis.
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 30,
        pointerEvents: "all",
      }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onMouseLeave={() => {
        hoveredRef.current = null;
      }}
    />
  );
}
