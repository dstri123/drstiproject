import { render, screen } from "@testing-library/react";
import MapGroundSpike from "./MapGroundSpike";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { defaults: { baseURL: "http://127.0.0.1:8000/api/v1/" } },
}));

const mockMaplibre = { maps: [], layers: [] };
jest.mock("maplibre-gl", () => {
  class Map {
    constructor(opts) {
      this.opts = opts;
      this.handlers = {};
      this.controls = [];
      this.removed = false;
      this.repaints = 0;
      mockMaplibre.maps.push(this);
    }
    addControl(c) {
      this.controls.push(c);
    }
    on(name, fn) {
      this.handlers[name] = fn;
    }
    addLayer(l) {
      mockMaplibre.layers.push(l);
    }
    getCanvas() {
      return "canvas";
    }
    triggerRepaint() {
      this.repaints += 1;
    }
    remove() {
      this.removed = true;
    }
  }
  return {
    __esModule: true,
    default: {
      Map,
      NavigationControl: class {
        constructor(o) {
          this.o = o;
        }
      },
      MercatorCoordinate: {
        fromLngLat: () => ({
          x: 0.7,
          y: 0.46,
          z: 0,
          meterInMercatorCoordinateUnits: () => 2.5e-8,
        }),
      },
    },
  };
});

const mockRender = { calls: 0 };
jest.mock("three", () => {
  const actual = jest.requireActual("three");
  class WebGLRenderer {
    constructor(o) {
      this.o = o;
    }
    resetState() {}
    render() {
      mockRender.calls += 1;
    }
  }
  return { ...actual, WebGLRenderer };
});

beforeEach(() => {
  mockMaplibre.maps = [];
  mockMaplibre.layers = [];
  mockRender.calls = 0;
});

test("creates a tilted map using the backend OSM tile proxy", () => {
  render(<MapGroundSpike />);
  expect(screen.getByText("MapLibre + Three.js spike")).toBeInTheDocument();
  expect(screen.getByText(/geo-locked at 12.9716, 77.5946/)).toBeInTheDocument();
  const map = mockMaplibre.maps[0];
  expect(map.opts.style.sources.osm.tiles).toEqual([
    "http://127.0.0.1:8000/api/v1/processing/osm-tile/{z}/{x}/{y}.png",
  ]);
  expect(map.opts).toMatchObject({ center: [77.5946, 12.9716], zoom: 17, pitch: 60 });
  expect(map.controls).toHaveLength(1);
});

test("adds the three.js custom layer on style load and renders it", () => {
  render(<MapGroundSpike />);
  const map = mockMaplibre.maps[0];
  map.handlers["style.load"]();
  const layer = mockMaplibre.layers[0];
  expect(layer).toMatchObject({ id: "three-model", type: "custom", renderingMode: "3d" });
  layer.onAdd(map, {});
  expect(layer.scene.children.length).toBe(3); // ambient, directional, box
  const identity = new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0));
  layer.render({}, identity);
  expect(mockRender.calls).toBe(1);
  expect(map.repaints).toBe(1);
  expect(layer.camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
});

test("removes the map on unmount", () => {
  const { unmount } = render(<MapGroundSpike />);
  unmount();
  expect(mockMaplibre.maps[0].removed).toBe(true);
});
