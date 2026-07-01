import React from 'react';

/**
 * Inspiration: IFCtoFDS staged loading progress bar
 * Shows title, stage label, % bar, and optional indeterminate spinner.
 * Overlays the entire viewport during heavy operations.
 *
 * Props: state from useLoadingProgress().state
 *   visible, title, stage, percent, indeterminate
 */
export default function LoadingProgressBar({ visible, title, stage, percent, indeterminate }) {
  if (!visible) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Spinner icon for indeterminate */}
        <div style={styles.iconRow}>
          {indeterminate ? (
            <div style={styles.spinner} />
          ) : (
            <svg width="28" height="28" viewBox="0 0 28 28" style={styles.progressRing}>
              <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
              <circle
                cx="14" cy="14" r="11"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeDasharray={`${2 * Math.PI * 11}`}
                strokeDashoffset={`${2 * Math.PI * 11 * (1 - percent / 100)}`}
                strokeLinecap="round"
                transform="rotate(-90 14 14)"
                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
              />
              <text x="14" y="18" textAnchor="middle" fill="#fff" fontSize="7" fontFamily="monospace">
                {percent}%
              </text>
            </svg>
          )}
        </div>

        {/* Title */}
        <div style={styles.title}>{title}</div>

        {/* Stage */}
        {stage && <div style={styles.stage}>{stage}</div>}

        {/* Bar */}
        <div style={styles.barTrack}>
          {indeterminate ? (
            <div style={styles.barIndeterminate} />
          ) : (
            <div
              style={{
                ...styles.barFill,
                width: `${percent}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const SHIMMER = `
@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

// Inject keyframes once
if (typeof document !== 'undefined') {
  const id = '__lp_keyframes';
  if (!document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = SHIMMER;
    document.head.appendChild(s);
  }
}

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(8, 12, 24, 0.72)',
    backdropFilter: 'blur(4px)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(15, 20, 40, 0.92)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    padding: '28px 40px',
    minWidth: '280px',
    maxWidth: '380px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
  },
  iconRow: {
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: '28px',
    height: '28px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTop: '3px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite',
  },
  progressRing: {
    display: 'block',
  },
  title: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 600,
    textAlign: 'center',
  },
  stage: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: '12px',
    textAlign: 'center',
    fontFamily: 'monospace',
    minHeight: '16px',
  },
  barTrack: {
    width: '100%',
    height: '5px',
    background: 'rgba(255,255,255,0.1)',
    borderRadius: '3px',
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
    borderRadius: '3px',
    transition: 'width 0.25s ease',
  },
  barIndeterminate: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '40%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
    borderRadius: '3px',
    animation: 'shimmer 1.4s infinite',
  },
};
