import React from 'react';

/**
 * Inspiration: IFCtoFDS separate FDS/IFC opacity sliders
 * Two sliders to independently control BIM and Point Cloud opacity.
 *
 * Props:
 *   bimOpacity      — 0–1
 *   pcOpacity       — 0–1
 *   onBimOpacity(v) — called with new 0–1 value
 *   onPcOpacity(v)  — called with new 0–1 value
 *   showBim / showPc — whether to render each slider
 */
export default function DualOpacitySliders({
  bimOpacity = 1,
  pcOpacity = 1,
  onBimOpacity,
  onPcOpacity,
  showBim = true,
  showPc = true,
}) {
  if (!showBim && !showPc) return null;

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>
        <span style={styles.titleIcon}>◐</span>
        Opacity
      </div>

      {showBim && (
        <SliderRow
          label="BIM Model"
          color="#4a90e2"
          value={bimOpacity}
          onChange={v => onBimOpacity?.(v)}
        />
      )}

      {showPc && (
        <SliderRow
          label="Point Cloud"
          color="#10b981"
          value={pcOpacity}
          onChange={v => onPcOpacity?.(v)}
        />
      )}
    </div>
  );
}

function SliderRow({ label, color, value, onChange }) {
  const pct = Math.round(value * 100);
  return (
    <div style={styles.row}>
      <div style={styles.rowHeader}>
        <span style={{ ...styles.dot, background: color }} />
        <span style={styles.label}>{label}</span>
        <span style={styles.value}>{pct}%</span>
      </div>
      <div style={styles.sliderWrap}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ ...styles.slider, accentColor: color }}
        />
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 0',
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
    padding: '0 4px 6px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    marginBottom: '4px',
  },
  titleIcon: { fontSize: '12px' },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '4px',
  },
  rowHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  label: {
    flex: 1,
    color: 'rgba(255,255,255,0.75)',
    fontSize: '12px',
  },
  value: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: '11px',
    fontFamily: 'monospace',
    minWidth: '30px',
    textAlign: 'right',
  },
  sliderWrap: {
    paddingLeft: '15px',
  },
  slider: {
    width: '100%',
    height: '4px',
    cursor: 'pointer',
    borderRadius: '2px',
    outline: 'none',
    border: 'none',
    background: 'rgba(255,255,255,0.15)',
  },
};
