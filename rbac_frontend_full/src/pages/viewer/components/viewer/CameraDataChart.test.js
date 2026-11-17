import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CameraDataChart, { fmt, smoothPath } from "./CameraDataChart";

describe("fmt", () => {
  test.each([
    [0, 0],
    [2.345, 2.35],
    [-7.1, -7.1],
    [999.994, 999.99],
    [1000, "1.0e+3"],
    [-1500, "-1.5e+3"],
    [0.005, "5.0e-3"],
    [-0.001, "-1.0e-3"],
    [0.01, 0.01],
  ])("fmt(%p) → %p", (v, out) => {
    expect(fmt(v)).toBe(out);
  });
});

describe("smoothPath", () => {
  const nums = (d) => d.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);

  test("single point is a bare move", () => {
    expect(smoothPath([[3, 4]])).toBe("M3,4");
  });

  test("two points produce one straight cubic", () => {
    expect(smoothPath([
      [0, 0],
      [3, 3],
    ])).toBe("M0,0 C1,1 2,2 3,3");
  });

  test("a local extremum gets a flat tangent (no overshoot)", () => {
    const d = smoothPath([
      [0, 10],
      [3, 0],
      [6, 10],
    ]);
    // control points either side of the minimum share its y (0)
    const v = nums(d);
    const expected = [0, 10, 1, 20 / 3, 2, 0, 3, 0, 4, 0, 5, 20 / 3, 6, 10];
    expect(v).toHaveLength(expected.length);
    v.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 9));
  });

  test("monotone data never leaves the data range", () => {
    const pts = [
      [0, 0],
      [1, 1],
      [2, 10],
      [3, 10.5],
      [4, 30],
    ];
    const values = nums(smoothPath(pts));
    expect(values.every(Number.isFinite)).toBe(true);
    const ys = values.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(30);
  });

  test("flat runs stay flat", () => {
    expect(smoothPath([
      [0, 5],
      [3, 5],
      [6, 5],
    ])).toBe("M0,5 C1,5 2,5 3,5 C4,5 5,5 6,5");
  });
});

const TABLE = {
  c1: { iso: "100" },
  c2: { iso: "400" },
  c3: { iso: "n/a" },
  c4: { iso: "200" },
};

function renderChart(props = {}) {
  const onClose = jest.fn();
  const utils = render(
    <CameraDataChart
      column="iso"
      tableData={TABLE}
      cameraIds={["c1", "c2", "c3", "c4", "missing"]}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...utils, onClose };
}

test("summarises only numeric values", () => {
  renderChart();
  expect(screen.getByText("min 100")).toBeInTheDocument();
  expect(screen.getByText("max 400")).toBeInTheDocument();
  expect(screen.getByText(/avg/)).toHaveTextContent("avg 233.33 · 3 cams");
});

test("empty data shows a message and only the close button", async () => {
  const { onClose } = renderChart({ tableData: undefined });
  expect(screen.getByText('No numeric values in "iso" to chart.')).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Line" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByTitle("Hide chart"));
  expect(onClose).toHaveBeenCalled();
});

test("switches between line and bar modes", async () => {
  const { container } = renderChart({ column: "iso value!" , tableData: {
    c1: { "iso value!": 1 }, c2: { "iso value!": 3 }, c4: { "iso value!": 2 },
  } });
  // line: gradient + area + stroke
  expect(container.querySelector("linearGradient").id).toBe("cam-chart-grad-iso_value_");
  expect(container.querySelectorAll("animate")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Bar" }));
  expect(container.querySelector("linearGradient")).toBeNull();
  // one bar per numeric camera
  expect(container.querySelectorAll('svg[viewBox="0 0 332 120"] > path')).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "Line" }));
  expect(container.querySelector("linearGradient")).not.toBeNull();
});

test("hovering shows the camera and value; leaving hides it", () => {
  const { container } = renderChart();
  const svg = container.querySelector('svg[viewBox="0 0 332 120"]');
  svg.getBoundingClientRect = () => ({ left: 0, width: 332, top: 0, height: 120 });
  // slot width = (332-36-6)/3 ≈ 96.7 → x=36+100 is the 2nd camera (c2)
  fireEvent.mouseMove(svg, { clientX: 140 });
  expect(screen.getByText("c2")).toBeInTheDocument();
  expect(screen.getByText("c2").parentElement).toHaveTextContent("c2 400");
  expect(container.querySelector("circle")).not.toBeNull();
  // left of the plot → nothing
  fireEvent.mouseMove(svg, { clientX: 10 });
  expect(screen.queryByText("c2")).not.toBeInTheDocument();
  fireEvent.mouseMove(svg, { clientX: 300 });
  expect(screen.getByText("c4")).toBeInTheDocument();
  fireEvent.mouseLeave(svg);
  expect(screen.queryByText("c4")).not.toBeInTheDocument();
});

test("a single value and all-negative bars render without NaN", async () => {
  const { container, rerender } = renderChart({ cameraIds: ["c1"] });
  expect(container.innerHTML).not.toContain("NaN");
  rerender(
    <CameraDataChart
      column="d"
      tableData={{ a: { d: -5 }, b: { d: -2 } }}
      cameraIds={["a", "b"]}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Bar" }));
  expect(container.innerHTML).not.toContain("NaN");
  expect(screen.getByText("min -5")).toBeInTheDocument();
  // close without a handler is a no-op
  await userEvent.click(screen.getByTitle("Hide chart"));
});
