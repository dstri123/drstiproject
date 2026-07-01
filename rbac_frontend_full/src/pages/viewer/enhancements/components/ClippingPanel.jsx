import React, { useState, useCallback } from 'react';

/**
 * Inspiration: IFCtoFDS 6-axis clipping panel with steppers + numeric inputs
 * Shows X/Y/Z min-max sliders with ▲▼ stepper buttons and direct input.
 * Calls onClipChange(axis, side, value) for each adjustment.
 *
 * Props:
 *   bounds        — { xmin, xmax, ymin, ymax, zmin, zmax }
 *   onClipChange(axis, side, value)
 *   onReset()
 */
export default function ClippingPanel({ bounds, onClipChange, onReset }) {
  const [values, setValues] = useState(() => initValues(bounds));

  // Re-init when bounds changes (new model loaded)
  React.useEffect(() => {
    if (bounds) setValues(initValues(bounds));
  }, [bounds]);

  const handleChange = useCallback((id, raw) => {
    if (!bounds) return;
    const [axis, side] = parseId(id);
    const lo = bounds[axis + 'min'];
    const hi = bounds[axis + 'max'];
    const v = Math.max(lo, Math.min(hi, parseFloat(raw) || lo));
    setValues(prev => ({ ...prev, [id]: v }));
    onClipChange?.(axis, side, v);
  }, [bounds, onClipChange]);

  const step = useCallback((id, dir) => {
    if (!bounds) return;
    const [axis] = parseId(id);
    const span = (bounds[axis + 'max'] - bounds[axis + 'min']) || 1;
    const s = Math.max(span / 200, 0.01);
    handleChange(id, (values[id] ?? 0) + dir * s);
  }, [bounds, values, handleChange]);

  const handleReset = () => {
    if (bounds) setValues(initValues(bounds));
    onReset?.();
  };

  if (!bounds) return null;

  const axes = [
    { key: 'x', label: 'X', color: '#ef4444' },
    { key: 'y', label: 'Y', color: '#22c55e' },
    { key: 'z', label: 'Z', color: '#3b82f6' },
  ];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.sectionTitle}>
          <span style={styles.titleIcon}>✂</span>
          Section Clip
        </span>
        <button style={styles.resetBtn} onClick={handleReset} title="Reset all clip planes">
          ↺ Reset
        </button>
      </div>

      {axes.map(({ key, label, color }) => (
        <div key={key} style={styles.axisBlock}>
          <div style={{ ...styles.axisLabel, color }}>
            {label} axis
          </div>
          {['min', 'max'].map(side => {
            const id = key + side;
            const lo = bounds[key + 'min'];
            const hi = bounds[key + 'max'];
            return (
              <div key={side} style={styles.sliderRow}>
                <span style={styles.sideLabel}>{side === 'min' ? '▼' : '▲'}</span>
                <div style={styles.steppers}>
                  <button style={styles.stepBtn} onClick={() => step(id, -1)}>−</button>
                  <button style={styles.stepBtn} onClick={() => step(id, +1)}>+</button>
                </div>
                <input
                  type="range"
                  min={lo}
                  max={hi}
                  step={(hi - lo) / 200}
                  value={values[id] ?? (side === 'min' ? lo : hi)}
                  onChange={e => handleChange(id, e.target.value)}
                  style={{ ...styles.slider, accentColor: color }}
                />
                <input
                  type="number"
                  value={(values[id] ?? 0).toFixed(2)}
                  step={(Math.max((bounds[key + 'max'] - bounds[key + 'min']) / 200, 0.01)).toFixed(3)}
                  onChange={e => handleChange(id, e.target.value)}
                  style={styles.numInput}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function initValues(bounds) {
  if (!bounds) return {};
  return {
    xmin: bounds.xmin, xmax: bounds.xmax,
    ymin: bounds.ymin, ymax: bounds.ymax,
    zmin: bounds.zmin, zmax: bounds.zmax,
  };
}

function parseId(id) {
  const axis = id[0];
  const side = id.slice(1);
  return [axis, side];
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px 0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 4px 6px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    marginBottom: '2px',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  titleIcon: { fontSize: '12px' },
  resetBtn: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '10px',
    padding: '2px 7px',
    cursor: 'pointer',
  },
  axisBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '4px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '6px',
  },
  axisLabel: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '2px',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  sideLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '10px',
    width: '10px',
    flexShrink: 0,
  },
  steppers: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    flexShrink: 0,
  },
  stepBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '10px',
    width: '16px',
    height: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    lineHeight: 1,
  },
  slider: {
    flex: 1,
    height: '4px',
    cursor: 'pointer',
    borderRadius: '2px',
    outline: 'none',
    border: 'none',
    minWidth: 0,
  },
  numInput: {
    width: '52px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.75)',
    fontSize: '10px',
    fontFamily: 'monospace',
    padding: '2px 4px',
    textAlign: 'right',
    flexShrink: 0,
  },
};
