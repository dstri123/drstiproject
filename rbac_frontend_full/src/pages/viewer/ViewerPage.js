import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { createProjectSlug, getProjectIdFromSlug } from "@/lib/utils";
import API from "../../api/axios";
import Layout from "./layout/Layout";
import ThreeViewer from "./components/viewer/ThreeViewer";
import { useToast } from "../../components/ToastContainer";

export default function ViewerPage() {
  const { projectSlug } = useParams();
  const [resolvedProjectId, setResolvedProjectId] = useState(() =>
    getProjectIdFromSlug(projectSlug),
  );
  const id = resolvedProjectId ?? getProjectIdFromSlug(projectSlug);
  const role = localStorage.getItem("role") || "viewer";
  const toast = useToast();

  // -------- FILE STATES --------
  const [bimFile, setBimFile] = useState(null);
  const [pointFile, setPointFile] = useState(null);
  const [latestBimItem, setLatestBimItem] = useState(null);
  const [latestPointItem, setLatestPointItem] = useState(null);
  const [bimModel, setBimModel] = useState(null);
  const [pcModel, setPcModel] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [uploadsByDate, setUploadsByDate] = useState({});
  const [selectedDate, setSelectedDate] = useState("");
  // Lat/Lng the user entered when creating the project — seeds the map panel.
  const [projectGeo, setProjectGeo] = useState({
    latitude: null,
    longitude: null,
    altitude: null,
    scale: null,
    zoom: null,
    footprint_area: null,
  });

  // -------- PICKED POINTS --------
  const [bimPoints, setBimPoints] = useState([]);
  const [pcPoints, setPcPoints] = useState([]);

  // -------- MATRIX --------
  const [matrix, setMatrix] = useState(null);

  // -------- VISIBILITY --------
  const [bimVisible, setBimVisible] = useState(true);
  const [pcVisible, setPcVisible] = useState(true);

  // -------- CAMERA --------
  const [cameraPositionsFile, setCameraPositionsFile] = useState(null);
  const [cameraImages, setCameraImages] = useState([]);

  // Matrix File (.json) uploaded alongside a photo batch — a raw 4x4
  // transform applied to both the imported camera positions and the point
  // cloud, so the BIM model and point cloud line up.
  const [uploadedAlignmentMatrix, setUploadedAlignmentMatrix] = useState(null);
  const [showCameras, setShowCameras] = useState(true);
  const [calOpen, setCalOpen] = useState(false);
  const calBtnRef = useRef(null);

  const resolveRemoteUrl = (fileUrl) => {
    if (!fileUrl) return null;
    if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
      return fileUrl;
    }
    if (fileUrl.startsWith("/") && !fileUrl.startsWith("//")) {
      const apiBase = API.defaults.baseURL.replace(/\/api\/?$/, "");
      return `${apiBase}${fileUrl}`;
    }
    return fileUrl;
  };

  // The viewer fires ~50 concurrent map-tile requests to the same origin on
  // load, which can starve other fetches past the browser's per-host
  // connection cap and drop them with a raw "Failed to fetch". Retry small
  // metadata fetches (camera/matrix) a couple of times before giving up.
  const fetchWithRetry = async (url, attempts = 6) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fetch(url);
      } catch (err) {
        lastErr = err;
        console.warn(
          `fetchWithRetry: attempt ${i + 1}/${attempts} failed for ${url}`,
          err,
        );
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));
        }
      }
    }
    throw lastErr;
  };

  const createRemoteSource = (fileUrl, transform = null) => {
    const url = resolveRemoteUrl(fileUrl);
    if (!url) return null;
    const name = url.split("/").pop().split("?")[0];
    return { url, name, transform };
  };

  const getLatestBatchImages = (images) => {
    if (!Array.isArray(images) || images.length === 0) return [];
    const batches = images.reduce((map, item) => {
      const batch = item.batch_name || "default";
      map[batch] = map[batch] || [];
      map[batch].push(item);
      return map;
    }, {});

    const sortedBatches = Object.values(batches).sort((a, b) => {
      const aDate = new Date(a[0]?.uploaded_at || a[0]?.date || 0).getTime();
      const bDate = new Date(b[0]?.uploaded_at || b[0]?.date || 0).getTime();
      return bDate - aDate;
    });

    return sortedBatches[0] || [];
  };

  const toDateStr = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getItemDateValue = (item) => {
    return (
      item.uploaded_at || item.date || item.created_at || item.updated_at || ""
    );
  };

  const buildUploadsByDate = (bimItems, pcItems) => {
    const groups = {};

    const addToGroup = (type, item) => {
      const dateKey = toDateStr(getItemDateValue(item));
      if (!dateKey) return;
      groups[dateKey] = groups[dateKey] || { bim: [], pc: [] };
      groups[dateKey][type].push(item);
    };

    (bimItems || []).forEach((item) => addToGroup("bim", item));
    (pcItems || []).forEach((item) => addToGroup("pc", item));

    return groups;
  };

  const loadDateUploads = (dateKey, grouped) => {
    const uploads = grouped[dateKey] || { bim: [], pc: [] };

    const pickByExtension = (items, exts) =>
      (items || []).find((item) => {
        const filePath = item.file?.split("?")[0] || "";
        return exts.some((ext) => filePath.toLowerCase().endsWith(ext));
      });

    const latestByFlag = (items) =>
      (items || []).find((item) => item.is_latest === true) ||
      pickByExtension(items, [".fbx", ".ifc", ".ply"]) ||
      items?.[0];

    const bimItem = latestByFlag(uploads.bim);
    const pointItem = latestByFlag(uploads.pc);

    setLatestBimItem(bimItem || null);
    setLatestPointItem(pointItem || null);

    if (bimItem?.file) {
      const source = createRemoteSource(bimItem.file, bimItem.transform);
      setBimFile(source ? { ...source, id: bimItem.id } : null);
    } else {
      setBimFile(null);
    }

    if (pointItem?.file) {
      const source = createRemoteSource(pointItem.file, pointItem.transform);
      setPointFile(source ? { ...source, id: pointItem.id } : null);
    } else {
      setPointFile(null);
    }
  };

  const loadProjectAssets = async () => {
    if (!projectSlug) return;

    try {
      const projectsRes = await API.get("projects/");
      const project = (projectsRes.data || []).find(
        (p) =>
          String(p.id) === String(projectSlug) ||
          p.slug === projectSlug ||
          createProjectSlug(p) === projectSlug,
      );

      const resolvedId = project?.id ?? getProjectIdFromSlug(projectSlug);
      if (!resolvedId) return;
      setResolvedProjectId(resolvedId);

      const [bimRes, pointRes, imageRes, cameraRes, matrixRes] =
        await Promise.all([
          API.get(`projects/${resolvedId}/bim/`),
          API.get(`projects/${resolvedId}/pointcloud/`),
          API.get(`projects/${resolvedId}/images/`),
          API.get(`projects/${resolvedId}/camera/`),
          API.get(`projects/${resolvedId}/matrix/`),
        ]);

      // Pull the project's creation-time latitude/longitude for the map panel.
      const proj = (projectsRes.data || []).find(
        (p) =>
          String(p.id) === String(resolvedId) ||
          p.slug === projectSlug ||
          createProjectSlug(p) === projectSlug,
      );
      if (proj) {
        setProjectGeo({
          latitude: proj.latitude ?? null,
          longitude: proj.longitude ?? null,
          altitude: proj.altitude ?? null,
          scale: proj.scale ?? null,
          zoom: proj.zoom ?? null,
          footprint_area: proj.footprint_area ?? null,
        });
      }

      const images = imageRes.data || [];
      const latestImages = getLatestBatchImages(images);
      setCameraImages(latestImages.length ? latestImages : images);

      const batchName = latestImages[0]?.batch_name || images[0]?.batch_name;
      const cameraItems = cameraRes.data || [];
      const batchCameraItems = batchName
        ? cameraItems.filter((c) => c.batch_name === batchName)
        : cameraItems;
      const cameraItem =
        (batchCameraItems.length ? batchCameraItems : cameraItems).find(
          (c) => c.is_latest,
        ) || (batchCameraItems.length ? batchCameraItems : cameraItems)[0];

      if (cameraItem?.file) {
        try {
          const camResp = await fetchWithRetry(
            resolveRemoteUrl(cameraItem.file),
          );
          const camBlob = await camResp.blob();
          setCameraPositionsFile(camBlob);
        } catch (camErr) {
          console.error("Failed to load camera positions file", camErr);
          setCameraPositionsFile(null);
        }
      } else {
        setCameraPositionsFile(null);
      }

      // Matrix File (.json) for the same batch — a raw 4x4 transform applied
      // to the camera positions and the point cloud so BIM + point cloud align.
      const matrixItems = matrixRes.data || [];
      const batchMatrixItems = batchName
        ? matrixItems.filter((m) => m.batch_name === batchName)
        : matrixItems;
      const matrixItem =
        (batchMatrixItems.length ? batchMatrixItems : matrixItems).find(
          (m) => m.is_latest,
        ) || (batchMatrixItems.length ? batchMatrixItems : matrixItems)[0];

      if (matrixItem?.file) {
        try {
          const matResp = await fetchWithRetry(
            resolveRemoteUrl(matrixItem.file),
          );
          const matJson = await matResp.json();
          const isValid4x4 =
            Array.isArray(matJson) &&
            matJson.length === 4 &&
            matJson.every((row) => Array.isArray(row) && row.length === 4);
          setUploadedAlignmentMatrix(isValid4x4 ? matJson : null);
          if (!isValid4x4) {
            console.error("Matrix file is not a 4x4 array", matJson);
          }
        } catch (matErr) {
          console.error("Failed to load matrix file", matErr);
          setUploadedAlignmentMatrix(null);
        }
      } else {
        setUploadedAlignmentMatrix(null);
      }

      const pickByExtension = (items, exts) =>
        (items || []).find((item) => {
          const filePath = item.file?.split("?")[0] || "";
          return exts.some((ext) => filePath.toLowerCase().endsWith(ext));
        });

      const latestByFlag = (items) =>
        (items || []).find((item) => item.is_latest === true);

      const bimItems = bimRes.data || [];
      const pcItems = pointRes.data || [];
      const groupedByDate = buildUploadsByDate(bimItems, pcItems);
      setUploadsByDate(groupedByDate);

      const dateKeys = Object.keys(groupedByDate).sort();
      const defaultDate = dateKeys.length ? dateKeys[dateKeys.length - 1] : "";
      setSelectedDate(defaultDate);

      if (defaultDate) {
        loadDateUploads(defaultDate, groupedByDate);
      } else {
        const bimItem =
          latestByFlag(bimItems) ||
          pickByExtension(bimItems, [".fbx", ".ifc"]) ||
          bimItems?.[0];
        const pointItem =
          latestByFlag(pcItems) ||
          pickByExtension(pcItems, [".ply"]) ||
          pcItems?.[0];

        setLatestBimItem(bimItem || null);
        setLatestPointItem(pointItem || null);

        if (bimItem?.file) {
          const source = createRemoteSource(bimItem.file, bimItem.transform);
          if (source) setBimFile({ ...source, id: bimItem.id });
        }

        if (pointItem?.file) {
          const source = createRemoteSource(
            pointItem.file,
            pointItem.transform,
          );
          if (source) setPointFile({ ...source, id: pointItem.id });
        }
      }
    } catch (err) {
      console.error("Failed to load project assets", err);
    }
  };

  useEffect(() => {
    loadProjectAssets();
    // loadProjectAssets re-derives the project id from projectSlug itself and
    // calls setResolvedProjectId(...) — depending on `id` here would make this
    // effect re-trigger itself on that very state update, silently doubling
    // every request it makes (including the multi-hundred-MB point cloud
    // fetch), which is enough concurrent load to make the browser drop one of
    // the duplicate large fetches ("Failed to fetch").
  }, [projectSlug]);

  const handleDateSelect = useCallback(
    (dateKey) => {
      setSelectedDate(dateKey);
      loadDateUploads(dateKey, uploadsByDate);
      setCalOpen(false);
    },
    [uploadsByDate],
  );

  const getTransformState = (model) => {
    if (!model) return null;
    model.updateMatrixWorld(true);
    return {
      position: model.position.toArray(),
      quaternion: model.quaternion.toArray(),
      scale: model.scale.toArray(),
    };
  };

  const saveModelTransform = async (item, type, model) => {
    if (!item || !model) return null;
    const transform = getTransformState(model);
    if (!transform) return null;
    const endpoint =
      type === "bim"
        ? `bim/${item.id}/update/`
        : `pointcloud/${item.id}/update/`;
    const res = await API.put(endpoint, { transform });
    return res.data;
  };

  const handleSavePosition = async () => {
    if (!latestBimItem && !latestPointItem) {
      toast.info("No uploaded models available to save.");
      return;
    }

    if (!bimModel && !pcModel) {
      toast.info("Load the latest BIM or PointCloud model before saving.");
      return;
    }

    setSaveStatus("saving");
    try {
      const saves = [];
      const savedTypes = [];
      if (latestBimItem && bimModel) {
        saves.push(saveModelTransform(latestBimItem, "bim", bimModel));
        savedTypes.push("BIM");
      }
      if (latestPointItem && pcModel) {
        saves.push(saveModelTransform(latestPointItem, "point", pcModel));
        savedTypes.push("Point Cloud");
      }

      if (!saves.length) {
        toast.info("Nothing to save — load a model first.");
        setSaveStatus("idle");
        return;
      }

      await Promise.all(saves);
      setSaveStatus("saved");
      // Name exactly which data types had their position/orientation saved.
      toast.success(
        `Saved position & orientation for ${savedTypes.join(" and ")}.`,
      );
    } catch (err) {
      console.error("Failed to save position", err);
      setSaveStatus("error");
      toast.error("Failed to save model position. Please try again.");
    }
  };

  // Explicit, user-initiated: record the current BIM↔PointCloud as a registered
  // alignment pair (with each file's date) so Progress Assessment can pick it.
  const handleSaveAlignmentPair = useCallback(async () => {
    if (!latestBimItem || !latestPointItem) {
      toast.info(
        "Load both a BIM and a Point Cloud to save an alignment pair.",
      );
      return;
    }
    try {
      const res = await API.post("processing/alignment/pair/", {
        project_id: id,
        bim_id: latestBimItem.id,
        pointcloud_id: latestPointItem.id,
        method: "manual",
      });
      const { bim_date, pointcloud_date, created } = res.data || {};
      toast.success(
        `${created ? "Created" : "Updated"} alignment pair — BIM ${
          bim_date || latestBimItem.date || "?"
        } ↔ Point Cloud ${pointcloud_date || latestPointItem.date || "?"}.`,
      );
    } catch (e) {
      console.error("alignment pair save failed", e);
      toast.error(e.response?.data?.error || "Could not save alignment pair.");
    }
  }, [id, latestBimItem, latestPointItem, toast]);

  // Expose to the sidebar "Save Alignment Pair" button.
  useEffect(() => {
    window.saveAlignmentPair = handleSaveAlignmentPair;
    return () => {
      delete window.saveAlignmentPair;
    };
  }, [handleSaveAlignmentPair]);

  // Persist the geolocation a contributor sets via the Map Location panel
  // ("Place Models") back to the project record.
  const handleSaveGeo = async ({
    latitude,
    longitude,
    altitude,
    scale,
    zoom,
    footprint_area,
  }) => {
    try {
      await API.put(`projects/${id}/`, {
        latitude,
        longitude,
        altitude,
        scale,
        zoom,
        footprint_area,
      });
      setProjectGeo({
        latitude,
        longitude,
        altitude,
        scale,
        zoom,
        footprint_area,
      });
      toast.success("Project location saved.");
    } catch (err) {
      console.error("Failed to save project location", err);
      toast.error("Failed to save project location.");
    }
  };

  // -------- MANUAL CAMERAS --------
  const [manualCameras, setManualCameras] = useState([]);
  const [onDeleteManualCamera, setOnDeleteManualCamera] = useState(null);
  const [onToggleManualCamera, setOnToggleManualCamera] = useState(null);

  const handleManualCamerasChange = useCallback(
    ({ manualCameras, onDeleteManualCamera, onToggleManualCamera }) => {
      setManualCameras(manualCameras);
      setOnDeleteManualCamera(() => onDeleteManualCamera);
      setOnToggleManualCamera(() => onToggleManualCamera);
    },
    [],
  );

  // -------- SEGMENTATION --------
  const [toggleSegmentation, setToggleSegmentation] = useState(null);
  const [isSegmented, setIsSegmented] = useState(false);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [wasCompressed, setWasCompressed] = useState(false);

  const handleModelDataChange = useCallback(
    ({ toggleSegmentation, isSegmented, isSegmenting, wasCompressed }) => {
      setToggleSegmentation(() => toggleSegmentation);
      setIsSegmented(isSegmented);
      setIsSegmenting(isSegmenting);
      setWasCompressed(wasCompressed);
    },
    [],
  );

  const [sectionBoxActive, setSectionBoxActive] = useState(false);
  const handleSectionBoxChange = useCallback(({ enabled }) => {
    setSectionBoxActive(enabled);
  }, []);

  // -------- METADATA --------
  // -------- METADATA --------
  const [selectedElement, setSelectedElement] = useState(null);
  const [highlightOverlap, setHighlightOverlap] = useState(false);
  const [bimElementCount, setBimElementCount] = useState(0);
  const [bimCategories, setBimCategories] = useState({}); // NEW
  const [overlapElementCount, setOverlapElementCount] = useState(0);
  const [overlapElementNames, setOverlapElementNames] = useState([]); // NEW

  return (
    <Layout
      sidebarProps={{
        bimFile,
        pointFile,
        setBimFile,
        setPointFile,
        bimVisible,
        pcVisible,
        setBimVisible,
        setPcVisible,
        setCameraPositionsFile,
        setCameraImages,
        showCameras,
        setShowCameras,
        selectedElement,
        highlightOverlap,
        setHighlightOverlap,
        bimElementCount,
        bimCategories, // NEW
        overlapElementCount,
        overlapElementNames, // NEW
        bimPoints,
        pcPoints,
        manualCameras,
        onDeleteManualCamera,
        onToggleManualCamera,
        sectionBoxActive,
        // ── segmentation ──
        toggleSegmentation,
        isSegmented,
        isSegmenting,
        wasCompressed,
      }}
    >
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 20,

            display: "flex",
            alignItems: "center",

            background: "transparent",
            border: "none",
            padding: 0,
            boxShadow: "none",
          }}
        >
          <button
            ref={calBtnRef}
            onClick={() => setCalOpen((o) => !o)}
            title="Pick a date"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,

              padding: "4px 8px",
              borderRadius: 6,

              border: "1px solid #cbd5e1",
              background: calOpen ? "#3b82f6" : "#fff",
              color: calOpen ? "#fff" : "#111827",

              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,

              whiteSpace: "nowrap",
              width: "auto",
              minHeight: 28,
            }}
          >
            <CalendarDays size={12} />
            {selectedDate ? selectedDate : "Pick date"}
          </button>
          {calOpen && (
            <MonthCalendar
              uploadsByDate={uploadsByDate}
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onClose={() => setCalOpen(false)}
              accent="#3b82f6"
              anchorEl={calBtnRef.current}
            />
          )}
        </div>

        <ThreeViewer
          bimFile={bimFile}
          pointFile={pointFile}
          onBimPointsChange={setBimPoints}
          onPcPointsChange={setPcPoints}
          onMatrixChange={setMatrix}
          bimVisible={bimVisible}
          pcVisible={pcVisible}
          cameraPositionsFile={cameraPositionsFile}
          cameraImages={cameraImages}
          uploadedCameraMatrix={uploadedAlignmentMatrix}
          uploadedAlignmentMatrix={uploadedAlignmentMatrix}
          showCameras={showCameras}
          onElementSelect={setSelectedElement}
          highlightOverlap={highlightOverlap}
          setBimElementCount={setBimElementCount}
          setBimCategories={setBimCategories} // NEW
          setOverlapElementCount={setOverlapElementCount}
          setOverlapElementNames={setOverlapElementNames} // NEW
          onManualCamerasChange={handleManualCamerasChange}
          onModelsChanged={({ bimModel, pcModel }) => {
            setBimModel(bimModel);
            setPcModel(pcModel);
          }}
          onSectionBoxChange={handleSectionBoxChange}
          initialLatitude={projectGeo.latitude}
          initialLongitude={projectGeo.longitude}
          initialAltitude={projectGeo.altitude}
          initialScale={projectGeo.scale}
          initialZoom={projectGeo.zoom}
          initialFootprintArea={projectGeo.footprint_area}
          onSavePosition={
            role === "data_contributor" ? handleSavePosition : undefined
          }
          onSaveGeo={role === "data_contributor" ? handleSaveGeo : undefined}
          saveStatus={saveStatus}
          // ── segmentation ──
          onModelDataChange={handleModelDataChange}
        />
      </div>
    </Layout>
  );
}

function MonthCalendar({
  uploadsByDate,
  selectedDate,
  onDateSelect,
  onClose,
  accent,
  anchorEl,
}) {
  const popupRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const dates = Object.keys(uploadsByDate).sort();
  const initialViewMonth = (() => {
    if (selectedDate) {
      const [y, m] = selectedDate.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    if (dates.length) {
      const [y, m] = dates[dates.length - 1].split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  })();

  const [viewMonth, setViewMonth] = useState(initialViewMonth);

  useEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const calH = 280;
    const top =
      rect.bottom + 6 + calH > window.innerHeight
        ? rect.top - calH - 6
        : rect.bottom + 6;
    setPos({ top, left: rect.left });
  }, [anchorEl]);

  useEffect(() => {
    const onDown = (e) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target) &&
        anchorEl &&
        !anchorEl.contains(e.target)
      ) {
        onClose();
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorEl]);

  const year = viewMonth.getFullYear();
  const monthIdx = viewMonth.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDow = (() => {
    const d = new Date(year, monthIdx, 1).getDay();
    return d === 0 ? 6 : d - 1;
  })();

  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const dateKeyForDay = (day) =>
    `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;

  const dateToStr = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const hasUploads = (day) => uploadsByDate[dateKeyForDay(day)];
  const todayStr = dateToStr(new Date());

  return ReactDOM.createPortal(
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.16)",
        padding: "14px 12px 12px",
        width: 260,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <button
          onClick={() =>
            setViewMonth(new Date(year, Math.max(0, monthIdx - 1), 1))
          }
          style={{
            background: "none",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            cursor: "pointer",
            padding: "3px 6px",
            color: "#64748b",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronLeft size={13} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
          {monthLabel}
        </span>
        <button
          onClick={() =>
            setViewMonth(new Date(year, Math.min(11, monthIdx + 1), 1))
          }
          style={{
            background: "none",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            cursor: "pointer",
            padding: "3px 6px",
            color: "#64748b",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
          marginBottom: 8,
          color: "#94a3b8",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} style={{ textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 6,
        }}
      >
        {cells.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} />;
          }
          const dateKey = dateKeyForDay(day);
          const selected = dateKey === selectedDate;
          const dayUploads = uploadsByDate[dateKey];
          const available = Boolean(dayUploads);
          const hasBim = Boolean(dayUploads?.bim?.length);
          const hasPc = Boolean(dayUploads?.pc?.length);
          const isToday = dateKey === todayStr;
          return (
            <button
              key={dateKey}
              onClick={() => available && onDateSelect(dateKey)}
              style={{
                width: "100%",
                minHeight: 32,
                borderRadius: 8,
                border: selected
                  ? `1px solid ${accent}`
                  : "1px solid transparent",
                background: selected
                  ? accent
                  : isToday
                    ? "#eef2ff"
                    : "transparent",
                color: selected ? "#fff" : "#0f172a",
                opacity: available ? 1 : 0.32,
                cursor: available ? "pointer" : "default",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 0",
              }}
              disabled={!available}
            >
              {day}
              {available && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: hasBim ? accent : "transparent",
                      border: hasBim ? "none" : `1px solid ${accent}`,
                    }}
                  />
                  {hasPc && (
                    <span
                      style={{
                        display: "block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: accent,
                      }}
                    />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
