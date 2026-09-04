import React, { useRef, useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, Eye, EyeOff, Trash2, ArrowLeft } from "lucide-react";
import ElementMetadata from "../components/metadata/ElementMetadata";
import { useToast } from "../../../components/ToastContainer";
// ─── Spinner keyframes (injected once) ────────────────────────────────────────
// ─── Overlap pill text — force visibility (scoped !important defeats any
// global -webkit-text-fill-color / gradient-text rule elsewhere in the app
// that would otherwise make this text invisible while still rendering it) ──
if (
  typeof document !== "undefined" &&
  !document.getElementById("overlap-pill-style")
) {
  const s = document.createElement("style");
  s.id = "overlap-pill-style";
  s.textContent = `
    .ctx-overlap-pill {
      color: #166534 !important;
      -webkit-text-fill-color: #166534 !important;
      filter: none !important;
      mix-blend-mode: normal !important;
      isolation: isolate;
    }
  `;
  document.head.appendChild(s);
}

const PANEL_LABELS = {
  upload: "Upload Files",
  models: "Models",
  picking: "Picking",
  alignment: "Alignment",
  cameras: "Cameras",
  matrix: "Camera Matrix",
  export: "Export",
  settings: "Settings",
};

export default function ContextPanel(props) {
  const navigate = useNavigate();
  const {
    bimFile,
    pointFile,
    setBimFile,
    setPointFile,
    bimVisible,
    pcVisible,
    setBimVisible,
    setPcVisible,
    setCameraPositionsFile,
    showCameras,
    setShowCameras,
    selectedElement,
    highlightOverlap,
    setHighlightOverlap,
    bimElementCount,
    overlapElementCount,
    overlapElementNames = [],
    // NEW — { byUuid: Map<uuid, count>, byExpressID: Map<expressID, count> },
    // populated by useOverlap.js via setOverlapCounts and passed down from the
    // page component. Used to look up the per-element point count for
    // whichever element is currently selected.
    overlapCounts,
    bimCategories = {},
    hiddenElementNames,
    onToggleElementVisibility,
    bimPoints,
    pcPoints,
    sectionBoxActive,
    toggleSegmentation,
    isSegmented,
    isSegmenting,
    wasCompressed,
    // ── NEW: SAM construction segmentation ──
    toggleSemanticSegmentation,
    isSemanticActive,
    isSamRunning,
    samProgress,
    manualCameras,
    onDeleteManualCamera,
    onToggleManualCamera,
    activePanel,
    onClosePanel,
  } = props;

  const { info, success } = useToast();

  const [activeMode, setActiveMode] = useState(null);
  // Import/Apply Matrix is an advanced/interop feature — collapsed by default.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const handleMode = (mode) => {
    setActiveMode(mode);
    window.setPickingMode?.(mode);
    if (mode === "bim") {
      info("BIM pick mode — click matching points on the BIM model.");
    } else if (mode === "pc") {
      info("Point-cloud pick mode — click the same points, in order.");
    } else {
      info("Picking stopped.");
    }
  };

  // NEW — category-wise counts of ONLY the currently overlapping elements.
  // Looks up each overlapping name's category from bimCategories, then tallies.
  const overlapByCategory = useMemo(() => {
    if (!overlapElementNames.length) return [];

    // Build a quick name -> category lookup from bimCategories.
    const nameToCategory = new Map();
    Object.entries(bimCategories).forEach(([category, names]) => {
      names.forEach((n) => nameToCategory.set(n, category));
    });

    const counts = new Map();
    overlapElementNames.forEach((item) => {
      // CHANGED — item is now {name, count}, not a plain string.
      const name = typeof item === "string" ? item : item.name;
      const cat = nameToCategory.get(name) || "Other";
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [overlapElementNames, bimCategories]);

  // NEW — per-element overlapping point count for whatever is currently
  // selected. Prefers the IFC expressID key (matches useOverlap.js's
  // elemIds), falls back to the Three.js mesh uuid (elemUuids) for non-IFC
  // meshes. Returns 0 (not undefined) when nothing is found, so downstream
  // rendering never sees NaN/undefined.
  const overlappingPoints = useMemo(() => {
    if (!selectedElement || !overlapCounts) return 0;
    const { byUuid, byExpressID } = overlapCounts;
    if (
      selectedElement.expressID != null &&
      byExpressID?.get(selectedElement.expressID) != null
    ) {
      return byExpressID.get(selectedElement.expressID);
    }
    if (selectedElement.uuid && byUuid?.get(selectedElement.uuid) != null) {
      return byUuid.get(selectedElement.uuid);
    }
    return 0;
  }, [selectedElement, overlapCounts]);

  const panels = {
    // ── UPLOAD ────────────────────────────────────────────────────────────────
    upload: (
      <div>
        <SectionLabel text="BIM Model" />
        <UploadZone
          label="Upload BIM (.fbx / .ifc)"
          accept=".fbx,.ifc"
          onFileSelected={setBimFile}
        />
        <SectionLabel text="Point Cloud" />
        <UploadZone
          label="Upload PointCloud (.ply / .las / .laz / .plz)"
          accept=".ply,.las,.laz,.plz,.e57,.pts,.xyz"
          onFileSelected={setPointFile}
        />
      </div>
    ),

    // ── MODELS ────────────────────────────────────────────────────────────────
    models: (
      <div>
        {!bimFile && !pointFile ? (
          <EmptyHint text="No files loaded. Use the Upload panel to add BIM or PointCloud files." />
        ) : (
          <>
            <SectionLabel text="Loaded Files" />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                marginBottom: 10,
              }}
            >
              {/* NEW — BIM element category breakdown (Walls, Floors, etc.) */}
              {bimFile && Object.keys(bimCategories).length > 0 && (
                <>
                  <SectionLabel text="BIM Element Categories" />
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 6,
                      overflow: "hidden",
                      marginBottom: 10,
                    }}
                  >
                    {Object.entries(bimCategories)
                      .sort((a, b) => b[1].length - a[1].length)
                      .map(([category, names]) => (
                        <CategoryDropdown
                          key={category}
                          category={category}
                          names={names}
                          highlightName={
                            selectedElement?.category === category
                              ? selectedElement.elementLabel
                              : null
                          }
                          hiddenNames={hiddenElementNames}
                          onToggleVisibility={onToggleElementVisibility}
                        />
                      ))}
                  </div>
                </>
              )}
              {bimFile && (
                <ModelCard
                  label="BIM Model"
                  name={bimFile.name}
                  visible={bimVisible}
                  accent="#3b82f6"
                  onToggle={() => setBimVisible(!bimVisible)}
                  onDelete={() => setBimFile(null)}
                />
              )}
              {pointFile && (
                <ModelCard
                  label="Point Cloud"
                  name={pointFile.name}
                  visible={pcVisible}
                  accent="#10b981"
                  onToggle={() => setPcVisible(!pcVisible)}
                  onDelete={() => setPointFile(null)}
                />
              )}
            </div>
          </>
        )}

        {pointFile && (
          <>
            <SectionLabel text="Segmentation" />
            <button
              onClick={toggleSegmentation}
              disabled={isSegmenting}
              style={{
                ...btn,
                background: isSegmented ? "#ede9fe" : "#f3f4f6",
                borderColor: isSegmented ? "#c4b5fd" : "#e5e7eb",
                color: isSegmented ? "#5b21b6" : "#6b7280",
                cursor: isSegmenting ? "not-allowed" : "pointer",
                opacity: isSegmenting ? 0.65 : 1,
              }}
            >
              {isSegmenting ? (
                <>
                  <Spinner /> Segmenting…
                </>
              ) : isSegmented ? (
                "Hide Segments"
              ) : (
                "Show Segments (RANSAC)"
              )}
            </button>
            {wasCompressed && !isSegmenting && (
              <div style={{ fontSize: 10, color: "#92400e", marginTop: 4 }}>
                ⚡ Compressed — file &gt;700 MB, subsampled to 70%
              </div>
            )}

            {/* ✅ NEW — SAM construction segmentation, moved inside {pointFile && ...} */}
            <button
              onClick={() => {
                console.log(
                  "SAM button clicked, toggleSemanticSegmentation is:",
                  toggleSemanticSegmentation,
                );
                toggleSemanticSegmentation?.();
              }}
              disabled={isSamRunning}
              style={{
                ...btn,
                background: isSemanticActive ? "#dcfce7" : "#f3f4f6",
                borderColor: isSemanticActive ? "#86efac" : "#e5e7eb",
                color: isSemanticActive ? "#166534" : "#6b7280",
                cursor: isSamRunning ? "not-allowed" : "pointer",
                opacity: isSamRunning ? 0.65 : 1,
                marginTop: 6,
              }}
            >
              {isSamRunning ? (
                <>
                  <Spinner /> {samProgress || "Segmenting…"}
                </>
              ) : isSemanticActive ? (
                "Hide Construction Segments"
              ) : (
                "Show Construction Segments (SAM)"
              )}
            </button>
          </>
        )}

        {/* NEW — Overlapping elements name list. Shown whenever the overlap
            highlight has produced named results, independent of whether an
            element is currently selected. */}
        {overlapElementNames.length > 0 && (
          <>
            <div style={divider} />
            <SectionLabel
              text={`Overlapping Elements (${overlapElementNames.length})`}
            />
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                maxHeight: 180,
                overflowY: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fafafa",
              }}
            >
              {/* CHANGED — overlapElementNames entries are now {name, count}
                  objects (see useOverlap.js), so each row shows the matched
                  point-cloud point count alongside the element name. */}
              {overlapElementNames.map((item, i) => {
                const name = typeof item === "string" ? item : item.name;
                const count = typeof item === "string" ? null : item.count;
                return (
                  <li
                    key={`${name}-${i}`}
                    title={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "5px 8px",
                      fontSize: 11,
                      borderBottom:
                        i < overlapElementNames.length - 1
                          ? "1px solid #eef0f2"
                          : "none",
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {i + 1}. {name}
                    </span>
                    {count != null && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#0891b2",
                          background: "#ecfeff",
                          borderRadius: 999,
                          padding: "1px 7px",
                        }}
                      >
                        {count.toLocaleString()} pts
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* NEW — category-wise counts of the overlapping elements above */}
            {overlapByCategory.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <SectionLabel text="Overlap by Category" />
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "#fff",
                  }}
                >
                  {overlapByCategory.map(({ category, count }, i) => (
                    <div
                      key={category}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 9px",
                        borderBottom:
                          i < overlapByCategory.length - 1
                            ? "1px solid #f1f5f9"
                            : "none",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#374151",
                        }}
                      >
                        {category}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#16a34a",
                          background: "#f0fdf4",
                          borderRadius: 999,
                          padding: "1px 8px",
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {selectedElement && (
          <>
            <div style={divider} />
            <SectionLabel text="Selected Element" />
            <ElementMetadata
              selectedElement={selectedElement}
              bimElementCount={bimElementCount}
              overlapElementCount={overlapElementCount}
              overlappingPoints={overlappingPoints}
              highlightOverlap={highlightOverlap}
              setHighlightOverlap={setHighlightOverlap}
              onSaveOverlapData={() => {
                if (window.sendOverlapSnapshot) {
                  window.sendOverlapSnapshot();
                } else {
                  info("Open a project with a BIM + Point Cloud first.");
                }
              }}
            />
          </>
        )}
      </div>
    ),

    // ── PICKING ───────────────────────────────────────────────────────────────
    picking: (
      <div>
        <SectionLabel text="Picking Mode" />
        <ToolBtn
          label="Pick BIM Points"
          active={activeMode === "bim"}
          activeBg="var(--tool-bim)"
          activeColor="#fff"
          inactiveBg="var(--tool-bim-soft)"
          inactiveColor="var(--tool-bim)"
          inactiveBorder="var(--tool-bim-border)"
          onClick={() => handleMode("bim")}
        />
        <ToolBtn
          label="Pick PointCloud Points"
          active={activeMode === "pc"}
          activeBg="var(--tool-cloud)"
          activeColor="#fff"
          inactiveBg="var(--tool-cloud-soft)"
          inactiveColor="var(--tool-cloud)"
          inactiveBorder="var(--tool-cloud-border)"
          onClick={() => handleMode("pc")}
        />
        <ToolBtn
          label="Stop Picking"
          active={activeMode === null}
          activeBg="var(--tool-neutral)"
          activeColor="#fff"
          inactiveBg="var(--tool-neutral-soft)"
          inactiveColor="var(--tool-neutral)"
          inactiveBorder="var(--tool-neutral-border)"
          onClick={() => handleMode(null)}
        />

        <div style={divider} />
        <SectionLabel text="Actions" />
        <ToolBtn
          label="Align Geometry"
          inactiveBg="var(--tool-bim-soft)"
          inactiveColor="var(--tool-bim)"
          inactiveBorder="var(--tool-bim-border)"
          onClick={() => {
            info("Aligning geometry from picked points…");
            window.alignGeometry?.();
            window.clearMarkers?.();
          }}
        />
        <ToolBtn
          label="ICP Align"
          inactiveBg="var(--tool-warn-soft)"
          inactiveColor="var(--tool-warn)"
          inactiveBorder="var(--tool-warn-border)"
          onClick={() => {
            info("Running ICP alignment…");
            window.alignGeometryICP?.();
            window.clearMarkers?.();
          }}
        />
        <ToolBtn
          label="Save Alignment Pair"
          inactiveBg="var(--tool-export-soft)"
          inactiveColor="var(--tool-export)"
          inactiveBorder="var(--tool-export-border)"
          onClick={() => {
            if (window.saveAlignmentPair) {
              info("Saving alignment pair…");
              window.saveAlignmentPair();
            } else {
              info("Open a project with a BIM + Point Cloud first.");
            }
          }}
        />
        <ToolBtn
          label={
            sectionBoxActive ? "Disable Section Box" : "Enable Section Box"
          }
          active={sectionBoxActive}
          activeBg="var(--tool-cloud)"
          activeColor="#fff"
          inactiveBg="var(--tool-cloud-soft)"
          inactiveColor="var(--tool-cloud)"
          inactiveBorder="var(--tool-cloud-border)"
          onClick={() => {
            window.toggleSectionBox?.();
            success(
              sectionBoxActive
                ? "Section box disabled."
                : "Section box enabled.",
            );
          }}
        />
        <ToolBtn
          label={
            highlightOverlap
              ? "Hide Overlap (green)"
              : "Highlight Overlap (green)"
          }
          active={highlightOverlap}
          activeBg="var(--tool-export)"
          activeColor="#fff"
          inactiveBg="var(--tool-export-soft)"
          inactiveColor="var(--tool-export)"
          inactiveBorder="var(--tool-export-border)"
          onClick={() => {
            setHighlightOverlap?.((prev) => {
              const next = !prev;
              info(
                next
                  ? "Highlighting overlap — point-cloud points covering BIM turn green."
                  : "Overlap highlight off.",
              );
              return next;
            });
          }}
        />
        <ToolBtn
          label="Clear Picked Points"
          inactiveBg="var(--tool-danger-soft)"
          inactiveColor="var(--tool-danger)"
          inactiveBorder="var(--tool-danger-border)"
          onClick={() => {
            window.clearMarkers?.();
            info("Picked points cleared.");
          }}
        />
        <div style={divider} />
        <SectionLabel text={`BIM Points (${bimPoints?.length || 0})`} />
        <PointList points={bimPoints} accent="#3b82f6" />

        <div style={{ marginTop: 10 }}>
          <SectionLabel
            text={`Point Cloud Points (${pcPoints?.length || 0})`}
          />
          <PointList points={pcPoints} accent="#059669" />
        </div>
      </div>
    ),

    // ── ALIGNMENT ─────────────────────────────────────────────────────────────
    alignment: (
      <div>
        <SectionLabel text="Matrix Operations" />
        <ToolBtn
          label="Generate Matrix"
          inactiveBg="var(--tool-bim-soft)"
          inactiveColor="var(--tool-bim)"
          inactiveBorder="var(--tool-bim-border)"
          onClick={() => {
            window.generateMatrix?.();
            window.clearMarkers?.();
            window.setPickingMode?.(null);
            setActiveMode(null);
          }}
        />
        <ToolBtn
          label="Export Matrix"
          inactiveBg="var(--tool-export-soft)"
          inactiveColor="var(--tool-export)"
          inactiveBorder="var(--tool-export-border)"
          onClick={() => window.exportMatrix?.()}
        />
        <ToolBtn
          label="Reset All"
          inactiveBg="var(--tool-danger-soft)"
          inactiveColor="var(--tool-danger)"
          inactiveBorder="var(--tool-danger-border)"
          onClick={() => window.resetAll?.()}
        />

        <div style={divider} />

        {/* Advanced / interop: import an externally-computed alignment matrix.
            Not needed for the normal auto-align + Save workflow. */}
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            background: "transparent",
            border: "none",
            padding: "4px 2px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            color: "#64748b",
          }}
        >
          <span style={{ fontSize: 10 }}>{advancedOpen ? "▾" : "▸"}</span>
          Advanced — Import Matrix (.json)
        </button>

        {advancedOpen && (
          <div style={{ marginTop: 4 }}>
            <MatrixDropZone />
            <div style={{ marginTop: 6 }}>
              <ToolBtn
                label="Apply Matrix"
                inactiveBg="var(--tool-export-soft)"
                inactiveColor="var(--tool-export)"
                inactiveBorder="var(--tool-export-border)"
                onClick={() => {
                  window.applyUploadedMatrix?.();
                  window.clearMarkers?.();
                  window.setPickingMode?.(null);
                  setActiveMode(null);
                }}
              />
            </div>
          </div>
        )}
      </div>
    ),

    // ── CAMERAS ───────────────────────────────────────────────────────────────
    cameras: (
      <div>
        <SectionLabel text="Upload Camera Data" />
        <UploadZone
          label="Upload Camera TXT"
          accept=".txt"
          onFileSelected={setCameraPositionsFile}
        />
        <CameraFolderZone />

        <div style={divider} />
        <SectionLabel text="Controls" />
        <ToolBtn
          label={showCameras ? "Hide Cameras" : "Show Cameras"}
          inactiveBg="var(--tool-bim-soft)"
          inactiveColor="var(--tool-bim)"
          inactiveBorder="var(--tool-bim-border)"
          onClick={() => setShowCameras(!showCameras)}
        />
        <ToolBtn
          label="Add Camera"
          inactiveBg="var(--tool-bim-soft)"
          inactiveColor="var(--tool-bim)"
          inactiveBorder="var(--tool-bim-border)"
          onClick={() => window.addCameraManually?.()}
        />

        {manualCameras && manualCameras.length > 0 && (
          <>
            <div style={divider} />
            <SectionLabel text={`Manual Cameras (${manualCameras.length})`} />
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {manualCameras.map((cam) => (
                <div
                  key={cam.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderBottom: "1px solid #f3f4f6",
                    background: cam.visible === false ? "#f9fafb" : "#ffffff",
                  }}
                >
                  <span
                    style={{
                      fontSize: 7,
                      color: cam.hasImage ? "#7c3aed" : "#0891b2",
                      flexShrink: 0,
                    }}
                  >
                    ●
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 11,
                      fontWeight: 500,
                      color: cam.visible === false ? "#c4cad4" : "#4b5563",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cam.name}
                  </span>
                  <IconBtn
                    title={cam.visible === false ? "Show" : "Hide"}
                    onClick={() => onToggleManualCamera?.(cam.name)}
                  >
                    {cam.visible === false ? (
                      <Eye size={11} />
                    ) : (
                      <EyeOff size={11} />
                    )}
                  </IconBtn>
                  <IconBtn
                    title="Delete"
                    danger
                    onClick={() => onDeleteManualCamera?.(cam.name)}
                  >
                    <Trash2 size={11} />
                  </IconBtn>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    ),

    // ── CAMERA MATRIX ─────────────────────────────────────────────────────────
    matrix: (
      <div>
        <SectionLabel text="Camera Alignment Matrix" />
        <UploadZone
          label="Upload Camera Matrix (.json)"
          accept=".json"
          onFileSelected={(file) => window.handleCameraMatrixUpload?.(file)}
        />
        <ToolBtn
          label="Apply Camera Matrix"
          inactiveBg="var(--tool-bim-soft)"
          inactiveColor="var(--tool-bim)"
          inactiveBorder="var(--tool-bim-border)"
          onClick={() => window.applyCameraMatrix?.()}
        />
        <ToolBtn
          label="Export Camera Positions"
          inactiveBg="var(--tool-export-soft)"
          inactiveColor="var(--tool-export)"
          inactiveBorder="var(--tool-export-border)"
          onClick={() => window.exportCameraPositions?.()}
        />

        <div style={divider} />
        <SectionLabel text="Keyboard Shortcuts" />
        <div style={hintBox}>
          <KbdRow k="G" label="Move" />
          <KbdRow k="R" label="Rotate" />
          <KbdRow k="S" label="Zoom FOV" />
          <KbdRow k="Esc" label="Cancel" />
        </div>
      </div>
    ),

    // ── EXPORT ────────────────────────────────────────────────────────────────
    export: (
      <div>
        <SectionLabel text="Export Options" />
        <ToolBtn
          label="Export Matrix (.json)"
          inactiveBg="var(--tool-export-soft)"
          inactiveColor="var(--tool-export)"
          inactiveBorder="var(--tool-export-border)"
          onClick={() => window.exportMatrix?.()}
        />
        <ToolBtn
          label="Export Camera Positions"
          inactiveBg="var(--tool-export-soft)"
          inactiveColor="var(--tool-export)"
          inactiveBorder="var(--tool-export-border)"
          onClick={() => window.exportCameraPositions?.()}
        />
      </div>
    ),

    // ── SETTINGS ──────────────────────────────────────────────────────────────
    settings: (
      <div>
        <SectionLabel text="Keyboard Shortcuts" />
        <div style={hintBox}>
          <KbdRow k="G" label="Move camera" />
          <KbdRow k="R" label="Rotate camera" />
          <KbdRow k="S" label="Zoom FOV" />
          <KbdRow k="Esc" label="Cancel operation" />
        </div>
        <div style={divider} />
        <button
          onClick={() => navigate(-1)}
          style={{
            ...btn,
            background: "#f3f4f6",
            borderColor: "#e5e7eb",
            color: "#6b7280",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeft size={12} /> Back to Dashboard
        </button>
      </div>
    ),
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px 8px 12px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#9ca3af",
            textTransform: "uppercase",
          }}
        >
          {PANEL_LABELS[activePanel] || activePanel}
        </span>
        <button
          onClick={onClosePanel}
          style={{
            background: "transparent",
            border: "1px solid #e5e7eb",
            borderRadius: 4,
            cursor: "pointer",
            color: "#9ca3af",
            display: "flex",
            alignItems: "center",
            padding: "2px 4px",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#d1d5db";
            e.currentTarget.style.color = "#6b7280";
            e.currentTarget.style.background = "#f3f4f6";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#e5e7eb";
            e.currentTarget.style.color = "#9ca3af";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px",
          scrollbarWidth: "thin",
          scrollbarColor: "#e5e7eb transparent",
        }}
      >
        {panels[activePanel] || null}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ text }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: "#9ca3af",
        marginBottom: 5,
        marginTop: 2,
      }}
    >
      {text}
    </div>
  );
}

function ToolBtn({
  label,
  active,
  activeBg,
  activeColor,
  inactiveBg,
  inactiveColor,
  inactiveBorder,
  onClick,
}) {
  const bg = active ? activeBg || "#2563eb" : inactiveBg || "#f3f4f6";
  const color = active ? activeColor || "#ffffff" : inactiveColor || "#374151";
  const border = active ? activeBg || "#2563eb" : inactiveBorder || "#e5e7eb";

  return (
    <button
      onClick={onClick}
      style={{ ...btn, background: bg, borderColor: border, color }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "0.88";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
    >
      {label}
    </button>
  );
}

function ModelCard({ label, name, visible, accent, onToggle, onDelete }) {
  return (
    <div
      style={{
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        padding: "7px 9px",
        display: "flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      <div
        style={{
          width: 3,
          height: 26,
          background: accent || "#3b82f6",
          borderRadius: 2,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#374151" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#9ca3af",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
      </div>
      <IconBtn title={visible ? "Hide" : "Show"} onClick={onToggle}>
        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </IconBtn>
      <IconBtn title="Remove" danger onClick={onDelete}>
        <Trash2 size={12} />
      </IconBtn>
    </div>
  );
}

function CategoryDropdown({
  category,
  names,
  highlightName,
  hiddenNames,
  onToggleVisibility,
}) {
  const [open, setOpen] = useState(false);
  const highlightRef = useRef(null);

  // Clicking an element in the 3D view auto-expands its category here and
  // scrolls the matching row into view, so the sidebar always shows exactly
  // which element (by name) within the category was just selected.
  useEffect(() => {
    if (!highlightName) return;
    setOpen(true);
  }, [highlightName]);

  // Runs again once `open` flips true: when the category was collapsed at
  // click time, the list (and this ref) doesn't exist yet during the same
  // effect pass that requests the expand above — it only mounts on the
  // render triggered by that setOpen(true), so scrolling has to wait for it.
  useEffect(() => {
    if (highlightName && open && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightName, open]);

  return (
    <div style={{ borderBottom: "1px solid #f1f5f9" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 9px",
          background: "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          color: "#374151",
        }}
      >
        <span>{category}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700 }}>
            {names.length}
          </span>
          <span style={{ fontSize: 9, color: "#9ca3af" }}>
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>
      {open && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: "0 0 6px 0",
            background: "#fafafa",
          }}
        >
          {names.map((name, i) => {
            const isHighlighted = name === highlightName;
            const isHidden = hiddenNames?.has(name);
            return (
              <li
                key={`${name}-${i}`}
                ref={isHighlighted ? highlightRef : null}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  padding: "4px 8px 4px 14px",
                  background: isHighlighted ? "#dbeafe" : "transparent",
                }}
              >
                <span
                  title={name}
                  style={{
                    fontSize: 10.5,
                    color: isHidden
                      ? "#c1c7d0"
                      : isHighlighted
                        ? "#1d4ed8"
                        : "#4b5563",
                    fontWeight: isHighlighted ? 700 : 400,
                    fontStyle: isHidden ? "italic" : "normal",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {name}
                </span>
                <button
                  type="button"
                  title={isHidden ? "Show element" : "Hide element"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility?.(name);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 2,
                    flexShrink: 0,
                    color: isHidden ? "#9ca3af" : "#6b7280",
                  }}
                >
                  {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IconBtn({ title, danger, onClick, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "transparent",
        border: `1px solid ${danger ? "#fecaca" : "#e5e7eb"}`,
        borderRadius: 4,
        cursor: "pointer",
        color: danger ? "#ef4444" : "#9ca3af",
        display: "flex",
        alignItems: "center",
        padding: 3,
        flexShrink: 0,
        transition: "color 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? "#dc2626" : "#374151";
        e.currentTarget.style.borderColor = danger ? "#fca5a5" : "#d1d5db";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = danger ? "#ef4444" : "#9ca3af";
        e.currentTarget.style.borderColor = danger ? "#fecaca" : "#e5e7eb";
      }}
    >
      {children}
    </button>
  );
}

function UploadZone({ label, accept, onFileSelected }) {
  const ref = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected?.(file);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected?.(file);
  };

  return (
    <div style={{ marginBottom: 7 }}>
      <div
        onClick={() => ref.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: "1px dashed #d1d5db",
          borderRadius: 6,
          padding: "10px 8px",
          cursor: "pointer",
          background: "#f9fafb",
          textAlign: "center",
          transition: "border-color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#93c5fd";
          e.currentTarget.style.background = "#eff6ff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#d1d5db";
          e.currentTarget.style.background = "#f9fafb";
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
          Click or drop file
        </div>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </div>
  );
}

function MatrixDropZone() {
  return (
    <div>
      <div
        onClick={() => document.getElementById("matrixUpload").click()}
        style={{
          border: "1px dashed #d1d5db",
          borderRadius: 6,
          padding: "10px 8px",
          textAlign: "center",
          cursor: "pointer",
          background: "#f9fafb",
          marginBottom: 7,
          transition: "border-color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#93c5fd";
          e.currentTarget.style.background = "#eff6ff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#d1d5db";
          e.currentTarget.style.background = "#f9fafb";
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>
          Upload Matrix (.json)
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
          Drop file or click to browse
        </div>
      </div>
      <input
        id="matrixUpload"
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              window.applyUploadedMatrix?.(JSON.parse(ev.target.result));
            } catch {
              alert("Invalid JSON file");
            }
          };
          reader.readAsText(file);
        }}
      />
    </div>
  );
}

function CameraFolderZone() {
  return (
    <div style={{ marginBottom: 7 }}>
      <div
        onClick={() => document.getElementById("cameraFolderInput").click()}
        style={{
          border: "1px dashed #d1d5db",
          borderRadius: 6,
          padding: "10px 8px",
          textAlign: "center",
          cursor: "pointer",
          background: "#f9fafb",
          transition: "border-color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#93c5fd";
          e.currentTarget.style.background = "#eff6ff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#d1d5db";
          e.currentTarget.style.background = "#f9fafb";
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>
          Upload Camera Folder
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
          Image folder — click or drop
        </div>
      </div>
      <input
        id="cameraFolderInput"
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => window.handleCameraFolderUpload(e.target.files)}
      />
    </div>
  );
}

function PointList({ points, accent }) {
  if (!points || points.length === 0) {
    return (
      <div
        style={{
          fontSize: 10,
          color: "#c4cad4",
          fontStyle: "italic",
          padding: "2px 0",
        }}
      >
        None selected
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {points.map((p, i) => (
        <div
          key={i}
          style={{
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            borderRadius: 4,
            padding: "4px 7px",
            fontSize: 10,
            fontFamily: '"SF Mono", "Fira Code", monospace',
            color: accent || "#374151",
          }}
        >
          #{i + 1}: {p.x.toFixed(3)}, {p.y.toFixed(3)}, {p.z.toFixed(3)}
        </div>
      ))}
    </div>
  );
}

function KbdRow({ k, label }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
    >
      <code
        style={{
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
          borderRadius: 3,
          padding: "1px 6px",
          fontSize: 10,
          color: "#374151",
          minWidth: 26,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {k}
      </code>
      <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
    </div>
  );
}

function EmptyHint({ text }) {
  return (
    <div
      style={{
        padding: "18px 6px",
        textAlign: "center",
        fontSize: 11,
        color: "#c4cad4",
        lineHeight: "1.6",
      }}
    >
      {text}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        marginRight: 6,
        border: "2px solid #d97706",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "ctxSpin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

// ─── Shared style tokens ──────────────────────────────────────────────────────
const btn = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 5,
  border: "1px solid #e5e7eb",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  transition: "opacity 0.12s ease",
  marginBottom: 4,
  letterSpacing: "0.01em",
};

const divider = {
  borderTop: "1px solid #f0f1f3",
  margin: "9px 0",
};

const hintBox = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "9px 10px",
};