import React, { forwardRef } from 'react';

/**
 * Inspiration: IFCtoFDS Shift+drag marquee selection rectangle
 * This is the visual rectangle drawn while the user drags.
 * Pass the ref to useMarqueeSelection({ overlayRef }).
 */
const MarqueeOverlay = forwardRef(function MarqueeOverlay(_, ref) {
  return (
    <div
      ref={ref}
      style={{
        display: 'none',
        position: 'absolute',
        border: '1.5px dashed #4fc3f7',
        background: 'rgba(79, 195, 247, 0.08)',
        borderRadius: '2px',
        pointerEvents: 'none',
        zIndex: 150,
        boxShadow: '0 0 0 1px rgba(79,195,247,0.15)',
      }}
    />
  );
});

export default MarqueeOverlay;
