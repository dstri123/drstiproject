import { render, screen, act } from "@testing-library/react";
import LeafletMap from "./LeafletMap";

// Minimal Leaflet double: records options and lets tests fire events.
const mockLeaflet = { maps: [], markers: [], tiles: [], inBounds: true };
jest.mock("leaflet", () => {
  const evented = (obj) => {
    obj.handlers = {};
    obj.on = (name, fn) => {
      obj.handlers[name] = fn;
      return obj;
    };
    obj.fire = (name, e) => obj.handlers[name]?.(e);
    return obj;
  };
  return {
    __esModule: true,
    default: {
      icon: (opts) => ({ icon: opts }),
      map: (el, opts) => {
        const m = evented({
          el,
          opts,
          view: null,
          removed: false,
          invalidated: 0,
          getContainer: () => el,
          getBounds: () => ({ contains: () => mockLeaflet.inBounds }),
          getZoom: () => 11,
          setView(c, z) {
            this.view = [c, z];
          },
          invalidateSize() {
            this.invalidated += 1;
          },
          remove() {
            this.removed = true;
          },
        });
        mockLeaflet.maps.push(m);
        return m;
      },
      tileLayer: (url, opts) => {
        const t = evented({ url, opts, addTo: () => t });
        mockLeaflet.tiles.push(t);
        return t;
      },
      marker: (latlng, opts) => {
        const k = evented({
          latlng,
          opts,
          addTo: () => k,
          getLatLng: () => ({ lat: k.latlng[0] ?? k.latlng.lat, lng: k.latlng[1] ?? k.latlng.lng }),
          setLatLng: (ll) => {
            k.latlng = ll;
          },
        });
        mockLeaflet.markers.push(k);
        return k;
      },
      DomEvent: { disableScrollPropagation: () => {} },
    },
  };
});

beforeEach(() => {
  mockLeaflet.maps = [];
  mockLeaflet.markers = [];
  mockLeaflet.tiles = [];
  mockLeaflet.inBounds = true;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test("creates the map once at the given position with a draggable pin", () => {
  const { rerender } = render(<LeafletMap lat={12.9} lng={77.6} zoom={15} />);
  expect(mockLeaflet.maps).toHaveLength(1);
  const map = mockLeaflet.maps[0];
  expect(map.opts).toMatchObject({ center: [12.9, 77.6], zoom: 15, attributionControl: false });
  expect(mockLeaflet.tiles[0].url).toBe("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
  expect(mockLeaflet.markers[0].opts.draggable).toBe(true);
  expect(mockLeaflet.markers[0].opts.icon.icon.iconUrl).toMatch(/marker-icon\.png$/);
  act(() => jest.runAllTimers());
  expect(map.invalidated).toBe(1);
  rerender(<LeafletMap lat={12.9} lng={77.6} zoom={15} />);
  expect(mockLeaflet.maps).toHaveLength(1);
});

test("non-numeric coordinates start at 0,0 and a custom tile URL is used", () => {
  render(<LeafletMap lat={null} lng={undefined} tileUrl="/proxy/{z}/{x}/{y}.png" />);
  expect(mockLeaflet.maps[0].opts.center).toEqual([0, 0]);
  expect(mockLeaflet.maps[0].opts.zoom).toBe(16);
  expect(mockLeaflet.tiles[0].url).toBe("/proxy/{z}/{x}/{y}.png");
});

test("dragging the pin or clicking the map reports the new position", () => {
  const onMove = jest.fn();
  render(<LeafletMap lat={1} lng={2} onMove={onMove} />);
  const marker = mockLeaflet.markers[0];
  marker.setLatLng({ lat: 5, lng: 6 });
  marker.fire("dragend");
  expect(onMove).toHaveBeenLastCalledWith(5, 6);
  mockLeaflet.maps[0].fire("click", { latlng: { lat: 7, lng: 8 } });
  expect(onMove).toHaveBeenLastCalledWith(7, 8);
  expect(marker.latlng).toEqual({ lat: 7, lng: 8 });
});

test("the latest onMove is used without re-creating the map", () => {
  const first = jest.fn();
  const second = jest.fn();
  const { rerender } = render(<LeafletMap lat={1} lng={2} onMove={first} />);
  rerender(<LeafletMap lat={1} lng={2} onMove={second} />);
  mockLeaflet.maps[0].fire("click", { latlng: { lat: 3, lng: 4 } });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith(3, 4);
});

test("prop changes move the pin, recentering only when off-screen", () => {
  const { rerender } = render(<LeafletMap lat={1} lng={2} zoom={14} />);
  const map = mockLeaflet.maps[0];
  rerender(<LeafletMap lat={1.001} lng={2} zoom={14} />);
  expect(mockLeaflet.markers[0].latlng).toEqual([1.001, 2]);
  expect(map.view).toBeNull();
  mockLeaflet.inBounds = false;
  rerender(<LeafletMap lat={40} lng={2} zoom={14} />);
  expect(map.view).toEqual([[40, 2], 14]);
  rerender(<LeafletMap lat={41} lng={2} zoom={0} />);
  expect(map.view).toEqual([[41, 2], 11]);
  // invalid coordinates are ignored
  rerender(<LeafletMap lat={NaN} lng={2} zoom={0} />);
  expect(mockLeaflet.markers[0].latlng).toEqual([41, 2]);
});

test("loading indicator follows the tile layer", () => {
  render(<LeafletMap lat={1} lng={2} />);
  expect(screen.getByText("Loading map…")).toBeInTheDocument();
  act(() => mockLeaflet.tiles[0].fire("load"));
  expect(screen.queryByText("Loading map…")).not.toBeInTheDocument();
  act(() => mockLeaflet.tiles[0].fire("loading"));
  expect(screen.getByText("Loading map…")).toBeInTheDocument();
});

test("grab cursor while dragging the map", () => {
  render(<LeafletMap lat={1} lng={2} />);
  const map = mockLeaflet.maps[0];
  expect(map.el.style.cursor).toBe("grab");
  map.fire("dragstart");
  expect(map.el.style.cursor).toBe("grabbing");
  map.fire("dragend");
  expect(map.el.style.cursor).toBe("grab");
});

test("full-height mode has no border radius; unmount removes the map", () => {
  const { container, unmount } = render(<LeafletMap lat={1} lng={2} height="100%" />);
  expect(container.firstChild).toHaveStyle({ height: "100%", borderRadius: "0" });
  unmount();
  expect(mockLeaflet.maps[0].removed).toBe(true);
});
