import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getSafeIfcType } from "./useModelLoader";
import { ISSUE_STATUS } from "../../issues/useIssues";

// ─── IFC ↔ scene frame ────────────────────────────────────────────────────────
// Issues are stored in IFC model coordinates (metres, Z-up) — what BCF uses —
// relative to the BIM model, so they stay put when the model is moved. web-ifc
// hands three.js its geometry in metres rotated to Y-up: scene (x, y, z) =
// IFC (x, z, -y), inside the BIM object's own transform.
const sceneToIfc = (v) => [v.x, -v.z, v.y];
const ifcToScene = ([x, y, z]) => new THREE.Vector3(x, z, -y);

const PIN_PX = 26; // on-screen pin diameter
const SNAPSHOT_MAX_EDGE = 1280;
const CLICK_SLOP_PX = 5; // farther than this between down/up = orbit drag

function pinTexture(number, color, selected) {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = selected ? 7 : 4;
  ctx.strokeStyle = selected ? "#1d4ed8" : "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${number > 99 ? 20 : 26}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), size / 2, size / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function expressIdAt(hit) {
  const geom = hit.object?.geometry;
  const ids = geom?.attributes?.expressID?.array;
  if (!ids || hit.faceIndex == null) return null;
  const vi = geom.index
    ? geom.index.array[hit.faceIndex * 3]
    : hit.faceIndex * 3;
  return ids[vi] ?? null;
}

async function globalIdOf(bimModel, expressID) {
  const mgr = bimModel?.ifcManager;
  if (!mgr || bimModel.modelID == null) return "";
  try {
    const props = await mgr.getItemProperties(bimModel.modelID, expressID);
    return props?.GlobalId?.value || "";
  } catch {
    return ""; // the backend resolves it from the IFC at export time
  }
}

// PNG of the current view, without issue pins, downscaled for upload.
function captureSnapshot(renderer, scene, camera, hide) {
  hide.visible = false;
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const scale = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(src.width, src.height));
  const out = document.createElement("canvas");
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  // Copy in the same tick as the render — the WebGL buffer isn't preserved.
  out.getContext("2d").drawImage(src, 0, 0, out.width, out.height);
  hide.visible = true;
  return new Promise((resolve) =>
    out.toBlob((blob) => {
      if (blob) blob.name = "snapshot.png";
      resolve(blob);
    }, "image/png"),
  );
}

/**
 * Issue pins in the 3D view.
 *  - pinMode: the next click on the BIM / point cloud calls onPick({position,
 *    viewpoint, element, snapshot}) in IFC coordinates, instead of selecting.
 *  - Renders every issue as a numbered, status-coloured pin; clicking one
 *    calls onSelect(issue).
 *  - window.flyToIssue(issue) moves the camera to the issue's saved viewpoint.
 */
export default function useIssuePins(sceneData, modelData, props) {
  const { sceneRef, cameraRef, rendererRef, controlsRef } = sceneData;
  const { bimModel, pcModel } = modelData;
  const { issues, pinMode, selectedIssueId, onPick, onSelect, onCancel } =
    props;

  const groupRef = useRef(null);
  const handlersRef = useRef({});
  handlersRef.current = { onPick, onSelect, onCancel, pinMode };

  // Pin group lives at the scene root; positions follow the BIM each frame.
  useEffect(() => {
    const scene = sceneRef?.current;
    if (!scene) return;
    const group = new THREE.Group();
    group.name = "issuePins";
    group.renderOrder = 999;
    scene.add(group);
    groupRef.current = group;
    return () => {
      scene.remove(group);
      groupRef.current = null;
    };
  }, [sceneRef, sceneData.sceneReady]);

  // (Re)build sprites when issues / selection change.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.children.slice().forEach((s) => {
      s.material.map?.dispose();
      s.material.dispose();
      group.remove(s);
    });
    if (!bimModel) return;
    (issues || []).forEach((issue) => {
      if (!Array.isArray(issue.position)) return;
      const selected = issue.id === selectedIssueId;
      const mat = new THREE.SpriteMaterial({
        map: pinTexture(
          issue.number,
          (ISSUE_STATUS[issue.status] || ISSUE_STATUS.open).color,
          selected,
        ),
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 999;
      sprite.userData = {
        isHelper: true, // keep useObjectSelection from selecting it
        issue,
        // Pin point in the BIM's own frame — re-placed every frame so the
        // pin stays on its element when the model is moved or rotated.
        local: ifcToScene(issue.position),
        selected,
      };
      group.add(sprite);
    });
  }, [issues, selectedIssueId, bimModel, sceneData.sceneReady]);

  // Keep pins on their element as the BIM moves/rotates, and a constant
  // size on screen.
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const group = groupRef.current;
      const renderer = rendererRef?.current;
      const camera = cameraRef?.current;
      if (!group || !bimModel || !renderer || !camera) return;
      bimModel.updateMatrixWorld();
      const h = renderer.domElement.clientHeight || 1;
      group.children.forEach((s) => {
        s.position.copy(s.userData.local).applyMatrix4(bimModel.matrixWorld);
        // sizeAttenuation:false sprites are sized in clip units of 2/height.
        const px = s.userData.selected ? PIN_PX * 1.3 : PIN_PX;
        const k = ((px / h) * 2 * Math.tan((camera.fov * Math.PI) / 360));
        s.scale.set(k, k, 1);
      });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [bimModel, rendererRef, cameraRef]);

  // Click handling — capture phase so a pin/pick click doesn't also select
  // the element underneath (usePicking / useObjectSelection).
  useEffect(() => {
    const renderer = rendererRef?.current;
    const camera = cameraRef?.current;
    const scene = sceneRef?.current;
    if (!renderer || !camera || !scene) return;
    const canvas = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let down = null;

    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY };
    };

    const onClick = async (e) => {
      if (
        down &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX
      )
        return; // end of an orbit drag
      const rect = canvas.getBoundingClientRect();
      mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const { pinMode: picking, onPick: pick, onSelect: select } =
        handlersRef.current;

      if (!picking) {
        const group = groupRef.current;
        const hit = group && raycaster.intersectObjects(group.children)[0];
        if (hit) {
          e.stopImmediatePropagation();
          select?.(hit.object.userData.issue);
        }
        return;
      }

      e.stopImmediatePropagation();
      if (!bimModel) return;
      const targets = [bimModel];
      if (pcModel?.visible) {
        pcModel.geometry.computeBoundingSphere?.();
        const r = pcModel.geometry.boundingSphere?.radius || 1;
        raycaster.params.Points.threshold = Math.max(
          r * (pcModel.scale?.x || 1) * 0.005,
          0.02,
        );
        targets.push(pcModel);
      }
      const hit = raycaster.intersectObjects(targets, true)[0];
      if (!hit) return;

      bimModel.updateMatrixWorld(true);
      const toLocal = bimModel.matrixWorld.clone().invert();
      const camDir = camera.getWorldDirection(new THREE.Vector3());
      const camUp = camera.up.clone().applyQuaternion(camera.quaternion);

      let isBimHit = false;
      for (let o = hit.object; o; o = o.parent) if (o === bimModel) isBimHit = true;
      const expressID = isBimHit ? expressIdAt(hit) : null;

      const snapshot = await captureSnapshot(
        renderer,
        scene,
        camera,
        groupRef.current || new THREE.Group(),
      );
      pick?.({
        position: sceneToIfc(bimModel.worldToLocal(hit.point.clone())),
        viewpoint: {
          position: sceneToIfc(bimModel.worldToLocal(camera.position.clone())),
          direction: sceneToIfc(camDir.transformDirection(toLocal)),
          up: sceneToIfc(camUp.transformDirection(toLocal)),
          fov: camera.fov,
        },
        element:
          expressID != null
            ? {
                expressID,
                type: getSafeIfcType(bimModel, expressID) || "",
                globalId: await globalIdOf(bimModel, expressID),
              }
            : null,
        snapshot,
      });
    };

    const onKey = (e) => {
      if (e.key === "Escape" && handlersRef.current.pinMode)
        handlersRef.current.onCancel?.();
    };

    canvas.addEventListener("pointerdown", onDown, true);
    canvas.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      canvas.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [rendererRef, cameraRef, sceneRef, bimModel, pcModel, sceneData.sceneReady]);

  // Crosshair while pinning.
  useEffect(() => {
    const canvas = rendererRef?.current?.domElement;
    if (!canvas) return;
    canvas.style.cursor = pinMode ? "crosshair" : "grab";
  }, [pinMode, rendererRef]);

  // Fly the camera to an issue's saved viewpoint (or just look at its pin).
  useEffect(() => {
    window.flyToIssue = (issue) => {
      const camera = cameraRef?.current;
      const controls = controlsRef?.current;
      if (!camera || !bimModel || !issue) return;
      bimModel.updateMatrixWorld(true);
      const m = bimModel.matrixWorld;
      const pin = ifcToScene(issue.position).applyMatrix4(m);
      const vp = issue.viewpoint;
      const toPos = vp?.position
        ? ifcToScene(vp.position).applyMatrix4(m)
        : camera.position
            .clone()
            .sub(controls?.target || pin)
            .add(pin);
      const fromPos = camera.position.clone();
      const fromTarget = (controls?.target || pin).clone();
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 600);
        const ease = t * (2 - t);
        camera.position.lerpVectors(fromPos, toPos, ease);
        if (controls) {
          controls.target.lerpVectors(fromTarget, pin, ease);
          controls.update();
        } else {
          camera.lookAt(pin);
        }
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    return () => {
      delete window.flyToIssue;
    };
  }, [bimModel, cameraRef, controlsRef]);
}
