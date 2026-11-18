import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClipBar from "./ClipBar";

const BOUNDS = { x: [0, 200], y: [-10, 10], z: [5, 5] };
const CLIP = { x: [20, 180], y: [-5, 5], z: [5, 5] };

function renderBar(props = {}) {
  const setAxisClip = jest.fn();
  const reset = jest.fn();
  const utils = render(
    <ClipBar bounds={BOUNDS} clip={CLIP} setAxisClip={setAxisClip} reset={reset} {...props} />,
  );
  return { ...utils, setAxisClip, reset };
}

test("renders nothing without bounds or clip", () => {
  const { container, rerender } = render(<ClipBar bounds={null} clip={CLIP} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<ClipBar bounds={BOUNDS} clip={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("shows per-axis values and slider ranges", () => {
  renderBar();
  expect(screen.getByText("CLIP")).toBeInTheDocument();
  ["X", "Y", "Z"].forEach((a) => expect(screen.getByText(a)).toBeInTheDocument());
  expect(screen.getByText("20.00")).toBeInTheDocument();
  expect(screen.getByText("180.00")).toBeInTheDocument();
  const sliders = screen.getAllByRole("slider");
  expect(sliders).toHaveLength(6);
  expect(sliders[0]).toHaveAttribute("min", "0");
  expect(sliders[0]).toHaveAttribute("max", "200");
  expect(sliders[0]).toHaveAttribute("step", "1"); // 200 / 200
  // zero-width axis falls back to a range of 1
  expect(sliders[4]).toHaveAttribute("step", "0.005");
});

test("sliders report axis, end and the raw value", () => {
  const { setAxisClip } = renderBar();
  const sliders = screen.getAllByRole("slider");
  fireEvent.change(sliders[0], { target: { value: "50" } });
  expect(setAxisClip).toHaveBeenLastCalledWith("x", 0, "50");
  fireEvent.change(sliders[3], { target: { value: "2" } });
  expect(setAxisClip).toHaveBeenLastCalledWith("y", 1, "2");
});

test("steppers move by 5 slider steps", async () => {
  const { setAxisClip } = renderBar();
  const downs = screen.getAllByRole("button", { name: "▼" });
  const ups = screen.getAllByRole("button", { name: "▲" });
  await userEvent.click(downs[0]); // x lo
  expect(setAxisClip).toHaveBeenLastCalledWith("x", 0, 15);
  await userEvent.click(ups[1]); // x hi
  expect(setAxisClip).toHaveBeenLastCalledWith("x", 1, 185);
  await userEvent.click(ups[2]); // y lo, step = 20/200*5 = 0.5
  expect(setAxisClip).toHaveBeenLastCalledWith("y", 0, -4.5);
});

test("Reset and Show box", async () => {
  const setBoxVisible = jest.fn();
  const { reset } = renderBar({ setBoxVisible, boxVisible: true });
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(reset).toHaveBeenCalled();
  const box = screen.getByRole("checkbox", { name: "Show box" });
  expect(box).toBeChecked();
  await userEvent.click(box);
  expect(setBoxVisible).toHaveBeenCalledWith(false);
});

test("Show box is hidden without a setter", () => {
  renderBar();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

describe("Export PLY", () => {
  test("is hidden without an export handler", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: "Export PLY" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("exports in the chosen coordinate frame", async () => {
    const onExportPly = jest.fn();
    renderBar({ onExportPly });
    await userEvent.click(screen.getByRole("button", { name: "Export PLY" }));
    expect(onExportPly).toHaveBeenLastCalledWith("original");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Export coordinates" }),
      "aligned",
    );
    await userEvent.click(screen.getByRole("button", { name: "Export PLY" }));
    expect(onExportPly).toHaveBeenLastCalledWith("aligned");
  });

  test("is disabled while exporting or when blocked", () => {
    const { rerender, setAxisClip, reset } = renderBar({
      onExportPly: jest.fn(),
      exportingPly: true,
    });
    expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    rerender(
      <ClipBar
        bounds={BOUNDS}
        clip={CLIP}
        setAxisClip={setAxisClip}
        reset={reset}
        onExportPly={jest.fn()}
        exportDisabledReason="Only point clouds saved to the project can be exported."
      />,
    );
    const btn = screen.getByRole("button", { name: "Export PLY" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Only point clouds saved to the project can be exported.",
    );
  });
});
