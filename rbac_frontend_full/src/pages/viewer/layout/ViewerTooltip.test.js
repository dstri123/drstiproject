import React, { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ViewerTooltip, { placeTooltip, TOOLTIP_STYLE } from "./ViewerTooltip";

function Harness({ children }) {
  const ref = useRef(null);
  return (
    <div ref={ref}>
      <ViewerTooltip containerRef={ref} />
      {children}
    </div>
  );
}

const rect = (left, top, w = 40, h = 40) => ({
  left, top, right: left + w, bottom: top + h, width: w, height: h,
});

test("hovering an element with a title shows the dark icon-bar tooltip", () => {
  render(
    <Harness>
      <button title="Zoom in">
        <svg data-testid="icon" />
      </button>
    </Harness>,
  );
  fireEvent.mouseOver(screen.getByTestId("icon")); // hovering the icon inside works
  const tip = screen.getByRole("tooltip");
  expect(tip).toHaveTextContent("Zoom in");
  expect(tip).toHaveStyle({
    background: TOOLTIP_STYLE.background,
    color: TOOLTIP_STYLE.color,
    fontSize: "11px",
    position: "fixed",
  });
  // native tooltip suppressed while ours shows; accessible name kept
  const btn = screen.getByRole("button", { name: "Zoom in" });
  expect(btn).not.toHaveAttribute("title");

  fireEvent.mouseOut(btn, { relatedTarget: document.body });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(btn).toHaveAttribute("title", "Zoom in");
});

test("moving between icons swaps the tooltip and restores titles", () => {
  render(
    <Harness>
      <button title="Zoom in">a</button>
      <button title="Zoom out">b</button>
    </Harness>,
  );
  fireEvent.mouseOver(screen.getByText("a"));
  fireEvent.mouseOver(screen.getByText("b"));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Zoom out");
  expect(screen.getByText("a")).toHaveAttribute("title", "Zoom in");
});

test("keyboard focus shows it too; clicking hides it", () => {
  render(
    <Harness>
      <button title="Fit models in view">x</button>
    </Harness>,
  );
  fireEvent.focusIn(screen.getByText("x"));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Fit models in view");
  fireEvent.mouseDown(screen.getByText("x"));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(screen.getByText("x")).not.toHaveAttribute("title"); // stays parked until leave
  fireEvent.focusOut(screen.getByText("x"), { relatedTarget: null });
  expect(screen.getByText("x")).toHaveAttribute("title", "Fit models in view");
});

test("elements without a title show nothing", () => {
  render(
    <Harness>
      <button>plain</button>
    </Harness>,
  );
  fireEvent.mouseOver(screen.getByText("plain"));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("long text wraps", () => {
  const text = "Runs SAM on the posed site photos and projects the masks onto the point cloud";
  render(
    <Harness>
      <button title={text}>s</button>
    </Harness>,
  );
  fireEvent.mouseOver(screen.getByText("s"));
  expect(screen.getByRole("tooltip")).toHaveStyle({ whiteSpace: "normal", maxWidth: "280px" });
});

describe("placement", () => {
  test("left icon bar: to the right of the icon", () => {
    expect(placeTooltip(rect(2, 100), 1900, 900)).toEqual({
      left: 50, top: 120, transform: "translateY(-50%)",
    });
  });
  test("right rail: to the left of the icon", () => {
    expect(placeTooltip(rect(1860, 100), 1900, 900)).toEqual({
      left: 1852, top: 120, transform: "translate(-100%, -50%)",
    });
  });
  test("elsewhere: centred below, or above near the bottom", () => {
    expect(placeTooltip(rect(500, 100), 1900, 900)).toEqual({
      left: 520, top: 148, transform: "translateX(-50%)",
    });
    expect(placeTooltip(rect(500, 860), 1900, 900)).toEqual({
      left: 520, top: 852, transform: "translate(-50%, -100%)",
    });
  });
});
