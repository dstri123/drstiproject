import { useCallback, useEffect, useState } from "react";
import API from "../../../api/axios";

// Mirrors issues.models.Issue choices.
export const ISSUE_STATUS = {
  open: { label: "Open", color: "#dc2626", bg: "#fef2f2" },
  in_progress: { label: "In Progress", color: "#d97706", bg: "#fffbeb" },
  resolved: { label: "Resolved", color: "#16a34a", bg: "#f0fdf4" },
  closed: { label: "Closed", color: "#64748b", bg: "#f1f5f9" },
};
export const ISSUE_PRIORITY = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

export const isOverdue = (issue) =>
  !!issue.due_date &&
  ["open", "in_progress"].includes(issue.status) &&
  issue.due_date < new Date().toISOString().slice(0, 10);

/**
 * Issues pinned in 3D for one project: list, assignees, create/update
 * (multipart, so a photo and the viewpoint snapshot can ride along), delete,
 * and BCF export.
 */
export default function useIssues(projectId) {
  const [issues, setIssues] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [list, people] = await Promise.all([
        API.get(`issues/project/${projectId}/`),
        API.get(`issues/project/${projectId}/assignees/`),
      ]);
      setIssues(list.data || []);
      setAssignees(people.data || []);
    } catch {
      // Not a member of this project (403) or offline — show no issues.
      setIssues([]);
      setAssignees([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // fields: plain values (objects/arrays are JSON-encoded); files: {photo,
  // snapshot} Blobs. issueId null creates.
  const save = useCallback(
    async (issueId, fields, files = {}) => {
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => {
        if (v === undefined) return;
        form.append(
          k,
          v === null ? "" : typeof v === "object" ? JSON.stringify(v) : v,
        );
      });
      Object.entries(files).forEach(([k, blob]) => {
        if (blob) form.append(k, blob, blob.name || `${k}.png`);
      });
      const res = issueId
        ? await API.patch(`issues/${issueId}/`, form)
        : await API.post(`issues/project/${projectId}/`, form);
      setIssues((prev) =>
        issueId
          ? prev.map((i) => (i.id === issueId ? res.data : i))
          : [res.data, ...prev],
      );
      return res.data;
    },
    [projectId],
  );

  const remove = useCallback(async (issueId) => {
    await API.delete(`issues/${issueId}/`);
    setIssues((prev) => prev.filter((i) => i.id !== issueId));
  }, []);

  // params: same filters as the list endpoint, e.g. {status: "open"}.
  const exportBcf = useCallback(
    async (params = {}) => {
      const res = await API.get(`issues/project/${projectId}/bcf/`, {
        params,
        responseType: "blob",
      });
      const name =
        /filename="([^"]+)"/.exec(
          res.headers?.["content-disposition"] || "",
        )?.[1] || "issues.bcfzip";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    [projectId],
  );

  return { issues, assignees, loading, reload, save, remove, exportBcf };
}
