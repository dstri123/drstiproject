import * as THREE from "three";
import createInfiniteGrid from "./InfiniteGrid";

describe("createInfiniteGrid", () => {
  test("builds a shader-driven plane flagged as a non-pickable grid helper", () => {
    const grid = createInfiniteGrid();
    expect(grid).toBeInstanceOf(THREE.Mesh);
    expect(grid.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(grid.frustumCulled).toBe(false);
    expect(grid.renderOrder).toBe(-1);
    expect(grid.userData).toEqual({ isGrid: true, isHelper: true });
    expect(grid.material.transparent).toBe(true);
    expect(grid.material.side).toBe(THREE.DoubleSide);
  });

  test("uses the default uniforms", () => {
    const { uniforms } = createInfiniteGrid().material;
    expect(uniforms.uCellSize.value).toBe(1);
    expect(uniforms.uSectionSize.value).toBe(10);
    expect(uniforms.uDistance.value).toBe(8000);
    expect(uniforms.uCellColor.value.getHex()).toBe(0xcccccc);
    expect(uniforms.uSectionColor.value.getHex()).toBe(0x888888);
  });

  test("passes custom options into the uniforms", () => {
    const { uniforms } = createInfiniteGrid({
      cellSize: 0.5,
      sectionSize: 5,
      cellColor: 0x112233,
      sectionColor: 0x445566,
      distance: 100,
    }).material;
    expect(uniforms.uCellSize.value).toBe(0.5);
    expect(uniforms.uSectionSize.value).toBe(5);
    expect(uniforms.uDistance.value).toBe(100);
    expect(uniforms.uCellColor.value.getHex()).toBe(0x112233);
    expect(uniforms.uSectionColor.value.getHex()).toBe(0x445566);
  });

  test("keeps an identity transform (the shader follows the camera)", () => {
    const grid = createInfiniteGrid();
    expect(grid.position.toArray()).toEqual([0, 0, 0]);
    expect(grid.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });
});
