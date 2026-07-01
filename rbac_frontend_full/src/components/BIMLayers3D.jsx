import React, { useEffect, useRef } from "react";
import * as THREE from "three";

const BIMLayers3D = () => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const groupRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    sceneRef.current = scene;

    // Camera setup
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 12, 8);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(10, 15, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -15;
    directionalLight.shadow.camera.right = 15;
    directionalLight.shadow.camera.top = 15;
    directionalLight.shadow.camera.bottom = -15;
    scene.add(directionalLight);

    // Create layer group
    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    // Helper function to create walls
    const createWall = (x, y, z, width, height, depth, color) => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshPhongMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Helper function to create columns
    const createColumn = (x, y, z, color) => {
      const geometry = new THREE.CylinderGeometry(0.2, 0.2, 2.5, 8);
      const material = new THREE.MeshPhongMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y + 1.25, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Helper function to create floor slab
    const createFloor = (x, y, z, width, depth, color) => {
      const geometry = new THREE.BoxGeometry(width, 0.3, depth);
      const material = new THREE.MeshPhongMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Foundation Layer (0)
    const foundationY = 0;
    const foundation = new THREE.Group();
    foundation.name = "Foundation Layer";
    foundation.position.y = foundationY;

    foundation.add(createFloor(0, 0, 0, 6, 5, 0x4a5568));
    foundation.add(createWall(-3, 0.15, 0, 0.3, 0.3, 5, 0x2d3748));
    foundation.add(createWall(3, 0.15, 0, 0.3, 0.3, 5, 0x2d3748));
    foundation.add(createWall(0, 0.15, -2.5, 6, 0.3, 0.3, 0x2d3748));
    foundation.add(createWall(0, 0.15, 2.5, 6, 0.3, 0.3, 0x2d3748));

    // Columns for foundation
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        foundation.add(createColumn(i * 1.5, 0.15, j * 1.2, 0x1a202c));
      }
    }
    group.add(foundation);

    // Architectural Layer (1)
    const archY = 3.5;
    const arch = new THREE.Group();
    arch.name = "Architectural Layer";
    arch.position.y = archY;

    arch.add(createFloor(0, 0, 0, 6, 5, 0xdbeafe));
    // Exterior walls
    arch.add(createWall(-3, 0, 0, 0.3, 2.8, 5, 0x1e40af));
    arch.add(createWall(3, 0, 0, 0.3, 2.8, 5, 0x1e40af));
    arch.add(createWall(0, 0, -2.5, 6, 2.8, 0.3, 0x1e40af));
    arch.add(createWall(0, 0, 2.5, 6, 2.8, 0.3, 0x1e40af));

    // Interior walls
    arch.add(createWall(-1, 0, 0, 0.2, 2.5, 5, 0x0c4a6e));
    arch.add(createWall(1.5, 0, 0, 0.2, 2.5, 3, 0x0c4a6e));
    arch.add(createWall(0, 0, -1, 3, 2.5, 0.2, 0x0c4a6e));
    arch.add(createWall(2, 0, 1, 2, 2.5, 0.2, 0x0c4a6e));
    group.add(arch);

    // MEP Systems Layer (2)
    const mepY = 7;
    const mep = new THREE.Group();
    mep.name = "MEP Systems Layer";
    mep.position.y = mepY;

    mep.add(createFloor(0, 0, 0, 6, 5, 0xa5f3fc));

    // HVAC ducts
    for (let i = -2; i <= 2; i++) {
      const ductGeom = new THREE.BoxGeometry(0.3, 0.15, 4, 4);
      const ductMat = new THREE.MeshPhongMaterial({ color: 0x0891b2 });
      const duct = new THREE.Mesh(ductGeom, ductMat);
      duct.position.set(i * 1.3, 0.5, 0);
      duct.castShadow = true;
      mep.add(duct);
    }

    // Plumbing pipes
    for (let i = -1; i <= 1; i++) {
      const pipeGeom = new THREE.CylinderGeometry(0.08, 0.08, 4.5, 6);
      const pipeMat = new THREE.MeshPhongMaterial({ color: 0x06b6d4 });
      const pipe = new THREE.Mesh(pipeGeom, pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(i * 1.8, 1, 0);
      pipe.castShadow = true;
      mep.add(pipe);
    }
    group.add(mep);

    // Structural Layer (3)
    const structY = 10.5;
    const struct = new THREE.Group();
    struct.name = "Structural Layer";
    struct.position.y = structY;

    struct.add(createFloor(0, 0, 0, 6, 5, 0x7dd3fc));

    // Main beams
    const beamH = new THREE.BoxGeometry(6, 0.25, 0.25);
    const beamMat = new THREE.MeshPhongMaterial({ color: 0x0369a1 });
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(beamH, beamMat);
      beam.position.set(0, 0.5, i * 1.2);
      beam.castShadow = true;
      struct.add(beam);
    }

    // Vertical columns with detail
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        struct.add(createColumn(i * 1.5, 0, j * 1.2, 0x0284c7));
      }
    }
    group.add(struct);

    // BIM Model Layer (4)
    const bimY = 14;
    const bim = new THREE.Group();
    bim.name = "BIM Model";
    bim.position.y = bimY;

    bim.add(createFloor(0, 0, 0, 6, 5, 0x38bdf8));
    bim.add(createWall(-3, 0, 0, 0.3, 2.8, 5, 0x0ea5e9));
    bim.add(createWall(3, 0, 0, 0.3, 2.8, 5, 0x0ea5e9));
    bim.add(createWall(0, 0, -2.5, 6, 2.8, 0.3, 0x0ea5e9));
    bim.add(createWall(0, 0, 2.5, 6, 2.8, 0.3, 0x0ea5e9));

    // Interior room divisions
    bim.add(createWall(-1, 0, 0, 0.2, 2.5, 5, 0x06b6d4));
    bim.add(createWall(1.5, 0, 0, 0.2, 2.5, 3, 0x06b6d4));
    bim.add(createWall(0, 0, -1, 3, 2.5, 0.2, 0x06b6d4));

    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        bim.add(createColumn(i * 1.5, 0, j * 1.2, 0x0284c7));
      }
    }
    group.add(bim);

    // Point Cloud Layer (5) - Simplified as dots
    const pcY = 17.5;
    const pc = new THREE.Group();
    pc.name = "Point Cloud";
    pc.position.y = pcY;

    pc.add(createFloor(0, 0, 0, 6, 5, 0x60a5fa));

    // Random point cloud dots
    const pointGeom = new THREE.BufferGeometry();
    const points = [];
    const pointColors = [];

    for (let i = 0; i < 300; i++) {
      const x = (Math.random() - 0.5) * 6;
      const y = Math.random() * 2;
      const z = (Math.random() - 0.5) * 5;
      points.push(x, y, z);
      pointColors.push(0.37, 0.64, 0.98); // #60a5fa in 0-1 range
    }

    pointGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    pointGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pointColors), 3));

    const pointMat = new THREE.PointsMaterial({ size: 0.08, vertexColors: true });
    const pointCloud = new THREE.Points(pointGeom, pointMat);
    pc.add(pointCloud);
    group.add(pc);

    // Mouse controls
    let mouseDown = false;
    let mouseX = 0;
    let mouseY = 0;
    let targetRotationX = 0;
    let targetRotationY = 0;
    let currentRotationX = 0.3;
    let currentRotationY = 0.5;
    let autoRotate = true;

    const onMouseDown = (e) => {
      mouseDown = true;
      mouseX = e.clientX;
      mouseY = e.clientY;
      autoRotate = false;
    };

    const onMouseMove = (e) => {
      if (!mouseDown) return;

      const deltaX = e.clientX - mouseX;
      const deltaY = e.clientY - mouseY;

      targetRotationY += deltaX * 0.01;
      targetRotationX -= deltaY * 0.01;

      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const onMouseUp = () => {
      mouseDown = false;
      setTimeout(() => {
        autoRotate = true;
      }, 3000);
    };

    const onWheel = (e) => {
      e.preventDefault();
      const zoomSpeed = 0.8;
      camera.position.z += e.deltaY > 0 ? zoomSpeed : -zoomSpeed;
      camera.position.z = Math.max(6, Math.min(25, camera.position.z));
    };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseup", onMouseUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      if (autoRotate) {
        targetRotationY += 0.001;
      }

      currentRotationX += (targetRotationX - currentRotationX) * 0.1;
      currentRotationY += (targetRotationY - currentRotationY) * 0.1;

      group.rotation.x = currentRotationX;
      group.rotation.y = currentRotationY;

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      const newWidth = containerRef.current?.clientWidth || width;
      const newHeight = containerRef.current?.clientHeight || height;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      containerRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      <div ref={containerRef} className="flex-1 relative" />
      <div className="px-4 py-2 bg-white/80 backdrop-blur-sm border-t border-gray-200">
        <div className="text-xs text-gray-600 text-center">
          <p>🖱️ Drag to rotate • 🔍 Scroll to zoom</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            📊 Point Cloud • 🏗️ BIM Model • 🔩 Structural • ⚡ MEP • 🏢 Arch • 🏛️ Foundation
          </p>
        </div>
      </div>
    </div>
  );
};

export default BIMLayers3D;
