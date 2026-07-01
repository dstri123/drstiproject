import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertCircle, Download } from "lucide-react";
import API from "../../api/axios";
import { useToast } from "../../components/ToastContainer";

export default function IFCConverterTool() {
  const navigate = useNavigate();
  const { error, success } = useToast();
  const fileInputRef = useRef(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [converting, setConverting] = useState(false);
  const [conversionStatus, setConversionStatus] = useState("");
  const [conversionComplete, setConversionComplete] = useState(false);
  const [downloadFileId, setDownloadFileId] = useState(null);
  const [downloadFileName, setDownloadFileName] = useState(null);
  const [progress, setProgress] = useState(0);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".ifc")) {
      error("Only .ifc files are supported");
      return;
    }

    setSelectedFile(file);
    setConversionComplete(false);
    setConversionStatus("");
    setDownloadFileId(null);
    setProgress(0);
  };

  const handleConvert = async () => {
    if (!selectedFile) {
      error("Please select an IFC file");
      return;
    }

    setConverting(true);
    setProgress(0);
    setConversionStatus("Uploading file...");
    setConversionComplete(false);

    // Conversion stages shown while the server works.
    // Upload progress is real (axios); the processing phase advances
    // gradually toward 90% until the server responds.
    let processingTimer = null;
    const startProcessingTicker = () => {
      const stages = [
        [35, "Parsing IFC file..."],
        [55, "Extracting geometry..."],
        [75, "Exporting FBX with Blender..."],
        [90, "Almost done..."],
      ];
      let i = 0;
      processingTimer = setInterval(() => {
        if (i < stages.length) {
          const [pct, label] = stages[i];
          setProgress(pct);
          setConversionStatus(label);
          i++;
        }
      }, 2000);
    };

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await API.post("processing/tools/convert-ifc/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          // Upload accounts for the first 30% of the bar
          const pct = Math.round((e.loaded / (e.total || e.loaded)) * 30);
          setProgress(pct);
          if (pct >= 30) {
            setConversionStatus("Parsing IFC file...");
            if (!processingTimer) startProcessingTicker();
          }
        },
      });

      if (processingTimer) clearInterval(processingTimer);

      if (res.data.success) {
        setProgress(100);
        setConversionStatus(`✓ ${res.data.message}`);
        setDownloadFileId(res.data.file_id);
        setDownloadFileName(res.data.output_file);
        setConversionComplete(true);
        success("Conversion successful! Ready to download.");
      } else {
        error(res.data.message || "Conversion failed");
        setConversionStatus("Conversion failed");
        setProgress(0);
      }
    } catch (err) {
      if (processingTimer) clearInterval(processingTimer);
      const errorMessage = err.response?.data?.error || "Conversion error occurred";
      error(errorMessage);
      setConversionStatus(`Error: ${errorMessage}`);
      setProgress(0);
    } finally {
      setConverting(false);
    }
  };

  const handleDownload = async () => {
    if (!downloadFileId) return;

    try {
      setConversionStatus("Preparing download...");

      const res = await API.get("processing/tools/convert-ifc/", {
        params: { file_id: downloadFileId },
        responseType: "blob",
      });

      // Create download link
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFileName || "converted.fbx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      success("File downloaded successfully");
      setConversionStatus("Download complete");
    } catch (err) {
      error("Download failed");
      setConversionStatus("Download failed");
    }
  };

  return (
    <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
      {/* Back Button */}
      <Button
        variant="ghost"
        className="flex items-center gap-2 text-black hover:text-gray-700 mb-6"
        onClick={() => navigate("/tools")}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tools
      </Button>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-black mb-2">IFC to FBX Converter</h1>
        <p className="text-sm text-gray-600">
          Convert Industry Foundation Classes (IFC) files to FBX format for 3D visualization
        </p>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader className="bg-gray-50 rounded-t-xl border-b">
          <CardTitle className="text-lg text-black">Upload & Convert to FBX</CardTitle>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* File Upload Section */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-black block">
              Select IFC File
            </label>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-gray-50 hover:bg-gray-100 transition-colors">
              <div
                className="cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-black mb-1">
                  {selectedFile ? selectedFile.name : "Choose IFC file or drag & drop"}
                </p>
                <p className="text-xs text-gray-500">
                  {selectedFile ? `Size: ${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : "Only .ifc files supported"}
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".ifc"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* Status Section */}
          {conversionStatus && (
            <div className={`rounded-lg p-3 flex items-start gap-3 ${
              conversionComplete
                ? "bg-green-50 border border-green-200"
                : converting
                ? "bg-blue-50 border border-blue-200"
                : "bg-red-50 border border-red-200"
            }`}>
              {converting ? (
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin mt-0.5 flex-shrink-0" />
              ) : conversionComplete ? (
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              )}

              <p className={`text-sm ${
                conversionComplete
                  ? "text-green-700"
                  : converting
                  ? "text-blue-700"
                  : "text-red-700"
              }`}>
                {conversionStatus}
              </p>
            </div>
          )}

          {/* Progress Bar */}
          {converting && progress > 0 && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-black h-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 text-center font-medium">
                {progress}% Complete
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleConvert}
              disabled={!selectedFile || converting || conversionComplete}
              className="flex-1 bg-black hover:bg-gray-900 text-white disabled:opacity-50"
            >
              {converting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Converting...
                </>
              ) : (
                "Convert to FBX"
              )}
            </Button>

            {conversionComplete && (
              <Button
                onClick={handleDownload}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                Download FBX
              </Button>
            )}
          </div>

          {/* Info Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-blue-900">
              <strong>Info:</strong> This tool uses ifcopenshell and trimesh to convert IFC geometry to FBX format.
              FBX files can be imported into Blender, Autodesk products, Unity, Unreal Engine, and other 3D software.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
