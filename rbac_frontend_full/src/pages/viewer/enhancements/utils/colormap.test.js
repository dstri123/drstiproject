import { buildColorMap, viridisColor } from "./colormap";

test("viridis endpoints and clamping", () => {
  expect(viridisColor(0)).toBe("#440154");
  expect(viridisColor(1)).toBe("#fde725");
  expect(viridisColor(-5)).toBe(viridisColor(0));
  expect(viridisColor(9)).toBe(viridisColor(1));
});

test("buildColorMap scales a numeric column and skips non-numbers", () => {
  const { colors, min, max } = buildColorMap(
    { a: { T: "10" }, b: { T: "20" }, c: { T: "n/a" }, d: {} },
    "T"
  );
  expect([min, max]).toEqual([10, 20]);
  expect(Object.keys(colors).sort()).toEqual(["a", "b"]);
  expect(colors.a).toBe(viridisColor(0));
  expect(colors.b).toBe(viridisColor(1));
});

test("buildColorMap with no numeric values", () => {
  expect(buildColorMap({ a: { T: "x" } }, "T")).toEqual({ colors: {}, min: null, max: null });
});
