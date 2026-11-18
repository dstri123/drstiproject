import { act, renderHook, waitFor } from "@testing-library/react";
import API from "../../../api/axios";
import useMonthlyMerge, {
  POLL_MS,
  formatCount,
  isActiveMerge,
  monthLabel,
} from "./useMonthlyMerge";

jest.mock("../../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

const job = (over = {}) => ({
  id: 31,
  project_id: 7,
  year: 2026,
  month: 11,
  status: "queued",
  progress: 0,
  total_source_files: 3,
  ...over,
});

const setup = (projectId = 7) =>
  renderHook(({ pid }) => useMonthlyMerge({ projectId: pid, toast }), {
    initialProps: { pid: projectId },
  });

afterEach(() => {
  jest.useRealTimers();
});

describe("helpers", () => {
  test("labels, counts and active states", () => {
    expect(monthLabel(2026, 11)).toBe("November 2026");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(undefined)).toBe("—");
    expect(isActiveMerge({ status: "running" })).toBe(true);
    expect(isActiveMerge({ status: "queued" })).toBe(true);
    expect(isActiveMerge({ status: "completed" })).toBe(false);
    expect(isActiveMerge(null)).toBe(false);
  });
});

describe("useMonthlyMerge", () => {
  test("loadPreview asks for the project/month and tracks a running job", async () => {
    API.get.mockResolvedValue({
      data: { eligible_count: 2, running: job({ status: "running" }) },
    });
    const { result } = setup();
    let data;
    await act(async () => {
      data = await result.current.loadPreview(2026, 11);
    });
    expect(API.get).toHaveBeenCalledWith("pointcloud/merge/", {
      params: { project_id: 7, year: 2026, month: 11 },
    });
    expect(data.eligible_count).toBe(2);
    expect(result.current.jobFor(2026, 11).status).toBe("running");
    expect(result.current.jobFor(2026, 10)).toBeNull();
  });

  test("startMerge posts once; repeated clicks are ignored while it runs", async () => {
    let resolvePost;
    API.post.mockImplementation(
      () => new Promise((r) => (resolvePost = r)),
    );
    const { result } = setup();
    let first;
    let second;
    await act(async () => {
      first = result.current.startMerge(2026, 11);
      second = await result.current.startMerge(2026, 11);
    });
    expect(second.ignored).toBe(true);
    expect(result.current.isStarting(2026, 11)).toBe(true);
    await act(async () => {
      resolvePost({ data: { merge: job() } });
      await first;
    });
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith("pointcloud/merge/", {
      project_id: 7,
      year: 2026,
      month: 11,
      force: false,
    });
    expect(toast.info).toHaveBeenCalledWith(
      "Merging 3 point cloud file(s) for November 2026…",
    );
    // the job is now queued: another click still does nothing
    let third;
    await act(async () => {
      third = await result.current.startMerge(2026, 11, { force: true });
    });
    expect(third.ignored).toBe(true);
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("reused and already-running responses are reported", async () => {
    const { result } = setup();
    API.post.mockResolvedValueOnce({
      data: { merge: job({ status: "completed" }), reused: true },
    });
    await act(async () => {
      await result.current.startMerge(2026, 11);
    });
    expect(toast.info).toHaveBeenCalledWith(
      "The merged point cloud for November 2026 is already up to date.",
    );
    API.post.mockResolvedValueOnce({
      data: { merge: job({ id: 40, month: 10 }), already_running: true },
    });
    await act(async () => {
      await result.current.startMerge(2026, 10);
    });
    expect(toast.info).toHaveBeenCalledWith(
      "A merge for October 2026 is already running.",
    );
  });

  test("API failures surface the server message and failed files", async () => {
    API.post.mockRejectedValue({
      response: {
        data: { error: "2 files missing", failed_sources: [{ id: 1 }] },
      },
    });
    const { result } = setup();
    let res;
    await act(async () => {
      res = await result.current.startMerge(2026, 11);
    });
    expect(res).toEqual({ error: "2 files missing", failed_sources: [{ id: 1 }] });
    expect(toast.error).toHaveBeenCalledWith("2 files missing");
    expect(result.current.isStarting(2026, 11)).toBe(false);

    API.post.mockRejectedValue(new Error("Network Error"));
    await act(async () => {
      res = await result.current.startMerge(2026, 11);
    });
    expect(res.error).toMatch(/Could not start the merge/);
  });

  test("polls a running job until it completes, notifying once", async () => {
    jest.useFakeTimers();
    API.post.mockResolvedValue({ data: { merge: job() } });
    API.get
      .mockResolvedValueOnce({ data: job({ status: "running", progress: 0.5 }) })
      .mockResolvedValue({
        data: job({ status: "completed", progress: 1, point_count: 1500 }),
      });
    const { result } = setup();
    await act(async () => {
      await result.current.startMerge(2026, 11);
    });
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS);
    });
    await waitFor(() =>
      expect(result.current.jobFor(2026, 11).progress).toBe(0.5),
    );
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS);
    });
    await waitFor(() =>
      expect(result.current.jobFor(2026, 11).status).toBe("completed"),
    );
    expect(API.get).toHaveBeenCalledWith("pointcloud/merge/31/");
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success.mock.calls[0][0]).toMatch(
      /November 2026 is ready: 1,500 points from 3 file/,
    );
    // finished: no more polling
    const calls = API.get.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS * 3);
    });
    expect(API.get.mock.calls.length).toBe(calls);
  });

  test("a failed job raises an error toast; poll errors are retried", async () => {
    jest.useFakeTimers();
    API.post.mockResolvedValue({ data: { merge: job() } });
    API.get
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue({
        data: job({ status: "failed", error_message: "scan_03 did not align" }),
      });
    const { result } = setup();
    await act(async () => {
      await result.current.startMerge(2026, 11);
    });
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS);
    });
    expect(result.current.jobFor(2026, 11).status).toBe("queued");
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS);
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Merging November 2026 failed. scan_03 did not align",
        8000,
      ),
    );
  });

  test("switching projects forgets the previous project's jobs", async () => {
    API.post.mockResolvedValue({ data: { merge: job() } });
    const { result, rerender } = setup();
    await act(async () => {
      await result.current.startMerge(2026, 11);
    });
    expect(result.current.jobFor(2026, 11)).not.toBeNull();
    rerender({ pid: 8 });
    expect(result.current.jobs).toEqual({});
    expect(result.current.jobFor(2026, 11)).toBeNull();
  });
});
