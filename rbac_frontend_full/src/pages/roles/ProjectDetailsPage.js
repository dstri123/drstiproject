import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trash2,
  Save,
  Upload,
  Edit2,
  Eye,
  ArrowLeft,
  Image as ImageIcon,
  FileText,
  Cloud,
  Loader2,
} from "lucide-react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import API from "../../api/axios";
import { createProjectSlug } from "@/lib/utils";
import { useToast } from "../../components/ToastContainer";

export default function ProjectDetailsPage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { error, success } = useToast();

  const projectName = location.state?.projectName || "Selected Project";

  const [projectData, setProjectData] = useState(null);
  const [bimRows, setBimRows] = useState([]);
  const [pointRows, setPointRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    type: null,
    rowId: null,
  });
  const [savingRowId, setSavingRowId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    fetchSavedData();
  }, [slug]);

  const fetchSavedData = async () => {
    setLoading(true);
    try {
      const projectsRes = await API.get("projects/");
      const project = projectsRes.data.find((p) => p.slug === slug);

      if (!project) {
        console.error("Project not found with slug:", slug);
        setLoading(false);
        return;
      }

      setProjectData(project);
      setProjectId(project.id);

      const bimRes = await API.get(`projects/${project.id}/bim/`);
      const pointRes = await API.get(`projects/${project.id}/pointcloud/`);

      setBimRows(
        bimRes.data.map((row) => ({
          ...row,
          editable: false,
          isNew: false,
          isLatest: row.is_latest === true,
        })),
      );

      setPointRows(
        pointRes.data.map((row) => ({
          ...row,
          editable: false,
          isNew: false,
          isLatest: row.is_latest === true,
        })),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addRow = (type) => {
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split("T")[0];

    const rows = type === "bim" ? bimRows : pointRows;
    const isFirstRow = rows.length === 0;

    const row = {
      id: Date.now(),
      description: "",
      file: null,
      date: today,
      editable: true,
      isNew: true,
      isLatest: isFirstRow, // Auto-mark as latest if first row
    };

    if (type === "bim") setBimRows((prev) => [...prev, row]);
    else setPointRows((prev) => [...prev, row]);
  };

  const updateRow = (type, rowId, field, value) => {
    const updater = (rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r));

    if (type === "bim") setBimRows(updater);
    else setPointRows(updater);
  };

  const toggleEdit = (type, rowId) => {
    const updater = (rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, editable: !r.editable } : r));

    if (type === "bim") setBimRows(updater);
    else setPointRows(updater);
  };

  const markLatestVersion = async (type, rowId) => {
    const rows = type === "bim" ? bimRows : pointRows;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    if (row.isNew) {
      const updater = (items) =>
        items.map((item) => ({
          ...item,
          isLatest: item.id === rowId,
        }));

      if (type === "bim") setBimRows(updater);
      else setPointRows(updater);
      return;
    }

    try {
      const url =
        type === "bim" ? `bim/${rowId}/update/` : `pointcloud/${rowId}/update/`;
      const res = await API.put(url, { is_latest: true });

      const updater = (items) =>
        items.map((item) => ({
          ...item,
          isLatest: item.id === rowId ? res.data.is_latest : false,
        }));

      if (type === "bim") setBimRows(updater);
      else setPointRows(updater);
    } catch (err) {
      console.error(err.response?.data || err);
      error("Unable to save latest version setting.");
    }
  };

  const saveRow = async (type, row) => {
    try {
      // Validate date format
      if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        error("Please select a valid date (YYYY-MM-DD format)");
        return;
      }

      const formData = new FormData();
      formData.append("description", row.description);
      formData.append("date", row.date);
      if (row.isLatest) {
        formData.append("is_latest", true);
      }

      if (row.file instanceof File) {
        formData.append("file", row.file);
      }

      let url = "";
      let method = "post";

      if (row.isNew) {
        url =
          type === "bim"
            ? `projects/${projectId}/bim/`
            : `projects/${projectId}/pointcloud/`;
      } else {
        url =
          type === "bim"
            ? `bim/${row.id}/update/`
            : `pointcloud/${row.id}/update/`;
        method = "put";
      }

      setSavingRowId(row.id);
      setUploadProgress(0);

      const res = await API({
        method,
        url,
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });

      const savedRow = {
        ...res.data,
        editable: false,
        isNew: false,
        isLatest: res.data.is_latest === true,
      };

      if (type === "bim") {
        setBimRows((prev) => prev.map((r) => (r.id === row.id ? savedRow : r)));
      } else {
        setPointRows((prev) =>
          prev.map((r) => (r.id === row.id ? savedRow : r)),
        );
      }

      success("Saved Successfully");
    } catch (err) {
      console.error(err.response?.data);
      error(JSON.stringify(err.response?.data || "Error occurred"));
    } finally {
      setSavingRowId(null);
      setUploadProgress(0);
    }
  };

  const deleteRow = async (type, rowId) => {
    const isServerRow = String(rowId).length < 10;
    try {
      if (isServerRow) {
        const url =
          type === "bim"
            ? `bim/${rowId}/delete/`
            : type === "point"
              ? `pointcloud/${rowId}/delete/`
              : `images/${rowId}/delete/`;

        await API.delete(url);
      }

      // For server rows, re-fetch so an auto-promoted LATEST shows correctly;
      // for unsaved local rows just drop them from state.
      if (isServerRow) {
        await fetchSavedData();
        success?.("Deleted.");
      } else if (type === "bim") {
        setBimRows((prev) => prev.filter((r) => r.id !== rowId));
      } else if (type === "point") {
        setPointRows((prev) => prev.filter((r) => r.id !== rowId));
      } else {
        setImageRows((prev) => prev.filter((r) => r.id !== rowId));
      }
    } catch (err) {
      console.error(err);
      // Surface the backend's reason (e.g. "Cannot delete the only BIM file…").
      error(err.response?.data?.error || "Delete failed. Please try again.");
    }
  };

  const renderRows = (rows, type) => {
    // A "server row" is one already saved to the DB (short numeric id). The
    // backend refuses to delete the only saved file of a type, so disable the
    // Delete button in that case to make the rule obvious up front.
    const savedCount = rows.filter((r) => String(r.id).length < 10).length;
    return rows.map((row, i) => {
      const isServerRow = String(row.id).length < 10;
      const isOnlyServerRow = isServerRow && savedCount <= 1;
      return (
        <div
          key={row.id}
          className="flex flex-col md:flex-row gap-4 items-center p-4 mb-4 rounded-lg border border-gray-200 bg-white hover:shadow-md transition-all"
        >
          <div className="font-bold text-black text-sm w-8 h-8 text-center bg-gray-200 rounded-full flex items-center justify-center shrink-0">
            {i + 1}
          </div>

          <Input
            className="flex-1"
            disabled={!row.editable}
            value={row.description}
            onChange={(e) =>
              updateRow(type, row.id, "description", e.target.value)
            }
            placeholder="Description"
          />

          <div className="flex-1 relative min-w-[200px]">
            <Button
              variant="outline"
              className="w-full justify-start whitespace-nowrap overflow-hidden text-ellipsis px-4"
              disabled={!row.editable}
              asChild
            >
              <label className="cursor-pointer font-normal flex items-center">
                <Upload className="w-4 h-4 mr-2 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {row.file
                    ? typeof row.file === "string"
                      ? row.file.split("/").pop()
                      : row.file.name
                    : "Upload File"}
                </span>
                <input
                  className="hidden"
                  type="file"
                  disabled={!row.editable}
                  accept={
                    type === "bim"
                      ? ".rvt,.ifc,.dwg,.nwd,.nwc,.fbx"
                      : ".e57,.las,.laz,.pts,.xyz,.ply"
                  }
                  onChange={(e) =>
                    updateRow(type, row.id, "file", e.target.files[0])
                  }
                />
              </label>
            </Button>
          </div>

          <DatePicker
            date={row.date ? new Date(row.date) : undefined}
            onDateChange={(date) =>
              updateRow(
                type,
                row.id,
                "date",
                date ? date.toISOString().split("T")[0] : "",
              )
            }
            disabled={!row.editable}
            placeholder="Pick a date"
            className="w-full md:w-40 shrink-0"
          />

          <div className="flex gap-2 shrink-0 items-center flex-wrap">
            <button
              type="button"
              onClick={() => markLatestVersion(type, row.id)}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 transition-all ${
                row.isLatest
                  ? "bg-green-100 text-green-700 border border-green-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
              }`}
              title="Mark this version as the latest"
            >
              {row.isLatest ? "✓ LATEST" : "Set Latest"}
            </button>

            <Button
              size="sm"
              onClick={() => saveRow(type, row)}
              className="bg-black hover:bg-gray-900 text-white min-w-[96px]"
              title="Save changes"
              disabled={!row.editable || savingRowId === row.id}
            >
              {savingRowId === row.id ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  {row.file instanceof File
                    ? `Uploading ${uploadProgress}%`
                    : "Saving..."}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </>
              )}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => toggleEdit(type, row.id)}
              className="border-gray-300 text-black hover:bg-gray-100"
              title={row.editable ? "Cancel editing" : "Edit this entry"}
            >
              <Edit2 className="w-4 h-4 mr-1" />
              {row.editable ? "Cancel" : "Edit"}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              disabled={isOnlyServerRow}
              onClick={() =>
                setDeleteDialog({ open: true, type, rowId: row.id })
              }
              title={
                isOnlyServerRow
                  ? "Can't delete the only file — use Edit to replace it"
                  : "Delete this entry permanently"
              }
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      );
    });
  };

  const renderImageRows = (rows) => {
    const batches = groupImageBatches(rows);
    const latestBatchName = latestImageBatch || getLatestImageBatchName(rows);

    return batches.map((batch, batchIndex) => {
      const isOpen = openImageBatch === batch.batchName;
      const isLatest = batch.batchName === latestBatchName;

      return (
        <div
          key={`${batch.batchName}-${batchIndex}`}
          className="space-y-2 mb-4"
        >
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-all">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold text-base">{batch.batchName}</div>
              <div className="text-sm text-muted-foreground">
                {batch.items.length} image{batch.items.length !== 1 ? "s" : ""}{" "}
                - {batch.items[0]?.date || "No date"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => markLatestImageBatch(batch.batchName)}
                className={`text-xs font-semibold rounded-full px-3 py-1 transition-all ${
                  isLatest
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
                title="Mark this folder as the latest image set"
              >
                {isLatest ? "LATEST" : "Set latest"}
              </button>

              <Button
                size="icon"
                variant="destructive"
                onClick={() => deleteImageBatch(batch.batchName)}
                title="Delete folder"
              >
                <Trash2 className="w-4 h-4" />
              </Button>

              <button
                type="button"
                onClick={() =>
                  setOpenImageBatch(isOpen ? null : batch.batchName)
                }
                className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-2"
              >
                {isOpen ? "Hide folder" : "Open folder"}
              </button>
            </div>
          </div>

          {isOpen && (
            <div className="space-y-2 ml-0 md:ml-6">
              {batch.items.map((row, i) => (
                <div
                  key={row.id || `${batch.batchName}-${i}`}
                  className="flex flex-col md:flex-row gap-4 items-center p-3 rounded-xl border bg-slate-50 text-card-foreground"
                >
                  <div className="font-bold text-primary text-lg w-8 text-center bg-primary/10 rounded-full h-8 flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-[200px]">
                    <div className="text-sm text-muted-foreground">
                      {row.original_path || row.original_name}
                    </div>
                    <a
                      className="text-blue-600 hover:text-blue-800 break-all"
                      href={row.image}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row.image?.split("/").pop() || "Download Image"}
                    </a>
                  </div>

                  <div className="w-full md:w-40 shrink-0">
                    <div className="text-sm text-muted-foreground">Date</div>
                    <div>{row.date || "—"}</div>
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="icon"
                      variant="destructive"
                      onClick={() => deleteRow("images", row.id)}
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <Loader2 className="w-8 h-8 text-black animate-spin" />
        <p className="text-sm text-gray-500">Loading project data…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto space-y-6">
        {/* Back Button */}
        <Button
          variant="ghost"
          className="flex items-center gap-2 text-black hover:text-gray-700 mb-4"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        {/* Header with Project Info and Cover Image */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Project Info */}
          <div className="lg:col-span-2">
            <div>
              <h1 className="text-3xl font-bold text-black mb-2">
                {projectName}
              </h1>
              <p className="text-gray-600 mb-4">
                Manage BIM, Point Cloud, and Image data for this project
              </p>
              <Button
                className="bg-black hover:bg-gray-900 text-white gap-2"
                onClick={() =>
                  navigate(
                    `/viewer/${createProjectSlug(
                      projectData || {
                        id: projectId,
                        project_name: projectName,
                      },
                    )}`,
                  )
                }
              >
                <Eye className="w-4 h-4" /> Open 3D Viewer
              </Button>
            </div>
          </div>

          {/* Right Column - Cover Image Card */}
          <div className="lg:col-span-1">
            <Card className="h-full overflow-hidden">
              <CardContent className="p-0">
                <div className="h-40 bg-gray-100 flex items-center justify-center rounded-lg">
                  {projectData?.image ? (
                    <img
                      src={
                        projectData.image.startsWith("http")
                          ? projectData.image
                          : `http://127.0.0.1:8000${projectData.image}`
                      }
                      alt={projectName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = "none";
                        e.target.nextSibling?.classList.remove("hidden");
                      }}
                    />
                  ) : null}
                  <div
                    className={`text-center ${projectData?.image ? "hidden" : ""}`}
                  >
                    <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">Project Cover</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50 rounded-t-xl border-b mb-4">
            <div>
              <CardTitle className="text-lg font-bold text-black">
                BIM Data
              </CardTitle>
              <p className="text-xs text-gray-600 mt-1 font-medium">
                Supported formats: RVT, IFC, DWG, NWD, NWC, FBX
              </p>
            </div>
            <Button
              onClick={() => addRow("bim")}
              className="bg-black hover:bg-gray-900 text-white"
            >
              Add BIM File
            </Button>
          </CardHeader>
          <CardContent className="pt-6">
            {bimRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
                <FileText className="w-10 h-10 text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-700">
                  No BIM data available
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Click "Add BIM File" to upload your first BIM model
                </p>
              </div>
            ) : (
              renderRows(bimRows, "bim")
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50 rounded-t-xl border-b mb-4">
            <div>
              <CardTitle className="text-lg font-bold text-black">
                Point Cloud Data
              </CardTitle>
              <p className="text-xs text-gray-600 mt-1 font-medium">
                Supported formats: E57, LAS, LAZ, PTS, XYZ, PLY
              </p>
            </div>
            <Button
              onClick={() => addRow("point")}
              className="bg-black hover:bg-gray-900 text-white"
            >
              Add Point Cloud
            </Button>
          </CardHeader>
          <CardContent className="pt-6">
            {pointRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
                <Cloud className="w-10 h-10 text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-700">
                  No Point Cloud data available
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Click "Add Point Cloud" to upload your first point cloud file
                </p>
              </div>
            ) : (
              renderRows(pointRows, "point")
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50 rounded-t-xl border-b mb-4">
            <div>
              <CardTitle className="text-lg font-bold text-black">
                Images
              </CardTitle>
              <p className="text-xs text-gray-600 mt-1 font-medium">
                Manage project images and photos
              </p>
            </div>
            <Button
              onClick={() =>
                navigate(`/project/${slug}/data/upload-images`, {
                  state: {
                    projectId,
                    projectName: projectData?.project_name || projectName,
                  },
                })
              }
              className="bg-black hover:bg-gray-900 text-white"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Images
            </Button>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
              <ImageIcon className="w-10 h-10 text-gray-400 mb-3" />
              <p className="text-sm font-medium text-gray-700">
                Image uploads managed separately
              </p>
              <p className="text-xs text-gray-600 mt-1 text-center max-w-xs">
                Click "Upload Images" to extract ZIP files, set version toggles,
                and preview all images
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <AlertDialog
          open={deleteDialog.open}
          onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The{" "}
                {deleteDialog.type === "bim"
                  ? "BIM"
                  : deleteDialog.type === "point"
                    ? "Point Cloud"
                    : "image"}{" "}
                entry will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-gray-300">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleteRow(deleteDialog.type, deleteDialog.rowId);
                  setDeleteDialog({ open: false, type: null, rowId: null });
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
