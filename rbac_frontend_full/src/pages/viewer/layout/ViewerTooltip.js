import { useEffect, useState } from "react";
import ReactDOM from "react-dom";

// One tooltip style for the whole 3D viewer (the dark "Models" chip of the
// left icon bar). Any element inside `containerRef` with a `title` shows it
// in this style on hover or keyboard focus instead of the browser's native
// tooltip — so icon buttons only need `title` (plus aria-label) and can't
// drift out of style.
//
// While shown, the element's `title` is parked in `data-tip-title` (so the
// native tooltip doesn't appear as well) and restored on leave.

export const TOOLTIP_STYLE = {
  background: "#1f2937",
  color: "#f9fafb",
  padding: "4px 10px",
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.01em",
  boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
  pointerEvents: "none",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};

const GAP = 8;
const EDGE = 90; // icons this close to a side edge get the tooltip beside them
const PARKED = "data-tip-title";

// Where to draw the tooltip for an element's bounding rect.
export function placeTooltip(rect, viewportWidth, viewportHeight) {
  const midY = rect.top + rect.height / 2;
  if (rect.left < EDGE) {
    return { left: rect.right + GAP, top: midY, transform: "translateY(-50%)" };
  }
  if (viewportWidth - rect.right < EDGE) {
    return {
      left: rect.left - GAP,
      top: midY,
      transform: "translate(-100%, -50%)",
    };
  }
  const midX = rect.left + rect.width / 2;
  if (viewportHeight - rect.bottom < 48) {
    return { left: midX, top: rect.top - GAP, transform: "translate(-50%, -100%)" };
  }
  return { left: midX, top: rect.bottom + GAP, transform: "translateX(-50%)" };
}

const findTarget = (node, container) => {
  let el = node instanceof Element ? node : node?.parentElement;
  while (el && el !== container) {
    if (el.hasAttribute("title") && el.getAttribute("title")) return el;
    el = el.parentElement;
  }
  return null;
};

export default function ViewerTooltip({ containerRef }) {
  const [tip, setTip] = useState(null); // { text, pos }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let current = null;

    const restore = () => {
      if (current && current.hasAttribute(PARKED)) {
        current.setAttribute("title", current.getAttribute(PARKED));
        current.removeAttribute(PARKED);
      }
      current = null;
      setTip(null);
    };

    const show = (el) => {
      if (el === current) return;
      restore();
      const text = el.getAttribute("title");
      // Keep the accessible name when the title is the only label.
      if (!el.hasAttribute("aria-label") && !el.textContent.trim()) {
        el.setAttribute("aria-label", text);
      }
      el.setAttribute(PARKED, text);
      el.removeAttribute("title");
      current = el;
      setTip({
        text,
        pos: placeTooltip(
          el.getBoundingClientRect(),
          window.innerWidth,
          window.innerHeight,
        ),
      });
    };

    const onOver = (e) => {
      const el = findTarget(e.target, container);
      if (el) show(el);
      else if (current && !current.contains(e.target)) restore();
    };
    const onOut = (e) => {
      if (current && !current.contains(e.relatedTarget)) restore();
    };

    container.addEventListener("mouseover", onOver);
    container.addEventListener("mouseout", onOut);
    container.addEventListener("focusin", onOver);
    container.addEventListener("focusout", onOut);
    // Clicking hides the chip; the title stays parked until the pointer
    // leaves, so the native tooltip doesn't pop up after the click.
    const hide = () => setTip(null);
    container.addEventListener("mousedown", hide);
    window.addEventListener("scroll", restore, true);
    return () => {
      container.removeEventListener("mouseover", onOver);
      container.removeEventListener("mouseout", onOut);
      container.removeEventListener("focusin", onOver);
      container.removeEventListener("focusout", onOut);
      container.removeEventListener("mousedown", hide);
      window.removeEventListener("scroll", restore, true);
      restore();
    };
  }, [containerRef]);

  if (!tip) return null;
  const long = tip.text.length > 60;
  return ReactDOM.createPortal(
    <div
      role="tooltip"
      style={{
        ...TOOLTIP_STYLE,
        position: "fixed",
        zIndex: 10001,
        whiteSpace: long ? "normal" : "nowrap",
        maxWidth: long ? 280 : undefined,
        ...tip.pos,
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
