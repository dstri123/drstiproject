import { act, fireEvent, render, screen } from "@testing-library/react";
import AuthHeroPanel from "./AuthHeroPanel";
import BIMLayersHero from "./BIMLayersHero";

// The hero drives everything from one requestAnimationFrame loop. Capture the
// callback so tests can step frames at chosen timestamps.
let frames;
let nowMs;
beforeEach(() => {
  frames = [];
  nowMs = 0;
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  jest.spyOn(performance, "now").mockImplementation(() => nowMs);
  window.matchMedia = undefined;
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.matchMedia;
});

function step(ms) {
  const cb = frames.shift();
  act(() => cb(ms));
}

const TITLES = ["POINT CLOUD", "BIM MODEL", "STRUCTURAL LAYER", "MEP SYSTEMS", "ARCHITECTURAL LAYER", "FOUNDATION LAYER"];
const labelGroup = (title) => screen.getByText(title).closest("g.label-inner");

test("renders the labelled SVG with all six layers", () => {
  render(<BIMLayersHero />);
  expect(screen.getByRole("img", { name: /exploded bim model/i })).toBeInTheDocument();
  for (const t of TITLES) expect(screen.getByText(t)).toBeInTheDocument();
  expect(screen.getByText("01")).toBeInTheDocument();
  expect(screen.getByText("06")).toBeInTheDocument();
  expect(screen.getByText("• Columns")).toBeInTheDocument();
});

test("point cloud is deterministic (seeded) and non-empty", () => {
  const { container, unmount } = render(<BIMLayersHero />);
  const first = Array.from(container.querySelectorAll("circle[class^='pc-']")).map((c) => c.getAttribute("cx"));
  unmount();
  const { container: c2 } = render(<BIMLayersHero />);
  const second = Array.from(c2.querySelectorAll("circle[class^='pc-']")).map((c) => c.getAttribute("cx"));
  expect(first.length).toBeGreaterThan(500);
  expect(second).toEqual(first);
});

test("animation fades layers and labels in over time", () => {
  render(<BIMLayersHero />);
  const label = labelGroup("POINT CLOUD").parentElement;
  step(0);
  expect(label.style.opacity).toBe("0");
  step(10000);
  expect(label.style.opacity).toBe("1");
  // loop keeps scheduling frames
  expect(frames).toHaveLength(1);
});

test("hovering a label highlights it and dims the others", () => {
  render(<BIMLayersHero />);
  fireEvent.mouseEnter(labelGroup("MEP SYSTEMS").parentElement);
  expect(labelGroup("MEP SYSTEMS")).toHaveClass("is-hot");
  expect(labelGroup("BIM MODEL")).toHaveClass("is-dim");
  expect(labelGroup("MEP SYSTEMS")).not.toHaveClass("is-dim");
});

test("leaving the hero clears the hover", () => {
  const { container } = render(<BIMLayersHero />);
  fireEvent.mouseEnter(labelGroup("MEP SYSTEMS").parentElement);
  fireEvent.mouseLeave(container.firstChild);
  expect(labelGroup("BIM MODEL")).not.toHaveClass("is-dim");
  expect(labelGroup("MEP SYSTEMS")).not.toHaveClass("is-hot");
});

test("pointer movement tilts the stack", () => {
  const { container } = render(<BIMLayersHero />);
  const root = container.firstChild;
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  fireEvent.mouseMove(root, { clientX: 100, clientY: 50 });
  step(5000);
  expect(root.firstChild.style.transform).toMatch(/rotateY\(0\.300deg\)/);
});

test("reduced motion renders one static frame and stops", () => {
  window.matchMedia = jest.fn(() => ({ matches: true }));
  render(<BIMLayersHero />);
  step(0);
  expect(frames).toHaveLength(0);
  expect(labelGroup("POINT CLOUD").parentElement.style.opacity).toBe("1");
});

test("unmount cancels the animation frame", () => {
  const { unmount } = render(<BIMLayersHero />);
  unmount();
  expect(window.cancelAnimationFrame).toHaveBeenCalled();
});

describe("AuthHeroPanel", () => {
  test("wraps the hero with the default right divider", () => {
    const { container } = render(<AuthHeroPanel />);
    expect(container.firstChild).toHaveClass("border-r");
    expect(screen.getByRole("img", { name: /exploded bim model/i })).toBeInTheDocument();
  });

  test("divider side is configurable", () => {
    const { container } = render(<AuthHeroPanel className="border-l" />);
    expect(container.firstChild).toHaveClass("border-l");
    expect(container.firstChild).not.toHaveClass("border-r");
  });
});
