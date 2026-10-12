import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FileText, Loader2, Save, Trash2, Upload } from "lucide-react";
import API from "../../api/axios";
import { useToast } from "../../components/ToastContainer";

const todayStr = () => new Date().toISOString().split("T")[0];

const formatSize = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Upload + history for one kind of Gaussian-splatting file (COLMAP
// points3D.txt / cameras.txt, or an already-trained Gaussian .ply). The
// viewer's Gaussian panel picks the upload for its selected date (else the
// newest one on or before it).
export default function GaussianFileCard({
  projectId,
  kind,
  title,
  description,
  accept,
}) {
  const { error, success } = useToast();
  const inputRef = useRef(null);

  const [date, setDate] = useState(todayStr());
  const [file, setFile] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const fetchUploads = useCallback(async () => {
    const res = await API.get(`projects/${projectId}/gaussian-files/`, {
      params: { kind },
    });
    setUploads(res.data || []);
  }, [projectId, kind]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetchUploads()
      .catch(() => setUploads([]))
      .finally(() => setLoading(false));
  }, [projectId, fetchUploads]);

  const pickFile = (e) => {
    const picked = e.target.files?.[0] || null;
    const ext = picked?.name.split(".").pop()?.toLowerCase();
    if (picked && `.${ext}` !== accept) {
      error(`Please choose a ${accept} file.`);
      e.target.value = "";
      return;
    }
    setFile(picked);
  };

  const save = async () => {
    if (!file) {
      error(`Choose a ${accept} file first.`);
      return;
    }
    const form = new FormData();
    form.append("kind", kind);
    form.append("date", date);
    form.append("file", file);
    setSaving(true);
    setProgress(0);
    try {
      await API.post(`projects/${projectId}/gaussian-files/`, form, {
        timeout: 0,
        onUploadProgress: (e) =>
          e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await fetchUploads();
      success(`${title} saved.`);
    } catch (err) {
      const data = err.response?.data;
      error(
        data?.error ||
          (Array.isArray(data?.file) ? data.file[0] : data?.file) ||
          `Failed to save ${title}.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete ${item.original_name || title} (${item.date})?`))
      return;
    try {
      await API.delete(`gaussian-files/${item.id}/delete/`);
      await fetchUploads();
      success(`${title} deleted.`);
    } catch (err) {
      error(err.response?.data?.error || `Failed to delete ${title}.`);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50 rounded-t-xl border-b mb-4">
        <div>
          <CardTitle className="text-lg font-bold text-black">{title}</CardTitle>
          <p className="text-xs text-gray-600 mt-1 font-medium">
            {description}
          </p>
        </div>
        <Button
          onClick={save}
          disabled={saving || !file || !projectId}
          className="bg-black hover:bg-gray-900 text-white"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          {saving && progress ? `Saving ${progress}%` : "Save"}
        </Button>
      </CardHeader>

      <CardContent className="pt-2 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">Date</span>
            <DatePicker
              date={date ? new Date(date) : undefined}
              onDateChange={(d) => d && setDate(d.toISOString().split("T")[0])}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              onChange={pickFile}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
              className="border-gray-300 shrink-0"
            >
              <Upload className="w-4 h-4 mr-1" /> Choose {accept}
            </Button>
            <span className="text-xs text-gray-600 truncate">
              {file
                ? `${file.name} (${formatSize(file.size)})`
                : "No file selected"}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : uploads.length === 0 ? (
          <p className="text-xs text-gray-500">No uploads yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-auto max-h-[220px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-700">
                  <th className="font-semibold px-3 py-2 border-b">File</th>
                  <th className="font-semibold px-3 py-2 border-b">Date</th>
                  <th className="font-semibold px-3 py-2 border-b">
                    Uploaded
                  </th>
                  <th className="px-3 py-2 border-b" />
                </tr>
              </thead>
              <tbody>
                {uploads.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-1.5 border-b border-gray-100">
                      <a
                        href={new URL(item.file, API.defaults.baseURL).href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-gray-800 hover:underline"
                      >
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        {item.original_name || item.file.split("/").pop()}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 border-b border-gray-100 whitespace-nowrap">
                      {item.date}
                    </td>
                    <td className="px-3 py-1.5 border-b border-gray-100 whitespace-nowrap text-gray-500">
                      {new Date(item.uploaded_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 border-b border-gray-100 text-right">
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        title="Delete"
                        className="text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
