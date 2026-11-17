import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContextPanel from "./Sidebar";

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("../../../components/ToastContainer", () => ({
  useToast: () => mockToast,
}));

const WINDOW_FNS = [
  "setPickingMode",
  "alignGeometry",
  "alignGeometryICP",
  "clearMarkers",
  "saveAlignmentPair",
  "toggleSectionBox",
  "autoAlign",
  "tryNextAutoAlign",
  "undoAutoAlign",
  "generateMatrix",
  "exportMatrix",
  "resetAll",
  "applyUploadedMatrix",
  "addCameraManually",
  "addBubbleCameraManually",
  "handleCameraMatrixUpload",
  "applyCameraMatrix",
  "exportCameraPositions",
  "handleCameraFolderUpload",
  "sendOverlapSnapshot",
];

function installGlobals() {
  const fns = {};
  WINDOW_FNS.forEach((n) => {
    fns[n] = jest.fn();
    window[n] = fns[n];
  });
  return fns;
}

afterEach(() => {
  WINDOW_FNS.forEach((n) => delete window[n]);
  delete window.autoAlignState;
});

function renderPanel(activePanel, props = {}, role = "admin") {
  localStorage.setItem("role", role);
  const onClosePanel = jest.fn();
  const utils = render(
    <ContextPanel activePanel={activePanel} onClosePanel={onClosePanel} {...props} />,
  );
  return { ...utils, onClosePanel };
}

const fileInput = (container, accept) =>
  container.querySelector(`input[type="file"][accept="${accept}"]`);

describe("panel chrome", () => {
  test("shows the panel label and closes", async () => {
    const { onClosePanel, container } = renderPanel("cameras");
    expect(screen.getByText("Cameras")).toBeInTheDocument();
    await userEvent.click(container.querySelector("button"));
    expect(onClosePanel).toHaveBeenCalled();
  });

  test("unknown panel renders its id and nothing else", () => {
    renderPanel("mystery");
    expect(screen.getByText("mystery")).toBeInTheDocument();
  });

  test("issues panel renders only when props are given", () => {
    const { rerender } = renderPanel("issues");
    expect(screen.queryByText("Pin new issue")).not.toBeInTheDocument();
    rerender(
      <ContextPanel
        activePanel="issues"
        issuesPanelProps={{
          issues: [],
          loading: false,
          pinMode: false,
          hasBim: true,
          onTogglePinMode: jest.fn(),
          onOpen: jest.fn(),
          onExport: jest.fn(),
        }}
      />,
    );
    expect(screen.getByText("Pin new issue")).toBeInTheDocument();
  });
});

describe("upload panel", () => {
  test("labels list every accepted point-cloud format", () => {
    const { container } = renderPanel("upload");
    expect(screen.getByText("Upload BIM (.fbx / .ifc)")).toBeInTheDocument();
    const accept = ".ply,.las,.laz,.plz,.e57,.pts,.xyz";
    expect(fileInput(container, accept)).toBeInTheDocument();
    const label = screen.getByText(/^Upload PointCloud/).textContent;
    accept.split(",").forEach((ext) => expect(label).toContain(ext));
  });

  test.each(["admin", "project_manager", "viewer", "site_engineer"])(
    "%s can upload BIM and point-cloud files",
    async (role) => {
      const setBimFile = jest.fn();
      const setPointFile = jest.fn();
      const { container } = renderPanel("upload", { setBimFile, setPointFile }, role);
      expect(screen.queryByText("Upload not permitted for your role")).not.toBeInTheDocument();
      const bim = new File(["x"], "a.ifc");
      await userEvent.upload(fileInput(container, ".fbx,.ifc"), bim);
      expect(setBimFile).toHaveBeenCalledWith(bim);

      const pc = new File(["y"], "b.ply");
      fireEvent.drop(screen.getByText(/^Upload PointCloud/).parentElement, {
        dataTransfer: { files: [pc] },
      });
      expect(setPointFile).toHaveBeenCalledWith(pc);
    },
  );

  test("data_contributor uploads are disabled", () => {
    const setBimFile = jest.fn();
    const setPointFile = jest.fn();
    const { container } = renderPanel("upload", { setBimFile, setPointFile }, "data_contributor");
    expect(screen.getAllByText("Upload not permitted for your role")).toHaveLength(2);
    const input = fileInput(container, ".fbx,.ifc");
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File(["x"], "a.ifc")] } });
    fireEvent.drop(screen.getByText("Upload BIM (.fbx / .ifc)").parentElement, {
      dataTransfer: { files: [new File(["x"], "a.ifc")] },
    });
    expect(setBimFile).not.toHaveBeenCalled();
    expect(setPointFile).not.toHaveBeenCalled();
  });
});

describe("models panel", () => {
  test("empty hint when nothing is loaded", () => {
    renderPanel("models");
    expect(screen.getByText(/No files loaded/)).toBeInTheDocument();
    expect(screen.queryByText("Segmentation")).not.toBeInTheDocument();
  });

  test("model cards toggle visibility and remove files", async () => {
    const props = {
      bimFile: { name: "tower.ifc" },
      pointFile: { name: "scan.ply" },
      bimVisible: true,
      pcVisible: false,
      setBimVisible: jest.fn(),
      setPcVisible: jest.fn(),
      setBimFile: jest.fn(),
      setPointFile: jest.fn(),
    };
    renderPanel("models", props);
    expect(screen.getByText("tower.ifc")).toBeInTheDocument();
    expect(screen.getByText("scan.ply")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Hide"));
    expect(props.setBimVisible).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByTitle("Show"));
    expect(props.setPcVisible).toHaveBeenCalledWith(true);
    const [removeBim, removePc] = screen.getAllByTitle("Remove");
    await userEvent.click(removeBim);
    await userEvent.click(removePc);
    expect(props.setBimFile).toHaveBeenCalledWith(null);
    expect(props.setPointFile).toHaveBeenCalledWith(null);
  });

  test("segmentation buttons reflect running state", () => {
    const { rerender } = renderPanel("models", {
      pointFile: { name: "scan.ply" },
      isSegmenting: true,
      wasCompressed: true,
      isSamRunning: true,
      samProgress: "Photo 2/5",
    });
    expect(screen.getByRole("button", { name: /Segmenting…/ })).toBeDisabled();
    expect(screen.queryByText(/Compressed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Photo 2\/5/ })).toBeDisabled();
    // no BIM → no auto-detect
    expect(screen.queryByText(/Auto-detect Built/)).not.toBeInTheDocument();

    rerender(
      <ContextPanel
        activePanel="models"
        pointFile={{ name: "scan.ply" }}
        bimFile={{ name: "t.ifc" }}
        wasCompressed
        isBuiltDetecting
        builtDetectProgress="3 / 9"
        onAutoDetectBuilt={jest.fn()}
      />,
    );
    expect(screen.getByText(/Compressed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Segments (RANSAC)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Show Construction Segments (SAM)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /3 \/ 9/ })).toBeDisabled();
  });

  test("auto-detect is disabled without a handler", () => {
    renderPanel("models", { pointFile: { name: "s" }, bimFile: { name: "b" } });
    expect(
      screen.getByRole("button", { name: "Auto-detect Built Elements (SAM)" }),
    ).toBeDisabled();
  });

  test("overlapping elements list with counts and per-category tally", () => {
    renderPanel("models", {
      overlapElementNames: [
        { name: "Wall #1", count: 1200 },
        { name: "Wall #2", count: 5 },
        "Slab #3",
        { name: "Unknown #9", count: 1 },
      ],
      bimCategories: { Walls: ["Wall #1", "Wall #2"], Slabs: ["Slab #3"] },
    });
    expect(screen.getByText("Overlapping Elements (4)")).toBeInTheDocument();
    expect(screen.getByText("1. Wall #1")).toBeInTheDocument();
    expect(screen.getByText(`${(1200).toLocaleString()} pts`)).toBeInTheDocument();
    expect(screen.getByText("3. Slab #3")).toBeInTheDocument();
    const cats = screen.getByText("Overlap by Category").nextElementSibling;
    expect(cats.textContent).toBe("Walls2Slabs1Other1");
  });

  test("BIM categories open, highlight the selected element and toggle visibility", async () => {
    const onToggleElementVisibility = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
    renderPanel("models", {
      bimFile: { name: "t.ifc" },
      bimCategories: { Walls: ["Wall #1", "Wall #2"], Doors: ["Door #3"] },
      hiddenElementNames: new Set(["Wall #2"]),
      onToggleElementVisibility,
      selectedElement: { category: "Walls", elementLabel: "Wall #1" },
    });
    const walls = screen.getByTitle("Selected: Wall #1");
    expect(walls).toHaveTextContent("Walls");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByText("Wall #1")).not.toBeInTheDocument();
    await userEvent.click(walls);
    expect(screen.getByText("Wall #1")).toBeInTheDocument();
    expect(screen.getByTitle("Show element")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Hide element"));
    expect(onToggleElementVisibility).toHaveBeenCalledWith("Wall #1");
    await userEvent.click(walls);
    expect(screen.queryByText("Wall #1")).not.toBeInTheDocument();
    delete Element.prototype.scrollIntoView;
  });

  const countFor = () =>
    screen.getByText("Overlapping PointCloud Points:").parentElement.nextElementSibling
      .textContent;

  test("selected element shows its overlap point count (expressID first, then uuid)", () => {
    const overlapCounts = {
      byExpressID: new Map([[101, 42]]),
      byUuid: new Map([["u-1", 7]]),
    };
    const { rerender } = renderPanel("models", {
      selectedElement: { expressID: 101, uuid: "u-1" },
      overlapCounts,
    });
    expect(countFor()).toBe("42");
    rerender(
      <ContextPanel
        activePanel="models"
        selectedElement={{ expressID: 999, uuid: "u-1" }}
        overlapCounts={overlapCounts}
      />,
    );
    expect(countFor()).toBe("7");
    rerender(
      <ContextPanel
        activePanel="models"
        selectedElement={{ uuid: "nope" }}
        overlapCounts={overlapCounts}
      />,
    );
    expect(countFor()).toBe("0");
    rerender(<ContextPanel activePanel="models" selectedElement={{ uuid: "u-1" }} />);
    expect(countFor()).toBe("0");
  });

  test("Save Data sends the overlap snapshot, or explains what is missing", async () => {
    renderPanel("models", { selectedElement: { name: "X" } });
    await userEvent.click(screen.getByRole("button", { name: "Save Data" }));
    expect(mockToast.info).toHaveBeenCalledWith("Open a project with a BIM + Point Cloud first.");
    window.sendOverlapSnapshot = jest.fn();
    await userEvent.click(screen.getByRole("button", { name: "Save Data" }));
    expect(window.sendOverlapSnapshot).toHaveBeenCalled();
  });
});

describe("picking panel", () => {
  test("mode buttons drive the engine picking mode", async () => {
    const fns = installGlobals();
    renderPanel("picking");
    await userEvent.click(screen.getByRole("button", { name: "Pick BIM Points" }));
    expect(fns.setPickingMode).toHaveBeenLastCalledWith("bim");
    expect(mockToast.info).toHaveBeenLastCalledWith(expect.stringMatching(/^BIM pick mode/));
    await userEvent.click(screen.getByRole("button", { name: "Pick PointCloud Points" }));
    expect(fns.setPickingMode).toHaveBeenLastCalledWith("pc");
    await userEvent.click(screen.getByRole("button", { name: "Stop Picking" }));
    expect(fns.setPickingMode).toHaveBeenLastCalledWith(null);
    expect(mockToast.info).toHaveBeenLastCalledWith("Picking stopped.");
  });

  test("action buttons call the engine", async () => {
    const fns = installGlobals();
    renderPanel("picking");
    await userEvent.click(screen.getByRole("button", { name: "Align Geometry" }));
    expect(fns.alignGeometry).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "ICP Align" }));
    expect(fns.alignGeometryICP).toHaveBeenCalled();
    expect(fns.clearMarkers).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Save Alignment Pair" }));
    expect(fns.saveAlignmentPair).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Enable Section Box" }));
    expect(fns.toggleSectionBox).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("Section box enabled.");
    await userEvent.click(screen.getByRole("button", { name: "Clear Picked Points" }));
    expect(fns.clearMarkers).toHaveBeenCalledTimes(3);
  });

  test("Save Alignment Pair without a loaded project explains why", async () => {
    renderPanel("picking");
    await userEvent.click(screen.getByRole("button", { name: "Save Alignment Pair" }));
    expect(mockToast.info).toHaveBeenCalledWith("Open a project with a BIM + Point Cloud first.");
  });

  test("section box and overlap labels follow state", async () => {
    let state = false;
    const setHighlightOverlap = jest.fn((fn) => {
      state = fn(state);
    });
    renderPanel("picking", { sectionBoxActive: true, highlightOverlap: true, setHighlightOverlap });
    await userEvent.click(screen.getByRole("button", { name: "Disable Section Box" }));
    expect(mockToast.success).toHaveBeenCalledWith("Section box disabled.");
    await userEvent.click(screen.getByRole("button", { name: "Hide Overlap (green)" }));
    expect(state).toBe(true);
    expect(mockToast.info).toHaveBeenLastCalledWith(expect.stringMatching(/^Highlighting overlap/));
  });

  test("lists picked points", () => {
    renderPanel("picking", {
      bimPoints: [{ x: 1, y: 2.5, z: -3 }],
      pcPoints: [],
    });
    expect(screen.getByText("BIM Points (1)")).toBeInTheDocument();
    expect(screen.getByText("#1: 1.000, 2.500, -3.000")).toBeInTheDocument();
    expect(screen.getByText("Point Cloud Points (0)")).toBeInTheDocument();
    expect(screen.getByText("None selected")).toBeInTheDocument();
  });
});

describe("alignment panel", () => {
  test("Auto Align calls the engine, or explains when unavailable", async () => {
    renderPanel("alignment");
    await userEvent.click(screen.getByRole("button", { name: "Auto Align" }));
    expect(mockToast.info).toHaveBeenCalledWith("Open a project with a BIM + Point Cloud first.");
    const fns = installGlobals();
    await userEvent.click(screen.getByRole("button", { name: "Auto Align" }));
    expect(fns.autoAlign).toHaveBeenCalled();
    expect(fns.setPickingMode).toHaveBeenCalledWith(null);
  });

  test("auto-align results from the engine event", async () => {
    const fns = installGlobals();
    renderPanel("alignment");
    act(() => {
      window.dispatchEvent(
        new CustomEvent("autoalign-state", {
          detail: { busy: true },
        }),
      );
    });
    expect(screen.getByRole("button", { name: "Aligning…" })).toBeDisabled();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("autoalign-state", {
          detail: {
            busy: false,
            count: 3,
            index: 0,
            fitText: "rmse 0.04 m",
            confidence: "high",
            scale: 1.25,
          },
        }),
      );
    });
    expect(screen.getByText(/Result 1 of 3/)).toHaveTextContent(
      "Result 1 of 3 · rmse 0.04 m · high confidence · scale ×1.25",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try Next Result" }));
    expect(fns.tryNextAutoAlign).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Undo Auto Align" }));
    expect(fns.undoAutoAlign).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save Alignment Pair" }));
    expect(fns.saveAlignmentPair).toHaveBeenCalled();
  });

  test("initial auto-align state is read from window", () => {
    window.autoAlignState = { count: 1, index: 0, fitText: "ok" };
    renderPanel("alignment");
    expect(screen.getByText(/Result 1 of 1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Next Result" })).not.toBeInTheDocument();
  });

  test("matrix operations", async () => {
    const fns = installGlobals();
    renderPanel("alignment");
    await userEvent.click(screen.getByRole("button", { name: "Generate Matrix" }));
    expect(fns.generateMatrix).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Export Matrix" }));
    expect(fns.exportMatrix).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reset All" }));
    expect(fns.resetAll).toHaveBeenCalled();
  });

  test("Apply Matrix applies the uploaded matrix (not undefined)", async () => {
    const fns = installGlobals();
    const { container } = renderPanel("alignment");
    expect(screen.queryByText("Upload Matrix (.json)")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Advanced — Import Matrix/ }));

    // Nothing uploaded yet → explain, don't call the engine with undefined.
    await userEvent.click(screen.getByRole("button", { name: "Apply Matrix" }));
    expect(fns.applyUploadedMatrix).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenLastCalledWith("Upload a matrix (.json) file first.");

    const matrix = [
      [1, 0, 0, 5],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const input = container.querySelector("#matrixUpload");
    await userEvent.upload(input, new File([JSON.stringify(matrix)], "m.json"));
    await waitFor(() =>
      expect(mockToast.info).toHaveBeenLastCalledWith(
        "Matrix loaded — click Apply Matrix to apply it.",
      ),
    );
    // Upload alone doesn't apply it.
    expect(fns.applyUploadedMatrix).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Apply Matrix" }));
    expect(fns.applyUploadedMatrix).toHaveBeenCalledTimes(1);
    expect(fns.applyUploadedMatrix).toHaveBeenCalledWith(matrix);
    expect(fns.setPickingMode).toHaveBeenCalledWith(null);
  });

  test("invalid matrix JSON is rejected", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    const { container } = renderPanel("alignment");
    await userEvent.click(screen.getByRole("button", { name: /Advanced — Import Matrix/ }));
    await userEvent.upload(
      container.querySelector("#matrixUpload"),
      new File(["{not json"], "m.json"),
    );
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Invalid JSON file"));
  });
});

describe("cameras panel", () => {
  test("camera uploads and controls call the engine", async () => {
    const fns = installGlobals();
    const setCameraPositionsFile = jest.fn();
    const setShowCameras = jest.fn();
    const { container } = renderPanel("cameras", {
      setCameraPositionsFile,
      showCameras: true,
      setShowCameras,
    });
    const txt = new File(["1 2 3"], "images.txt");
    await userEvent.upload(fileInput(container, ".txt"), txt);
    expect(setCameraPositionsFile).toHaveBeenCalledWith(txt);

    const json = new File(["[]"], "cam.json");
    await userEvent.upload(fileInput(container, ".json"), json);
    expect(fns.handleCameraMatrixUpload).toHaveBeenCalledWith(json);

    const img = new File(["i"], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector("#cameraFolderInput"), {
      target: { files: [img] },
    });
    expect(fns.handleCameraFolderUpload).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Hide Cameras" }));
    expect(setShowCameras).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Add Camera" }));
    expect(fns.addCameraManually).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Bubble Camera" }));
    expect(fns.addBubbleCameraManually).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Apply Camera Matrix" }));
    expect(fns.applyCameraMatrix).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Export Camera Positions" }));
    expect(fns.exportCameraPositions).toHaveBeenCalled();
  });

  test("camera folder upload does not crash before the engine is ready", () => {
    const { container } = renderPanel("cameras", { showCameras: false, setShowCameras: jest.fn() });
    expect(() =>
      fireEvent.change(container.querySelector("#cameraFolderInput"), {
        target: { files: [new File(["i"], "a.jpg")] },
      }),
    ).not.toThrow();
    expect(screen.getByRole("button", { name: "Show Cameras" })).toBeInTheDocument();
  });

  test("manual cameras can be toggled and deleted", async () => {
    const onToggleManualCamera = jest.fn();
    const onDeleteManualCamera = jest.fn();
    renderPanel("cameras", {
      manualCameras: [
        { name: "Cam A", visible: true },
        { name: "Cam B", visible: false, isBubble: true },
      ],
      onToggleManualCamera,
      onDeleteManualCamera,
    });
    expect(screen.getByText("Manual Cameras (2)")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Hide"));
    expect(onToggleManualCamera).toHaveBeenCalledWith("Cam A");
    await userEvent.click(screen.getByTitle("Show"));
    expect(onToggleManualCamera).toHaveBeenCalledWith("Cam B");
    await userEvent.click(screen.getAllByTitle("Delete")[1]);
    expect(onDeleteManualCamera).toHaveBeenCalledWith("Cam B");
  });
});
