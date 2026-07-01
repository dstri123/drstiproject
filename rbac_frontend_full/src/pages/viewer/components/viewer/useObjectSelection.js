import { useEffect } from "react";
import * as THREE from "three";

export default function useObjectSelection(
  sceneRef,
  cameraRef,
  rendererRef,
  modelData,
  onObjectSelect
) {
  useEffect(() => {
    if (!sceneRef?.current || !cameraRef?.current || !rendererRef?.current) {
      return;
    }

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    let lastHighlighted = null;

    // Undo whatever highlight we applied, whether mesh (material swap) or
    // point cloud (color tweak), so deselect never leaves the model altered.
    const restoreHighlight = (obj) => {
      if (!obj) return;
      if (obj.isPoints) {
        if (obj.userData.origPointColor && obj.material?.color) {
          obj.material.color.copy(obj.userData.origPointColor);
          obj.material.needsUpdate = true;
          delete obj.userData.origPointColor;
        }
      } else if (obj.userData.originalMaterial) {
        obj.material = obj.userData.originalMaterial;
        delete obj.userData.originalMaterial;
      }
    };

    const onMouseClick = (event) => {
      // While the user is picking alignment points, let usePicking own the
      // click — don't select/highlight the whole model or pop the gizmo.
      if (window.__pickingMode === "bim" || window.__pickingMode === "pc") {
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      const pickable = intersects.filter(({ object: obj }) => {
        return (
          !(obj instanceof THREE.Sprite) &&
          !obj.userData?.isPickingMarker &&
          !obj.userData?.isHelper &&
          !obj.userData?.gizmoType  // skip gizmo meshes
        );
      });

      if (pickable.length > 0) {
        const selected = pickable[0].object;

        // Walk up to the root group
        let root = selected;
        while (root.parent && root.parent !== scene) {
          if (root.parent instanceof THREE.Group) {
            root = root.parent;
          } else {
            break;
          }
        }

        // Restore previous highlight
        if (lastHighlighted && lastHighlighted !== root) {
          restoreHighlight(lastHighlighted);
        }

        // Apply highlight. For point clouds we intentionally do NOT touch the
        // material colour — the per-point RGB scan values must stay exactly as
        // captured. Selection is already shown by the gizmo + top banner.
        if (root.isPoints) {
          // no-op: keep original point colours
        } else if (root.material) {
          root.userData.originalMaterial = root.material;
          root.material = new THREE.MeshStandardMaterial({
            color: 0x00aaff,
            emissive: 0x003366,
            emissiveIntensity: 0.3,
          });
        }

        lastHighlighted = root;
        onObjectSelect?.(root);
      } else {
        restoreHighlight(lastHighlighted);
        lastHighlighted = null;
        onObjectSelect?.(null);
      }
    };

    renderer.domElement.addEventListener("click", onMouseClick);
    return () => {
      renderer.domElement.removeEventListener("click", onMouseClick);
    };
  }, [sceneRef, cameraRef, rendererRef, modelData, onObjectSelect]);
}
