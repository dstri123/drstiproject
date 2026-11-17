import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CameraPreviewPanel from "./CameraPreviewPanel";
import { useConstructionSegmentation } from "./useConstructionSegmentation";

jest.mock("./useConstructionSegmentation", () => ({
  useConstructionSegmentation: jest.fn(),
  CONSTRUCTION_CLASSES: {
    sky: { id: 0, label: "Sky", color: [1, 2, 3], emoji: "S" },
    wall: { id: 1, label: "Wall", color: [4, 5, 6], emoji: "W" },
    rebar: { id: 2, label: "Rebar", color: [7, 8, 9], emoji: "R" },
  },
}));

// No WebGL in jsdom: stub just what the 360° bubble view touches. Plain
// classes (not jest.fn) so CRA's resetMocks doesn't wipe them.
const mockRenderers = [];
jest.mock("three", () => {
  class Disposable {
    dispose() {
      this.disposed = true;
    }
  }
  class WebGLRenderer extends Disposable {
    constructor() {
      super();
      this.renders = 0;
      mockRenderers.push(this);
    }
    setPixelRatio() {}
    setSize() {}
    render() {
      this.renders += 1;
    }
  }
  class Scene {
    add() {}
  }
  class PerspectiveCamera {
    lookAt(v) {
      this.target = v;
    }
  }
  class SphereGeometry extends Disposable {
    scale() {}
  }
  class TextureLoader {
    load() {
      return new Disposable();
    }
  }
  class MeshBasicMaterial extends Disposable {}
  class Mesh {}
  class Vector3 {
    constructor(x, y, z) {
      Object.assign(this, { x, y, z });
    }
  }
  return {
    WebGLRenderer,
    Scene,
    PerspectiveCamera,
    SphereGeometry,
    TextureLoader,
    MeshBasicMaterial,
    Mesh,
    Vector3,
    MathUtils: { degToRad: (d) => (d * Math.PI) / 180 },
    SRGBColorSpace: "srgb",
  };
});

const PHOTO_CAM = { name: "IMG_001", image: "http://x/img1.jpg" };
let segmentImageUrl;

beforeEach(() => {
  segmentImageUrl = jest.fn();
  useConstructionSegmentation.mockReturnValue({ segmentImageUrl, isLoading: false, result: null });
  jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

function renderPanel(camera, props = {}) {
  const setSelectedCamera = jest.fn();
  const utils = render(
    <CameraPreviewPanel
      selectedCamera={camera}
      setSelectedCamera={setSelectedCamera}
      previewCanvasRef={{ current: null }}
      {...props}
    />,
  );
  return { ...utils, setSelectedCamera };
}

test("renders nothing without a selected camera", () => {
  const { container } = renderPanel(null);
  expect(container).toBeEmptyDOMElement();
});

test("uses the segmentation service on port 8001", () => {
  renderPanel(PHOTO_CAM);
  expect(useConstructionSegmentation).toHaveBeenCalledWith({
    serviceUrl: "http://localhost:8001",
  });
});

test("shows the photo and closes", async () => {
  const { setSelectedCamera } = renderPanel(PHOTO_CAM);
  expect(screen.getByText("IMG_001")).toBeInTheDocument();
  expect(screen.getByAltText("cam")).toHaveAttribute("src", "http://x/img1.jpg");
  expect(screen.getByText("3D VIEW")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "×" }));
  expect(setSelectedCamera).toHaveBeenCalledWith(null);
});

test("segmentation success shows the overlay, Segmented badge and legend; cached after", async () => {
  segmentImageUrl.mockResolvedValue({
    overlayDataUrl: "data:seg",
    presentClasses: [{ id: 1, label: "Wall", color: [4, 5, 6], emoji: "W" }],
  });
  renderPanel(PHOTO_CAM);
  await userEvent.click(screen.getByRole("button", { name: "Segmented" }));
  expect(segmentImageUrl).toHaveBeenCalledWith("http://x/img1.jpg");
  await waitFor(() => expect(screen.getByAltText("cam")).toHaveAttribute("src", "data:seg"));
  // badge text (typo "Segmentated" fixed)
  expect(screen.getAllByText("Segmented").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText("Segmentated")).not.toBeInTheDocument();
  expect(screen.getByText("1 / 3 detected")).toBeInTheDocument();
  expect(screen.getAllByTitle("Wall")).toHaveLength(2); // detected + reference
  expect(screen.getByTitle("Rebar")).toHaveStyle({ opacity: "0.38" });

  await userEvent.click(screen.getByRole("button", { name: "Original" }));
  expect(screen.getByAltText("cam")).toHaveAttribute("src", "http://x/img1.jpg");
  // toggling back reuses the result without a new request
  await userEvent.click(screen.getByTitle("Run construction segmentation"));
  expect(screen.getByAltText("cam")).toHaveAttribute("src", "data:seg");
  await userEvent.click(screen.getByTitle("Show original"));
  expect(screen.getByAltText("cam")).toHaveAttribute("src", "http://x/img1.jpg");
  expect(segmentImageUrl).toHaveBeenCalledTimes(1);
});

test("a previously segmented image is served from the session cache", async () => {
  const cam = { name: "IMG_C", image: "http://x/cached.jpg" };
  segmentImageUrl.mockResolvedValue({ overlayDataUrl: "data:c", presentClasses: [] });
  const first = renderPanel(cam);
  await userEvent.click(screen.getByRole("button", { name: "Segmented" }));
  await waitFor(() => expect(screen.getByAltText("cam")).toHaveAttribute("src", "data:c"));
  first.unmount();
  renderPanel(cam);
  await userEvent.click(screen.getByRole("button", { name: "Segmented" }));
  expect(segmentImageUrl).toHaveBeenCalledTimes(1);
  expect(screen.getByAltText("cam")).toHaveAttribute("src", "data:c");
});

test("segmentation failure shows an error with retry", async () => {
  let resolve;
  segmentImageUrl
    .mockRejectedValueOnce(new Error("Service unreachable"))
    .mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  renderPanel({ name: "IMG_002", image: "http://x/img2.jpg" });
  await userEvent.click(screen.getByRole("button", { name: "Segmented" }));
  expect(await screen.findByText(/Service unreachable/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("retry"));
  expect(screen.getByText("Analysing construction scene…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Processing…/ })).toBeDisabled();
  await act(async () => resolve({ overlayDataUrl: "data:2", presentClasses: [] }));
  expect(screen.getByAltText("cam")).toHaveAttribute("src", "data:2");
  expect(screen.getByText("0 / 3 detected")).toBeInTheDocument();
});

test("error without a message falls back to a generic one", async () => {
  segmentImageUrl.mockRejectedValue({});
  renderPanel({ name: "IMG_003", image: "http://x/img3.jpg" });
  await userEvent.click(screen.getByRole("button", { name: "Segmented" }));
  expect(await screen.findByText(/Segmentation failed/)).toBeInTheDocument();
});

test("camera without an image shows a placeholder and no segmentation controls", () => {
  renderPanel({ name: "C9" });
  expect(screen.getByText("No image uploaded for this camera")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Segmented" })).not.toBeInTheDocument();
});

test("manual camera awaiting an image accepts an upload", async () => {
  URL.createObjectURL = jest.fn(() => "blob:new");
  const handleManualCameraImageUpload = jest.fn();
  const { container, setSelectedCamera } = renderPanel(
    { name: "Manual 1", awaitingImage: true },
    { handleManualCameraImageUpload },
  );
  expect(screen.getByText("• Manual")).toBeInTheDocument();
  expect(screen.getByText("Upload an image for this camera")).toBeInTheDocument();
  const file = new File(["i"], "p.jpg", { type: "image/jpeg" });
  await userEvent.upload(container.querySelector("#manualCamImageInput"), file);
  expect(handleManualCameraImageUpload).toHaveBeenCalledWith(file, "Manual 1");
  const updater = setSelectedCamera.mock.calls[0][0];
  expect(updater({ name: "Manual 1", awaitingImage: true })).toEqual({
    name: "Manual 1",
    image: "blob:new",
    awaitingImage: false,
  });
});

test("bubble camera awaiting a 360° image", () => {
  renderPanel({ name: "B1", awaitingImage: true, isBubble: true });
  expect(screen.getByText("• Bubble")).toBeInTheDocument();
  expect(screen.getByText("Upload a 360° image for this camera")).toBeInTheDocument();
});

test("bubble camera with an image renders the 360° view and cleans up", () => {
  const { unmount } = renderPanel({ name: "B2", image: "http://x/pano.jpg", isBubble: true });
  expect(screen.getByText("360° PHOTO")).toBeInTheDocument();
  expect(screen.getByText(/Drag to look around/)).toBeInTheDocument();
  expect(screen.queryByAltText("cam")).not.toBeInTheDocument();
  expect(mockRenderers).toHaveLength(1);
  const canvas = document.querySelector("canvas");
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30 });
  fireEvent.pointerUp(canvas);
  const renderer = mockRenderers[0];
  unmount();
  expect(renderer.disposed).toBe(true);
  expect(window.cancelAnimationFrame).toHaveBeenCalled();
});

test("Download 3D view saves the preview canvas as PNG", () => {
  window.requestAnimationFrame.mockImplementation((cb) => cb());
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  // The panel attaches previewCanvasRef to its own <canvas>.
  const toDataURL = jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,AA");
  renderPanel(PHOTO_CAM, { previewCanvasRef: { current: null } });
  fireEvent.click(screen.getByTitle("Download 3D view"));
  expect(toDataURL).toHaveBeenCalledWith("image/png");
  expect(click.mock.instances[0].href).toBe("data:image/png;base64,AA");
  expect(click.mock.instances[0].download).toBe("IMG_001-3d.png");
});

test("Download without a canvas ref does nothing", () => {
  renderPanel(PHOTO_CAM, { previewCanvasRef: undefined });
  expect(() => fireEvent.click(screen.getByTitle("Download 3D view"))).not.toThrow();
});
