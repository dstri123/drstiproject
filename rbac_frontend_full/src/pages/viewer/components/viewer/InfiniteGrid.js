import * as THREE from "three";

/**
 * A camera-following, distance-fading "infinite" ground grid.
 *
 * It's a large flat plane on the XZ ground plane whose grid lines are drawn in
 * world space by a fragment shader, so the lines stay crisp at any zoom and the
 * plane fades out toward the horizon — giving the impression of an endless grid
 * (similar to Blender / Revit ground planes). Call `update(camera)` each frame
 * so it re-centres under the camera and never visibly ends.
 */
export default function createInfiniteGrid({
  cellSize = 1,
  sectionSize = 10,
  cellColor = 0xcccccc,
  sectionColor = 0x888888,
  distance = 8000,
} = {}) {
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    extensions: { derivatives: true },
    uniforms: {
      uCellSize: { value: cellSize },
      uSectionSize: { value: sectionSize },
      uCellColor: { value: new THREE.Color(cellColor) },
      uSectionColor: { value: new THREE.Color(sectionColor) },
      uDistance: { value: distance },
    },
    vertexShader: /* glsl */ `
      varying vec3 worldPos;
      uniform float uDistance;
      void main() {
        // Stretch the unit plane out to the fade distance and lay it flat (XZ).
        vec3 pos = position.xzy * uDistance;
        pos.x += cameraPosition.x;
        pos.z += cameraPosition.z;
        worldPos = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 worldPos;
      uniform float uCellSize;
      uniform float uSectionSize;
      uniform vec3 uCellColor;
      uniform vec3 uSectionColor;
      uniform float uDistance;

      // Anti-aliased grid line intensity for a given world-space cell size.
      float gridLine(vec2 coord, float size) {
        vec2 g = coord / size;
        vec2 grid = abs(fract(g - 0.5) - 0.5) / fwidth(g);
        float line = min(grid.x, grid.y);
        return 1.0 - min(line, 1.0);
      }

      void main() {
        vec2 coord = worldPos.xz;
        float minor = gridLine(coord, uCellSize);
        float major = gridLine(coord, uSectionSize);

        // Radial fade so the grid melts into the background at the horizon.
        float d = length(worldPos.xz - cameraPosition.xz);
        float fade = 1.0 - clamp(d / uDistance, 0.0, 1.0);
        fade = pow(fade, 3.0);

        vec3 color = mix(uCellColor, uSectionColor, step(0.5, major));
        float alpha = max(minor * 0.5, major) * fade;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // draw under models
  mesh.userData.isGrid = true; // so the grid toggle can find it
  mesh.userData.isHelper = true; // so picking/selection ignores it

  // The shader already re-centres the plane on the camera every frame (it reads
  // the built-in cameraPosition uniform), so the mesh itself stays at the
  // origin with an identity transform — no per-frame JS update needed.

  return mesh;
}
