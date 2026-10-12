import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Leaf, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import API from "../../api/axios";
import { useToast } from "../../components/ToastContainer";

const todayStr = () => new Date().toISOString().split("T")[0];

// Same ordering the viewer uses for cameras, so rows line up with the
// camera markers / camera data table there.
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Camera ids are the image NAME tokens of COLMAP images.txt pose lines —
// the same key the viewer's camera markers use (cam.userData.imageName).
function parseCameraNames(text) {
  const names = [];
  let expectingPose = true;
  text.split("\n").forEach((line) => {
    if (!line.trim() || line.startsWith("#")) return;
    if (!expectingPose) {
      expectingPose = true; // skip the POINTS2D line after each pose line
      return;
    }
    const p = line.trim().split(/\s+/);
    if (p.length < 10) return;
    if (!/[A-Za-z]|\.[A-Za-z0-9]+$/.test(p[9])) return;
    names.push(p[9]);
    expectingPose = false;
  });
  return names.sort(naturalCompare);
}

// Pick the camera file for `date`: that day's latest, else any upload that
// day, else the project's overall latest so contributors still get rows.
function pickCameraFile(files, date) {
  const sameDay = files.filter((f) => String(f.date) === date);
  return (
    sameDay.find((f) => f.is_latest) ||
    sameDay[0] ||
    files.find((f) => f.is_latest) ||
    files[0] ||
    null
  );
}

export default function EnvironmentalDataCard({ projectId }) {
  const { error, success } = useToast();

  const [date, setDate] = useState(todayStr());
  const [savedDates, setSavedDates] = useState([]); // [{ id, date }]
  const [recordId, setRecordId] = useState(null);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState({}); // { [cameraId]: { [column]: value } }
  const [cameraFiles, setCameraFiles] = useState([]);
  const [cameraNames, setCameraNames] = useState([]);
  const [cameraSource, setCameraSource] = useState(null);
  const [newColumn, setNewColumn] = useState("");
  const [newCamera, setNewCamera] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchSavedDates = async () => {
    const res = await API.get(`projects/${projectId}/environmental/`);
    setSavedDates(res.data.map(({ id, date: d }) => ({ id, date: d })));
  };

  useEffect(() => {
    if (!projectId) return;
    fetchSavedDates().catch(() => {});
    API.get(`projects/${projectId}/camera/`)
      .then((res) => setCameraFiles(res.data || []))
      .catch(() => setCameraFiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Load the saved dataset for the selected date.
  useEffect(() => {
    if (!projectId || !date) return;
    let cancelled = false;
    setLoading(true);
    API.get(`projects/${projectId}/environmental/`, { params: { date } })
      .then((res) => {
        if (cancelled) return;
        const rec = res.data?.[0];
        setRecordId(rec?.id ?? null);
        setColumns(rec?.columns || []);
        setRows(rec?.rows || {});
        setDirty(false);
      })
      .catch(() => !cancelled && error("Failed to load environmental data."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, date]);

  // Camera ids come from the camera (images.txt) file for the selected date.
  useEffect(() => {
    const file = pickCameraFile(cameraFiles, date);
    setCameraSource(file);
    if (!file?.file) {
      setCameraNames([]);
      return;
    }
    let cancelled = false;
    fetch(new URL(file.file, API.defaults.baseURL).href)
      .then((r) => r.text())
      .then((text) => !cancelled && setCameraNames(parseCameraNames(text)))
      .catch(() => !cancelled && setCameraNames([]));
    return () => {
      cancelled = true;
    };
  }, [cameraFiles, date]);

  // Cameras from the file plus any ids already saved / added by hand.
  const cameraIds = useMemo(() => {
    const ids = new Set(cameraNames);
    Object.keys(rows).forEach((id) => ids.add(id));
    return Array.from(ids).sort(naturalCompare);
  }, [cameraNames, rows]);

  const addColumn = () => {
    const name = newColumn.trim();
    if (!name) return;
    if (columns.includes(name)) {
      error(`Column "${name}" already exists.`);
      return;
    }
    setColumns((prev) => [...prev, name]);
    setNewColumn("");
    setDirty(true);
  };

  const removeColumn = (col) => {
    setColumns((prev) => prev.filter((c) => c !== col));
    setRows((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, vals]) => {
        const { [col]: _removed, ...rest } = vals;
        next[id] = rest;
      });
      return next;
    });
    setDirty(true);
  };

  const addCamera = () => {
    const id = newCamera.trim();
    if (!id) return;
    if (cameraIds.includes(id)) {
      error(`Camera "${id}" already exists.`);
      return;
    }
    setRows((prev) => ({ ...prev, [id]: {} }));
    setNewCamera("");
    setDirty(true);
  };

  const updateCell = (camId, col, value) => {
    setRows((prev) => ({
      ...prev,
      [camId]: { ...(prev[camId] || {}), [col]: value },
    }));
    setDirty(true);
  };

  // Pasting a multi-line column (e.g. from Excel) fills downward.
  const handlePaste = (e, startCamId, col) => {
    const text = e.clipboardData.getData("text");
    const values = text.split(/\r?\n/).filter((v, i, arr) => v !== "" || i < arr.length - 1);
    if (values.length <= 1) return;
    e.preventDefault();
    const start = cameraIds.indexOf(startCamId);
    setRows((prev) => {
      const next = { ...prev };
      values.forEach((raw, i) => {
        const id = cameraIds[start + i];
        if (!id) return;
        next[id] = { ...(next[id] || {}), [col]: raw.split("\t")[0].trim() };
      });
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!columns.length) {
      error("Add at least one column before saving.");
      return;
    }
    // Only keep cells for known columns, and drop fully empty rows.
    const cleanRows = {};
    Object.entries(rows).forEach(([id, vals]) => {
      const kept = {};
      columns.forEach((c) => {
        const v = vals?.[c];
        if (v !== undefined && String(v).trim() !== "") kept[c] = String(v).trim();
      });
      if (Object.keys(kept).length) cleanRows[id] = kept;
    });
    setSaving(true);
    try {
      const res = await API.post(`projects/${projectId}/environmental/`, {
        date,
        columns,
        rows: cleanRows,
      });
      setRecordId(res.data.id);
      setRows(res.data.rows || {});
      setDirty(false);
      await fetchSavedDates();
      success("Environmental data saved.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to save environmental data.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!recordId || !window.confirm(`Delete environmental data for ${date}?`)) return;
    try {
      await API.delete(`environmental/${recordId}/delete/`);
      setRecordId(null);
      setColumns([]);
      setRows({});
      setDirty(false);
      await fetchSavedDates();
      success("Environmental data deleted.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to delete environmental data.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50 rounded-t-xl border-b mb-4">
        <div>
          <CardTitle className="text-lg font-bold text-black">
            Environmental Data
          </CardTitle>
          <p className="text-xs text-gray-600 mt-1 font-medium">
            Per-camera readings, visualised in the 3D viewer's camera data table
          </p>
        </div>
        <div className="flex items-center gap-2">
          {recordId && (
            <Button
              variant="outline"
              onClick={remove}
              className="border-gray-300 text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button
            onClick={save}
            disabled={saving || loading || !projectId}
            className="bg-black hover:bg-gray-900 text-white"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save{dirty ? " *" : ""}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-2 space-y-4">
        {/* Date + saved dates */}
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">Date</span>
            <DatePicker
              date={date ? new Date(date) : undefined}
              onDateChange={(d) => d && setDate(d.toISOString().split("T")[0])}
              className="w-40"
            />
          </div>
          {savedDates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">Saved:</span>
              {savedDates.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setDate(String(s.date))}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    String(s.date) === date
                      ? "bg-black text-white border-black"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {s.date}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500">
          {cameraSource
            ? `Camera IDs from "${cameraSource.batch_name}" camera file (${cameraSource.date})${
                String(cameraSource.date) !== date ? " — no camera file on this date, using latest" : ""
              }.`
            : "No camera file uploaded yet — add camera IDs manually below."}
        </p>

        {/* Add column / camera */}
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            <Input
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addColumn()}
              placeholder="New column (e.g. Temperature °C)"
            />
            <Button variant="outline" onClick={addColumn} className="border-gray-300 shrink-0">
              <Plus className="w-4 h-4 mr-1" /> Column
            </Button>
          </div>
          <div className="flex gap-2 flex-1">
            <Input
              value={newCamera}
              onChange={(e) => setNewCamera(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCamera()}
              placeholder="Camera ID (e.g. DJI_0001.JPG)"
            />
            <Button variant="outline" onClick={addCamera} className="border-gray-300 shrink-0">
              <Plus className="w-4 h-4 mr-1" /> Camera
            </Button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : cameraIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
            <Leaf className="w-10 h-10 text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-700">No cameras yet</p>
            <p className="text-xs text-gray-600 mt-1 text-center max-w-xs">
              Upload a camera file under Images, or add camera IDs above
            </p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-auto max-h-[420px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  <th className="text-left font-semibold text-gray-700 px-3 py-2 border-b border-gray-200 whitespace-nowrap">
                    Camera ID
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="text-left font-semibold text-gray-700 px-2 py-2 border-b border-l border-gray-200 whitespace-nowrap"
                    >
                      <span className="inline-flex items-center gap-1">
                        {col}
                        <button
                          type="button"
                          onClick={() => removeColumn(col)}
                          title={`Remove ${col}`}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cameraIds.map((camId) => (
                  <tr key={camId} className="hover:bg-gray-50/60">
                    <td className="px-3 py-1.5 border-b border-gray-100 font-mono text-gray-800 whitespace-nowrap">
                      {camId}
                    </td>
                    {columns.map((col) => (
                      <td key={col} className="px-1 py-1 border-b border-l border-gray-100">
                        <input
                          value={rows[camId]?.[col] ?? ""}
                          onChange={(e) => updateCell(camId, col, e.target.value)}
                          onPaste={(e) => handlePaste(e, camId, col)}
                          className="w-full min-w-[90px] px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-black focus:outline-none bg-transparent"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {columns.length === 0 && cameraIds.length > 0 && (
          <p className="text-xs text-gray-500">
            Add a column to start entering values. Tip: paste a column from Excel into the first cell to fill downward.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
