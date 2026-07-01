import React, { useEffect, useRef } from 'react';

/**
 * Inspiration: IFCtoFDS hover tooltip
 * Follows the cursor and shows element type + name.
 * Pass visible=false to hide, otherwise it tracks x/y.
 */
export default function HoverTooltip({ visible, data, x, y, containerRef }) {
  const tooltipRef = useRef(null);

  useEffect(() => {
    const el = tooltipRef.current;
    const container = containerRef?.current;
    if (!el || !visible || !container) return;

    const cRect = container.getBoundingClientRect();
    const OFFSET = 14;
    let left = x - cRect.left + OFFSET;
    let top = y - cRect.top + OFFSET;

    // Keep tooltip inside container
    const maxLeft = container.clientWidth - el.offsetWidth - 10;
    const maxTop = container.clientHeight - el.offsetHeight - 10;
    left = Math.max(10, Math.min(left, maxLeft));
    top = Math.max(10, Math.min(top, maxTop));

    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }, [x, y, visible, containerRef]);

  if (!visible || !data) return null;

  const label = data.ifcType
    ? data.ifcType.replace(/^IFC/, '')
    : data.type || 'Object';

  return (
    <div ref={tooltipRef} style={styles.tooltip}>
      <span style={styles.type}>{label}</span>
      {data.name && data.name !== label && (
        <span style={styles.name}>{data.name}</span>
      )}
      {data.id && (
        <span style={styles.id}>#{data.id}</span>
      )}
    </div>
  );
}

const styles = {
  tooltip: {
    position: 'absolute',
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    background: 'rgba(10, 14, 26, 0.90)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '5px 10px',
    pointerEvents: 'none',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
    minWidth: '80px',
    maxWidth: '240px',
  },
  type: {
    color: '#ffd166',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  name: {
    color: '#e2e8f0',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  id: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '10px',
    fontFamily: 'monospace',
  },
};
