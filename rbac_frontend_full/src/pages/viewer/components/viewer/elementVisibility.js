// Per-element show/hide toggled from the sidebar's "BIM Element Categories"
// list. IFC elements are merged into one mesh per material (see
// setupBimObject in useModelLoader.js) — there's no separate Object3D per
// element to hide, so instead we degenerate that element's triangles in the
// shared index buffer (collapse each to a single point, so it rasterizes to
// zero area) and restore the original indices when it's shown again.
// Non-IFC (FBX) elements each keep their own child mesh, so those just
// toggle `.visible` directly.

// geometry -> original index array, captured the first time any element on
// it is hidden, so later toggles (including showing it again) always start
// from the untouched triangle list instead of compounding edits.
const ORIGINAL_INDEX_CACHE = new WeakMap();

// Sidebar labels for IFC elements are built as `${ifcType} #${expressID}`
// (see useModelLoader.js / usePicking.js) — pull the id back out of that.
function expressIdFromLabel(name) {
  const m = /#(\d+)\s*$/.exec(name || "");
  return m ? Number(m[1]) : null;
}

export function applyHiddenElements(bimModel, hiddenNames) {
  if (!bimModel) return;

  const hiddenExpressIds = new Set();
  const hiddenMeshNames = new Set();
  hiddenNames.forEach((name) => {
    const id = expressIdFromLabel(name);
    if (id != null) hiddenExpressIds.add(id);
    else hiddenMeshNames.add(name);
  });

  bimModel.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    const expressIDAttr = geometry?.attributes?.expressID;
    const index = geometry?.index;

    if (!expressIDAttr || !index) {
      // Non-IFC element: its own mesh, named after the element (or its
      // parent group) the same way the sidebar list names it.
      const elementName = child.name || child.parent?.name;
      if (elementName) child.visible = !hiddenMeshNames.has(elementName);
      return;
    }

    let original = ORIGINAL_INDEX_CACHE.get(geometry);
    if (!original) {
      if (hiddenExpressIds.size === 0) return; // nothing hidden yet, nothing to restore
      original = index.array.slice();
      ORIGINAL_INDEX_CACHE.set(geometry, original);
    }

    const arr = index.array;
    const faceCount = original.length / 3;
    for (let f = 0; f < faceCount; f++) {
      const base = f * 3;
      const i0 = original[base];
      const id = expressIDAttr.array[i0];
      if (hiddenExpressIds.has(id)) {
        arr[base] = i0;
        arr[base + 1] = i0;
        arr[base + 2] = i0;
      } else {
        arr[base] = i0;
        arr[base + 1] = original[base + 1];
        arr[base + 2] = original[base + 2];
      }
    }
    index.needsUpdate = true;
  });
}
