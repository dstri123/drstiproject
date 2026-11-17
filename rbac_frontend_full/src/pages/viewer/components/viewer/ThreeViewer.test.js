import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as THREE from "three";
import ThreeViewer from "./ThreeViewer";

// All engine hooks are unit-tested on their own; here they are stubbed with
// stable objects so ThreeViewer's own wiring (panels, zoom, grid, section box)
// can be exercised without WebGL.
const mockScene = {};
const noop = () => {};
jest.mock("./useSceneSetup", () => () => mockScene.sceneData);
jest.mock("./useModelLoader", () => () => mockScene.modelData);
jest.mock("./usePicking", () => () => mockScene.picking);
jest.mock("./useAlignment", () => () => ({ alignGeometry: () => {}, alignGeometryICP: () => {} }));
jest.mock("./useOverlap", () => () => {});
jest.mock("./usePointCloudSAMSegmentation", () => () => mockScene.sam);
jest.mock("./useSAMProgressDetection", () => () => mockScene.detect);
jest.mock("./useIssuePins", () => () => {});
jest.mock("./useGaussianSplatting", () => () => mockScene.gaussian);
jest.mock("./useCameraSystem", () => () => mockScene.camera);
jest.mock("./useTransformControls", () => () => ({}));
jest.mock("./useObjectSelection", () => () => {});
jest.mock("./CameraPreviewPanel", () => () => null);
jest.mock("./CameraDataChart", () => () => null);
jest.mock("./ClipBar", () => () => <div>clip-bar</div>);
jest.mock("./LeafletMap", () => () => null);
jest.mock("../gizmo/BlenderViewportGizmo", () => () => null);
jest.mock("../../../../components/ToastContainer", () => ({
  useToast: () => mockScene.toast,
}));
jest.mock("../../../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "http://127.0.0.1:8000/api/v1/" } },
}));

beforeEach(() => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  const canvas = document.createElement("canvas");
  const grid = new THREE.Object3D();
  const axes = new THREE.Object3D();
  mockScene.sceneData = {
    sceneRef: { current: new THREE.Scene() },
    cameraRef: { current: camera },
    rendererRef: { current: { domElement: canvas, clippingPlanes: [] } },
    controlsRef: { current: { target: new THREE.Vector3(), update: () => {}, minDistance: 1, maxDistance: 100 } },
    gridRef: { current: grid },
    axesRef: { current: axes },
    sceneReady: true,
    sceneError: null,
  };
  mockScene.modelData = {
    bimModel: null,
    pcModel: null,
    toggleSegmentation: noop,
    setModelOpacity: noop,
    setModelScale: noop,
    resetTransform: noop,
    fitAll: jest.fn(),
    isLoadingModel: false,
  };
  mockScene.picking = { bimPoints: [], pcPoints: [] };
  mockScene.sam = { toggleSemanticSegmentation: noop, isSemanticActive: false, isRunning: false, progress: null, semanticSummary: null };
  mockScene.detect = { runDetection: noop, isDetecting: false, progress: null };
  mockScene.gaussian = {
    toggleGaussianSplatting: noop,
    showTrainedGaussian: noop,
    trainGaussian: noop,
    hideGaussian: noop,
    gaussianMode: null,
    isGaussianVisible: false,
    isGaussianLoading: false,
    gaussianPointCount: 0,
    gaussianError: null,
  };
  mockScene.camera = {
    selectedCamera: null,
    setSelectedCamera: noop,
    previewCanvasRef: { current: null },
    handleManualCameraImageUpload: noop,
    manualCameras: [],
    allCameras: [],
    deleteCamera: noop,
    toggleCameraVisibility: noop,
    toggleCameraPath: noop,
    cameraPathVisible: false,
    colorCamerasByColumn: noop,
    resetCameraColors: noop,
    applyGeoTransform: noop,
  };
  mockScene.toast = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
});

const renderViewer = (props = {}) => render(<ThreeViewer onModelDataChange={jest.fn()} {...props} />);

describe("ThreeViewer", () => {
  test("renders the right-rail tools without crashing", () => {
    renderViewer();
    for (const t of ["Adjust models (rotate / opacity / scale)", "Zoom in", "Zoom out", "Fit models in view", "Show grid"]) {
      expect(screen.getByTitle(t)).toBeInTheDocument();
    }
    // Save button only when the parent provides a save handler
    expect(screen.queryByTitle("Save current position & orientation")).not.toBeInTheDocument();
  });

  test("shows the save button when onSavePosition is given", async () => {
    const onSavePosition = jest.fn();
    renderViewer({ onSavePosition });
    await userEvent.click(screen.getByTitle("Save current position & orientation"));
    expect(onSavePosition).toHaveBeenCalled();
  });

  test("shows the WebGL error message from scene setup", () => {
    mockScene.sceneData.sceneError = "Couldn't start the 3D viewer";
    renderViewer();
    expect(screen.getByText(/Couldn't start the 3D viewer/)).toBeInTheDocument();
  });

  test("zoom buttons dolly the camera toward / away from the target", async () => {
    renderViewer();
    const cam = mockScene.sceneData.cameraRef.current;
    await userEvent.click(screen.getByTitle("Zoom in"));
    const zin = cam.position.length();
    expect(zin).toBeLessThan(10);
    await userEvent.click(screen.getByTitle("Zoom out"));
    expect(cam.position.length()).toBeGreaterThan(zin);
  });

  test("Fit models calls fitAll", async () => {
    renderViewer();
    await userEvent.click(screen.getByTitle("Fit models in view"));
    expect(mockScene.modelData.fitAll).toHaveBeenCalled();
  });

  test("grid toggle shows grid + axes", async () => {
    renderViewer();
    expect(mockScene.sceneData.gridRef.current.visible).toBe(false);
    await userEvent.click(screen.getByTitle("Show grid"));
    expect(mockScene.sceneData.gridRef.current.visible).toBe(true);
    expect(mockScene.sceneData.axesRef.current.visible).toBe(true);
    await userEvent.click(screen.getByTitle("Hide grid"));
    expect(mockScene.sceneData.gridRef.current.visible).toBe(false);
  });

  test("window.toggleSectionBox enables the section box (clip bar + clipping)", () => {
    renderViewer();
    act(() => window.toggleSectionBox());
    expect(screen.getByText("clip-bar")).toBeInTheDocument();
    expect(mockScene.sceneData.rendererRef.current.clippingPlanes).toHaveLength(6);
    act(() => window.toggleSectionBox());
    expect(screen.queryByText("clip-bar")).not.toBeInTheDocument();
    expect(mockScene.sceneData.rendererRef.current.clippingPlanes).toEqual([]);
  });

  test("the Adjust panel lists both models as not loaded", async () => {
    renderViewer();
    await userEvent.click(screen.getByTitle("Adjust models (rotate / opacity / scale)"));
    expect(screen.getAllByText(/\(not loaded\)/).length).toBeGreaterThanOrEqual(2);
  });

  test("reports SAM / gaussian state up to the page", () => {
    const onModelDataChange = jest.fn();
    renderViewer({ onModelDataChange });
    expect(onModelDataChange).toHaveBeenCalledWith(
      expect.objectContaining({ isSemanticActive: false, isGaussianVisible: false, gaussianPointCount: 0 }),
    );
  });
});
