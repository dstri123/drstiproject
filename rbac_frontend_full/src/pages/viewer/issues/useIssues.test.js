import { renderHook, waitFor, act } from "@testing-library/react";
import API from "../../../api/axios";
import useIssues, { isOverdue, ISSUE_STATUS, ISSUE_PRIORITY } from "./useIssues";

jest.mock("../../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

describe("isOverdue", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });
  afterAll(() => jest.useRealTimers());

  test.each([
    [{ due_date: "2026-06-14", status: "open" }, true],
    [{ due_date: "2026-06-14", status: "in_progress" }, true],
    [{ due_date: "2026-06-15", status: "open" }, false],
    [{ due_date: "2026-06-16", status: "open" }, false],
    [{ due_date: "2026-01-01", status: "resolved" }, false],
    [{ due_date: "2026-01-01", status: "closed" }, false],
    [{ due_date: null, status: "open" }, false],
    [{ status: "open" }, false],
  ])("%j → %s", (issue, expected) => {
    expect(isOverdue(issue)).toBe(expected);
  });
});

test("status and priority maps mirror the backend choices", () => {
  expect(Object.keys(ISSUE_STATUS)).toEqual(["open", "in_progress", "resolved", "closed"]);
  expect(Object.keys(ISSUE_PRIORITY)).toEqual(["low", "normal", "high", "critical"]);
});

function mockLists(issues = [], people = []) {
  API.get.mockImplementation((url) =>
    Promise.resolve({ data: url.endsWith("assignees/") ? people : issues }),
  );
}

test("loads issues and assignees for the project", async () => {
  mockLists([{ id: 1 }], [{ id: 9, name: "A" }]);
  const { result } = renderHook(() => useIssues(7));
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(API.get).toHaveBeenCalledWith("issues/project/7/");
  expect(API.get).toHaveBeenCalledWith("issues/project/7/assignees/");
  expect(result.current.issues).toEqual([{ id: 1 }]);
  expect(result.current.assignees).toEqual([{ id: 9, name: "A" }]);
});

test("null data is treated as empty lists", async () => {
  API.get.mockResolvedValue({ data: null });
  const { result } = renderHook(() => useIssues(7));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.issues).toEqual([]);
  expect(result.current.assignees).toEqual([]);
});

test("a 403 (not a member) shows no issues", async () => {
  API.get.mockRejectedValue({ response: { status: 403 } });
  const { result } = renderHook(() => useIssues(7));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.issues).toEqual([]);
});

test("no project id → no requests", () => {
  renderHook(() => useIssues(null));
  expect(API.get).not.toHaveBeenCalled();
});

test("save creates with multipart form data and prepends the issue", async () => {
  mockLists([{ id: 1 }]);
  API.post.mockResolvedValue({ data: { id: 2, number: 2 } });
  const { result } = renderHook(() => useIssues(7));
  await waitFor(() => expect(result.current.issues).toHaveLength(1));

  const snapshot = new Blob(["png"], { type: "image/png" });
  const photo = new File(["jpg"], "site.jpg");
  let saved;
  await act(async () => {
    saved = await result.current.save(
      null,
      { title: "T", assignee: null, position: [1, 2, 3], skip: undefined, n: 4 },
      { photo, snapshot, none: null },
    );
  });
  expect(saved).toEqual({ id: 2, number: 2 });
  const [url, form] = API.post.mock.calls[0];
  expect(url).toBe("issues/project/7/");
  expect(form.get("title")).toBe("T");
  expect(form.get("assignee")).toBe("");
  expect(form.get("position")).toBe("[1,2,3]");
  expect(form.get("n")).toBe("4");
  expect(form.has("skip")).toBe(false);
  expect(form.get("photo").name).toBe("site.jpg");
  expect(form.get("snapshot").name).toBe("snapshot.png");
  expect(form.has("none")).toBe(false);
  expect(result.current.issues.map((i) => i.id)).toEqual([2, 1]);
});

test("save with an id PATCHes and replaces in place", async () => {
  mockLists([{ id: 1, title: "a" }, { id: 3, title: "c" }]);
  API.patch.mockResolvedValue({ data: { id: 1, title: "b" } });
  const { result } = renderHook(() => useIssues(7));
  await waitFor(() => expect(result.current.issues).toHaveLength(2));
  await act(() => result.current.save(1, { title: "b" }));
  expect(API.patch).toHaveBeenCalledWith("issues/1/", expect.any(FormData));
  expect(result.current.issues).toEqual([{ id: 1, title: "b" }, { id: 3, title: "c" }]);
});

test("save errors propagate and leave the list unchanged", async () => {
  mockLists([{ id: 1 }]);
  API.post.mockRejectedValue(new Error("400"));
  const { result } = renderHook(() => useIssues(7));
  await waitFor(() => expect(result.current.issues).toHaveLength(1));
  await expect(result.current.save(null, { title: "" })).rejects.toThrow("400");
  expect(result.current.issues).toHaveLength(1);
});

test("remove deletes and drops the issue", async () => {
  mockLists([{ id: 1 }, { id: 2 }]);
  API.delete.mockResolvedValue({});
  const { result } = renderHook(() => useIssues(7));
  await waitFor(() => expect(result.current.issues).toHaveLength(2));
  await act(() => result.current.remove(1));
  expect(API.delete).toHaveBeenCalledWith("issues/1/");
  expect(result.current.issues).toEqual([{ id: 2 }]);
});

describe("exportBcf", () => {
  let click;
  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => "blob:bcf");
    URL.revokeObjectURL = jest.fn();
    click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  test("downloads with the server filename and passes filters", async () => {
    mockLists();
    const { result } = renderHook(() => useIssues(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const blob = new Blob(["zip"]);
    API.get.mockResolvedValue({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="tower-issues.bcfzip"' },
    });
    await act(() => result.current.exportBcf({ status: "open" }));
    expect(API.get).toHaveBeenLastCalledWith("issues/project/7/bcf/", {
      params: { status: "open" },
      responseType: "blob",
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click.mock.instances[0].download).toBe("tower-issues.bcfzip");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:bcf");
  });

  test("falls back to issues.bcfzip without a header", async () => {
    mockLists();
    const { result } = renderHook(() => useIssues(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    API.get.mockResolvedValue({ data: new Blob(["zip"]) });
    await act(() => result.current.exportBcf());
    expect(API.get).toHaveBeenLastCalledWith("issues/project/7/bcf/", {
      params: {},
      responseType: "blob",
    });
    expect(click.mock.instances[0].download).toBe("issues.bcfzip");
  });
});
