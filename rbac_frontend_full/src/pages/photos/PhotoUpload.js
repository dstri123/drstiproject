// import React, { useState, useRef, useEffect } from "react";
// import JSZip from "jszip";
// import { useNavigate, useParams, useLocation } from "react-router-dom";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2, Image as ImageIcon, FolderOpen } from "lucide-react";
// import Topbar from "../../layouts/Topbar";
// import { useToast } from "../../components/ToastContainer";

// export default function PhotoUpload() {
//   const { slug } = useParams();
//   const location = useLocation();
//   const projectName = location.state?.projectName || null;
//   const storageKey = slug ? `photoFolders:${slug}` : "photoFolders";
//   const { error, success } = useToast();
//   const navigate = useNavigate();

//   const [folders, setFolders] = useState([]);
//   const [selectedFolderId, setSelectedFolderId] = useState(null);
//   const [currentFolderName, setCurrentFolderName] = useState("");
//   const [folderName, setFolderName] = useState("");
//   const [selectedZipFile, setSelectedZipFile] = useState(null);
//   const [isLatest, setIsLatest] = useState(true);
//   const [images, setImages] = useState([]);
//   const [uploadedAt, setUploadedAt] = useState(null);
//   const [detailsEditable, setDetailsEditable] = useState(true);
//   const [uploading, setUploading] = useState(false);
//   const [successMessage, setSuccessMessage] = useState("");
//   const [uploadType, setUploadType] = useState("images");
//   const [uploadDate, setUploadDate] = useState(new Date().toISOString().split('T')[0]);

//   const zipRef = useRef(null);

//   useEffect(() => {
//     const raw = localStorage.getItem(storageKey);
//     const existing = raw ? JSON.parse(raw) : [];
//     setFolders(existing);
//     setSelectedFolderId(existing[0]?.id ?? null);
//   }, [storageKey]);

//   useEffect(() => {
//     const selected = folders.find((folder) => folder.id === selectedFolderId);
//     if (selected) {
//       setFolderName(selected.name);
//       setCurrentFolderName(selected.name);
//       setIsLatest(selected.isLatest ?? true);
//       setImages(selected.images || []);
//       setUploadedAt(selected.uploadedAt || null);
//       setDetailsEditable(false);
//     } else if (selectedFolderId === null || folders.length === 0) {
//       setFolderName("");
//       setCurrentFolderName("");
//       setIsLatest(true);
//       setImages([]);
//       setUploadedAt(null);
//       setDetailsEditable(true);
//     }
//   }, [folders, selectedFolderId]);

//   const saveFolderDetails = () => {
//     if (!selectedFolderId) return;
//     const updatedFolders = folders.map((folder) => ({
//       ...folder,
//       isLatest:
//         folder.id === selectedFolderId
//           ? isLatest
//           : isLatest ? false : folder.isLatest,
//       name:
//         folder.id === selectedFolderId
//           ? currentFolderName.trim() || folder.name
//           : folder.name,
//     }));
//     localStorage.setItem(storageKey, JSON.stringify(updatedFolders));
//     setFolders(updatedFolders);
//     setFolderName(
//       currentFolderName.trim() ||
//         folders.find((f) => f.id === selectedFolderId)?.name ||
//         ""
//     );
//     setDetailsEditable(false);
//     setSuccessMessage("Folder details saved successfully");
//     setTimeout(() => setSuccessMessage(""), 3000);
//   };

//   const selectFolder = (folderId) => {
//     setSelectedFolderId(folderId);
//     setDetailsEditable(false);
//   };

//   const handleZipSelection = (e) => {
//     const file = e.target.files?.[0];
//     if (!file) return;
//     setSelectedZipFile(file);
//     setCurrentFolderName(file.name.replace(/\.zip$/i, ""));
//     setDetailsEditable(true);
//   };

//   const handleZipUpload = async () => {
//     if (!selectedZipFile) {
//       error("Please choose a ZIP file to upload.");
//       return;
//     }

//     setUploading(true);
//     const resolvedName =
//       currentFolderName.trim() || selectedZipFile.name.replace(/\.zip$/i, "");
//     const z = new JSZip();

//     try {
//       const data = await selectedZipFile.arrayBuffer();
//       const loaded = await z.loadAsync(data);
//       const imgs = [];
//       const fileNames = Object.keys(loaded.files).sort();

//       for (const fname of fileNames) {
//         const entry = loaded.files[fname];
//         if (entry.dir) continue;
//         if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(fname)) continue;
//         const blob = await entry.async("blob");
//         const url = await new Promise((resolve, reject) => {
//           const reader = new FileReader();
//           reader.onloadend = () => resolve(reader.result);
//           reader.onerror = reject;
//           reader.readAsDataURL(blob);
//         });
//         imgs.push({ name: fname, url });
//       }

//       const newFolder = {
//         id: Date.now(),
//         name: resolvedName,
//         images: imgs,
//         isLatest: !!isLatest,
//         uploadedAt: new Date().toISOString(),
//       };

//       const raw = localStorage.getItem(storageKey);
//       const existing = raw ? JSON.parse(raw) : [];
//       const updated = existing.map((f) => ({
//         ...f,
//         isLatest: isLatest ? false : f.isLatest,
//       }));
//       updated.unshift(newFolder);
//       localStorage.setItem(storageKey, JSON.stringify(updated));

//       setFolders(updated);
//       setSelectedFolderId(newFolder.id);
//       setFolderName(resolvedName);
//       setImages(imgs);
//       setUploadedAt(newFolder.uploadedAt);
//       setCurrentFolderName(resolvedName);
//       setDetailsEditable(false);
//       setSuccessMessage(`Successfully extracted ${imgs.length} image(s)`);
//       setTimeout(() => setSuccessMessage(""), 3000);

//       if (zipRef.current) zipRef.current.value = null;
//       setSelectedZipFile(null);
//     } catch (err) {
//       console.error("Failed to extract zip", err);
//       alert("Failed to extract ZIP file. Check the file and try again.");
//     } finally {
//       setUploading(false);
//     }
//   };

//   const selectedFolder = folders.find(
//     (folder) => folder.id === selectedFolderId
//   );

//   return (
//     <>
//       <Topbar />
//       <div className="min-h-screen bg-white">
//         <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto space-y-6">
//           {/* Back Button */}
//           <Button
//             variant="ghost"
//             className="flex items-center gap-2 text-black hover:text-gray-700 mb-4"
//             onClick={() => navigate(-1)}
//           >
//             <ArrowLeft className="w-4 h-4" />
//             Back
//           </Button>

//           {/* Header */}
//           <div className="mb-8">
//             <h1 className="text-3xl font-bold text-black mb-1">
//               {projectName ? `Upload Images - ${projectName}` : "Upload Images"}
//             </h1>
//             <p className="text-sm text-gray-600">
//               Extract ZIP files and preview all images
//             </p>
//           </div>

//           {/* Success Message */}
//           {successMessage && (
//             <div className="rounded-lg border border-green-300 bg-green-50 p-3 mb-4">
//               <p className="text-xs text-green-900 flex items-center gap-2">
//                 <CheckCircle2 className="w-4 h-4" />
//                 {successMessage}
//               </p>
//             </div>
//           )}

//           {/* Upload Card */}
//           <Card>
//             <CardHeader className="bg-slate-50/50 rounded-t-xl border-b mb-4">
//               <div className="flex items-center justify-between">
//                 <div>
//                   <CardTitle className="text-lg font-bold text-black">
//                     Upload ZIP Archive
//                   </CardTitle>
//                   <p className="text-xs text-gray-600 mt-2">
//                     {uploadType === "images" && "Select a ZIP file containing your images"}
//                     {uploadType === "bim" && "Select a ZIP file containing your BIM data"}
//                     {uploadType === "pointcloud" && "Select a ZIP file containing your point cloud data"}
//                   </p>
//                 </div>
//                 <div className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
//                   uploadType === "images" ? "bg-blue-100 text-blue-700" :
//                   uploadType === "bim" ? "bg-purple-100 text-purple-700" :
//                   "bg-cyan-100 text-cyan-700"
//                 }`}>
//                   {uploadType === "images" ? "📸 Images" :
//                    uploadType === "bim" ? "🏗️ BIM" :
//                    "☁️ Point Cloud"}
//                 </div>
//               </div>
//             </CardHeader>
//             <CardContent className="pt-6 space-y-4">
//               <div className="grid grid-cols-2 gap-4">
//                 <div className="space-y-2">
//                   <Label htmlFor="upload_date" className="text-sm font-semibold text-black">
//                     Date
//                   </Label>
//                   <input
//                     id="upload_date"
//                     type="date"
//                     value={uploadDate}
//                     onChange={(e) => setUploadDate(e.target.value)}
//                     className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
//                   />
//                 </div>

//                 <div className="space-y-2">
//                   <Label htmlFor="folder_name" className="text-sm font-semibold text-black">
//                     Folder Name
//                   </Label>
//                   <Input
//                     id="folder_name"
//                     value={currentFolderName}
//                     onChange={(e) => setCurrentFolderName(e.target.value)}
//                     disabled={!detailsEditable && images.length > 0}
//                     placeholder="Optional custom folder name"
//                     className="text-sm border-gray-300"
//                   />
//                   {folderName && (
//                     <p className="text-xs text-gray-600">
//                       Will be saved as: <strong>{folderName}</strong>
//                     </p>
//                   )}
//                 </div>
//               </div>

//               <div className="grid grid-cols-2 gap-4">
//                 <div className="space-y-2">
//                   <Label className="text-sm font-semibold text-black">
//                     Choose ZIP File
//                   </Label>
//                   <div className="flex gap-3 items-end">
//                     <label className="flex-1">
//                       <Button
//                         type="button"
//                         className="w-full bg-black hover:bg-gray-900 text-white"
//                         asChild
//                       >
//                         <span className="cursor-pointer flex items-center justify-center gap-2">
//                           <Upload className="w-4 h-4" />
//                           Select ZIP File
//                         </span>
//                       </Button>
//                       <input
//                         ref={zipRef}
//                         type="file"
//                         accept=".zip"
//                         onChange={handleZipSelection}
//                         className="hidden"
//                       />
//                     </label>
//                     <Button
//                       onClick={handleZipUpload}
//                       disabled={!selectedZipFile || uploading}
//                       className="bg-black hover:bg-gray-900 text-white"
//                     >
//                       {uploading ? (
//                         <>
//                           <Loader2 className="w-4 h-4 mr-2 animate-spin" />
//                           Processing...
//                         </>
//                       ) : (
//                         "Extract & Upload"
//                       )}
//                     </Button>
//                   </div>
//                 </div>

//                 <div className="space-y-2">
//                   <Label className="text-sm font-semibold text-black">
//                     Version
//                   </Label>
//                   <div className="flex items-center gap-2 pt-2">
//                     <input
//                       type="checkbox"
//                       id="latest_version"
//                       checked={isLatest}
//                       disabled={!detailsEditable && images.length > 0}
//                       onChange={(e) => setIsLatest(e.target.checked)}
//                       className="w-4 h-4 cursor-pointer"
//                     />
//                     <Label htmlFor="latest_version" className="text-sm text-black cursor-pointer">
//                       Set as latest version
//                     </Label>
//                   </div>
//                 </div>
//               </div>

//               {selectedZipFile && (
//                 <p className="text-xs text-gray-600 mt-2">
//                   Selected: {selectedZipFile.name}
//                 </p>
//               )}

//               {detailsEditable && images.length > 0 && (
//                 <Button
//                   onClick={saveFolderDetails}
//                   className="w-full bg-black hover:bg-gray-900 text-white"
//                 >
//                   Save Folder Details
//                 </Button>
//               )}
//             </CardContent>
//           </Card>

//           {/* Folders List */}
//           {folders.length > 0 && (
//             <Card>
//               <CardHeader className="bg-slate-50/50 rounded-t-xl border-b mb-4">
//                 <CardTitle className="text-lg font-bold text-black">
//                   Uploaded Folders ({folders.length})
//                 </CardTitle>
//               </CardHeader>
//               <CardContent className="pt-6">
//                 <div className="flex flex-wrap gap-2">
//                   {folders.map((folder) => (
//                     <button
//                       key={folder.id}
//                       type="button"
//                       onClick={() => selectFolder(folder.id)}
//                       className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
//                         folder.id === selectedFolderId
//                           ? "bg-black text-white border border-black"
//                           : "bg-gray-100 text-black border border-gray-300 hover:bg-gray-200"
//                       }`}
//                     >
//                       <FolderOpen className="w-4 h-4 inline mr-2" />
//                       {folder.name}
//                     </button>
//                   ))}
//                 </div>
//               </CardContent>
//             </Card>
//           )}

//           {/* Folder Details */}
//           {selectedFolder && (
//             <Card>
//               <CardHeader className="bg-slate-50/50 rounded-t-xl border-b mb-4">
//                 <div className="flex items-center justify-between">
//                   <div>
//                     <CardTitle className="text-lg font-bold text-black">
//                       {selectedFolder.name}
//                     </CardTitle>
//                     <p className="text-xs text-gray-600 mt-1">
//                       Uploaded: {new Date(selectedFolder.uploadedAt).toLocaleString()}
//                     </p>
//                   </div>
//                   <div
//                     className={`px-3 py-1 rounded-full text-xs font-semibold ${
//                       selectedFolder.isLatest
//                         ? "bg-green-100 text-green-700 border border-green-300"
//                         : "bg-gray-100 text-gray-700 border border-gray-300"
//                     }`}
//                   >
//                     {selectedFolder.isLatest ? "✓ LATEST" : "Not Latest"}
//                   </div>
//                 </div>
//               </CardHeader>
//               <CardContent className="pt-6">
//                 {selectedFolder.images.length === 0 ? (
//                   <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
//                     <ImageIcon className="w-10 h-10 text-gray-400 mb-3" />
//                     <p className="text-sm font-medium text-gray-700">No images found</p>
//                     <p className="text-xs text-gray-600 mt-1">This folder contains no images</p>
//                   </div>
//                 ) : (
//                   <div>
//                     <p className="text-sm font-medium text-black mb-4">
//                       {selectedFolder.images.length} image(s)
//                     </p>
//                     <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
//                       {selectedFolder.images.map((image) => (
//                         <div
//                           key={image.url}
//                           className="rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-shadow"
//                         >
//                           <img
//                             src={image.url}
//                             alt={image.name}
//                             className="w-full h-32 object-cover"
//                             title={image.name}
//                           />
//                           <div className="p-2 bg-white">
//                             <p className="text-xs text-gray-700 truncate" title={image.name}>
//                               {image.name}
//                             </p>
//                           </div>
//                         </div>
//                       ))}
//                     </div>
//                   </div>
//                 )}
//               </CardContent>
//             </Card>
//           )}

//           {/* Empty State */}
//           {folders.length === 0 && (
//             <Card>
//               <CardContent className="pt-12 pb-12">
//                 <div className="flex flex-col items-center justify-center">
//                   <ImageIcon className="w-12 h-12 text-gray-400 mb-4" />
//                   <p className="text-base font-medium text-gray-700 mb-2">
//                     No images uploaded yet
//                   </p>
//                   <p className="text-sm text-gray-600 text-center max-w-sm">
//                     Upload a ZIP file containing your project images to get started
//                   </p>
//                 </div>
//               </CardContent>
//             </Card>
//           )}
//         </div>
//       </div>
//     </>
//   );
// }

import React, { useState, useRef, useEffect } from "react";
import JSZip from "jszip";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  FolderOpen,
  Camera,
  FileJson,
  Star,
} from "lucide-react";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import API from "../../api/axios";

export default function PhotoUpload() {
  const { slug } = useParams();
  const location = useLocation();
  const projectName = location.state?.projectName || null;
  // NOTE: assumes the page that navigates here passes projectId in location.state.
  // Camera/Matrix endpoints are keyed by the numeric Project id, not the slug.
  const projectId = location.state?.projectId || null;
  const storageKey = slug ? `photoFolders:${slug}` : "photoFolders";
  const { error, success } = useToast();
  const navigate = useNavigate();

  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [currentFolderName, setCurrentFolderName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [selectedZipFile, setSelectedZipFile] = useState(null);
  const [isLatest, setIsLatest] = useState(true);
  const [images, setImages] = useState([]);
  const [uploadedAt, setUploadedAt] = useState(null);
  const [detailsEditable, setDetailsEditable] = useState(true);
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
  const [cameraIsLatest, setCameraIsLatest] = useState(true);
  const [matrixIsLatest, setMatrixIsLatest] = useState(true);
  const [uploadingCamera, setUploadingCamera] = useState(false);
  const [uploadingMatrix, setUploadingMatrix] = useState(false);

  const zipRef = useRef(null);

  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    const existing = raw ? JSON.parse(raw) : [];
    setFolders(existing);
    setSelectedFolderId(existing[0]?.id ?? null);
  }, [storageKey]);

  useEffect(() => {
    const selected = folders.find((folder) => folder.id === selectedFolderId);
    if (selected) {
      setFolderName(selected.name);
      setCurrentFolderName(selected.name);
      setIsLatest(selected.isLatest ?? true);
      setImages(selected.images || []);
      setUploadedAt(selected.uploadedAt || null);
      setDetailsEditable(false);
    } else if (selectedFolderId === null || folders.length === 0) {
      setFolderName("");
      setCurrentFolderName("");
      setIsLatest(true);
      setImages([]);
      setUploadedAt(null);
      setDetailsEditable(true);
    }
  }, [folders, selectedFolderId]);

  const selectedFolder = folders.find(
    (folder) => folder.id === selectedFolderId,
  );

  // --- Fetch camera/matrix file history whenever the selected folder changes ---
  useEffect(() => {
    if (!projectId || !selectedFolder) {
      setCameraFiles([]);
      setMatrixFiles([]);
      return;
    }

    const fetchFiles = async () => {
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

    fetchFiles();
  }, [projectId, selectedFolder?.name]);

  const saveFolderDetails = () => {
    if (!selectedFolderId) return;
    const updatedFolders = folders.map((folder) => ({
      ...folder,
      isLatest:
        folder.id === selectedFolderId
          ? isLatest
          : isLatest
            ? false
            : folder.isLatest,
      name:
        folder.id === selectedFolderId
          ? currentFolderName.trim() || folder.name
          : folder.name,
    }));
    localStorage.setItem(storageKey, JSON.stringify(updatedFolders));
    setFolders(updatedFolders);
    setFolderName(
      currentFolderName.trim() ||
        folders.find((f) => f.id === selectedFolderId)?.name ||
        "",
    );
    setDetailsEditable(false);
    setSuccessMessage("Folder details saved successfully");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  const selectFolder = (folderId) => {
    setSelectedFolderId(folderId);
    setDetailsEditable(false);
  };

  const handleZipSelection = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedZipFile(file);
    setCurrentFolderName(file.name.replace(/\.zip$/i, ""));
    setDetailsEditable(true);
  };

  const handleZipUpload = async () => {
    if (!selectedZipFile) {
      error("Please choose a ZIP file to upload.");
      return;
    }

    setUploading(true);
    const resolvedName =
      currentFolderName.trim() || selectedZipFile.name.replace(/\.zip$/i, "");
    const z = new JSZip();

    try {
      const data = await selectedZipFile.arrayBuffer();
      const loaded = await z.loadAsync(data);
      const imgs = [];
      const fileNames = Object.keys(loaded.files).sort();

      for (const fname of fileNames) {
        const entry = loaded.files[fname];
        if (entry.dir) continue;
        if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(fname)) continue;
        const blob = await entry.async("blob");
        const url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        imgs.push({ name: fname, url });
      }

      const newFolder = {
        id: Date.now(),
        name: resolvedName,
        images: imgs,
        isLatest: !!isLatest,
        uploadedAt: new Date().toISOString(),
      };

      const raw = localStorage.getItem(storageKey);
      const existing = raw ? JSON.parse(raw) : [];
      const updated = existing.map((f) => ({
        ...f,
        isLatest: isLatest ? false : f.isLatest,
      }));
      updated.unshift(newFolder);
      localStorage.setItem(storageKey, JSON.stringify(updated));

      setFolders(updated);
      setSelectedFolderId(newFolder.id);
      setFolderName(resolvedName);
      setImages(imgs);
      setUploadedAt(newFolder.uploadedAt);
      setCurrentFolderName(resolvedName);
      setDetailsEditable(false);
      setSuccessMessage(`Successfully extracted ${imgs.length} image(s)`);
      setTimeout(() => setSuccessMessage(""), 3000);

      if (zipRef.current) zipRef.current.value = null;
      setSelectedZipFile(null);
    } catch (err) {
      console.error("Failed to extract zip", err);
      alert("Failed to extract ZIP file. Check the file and try again.");
    } finally {
      setUploading(false);
    }
  };

  // --- Camera / Matrix upload handlers ---
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
    } catch (err) {
      error(err.response?.data?.file?.[0] || "Failed to upload matrix file");
    } finally {
      setUploadingMatrix(false);
    }
  };

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
              Extract ZIP files and preview all images
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
                    disabled={!detailsEditable && images.length > 0}
                    placeholder="Optional custom folder name"
                    className="text-sm border-gray-300"
                  />
                  {folderName && (
                    <p className="text-xs text-gray-600">
                      Will be saved as: <strong>{folderName}</strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
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
                          Processing...
                        </>
                      ) : (
                        "Extract & Upload"
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-black">
                    Version
                  </Label>
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="latest_version"
                      checked={isLatest}
                      disabled={!detailsEditable && images.length > 0}
                      onChange={(e) => setIsLatest(e.target.checked)}
                      className="w-4 h-4 cursor-pointer"
                    />
                    <Label
                      htmlFor="latest_version"
                      className="text-sm text-black cursor-pointer"
                    >
                      Set as latest version
                    </Label>
                  </div>
                </div>
              </div>

              {selectedZipFile && (
                <p className="text-xs text-gray-600 mt-2">
                  Selected: {selectedZipFile.name}
                </p>
              )}

              {detailsEditable && images.length > 0 && (
                <Button
                  onClick={saveFolderDetails}
                  className="w-full bg-black hover:bg-gray-900 text-white"
                >
                  Save Folder Details
                </Button>
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
                      key={folder.id}
                      type="button"
                      onClick={() => selectFolder(folder.id)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        folder.id === selectedFolderId
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
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-black">
                      {selectedFolder.name}
                    </CardTitle>
                    <p className="text-xs text-gray-600 mt-1">
                      Uploaded:{" "}
                      {new Date(selectedFolder.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedFolder.isLatest
                        ? "bg-green-100 text-green-700 border border-green-300"
                        : "bg-gray-100 text-gray-700 border border-gray-300"
                    }`}
                  >
                    {selectedFolder.isLatest ? "✓ LATEST" : "Not Latest"}
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
                          key={image.url}
                          className="rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-shadow"
                        >
                          <img
                            src={image.url}
                            alt={image.name}
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
                      <div className="border-t border-gray-200 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
                        {cameraFiles.map((f) => (
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
                              {f.is_latest && (
                                <Star className="w-3 h-3 text-green-600 fill-green-600" />
                              )}
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
                      <div className="border-t border-gray-200 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
                        {matrixFiles.map((f) => (
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
                              {f.is_latest && (
                                <Star className="w-3 h-3 text-green-600 fill-green-600" />
                              )}
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
