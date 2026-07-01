// Thin wrapper exposing controls for SectionBoxManager
export function attachSimpleUI({ manager, onChange }) {
  if (!manager) return () => {};
  const api = {
    toggle: () => {
      if (manager.edgeMesh) manager.disable();
      else manager.enable();
      onChange && onChange({ enabled: !!manager.edgeMesh });
    },
    reset: () => {
      manager.reset();
      onChange && onChange({ reset: true });
    },
    isolateFloor: (predicate) => {
      manager.isolateFloor(predicate);
      onChange && onChange({ isolate: true });
    },
  };
  return api;
}
