import { useState, useCallback, useRef } from 'react';

/**
 * Inspiration: IFCtoFDS multi-phase loading progress bar
 * Tracks loading state with a percentage, stage label, and title.
 * Supports both indeterminate (spinner) and determinate (% bar) modes.
 *
 * Usage:
 *   const progress = useLoadingProgress();
 *   progress.show('Loading BIM model', 'Reading file…');
 *   progress.set(0.5, 'Parsing geometry…');
 *   progress.hide();
 *
 *   // Render: <LoadingProgressBar {...progress.state} />
 */
export function useLoadingProgress() {
  const [state, setState] = useState({
    visible: false,
    title: '',
    stage: '',
    percent: 0,
    indeterminate: true,
  });

  const show = useCallback((title = 'Loading…', stage = '') => {
    setState({ visible: true, title, stage, percent: 0, indeterminate: true });
  }, []);

  const set = useCallback((fraction, stage) => {
    setState(prev => ({
      ...prev,
      visible: true,
      indeterminate: false,
      percent: Math.round(Math.max(0, Math.min(1, fraction)) * 100),
      stage: stage !== undefined ? stage : prev.stage,
    }));
  }, []);

  const hide = useCallback(() => {
    setState(prev => ({ ...prev, visible: false }));
  }, []);

  const setStage = useCallback((stage) => {
    setState(prev => ({ ...prev, stage }));
  }, []);

  /**
   * Wraps an async operation with automatic progress tracking.
   * phases = [{ label, weight }]  (weights are relative)
   */
  const withProgress = useCallback(async (title, phases, operation) => {
    show(title, phases[0]?.label ?? '');
    let done = 0;
    const total = phases.reduce((s, p) => s + (p.weight ?? 1), 0);
    const advance = (phaseIdx, fractionWithinPhase = 1) => {
      const phaseWeight = phases[phaseIdx]?.weight ?? 1;
      const phaseStart = phases.slice(0, phaseIdx).reduce((s, p) => s + (p.weight ?? 1), 0);
      const overall = (phaseStart + phaseWeight * fractionWithinPhase) / total;
      set(overall, phases[phaseIdx]?.label ?? '');
    };
    try {
      const result = await operation(advance);
      set(1, 'Done');
      setTimeout(hide, 400);
      return result;
    } catch (err) {
      hide();
      throw err;
    }
  }, [show, set, hide]);

  return { state, show, set, setStage, hide, withProgress };
}
