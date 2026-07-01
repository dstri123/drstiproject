import React, { useState } from 'react';

/**
 * Inspiration: IFCtoFDS per-category layer visibility toggles
 * Shows checkboxes for BIM categories and overlay layers.
 * Calls onToggle(layerId, visible) for each change.
 *
 * Props:
 *   layers  — array of { id, label, visible, color? }
 *   onToggle(id, visible)
 */
export default function LayerVisibilityPanel({ layers = [], onToggle }) {
  return (
    <div style={styles.panel}>
      <div style={styles.title}>
        <span style={styles.titleIcon}>⊞</span>
        Layer Visibility
      </div>

      {layers.length === 0 && (
        <p style={styles.empty}>Load a model to see layers</p>
      )}

      {layers.map(layer => (
        <label key={layer.id} style={styles.row}>
          <div style={styles.left}>
            {layer.color && (
              <span style={{ ...styles.dot, background: layer.color }} />
            )}
            <span style={styles.label}>{layer.label}</span>
          </div>
          <div
            style={{
              ...styles.toggle,
              background: layer.visible ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            }}
            onClick={() => onToggle?.(layer.id, !layer.visible)}
            role="checkbox"
            aria-checked={layer.visible}
            tabIndex={0}
            onKeyDown={e => e.key === ' ' && onToggle?.(layer.id, !layer.visible)}
          >
            <div
              style={{
                ...styles.toggleThumb,
                transform: layer.visible ? 'translateX(14px)' : 'translateX(2px)',
              }}
            />
          </div>
        </label>
      ))}
    </div>
  );
}

/**
 * Factory: build default layers from BIM/PC model presence.
 * Returns array compatible with LayerVisibilityPanel.
 */
export function buildDefaultLayers({ hasBim, hasPointCloud } = {}) {
  const layers = [];
  if (hasBim) {
    layers.push(
      { id: 'bim_structure', label: 'Structure & Shell', visible: true, color: '#94a3b8' },
      { id: 'bim_doors',     label: 'Doors',            visible: true, color: '#985d3f' },
      { id: 'bim_windows',   label: 'Windows',          visible: true, color: '#6db4d6' },
      { id: 'bim_other',     label: 'Other Elements',   visible: true, color: '#c1c7d2' },
      { id: 'bim_edges',     label: 'Element Edges',    visible: true, color: '#64748b' },
    );
  }
  if (hasPointCloud) {
    layers.push(
      { id: 'pc_all',        label: 'Point Cloud',      visible: true, color: '#10b981' },
      { id: 'pc_segments',   label: 'RANSAC Segments',  visible: false, color: '#f59e0b' },
    );
  }
  layers.push(
    { id: 'grid',            label: 'Ground Grid',      visible: true, color: '#475569' },
    { id: 'axes',            label: 'Axes Helper',      visible: true, color: '#ef4444' },
  );
  return layers;
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 0',
  },
  title: {
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
  empty: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '12px',
    textAlign: 'center',
    padding: '8px 0',
    margin: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 4px',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  label: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: '12px',
  },
  toggle: {
    position: 'relative',
    width: '30px',
    height: '16px',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.2s',
    flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute',
    top: '2px',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
};
