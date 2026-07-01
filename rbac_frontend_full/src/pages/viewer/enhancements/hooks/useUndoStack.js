import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Inspiration: IFCtoFDS undo stack (Ctrl+Z)
 * Generic undo/redo stack for viewer actions.
 * Supports: visibility toggle, opacity change, deletion, custom actions.
 *
 * Usage:
 *   const { push, undo, redo, canUndo, canRedo, history } = useUndoStack();
 *
 *   // Push a reversible action:
 *   push({
 *     label: 'Hide wall',
 *     redo: () => mesh.visible = false,
 *     undo: () => mesh.visible = true,
 *   });
 */
export function useUndoStack(maxSize = 50) {
  const [cursor, setCursor] = useState(-1);
  const stackRef = useRef([]);
  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate(n => n + 1);

  const push = useCallback((action) => {
    // Execute the action
    action.redo?.();
    // Truncate any redo history
    stackRef.current = stackRef.current.slice(0, cursor + 1);
    stackRef.current.push({
      label: action.label || 'Action',
      redo: action.redo,
      undo: action.undo,
      timestamp: Date.now(),
    });
    if (stackRef.current.length > maxSize) stackRef.current.shift();
    setCursor(stackRef.current.length - 1);
    refresh();
  }, [cursor, maxSize]);

  const undo = useCallback(() => {
    if (cursor < 0) return;
    stackRef.current[cursor]?.undo?.();
    setCursor(c => c - 1);
    refresh();
  }, [cursor]);

  const redo = useCallback(() => {
    const next = cursor + 1;
    if (next >= stackRef.current.length) return;
    stackRef.current[next]?.redo?.();
    setCursor(next);
    refresh();
  }, [cursor]);

  const clear = useCallback(() => {
    stackRef.current = [];
    setCursor(-1);
    refresh();
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) redo();
        else undo();
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        redo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // Convenience helpers for common viewer actions
  const pushVisibility = useCallback((mesh, visible) => {
    const prev = mesh.visible;
    push({
      label: `${visible ? 'Show' : 'Hide'} ${mesh.name || 'object'}`,
      redo: () => { mesh.visible = visible; },
      undo: () => { mesh.visible = prev; },
    });
  }, [push]);

  const pushOpacity = useCallback((material, opacity) => {
    const prev = material.opacity;
    push({
      label: `Opacity → ${(opacity * 100).toFixed(0)}%`,
      redo: () => { material.opacity = opacity; material.transparent = opacity < 1; },
      undo: () => { material.opacity = prev; material.transparent = prev < 1; },
    });
  }, [push]);

  return {
    push,
    undo,
    redo,
    clear,
    pushVisibility,
    pushOpacity,
    canUndo: cursor >= 0,
    canRedo: cursor < stackRef.current.length - 1,
    history: stackRef.current.slice(0, cursor + 1),
    cursor,
  };
}
