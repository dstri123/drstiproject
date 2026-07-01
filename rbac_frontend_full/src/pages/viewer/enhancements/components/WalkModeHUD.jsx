import React from 'react';

/**
 * Inspiration: IFCtoFDS walk-mode HUD overlay
 * Shows status text and control hints while in walk mode.
 * Floats at the bottom-center of the viewport.
 */
export default function WalkModeHUD({ visible, status }) {
  if (!visible) return null;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.icon}>🚶</div>
        <div style={styles.text}>
          <span style={styles.status}>{status || 'Walk Mode'}</span>
          <span style={styles.hint}>W/A/S/D · Arrow keys · Space=Jump · Shift=Run · Esc=Exit</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 120,
    pointerEvents: 'none',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(15, 20, 35, 0.82)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    padding: '8px 18px 8px 12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    minWidth: '300px',
    maxWidth: '520px',
  },
  icon: {
    fontSize: '20px',
    flexShrink: 0,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  status: {
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: '0.01em',
  },
  hint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    fontFamily: 'monospace',
  },
};
