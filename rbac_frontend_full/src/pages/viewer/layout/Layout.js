import React, { useState } from 'react';
import Header from './Header';
import IconToolbar from './IconToolbar';
import ContextPanel from './Sidebar';

export default function Layout({ sidebarProps, children }) {
  const [activePanel, setActivePanel] = useState(null);
  const role = localStorage.getItem('role') || 'viewer';

  const handleSelectPanel = (id) => {
    setActivePanel(prev => (prev === id ? null : id));
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 52,
      display: 'flex',
      flexDirection: 'column',
      background: '#f0f4f8',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    }}>
      {/* TOP HEADER */}
      <Header />

      {/* WORKSPACE */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* ICON TOOLBAR */}
        <IconToolbar
          activePanel={activePanel}
          onSelectPanel={handleSelectPanel}
          role={role}
        />

        {/* CONTEXTUAL PANEL — compact floating tool drawer */}
        {activePanel && (
          <div style={{
            width: 216,
            flexShrink: 0,
            background: '#ffffff',
            borderRight: '1px solid #e5e7eb',
            boxShadow: '2px 0 12px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <ContextPanel
              {...sidebarProps}
              activePanel={activePanel}
              onClosePanel={() => setActivePanel(null)}
              role={role}
            />
          </div>
        )}

        {/* 3D VIEWPORT — dominates remaining space */}
        <div style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          background: '#f0f4f8',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}
