import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import createInfiniteGrid from "./InfiniteGrid";

// Dispose a material and any textures it references.
function disposeMaterial(m) {
  if (!m) return;
  for (const key in m) {
    const val = m[key];
    if (val && val.isTexture) val.dispose();
  }
  m.dispose();
}

// Recursively dispose every geometry/material/texture under a root object.
export function disposeSceneDeep(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(
        disposeMaterial,
      );
    }
  });
}

export default function useSceneSetup(mountRef) {
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const animationRef = useRef(null);
  const gridRef = useRef(null);
  const axesRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;

    // ---------- SCENE ----------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#F3F4F6");

    // ---------- CAMERA ----------
    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      5000,
    );
    camera.position.set(10, 10, 10);

    // ---------- RENDERER ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(
      mountRef.current.clientWidth,
      mountRef.current.clientHeight,
    );
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true;

    mountRef.current.appendChild(renderer.domElement);

    // Show a hand cursor over the viewport: open "grab" hand at rest, closed
    // "grabbing" hand while dragging to orbit/pan — like a 3D navigation tool.
    renderer.domElement.style.cursor = "grab";
    const handleGrabDown = () => {
      renderer.domElement.style.cursor = "grabbing";
    };
    const handleGrabUp = () => {
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerdown", handleGrabDown);
    window.addEventListener("pointerup", handleGrabUp);

    // ---------- CONTROLS ----------
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    // ---------- HELPERS ----------
    const grid = createInfiniteGrid({
      cellSize: 1,
      sectionSize: 10,
      cellColor: 0xcccccc,
      sectionColor: 0x888888,
    });
    // Hidden by default — the viewer shows them only when the user enables the
    // grid view, so the loading scene stays clean.
    grid.visible = false;
    scene.add(grid);
    gridRef.current = grid;

    const axes = new THREE.AxesHelper(5);
    axes.visible = false;
    scene.add(axes);
    axesRef.current = axes;

    // ---------- LIGHT ----------
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(10, 20, 10);
    scene.add(directional);

    // ---------- SAVE REFS ----------
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    setSceneReady(true);

    // Monkey-patch add/remove to catch invalid inserts for debugging
    const origAdd = scene.add.bind(scene);
    scene.add = (...objs) => {
      objs.forEach((o) => {
        if (!o || typeof o.visible === "undefined") {
          console.warn(
            "useSceneSetup: scene.add called with invalid object:",
            o,
            new Error().stack,
          );
        }
      });
      return origAdd(...objs);
    };
    const origRemove = scene.remove.bind(scene);
    scene.remove = (...objs) => {
      objs.forEach((o) => {
        if (!o || typeof o.visible === "undefined") {
          console.warn(
            "useSceneSetup: scene.remove called with invalid object:",
            o,
            new Error().stack,
          );
        }
      });
      return origRemove(...objs);
    };

    // ---------- ANIMATION ----------
    const sanitizeSceneChildren = () => {
      // Deep-clean the scene graph: remove any falsy, malformed, or non-Object3D
      // child entries recursively so Three.js never sees a null child during render.
      const cleanNode = (node) => {
        if (!node) return;
        const children = Array.isArray(node.children) ? node.children : null;
        if (!children) return;
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (
            !child ||
            typeof child.visible === "undefined" ||
            !(child instanceof THREE.Object3D)
          ) {
            console.warn(
              "useSceneSetup: removing invalid scene child",
              child,
              "from parent",
              node,
            );
            try {
              if (child && child.parent) child.parent.remove(child);
            } catch (err) {
              // ignore remove errors
            }
            children.splice(i, 1);
            continue;
          }
          // recurse
          cleanNode(child);
        }
      };

      // Extra diagnostic: find null/invalid paths for logging (helps trace origin)
      const findInvalidPaths = () => {
        const bad = [];
        const dfs = (node, path) => {
          if (!node) {
            bad.push(path);
            return;
          }
          const children = Array.isArray(node.children) ? node.children : null;
          if (!children) return;
          for (let i = 0; i < children.length; i++) {
            const c = children[i];
            const childPath = `${path}/${node.type || node.constructor?.name || "node"}[${i}]`;
            if (!c) {
              bad.push(childPath + " = null");
              continue;
            }
            if (typeof c.visible === "undefined") {
              bad.push(childPath + " (missing visible)");
              continue;
            }
            dfs(c, childPath);
          }
        };
        dfs(scene, "scene");
        return bad;
      };

      cleanNode(scene);
      const invalidPaths = findInvalidPaths();
      if (invalidPaths.length) {
        console.warn(
          "useSceneSetup: detected invalid scene paths:",
          invalidPaths,
        );
      }
    };

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controls.update();
      sanitizeSceneChildren();
      try {
        renderer.render(scene, camera);
      } catch (err) {
        console.error("useSceneSetup: renderer.render failed", err);
        // dump quick diagnostic about children
        try {
          const bad = [];
          for (let i = 0; i < scene.children.length; i++) {
            const c = scene.children[i];
            if (!c || typeof c.visible === "undefined")
              bad.push({ index: i, child: c });
          }
          console.error(
            "useSceneSetup: invalid children:",
            bad,
            "scene.children.length=",
            scene.children.length,
          );
        } catch (e) {
          console.error(
            "useSceneSetup: failed to introspect scene.children",
            e,
          );
        }
      }
    };

    animate();

    // ---------- RESIZE ----------
    const handleResize = () => {
      if (!mountRef.current) return;

      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    let resizeObserver = null;
    if (window.ResizeObserver && mountRef.current) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(mountRef.current);
    }

    // ---------- CLEANUP ----------
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      renderer.domElement.removeEventListener("pointerdown", handleGrabDown);
      window.removeEventListener("pointerup", handleGrabUp);

      // stop animation loop
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      // dispose controls
      controls.dispose();

      // ---- Free GPU memory ----
      // Three.js does NOT auto-release geometries/materials/textures or the
      // WebGL context. Without this, every viewer visit leaks GPU memory and
      // the tab eventually slows/crashes. Traverse the whole scene and dispose
      // everything, then drop the context.
      try {
        disposeSceneDeep(scene);
        scene.clear();
      } catch (e) {
        console.warn("useSceneSetup: scene dispose failed", e);
      }

      // safe DOM removal
      if (renderer && renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }

      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch (e) {
        // not all browsers support it — ignore
      }
      sceneRef.current = null;
      rendererRef.current = null;
      setSceneReady(false);
    };
  }, [mountRef]);

  return {
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    gridRef,
    axesRef,
    sceneReady,
  };
}
