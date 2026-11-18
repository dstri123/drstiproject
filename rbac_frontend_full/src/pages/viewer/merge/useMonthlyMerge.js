import { useCallback, useEffect, useRef, useState } from "react";
import API from "../../../api/axios";

// Monthly "Merge Point Clouds" state for one project: previews, starting a
// merge (once — repeated clicks are ignored while a request or job is in
// flight), and polling running jobs until they finish. The merge itself runs
// on the server in the background, so closing the dialog doesn't stop it.

export const POLL_MS = 2000;

export const isActiveMerge = (merge) =>
  merge?.status === "queued" || merge?.status === "running";

export const monthLabel = (year, month) =>
  new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

export const formatCount = (n) =>
  typeof n === "number" ? n.toLocaleString("en-US") : "—";

const keyOf = (projectId, year, month) => `${projectId}:${year}-${month}`;

export default function useMonthlyMerge({ projectId, toast }) {
  // Latest known merge record per project/month, keyed "project:year-month".
  const [jobs, setJobs] = useState({});
  const [startingKey, setStartingKey] = useState(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const inFlight = useRef(new Set());
  const notified = useRef(new Set());
  // The toast context object changes identity whenever a toast is shown;
  // read it through a ref so polling isn't restarted by every toast.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // A different project has its own merges.
  useEffect(() => {
    setJobs({});
  }, [projectId]);

  const track = useCallback((merge) => {
    if (!merge?.id) return;
    setJobs((prev) => ({
      ...prev,
      [keyOf(merge.project_id, merge.year, merge.month)]: merge,
    }));
  }, []);

  const jobFor = useCallback(
    (year, month) => jobs[keyOf(projectId, year, month)] || null,
    [jobs, projectId],
  );

  const isStarting = useCallback(
    (year, month) => startingKey === keyOf(projectId, year, month),
    [startingKey, projectId],
  );

  const loadPreview = useCallback(
    async (year, month) => {
      const res = await API.get("pointcloud/merge/", {
        params: { project_id: projectId, year, month },
      });
      const data = res.data || {};
      if (data.running) track(data.running);
      return data;
    },
    [projectId, track],
  );

  const startMerge = useCallback(
    async (year, month, { force = false } = {}) => {
      const key = keyOf(projectId, year, month);
      const existing = jobsRef.current[key];
      if (inFlight.current.has(key) || isActiveMerge(existing)) {
        return { merge: existing, ignored: true };
      }
      inFlight.current.add(key);
      setStartingKey(key);
      const label = monthLabel(year, month);
      const toast = toastRef.current;
      try {
        const res = await API.post("pointcloud/merge/", {
          project_id: projectId,
          year,
          month,
          force,
        });
        const data = res.data || {};
        track(data.merge);
        if (data.reused) {
          toast.info(`The merged point cloud for ${label} is already up to date.`);
        } else if (data.already_running) {
          toast.info(`A merge for ${label} is already running.`);
        } else {
          toast.info(
            `Merging ${data.merge?.total_source_files ?? ""} point cloud file(s) for ${label}…`,
          );
        }
        return data;
      } catch (err) {
        const data = err?.response?.data || {};
        const error = data.error || "Could not start the merge. Please try again.";
        toast.error(error);
        return { error, failed_sources: data.failed_sources || [] };
      } finally {
        inFlight.current.delete(key);
        setStartingKey(null);
      }
    },
    [projectId, track],
  );

  // Poll every running job until it completes or fails.
  const activeIds = Object.values(jobs)
    .filter(isActiveMerge)
    .map((j) => j.id)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!activeIds) return undefined;
    let cancelled = false;
    const poll = () =>
      activeIds.split(",").forEach(async (id) => {
        try {
          const res = await API.get(`pointcloud/merge/${id}/`);
          const merge = res.data;
          if (cancelled || !merge) return;
          track(merge);
          if (isActiveMerge(merge) || notified.current.has(merge.id)) return;
          notified.current.add(merge.id);
          const label = monthLabel(merge.year, merge.month);
          const toast = toastRef.current;
          if (merge.status === "completed") {
            toast.success(
              `Merged point cloud for ${label} is ready: ${formatCount(
                merge.point_count,
              )} points from ${merge.total_source_files} file(s).`,
              6000,
            );
          } else if (merge.status === "failed") {
            toast.error(`Merging ${label} failed. ${merge.error_message || ""}`, 8000);
          }
        } catch (_) {
          // Transient network error — try again on the next tick.
        }
      });
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeIds, track]);

  return { jobs, jobFor, isStarting, loadPreview, startMerge, track };
}
