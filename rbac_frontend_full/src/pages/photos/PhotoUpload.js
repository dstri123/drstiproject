import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  Loader2,
  Image as ImageIcon,
  FolderOpen,
  Camera,
  FileJson,
  Star,
  Trash2,
} from "lucide-react";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import API from "../../api/axios";

export default function PhotoUpload() {
  const { slug } = useParams();
  const location = useLocation();
  const projectName = location.state?.projectName || null;
  // NOTE: assumes the page that navigates here passes projectId in location.state.
  // Camera/Matrix/Images endpoints are keyed by the numeric Project id, not the slug.
  const projectId = location.state?.projectId || null;
  const { error, success } = useToast();
  const navigate = useNavigate();

  // Batches ("folders") are derived from the backend's ProjectImage rows,
  // grouped by batch_name — never persisted to localStorage or extracted
  // client-side, since a real photo batch (hundreds of images / gigabytes)
  // will blow past both browser memory and localStorage's ~5-10MB quota.
  const [folders, setFolders] = useState([]);
  const [selectedFolderName, setSelectedFolderName] = useState(null);
  const [currentFolderName, setCurrentFolderName] = useState("");
  const [selectedZipFile, setSelectedZipFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadType, setUploadType] = useState("images");
  const [uploadDate, setUploadDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  // --- Camera / Matrix file state ---
  const [cameraFiles, setCameraFiles] = useState([]);
  const [matrixFiles, setMatrixFiles] = useState([]);
  const [cameraFileToUpload, setCameraFileToUpload] = useState(null);
  const [matrixFileToUpload, setMatrixFileToUpload] = useState(null);
  const [cameraDate, setCameraDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [matrixDate, setMatrixDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [cameraDeleteLoading, setCameraDeleteLoading] = useState(false);
  const [matrixDeleteLoading, setMatrixDeleteLoading] = useState(false);
  const [folderDeleteLoading, setFolderDeleteLoading] = useState(false);
  const [cameraIsLatest, setCameraIsLatest] = useState(true);
  const [matrixIsLatest, setMatrixIsLatest] = useState(true);
  const [uploadingCamera, setUploadingCamera] = useState(false);
  const [uploadingMatrix, setUploadingMatrix] = useState(false);

  const zipRef = useRef(null);

  const fetchImageFolders = async (preferredName) => {
    if (!projectId) {
      setFolders([]);
      return;
    }
    try {
      const res = await API.get(`projects/${projectId}/images/`);
      const rows = Array.isArray(res.data) ? res.data : [];

      const grouped = rows.reduce((map, row) => {
        const key = row.batch_name || "default";
        (map[key] = map[key] || []).push(row);
        return map;
      }, {});

      const batches = Object.entries(grouped).map(([name, items]) => {
        const sorted = [...items].sort((a, b) =>
          (a.original_name || "").localeCompare(b.original_name || ""),
        );
        const latestTimestamp = items.reduce((latest, item) => {
          const t = new Date(item.uploaded_at || item.date || 0).getTime();
          return t > latest ? t : latest;
        }, 0);
        return {
          name,
          images: sorted.map((item) => ({
            id: item.id,
            url: item.image,
            name: item.original_name || item.image?.split("/").pop(),
          })),
          uploadedAt: latestTimestamp
            ? new Date(latestTimestamp).toISOString()
            : null,
        };
      });

      batches.sort(
        (a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0),
      );

      setFolders(batches);
      setSelectedFolderName((prev) => {
        if (preferredName && batches.some((b) => b.name === preferredName)) {
          return preferredName;
        }
        if (prev && batches.some((b) => b.name === prev)) return prev;
        return batches[0]?.name ?? null;
      });
    } catch (err) {
      console.error("Failed to load image folders:", err);
    }
  };

  const refreshCameraAndMatrixFiles = async () => {
    if (!projectId || !selectedFolder) return;
    try {
      const [camRes, matRes] = await Promise.all([
        API.get(`projects/${projectId}/camera/`, {
          params: { batch_name: selectedFolder.name },
        }),
        API.get(`projects/${projectId}/matrix/`, {
          params: { batch_name: selectedFolder.name },
        }),
      ]);
      setCameraFiles(Array.isArray(camRes.data) ? camRes.data : []);
      setMatrixFiles(Array.isArray(matRes.data) ? matRes.data : []);
    } catch (err) {
      console.error("Failed to load camera/matrix files:", err);
    }
  };

  useEffect(() => {
    fetchImageFolders();
  }, [projectId]);

  const selectedFolder = folders.find(
    (folder) => folder.name === selectedFolderName,
  );

  const latestCameraFile =
    cameraFiles.find((file) => file.is_latest) || cameraFiles[0] || null;
  const latestMatrixFile =
    matrixFiles.find((file) => file.is_latest) || matrixFiles[0] || null;

  const deleteCameraFile = async (fileId) => {
    if (!fileId || !projectId) return;
    if (!window.confirm("Delete this camera file?")) return;
    setCameraDeleteLoading(true);
    try {
      await API.delete(`camera/${fileId}/delete/`);
      success("Camera file deleted.");
      await refreshCameraAndMatrixFiles();
    } catch (err) {
      error(err.response?.data?.error || "Failed to delete camera file.");
    } finally {
      setCameraDeleteLoading(false);
    }
  };

  const deleteMatrixFile = async (fileId) => {
    if (!fileId || !projectId) return;
    if (!window.confirm("Delete this matrix file?")) return;
    setMatrixDeleteLoading(true);
    try {
      await API.delete(`matrix/${fileId}/delete/`);
      success("Matrix file deleted.");
      await refreshCameraAndMatrixFiles();
    } catch (err) {
      error(err.response?.data?.error || "Failed to delete matrix file.");
    } finally {
      setMatrixDeleteLoading(false);
    }
  };

  const deleteImageFolder = async () => {
    if (!selectedFolder || !projectId) return;
    if (!window.confirm(`Delete all images in '${selectedFolder.name}'?`))
      return;
    setFolderDeleteLoading(true);
    try {
      await API.delete(`projects/${projectId}/images/`, {
        params: { batch_name: selectedFolder.name },
      });
      success("Image folder deleted.");
      setSelectedFolderName(null);
      await fetchImageFolders();
      setCameraFiles([]);
      setMatrixFiles([]);
    } catch (err) {
      error(err.response?.data?.error || "Failed to delete image folder.");
    } finally {
      setFolderDeleteLoading(false);
    }
  };

  // --- Fetch camera/matrix file history whenever the selected folder changes ---
  useEffect(() => {
    if (!projectId || !selectedFolder) {
      setCameraFiles([]);
      setMatrixFiles([]);
      return;
    }

    refreshCameraAndMatrixFiles();
  }, [projectId, selectedFolder?.name]);

  const selectFolder = (folderName) => {
    setSelectedFolderName(folderName);
  };

  const handleZipSelection = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedZipFile(file);
    setCurrentFolderName(file.name.replace(/\.zip$/i, ""));
  };

  // Streams the selected ZIP straight to the backend, which extracts it and
  // creates one ProjectImage row per photo. Nothing is parsed or held in
  // browser memory client-side — safe for archives with hundreds of images.
  const uploadZip = async (batchName) => {
    if (!selectedZipFile) return true;
    if (!projectId) {
      error("No project selected. Cannot save images to the database.");
      return false;
    }

    try {
      const formData = new FormData();
      formData.append("zip_file", selectedZipFile);
      formData.append("date", uploadDate);
      formData.append("batch_name", batchName);

      await API.post(`projects/${projectId}/images/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (zipRef.current) zipRef.current.value = null;
      setSelectedZipFile(null);
      return true;
    } catch (err) {
      error(err.response?.data?.zip_file?.[0] || "Failed to upload ZIP file.");
      return false;
    }
  };

  const handleZipUpload = async () => {
    if (!selectedZipFile) {
      error("Please choose a ZIP file to upload.");
      return;
    }
    if (!projectId) {
      error("No project selected. Cannot save images to the database.");
      return;
    }

    setUploading(true);
    const resolvedName =
      currentFolderName.trim() || selectedZipFile.name.replace(/\.zip$/i, "");

    try {
      const saved = await uploadZip(resolvedName);
      if (!saved) return;

      setCurrentFolderName("");
      setSuccessMessage("ZIP uploaded and saved to the database");
      setTimeout(() => setSuccessMessage(""), 3000);

      await fetchImageFolders(resolvedName);
    } finally {
      setUploading(false);
    }
  };

  // --- Camera / Matrix upload handlers ---

  // Core matrix upload, shared by the standalone button and the camera cascade below.
  const uploadMatrixFile = async () => {
    if (!matrixFileToUpload) return true;
    if (!projectId || !selectedFolder) {
      error("No project or folder selected.");
      return false;
    }

    setUploadingMatrix(true);
    try {
      const formData = new FormData();
      formData.append("file", matrixFileToUpload);
      formData.append("batch_name", selectedFolder.name);
      formData.append("date", matrixDate);
      formData.append("is_latest", matrixIsLatest);

      const res = await API.post(`projects/${projectId}/matrix/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setMatrixFiles((prev) => {
        const updated = matrixIsLatest
          ? prev.map((f) => ({ ...f, is_latest: false }))
          : prev;
        return [res.data, ...updated];
      });
      setMatrixFileToUpload(null);
      success("Matrix file uploaded successfully!");
      return true;
    } catch (err) {
      error(err.response?.data?.file?.[0] || "Failed to upload matrix file");
      return false;
    } finally {
      setUploadingMatrix(false);
    }
  };

  const handleUploadCameraFile = async () => {
    if (!cameraFileToUpload) {
      error("Please choose a .txt camera file.");
      return;
    }
    if (!projectId || !selectedFolder) {
      error("No project or folder selected.");
      return;
    }

    setUploadingCamera(true);
    try {
      const formData = new FormData();
      formData.append("file", cameraFileToUpload);
      formData.append("batch_name", selectedFolder.name);
      formData.append("date", cameraDate);
      formData.append("is_latest", cameraIsLatest);

      const res = await API.post(`projects/${projectId}/camera/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setCameraFiles((prev) => {
        const updated = cameraIsLatest
          ? prev.map((f) => ({ ...f, is_latest: false }))
          : prev;
        return [res.data, ...updated];
      });
      setCameraFileToUpload(null);
      success("Camera file uploaded successfully!");

      // Bring along whatever's still staged for this batch, then jump to the viewer.
      await uploadZip(selectedFolder.name);
      await uploadMatrixFile();
      navigate(`/viewer/${slug || projectId}`);
    } catch (err) {
      error(err.response?.data?.file?.[0] || "Failed to upload camera file");
    } finally {
      setUploadingCamera(false);
    }
  };

  const handleUploadMatrixFile = async () => {
    if (!matrixFileToUpload) {
      error("Please choose a .json matrix file.");
      return;
    }
    if (!projectId || !selectedFolder) {
      error("No project or folder selected.");
      return;
    }
    await uploadMatrixFile();
  };

  const previewName =
    currentFolderName.trim() ||
    selectedZipFile?.name.replace(/\.zip$/i, "") ||
    "";

  return (
    <>
      <Topbar />
      <div className="min-h-screen bg-white">
        <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto space-y-6">
          {/* Back Button */}
          <Button
            variant="ghost"
            className="flex items-center gap-2 text-black hover:text-gray-700 mb-4"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">
              {projectName ? `Upload Images - ${projectName}` : "Upload Images"}
            </h1>
            <p className="text-sm text-gray-600">
              Upload a ZIP file — images are extracted and stored server-side
            </p>
          </div>

          {/* Success Message */}
          {successMessage && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-3 mb-4">
              <p className="text-xs text-green-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {successMessage}
              </p>
            </div>
          )}

          {/* Upload Card */}
          <Card>
            <CardHeader className="bg-slate-50/50 rounded-t-xl border-b mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-bold text-black">
                    Upload ZIP Archive
                  </CardTitle>
                  <p className="text-xs text-gray-600 mt-2">
                    {uploadType === "images" &&
                      "Select a ZIP file containing your images"}
                    {uploadType === "bim" &&
                      "Select a ZIP file containing your BIM data"}
                    {uploadType === "pointcloud" &&
                      "Select a ZIP file containing your point cloud data"}
                  </p>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                    uploadType === "images"
                      ? "bg-blue-100 text-blue-700"
                      : uploadType === "bim"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-cyan-100 text-cyan-700"
                  }`}
                >
                  {uploadType === "images"
                    ? "📸 Images"
                    : uploadType === "bim"
                      ? "🏗️ BIM"
                      : "☁️ Point Cloud"}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="upload_date"
                    className="text-sm font-semibold text-black"
                  >
                    Date
                  </Label>
                  <input
                    id="upload_date"
                    type="date"
                    value={uploadDate}
                    onChange={(e) => setUploadDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                  />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="folder_name"
                    className="text-sm font-semibold text-black"
                  >
                    Folder Name
                  </Label>
                  <Input
                    id="folder_name"
                    value={currentFolderName}
                    onChange={(e) => setCurrentFolderName(e.target.value)}
                    disabled={uploading}
                    placeholder="Optional custom folder name"
                    className="text-sm border-gray-300"
                  />
                  {previewName && (
                    <p className="text-xs text-gray-600">
                      Will be saved as: <strong>{previewName}</strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-black">
                  Choose ZIP File
                </Label>
                <div className="flex gap-3 items-end">
                  <label className="flex-1">
                    <Button
                      type="button"
                      className="w-full bg-black hover:bg-gray-900 text-white"
                      asChild
                    >
                      <span className="cursor-pointer flex items-center justify-center gap-2">
                        <Upload className="w-4 h-4" />
                        Select ZIP File
                      </span>
                    </Button>
                    <input
                      ref={zipRef}
                      type="file"
                      accept=".zip"
                      onChange={handleZipSelection}
                      className="hidden"
                    />
                  </label>
                  <Button
                    onClick={handleZipUpload}
                    disabled={!selectedZipFile || uploading}
                    className="bg-black hover:bg-gray-900 text-white"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      "Extract & Upload"
                    )}
                  </Button>
                </div>
              </div>

              {selectedZipFile && (
                <p className="text-xs text-gray-600 mt-2">
                  Selected: {selectedZipFile.name}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Folders List */}
          {folders.length > 0 && (
            <Card>
              <CardHeader className="bg-slate-50/50 rounded-t-xl border-b mb-4">
                <CardTitle className="text-lg font-bold text-black">
                  Uploaded Folders ({folders.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-2">
                  {folders.map((folder) => (
                    <button
                      key={folder.name}
                      type="button"
                      onClick={() => selectFolder(folder.name)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        folder.name === selectedFolderName
                          ? "bg-black text-white border border-black"
                          : "bg-gray-100 text-black border border-gray-300 hover:bg-gray-200"
                      }`}
                    >
                      <FolderOpen className="w-4 h-4 inline mr-2" />
                      {folder.name}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Folder Details */}
          {selectedFolder && (
            <Card>
              <CardHeader className="bg-slate-50/50 rounded-t-xl border-b mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-bold text-black">
                      {selectedFolder.name}
                    </CardTitle>
                    <p className="text-xs text-gray-600 mt-1">
                      Uploaded:{" "}
                      {selectedFolder.uploadedAt
                        ? new Date(selectedFolder.uploadedAt).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {folders[0]?.name === selectedFolder.name && (
                      <div className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300">
                        ✓ MOST RECENT
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={deleteImageFolder}
                      disabled={folderDeleteLoading}
                      className="px-2 py-1 text-[10px] text-gray-700 bg-gray-100 border border-gray-200 hover:bg-gray-200"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {selectedFolder.images.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
                    <ImageIcon className="w-10 h-10 text-gray-400 mb-3" />
                    <p className="text-sm font-medium text-gray-700">
                      No images found
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      This folder contains no images
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-black mb-4">
                      {selectedFolder.images.length} image(s)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      {selectedFolder.images.map((image) => (
                        <div
                          key={image.id}
                          className="rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-shadow"
                        >
                          <img
                            src={image.url}
                            alt={image.name}
                            loading="lazy"
                            className="w-full h-32 object-cover"
                            title={image.name}
                          />
                          <div className="p-2 bg-white">
                            <p
                              className="text-xs text-gray-700 truncate"
                              title={image.name}
                            >
                              {image.name}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Camera File / Matrix File Section */}
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Camera File */}
                  <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Camera className="w-4 h-4 text-gray-600" />
                      <h4 className="text-sm font-semibold text-black">
                        Camera File (.txt)
                      </h4>
                    </div>

                    <div className="space-y-2">
                      <input
                        type="file"
                        accept=".txt"
                        onChange={(e) =>
                          setCameraFileToUpload(e.target.files?.[0] || null)
                        }
                        className="block w-full text-xs text-gray-600"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={cameraDate}
                          onChange={(e) => setCameraDate(e.target.value)}
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                        />
                        <label className="flex items-center gap-1 text-xs text-black whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={cameraIsLatest}
                            onChange={(e) =>
                              setCameraIsLatest(e.target.checked)
                            }
                          />
                          Latest
                        </label>
                      </div>
                      <Button
                        onClick={handleUploadCameraFile}
                        disabled={uploadingCamera}
                        className="w-full bg-black hover:bg-gray-900 text-white text-xs py-1.5"
                      >
                        {uploadingCamera
                          ? "Uploading..."
                          : "Upload Camera File"}
                      </Button>
                    </div>

                    {cameraFiles.length > 0 && (
                      <div className="border-t border-gray-200 pt-2 space-y-2 max-h-40 overflow-y-auto">
                        {latestCameraFile && (
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex-1 min-w-0">
                              <a
                                href={latestCameraFile.file}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gray-700 truncate hover:underline"
                                title={latestCameraFile.file}
                              >
                                {latestCameraFile.file.split("/").pop()}
                              </a>
                              <p className="text-[10px] text-gray-500 mt-1">
                                Latest uploaded file
                              </p>
                            </div>
                            <div className="flex items-center gap-2 ml-2 whitespace-nowrap">
                              <span className="text-gray-500">
                                {latestCameraFile.date}
                              </span>
                              <Star className="w-3 h-3 text-green-600 fill-green-600" />
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  deleteCameraFile(latestCameraFile.id)
                                }
                                disabled={cameraDeleteLoading}
                                className="px-2 py-1 text-[10px] text-gray-700 bg-gray-100 border border-gray-200 hover:bg-gray-200"
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        )}
                        {cameraFiles
                          .filter((f) => f.id !== latestCameraFile?.id)
                          .map((f) => (
                            <div
                              key={f.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <a
                                href={f.file}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gray-700 truncate hover:underline"
                                title={f.file}
                              >
                                {f.file.split("/").pop()}
                              </a>
                              <div className="flex items-center gap-1 whitespace-nowrap ml-2">
                                <span className="text-gray-500">{f.date}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Matrix File */}
                  <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileJson className="w-4 h-4 text-gray-600" />
                      <h4 className="text-sm font-semibold text-black">
                        Matrix File (.json)
                      </h4>
                    </div>

                    <div className="space-y-2">
                      <input
                        type="file"
                        accept=".json"
                        onChange={(e) =>
                          setMatrixFileToUpload(e.target.files?.[0] || null)
                        }
                        className="block w-full text-xs text-gray-600"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={matrixDate}
                          onChange={(e) => setMatrixDate(e.target.value)}
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                        />
                        <label className="flex items-center gap-1 text-xs text-black whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={matrixIsLatest}
                            onChange={(e) =>
                              setMatrixIsLatest(e.target.checked)
                            }
                          />
                          Latest
                        </label>
                      </div>
                      <Button
                        onClick={handleUploadMatrixFile}
                        disabled={uploadingMatrix}
                        className="w-full bg-black hover:bg-gray-900 text-white text-xs py-1.5"
                      >
                        {uploadingMatrix
                          ? "Uploading..."
                          : "Upload Matrix File"}
                      </Button>
                    </div>

                    {matrixFiles.length > 0 && (
                      <div className="border-t border-gray-200 pt-2 space-y-2 max-h-40 overflow-y-auto">
                        {latestMatrixFile && (
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex-1 min-w-0">
                              <a
                                href={latestMatrixFile.file}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gray-700 truncate hover:underline"
                                title={latestMatrixFile.file}
                              >
                                {latestMatrixFile.file.split("/").pop()}
                              </a>
                              <p className="text-[10px] text-gray-500 mt-1">
                                Latest uploaded file
                              </p>
                            </div>
                            <div className="flex items-center gap-2 ml-2 whitespace-nowrap">
                              <span className="text-gray-500">
                                {latestMatrixFile.date}
                              </span>
                              <Star className="w-3 h-3 text-green-600 fill-green-600" />
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  deleteMatrixFile(latestMatrixFile.id)
                                }
                                disabled={matrixDeleteLoading}
                                className="px-2 py-1 text-[10px] text-gray-700 bg-gray-100 border border-gray-200 hover:bg-gray-200"
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        )}
                        {matrixFiles
                          .filter((f) => f.id !== latestMatrixFile?.id)
                          .map((f) => (
                            <div
                              key={f.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <a
                                href={f.file}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gray-700 truncate hover:underline"
                                title={f.file}
                              >
                                {f.file.split("/").pop()}
                              </a>
                              <div className="flex items-center gap-1 whitespace-nowrap ml-2">
                                <span className="text-gray-500">{f.date}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {folders.length === 0 && (
            <Card>
              <CardContent className="pt-12 pb-12">
                <div className="flex flex-col items-center justify-center">
                  <ImageIcon className="w-12 h-12 text-gray-400 mb-4" />
                  <p className="text-base font-medium text-gray-700 mb-2">
                    No images uploaded yet
                  </p>
                  <p className="text-sm text-gray-600 text-center max-w-sm">
                    Upload a ZIP file containing your project images to get
                    started
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
