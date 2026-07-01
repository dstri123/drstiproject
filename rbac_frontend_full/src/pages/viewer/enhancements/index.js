/**
 * Viewer Enhancements — inspired by IFCtoFDS
 * ============================================
 * Drop-in hooks and components that upgrade drsti-main's 3D viewer
 * with features from the IFCtoFDS project.
 *
 * QUICK START
 * -----------
 * In ThreeViewer.js (or any React component with access to sceneData):
 *
 *   import {
 *     useWalkMode,
 *     useHoverTooltip,
 *     useMarqueeSelection,
 *     useUndoStack,
 *     useKeyboardShortcuts,
 *     useLoadingProgress,
 *     WalkModeHUD,
 *     HoverTooltip,
 *     MarqueeOverlay,
 *     LayerVisibilityPanel,
 *     DualOpacitySliders,
 *     ClippingPanel,
 *     LoadingProgressBar,
 *     playReveal,
 *     fadeGroup,
 *   } from '../enhancements';
 *
 * FEATURE REFERENCE
 * -----------------
 * useWalkMode          — First-person WASD walk with gravity + collision
 * useHoverTooltip      — Gold hover highlight + floating name tooltip
 * useMarqueeSelection  — Shift+drag rectangle multi-select
 * useUndoStack         — Ctrl+Z undo for any viewer action
 * useKeyboardShortcuts — Numpad 0-6 snap views + arrow key orbit
 * useLoadingProgress   — Multi-phase progress bar (% + stage label)
 *
 * WalkModeHUD          — HUD overlay with status + control hints
 * HoverTooltip         — Cursor-following tooltip component
 * MarqueeOverlay       — Dashed selection rectangle (pass ref to useMarqueeSelection)
 * LayerVisibilityPanel — Per-category toggle switches for BIM layers
 * DualOpacitySliders   — Independent BIM / Point Cloud opacity sliders
 * ClippingPanel        — 6-axis X/Y/Z clip with steppers + numeric input
 * LoadingProgressBar   — Full-viewport loading overlay with phase bar
 *
 * playReveal(scene, opts) — Bottom-up layer reveal animation (post-load)
 * fadeGroup(group, targetOpacity, ms) — Simple opacity fade utility
 */

// Hooks
export { useWalkMode }         from './hooks/useWalkMode';
export { useHoverTooltip }     from './hooks/useHoverTooltip';
export { useMarqueeSelection } from './hooks/useMarqueeSelection';
export { useUndoStack }        from './hooks/useUndoStack';
export { useKeyboardShortcuts }from './hooks/useKeyboardShortcuts';
export { useLoadingProgress }  from './hooks/useLoadingProgress';

// Components
export { default as WalkModeHUD }          from './components/WalkModeHUD';
export { default as HoverTooltip }         from './components/HoverTooltip';
export { default as MarqueeOverlay }       from './components/MarqueeOverlay';
export { default as LayerVisibilityPanel, buildDefaultLayers } from './components/LayerVisibilityPanel';
export { default as DualOpacitySliders }   from './components/DualOpacitySliders';
export { default as ClippingPanel }        from './components/ClippingPanel';
export { default as LoadingProgressBar }   from './components/LoadingProgressBar';

// Utils
export { playReveal, fadeGroup } from './utils/revealAnimation';
