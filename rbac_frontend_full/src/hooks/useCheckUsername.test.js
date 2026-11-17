import { act, renderHook } from "@testing-library/react";
import API from "../api/axios";
import { useCheckEmail, useCheckUsername } from "./useCheckUsername";

jest.mock("../api/axios", () => ({ __esModule: true, default: { post: jest.fn() } }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// Advance past the 500ms debounce and let the API promise settle.
async function flush() {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

describe("useCheckUsername", () => {
  test("starts idle", () => {
    const { result } = renderHook(() => useCheckUsername());
    expect(result.current).toMatchObject({ checking: false, isAvailable: null, message: "" });
  });

  test("debounces and posts the username", async () => {
    API.post.mockResolvedValue({ data: { available: true, message: "Username is available" } });
    const { result } = renderHook(() => useCheckUsername());
    act(() => result.current.debouncedCheck("ad"));
    act(() => result.current.debouncedCheck("ada"));
    act(() => result.current.debouncedCheck("adam"));
    act(() => jest.advanceTimersByTime(499));
    expect(API.post).not.toHaveBeenCalled();
    await flush();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith("auth/check-username/", { username: "adam" });
    expect(result.current).toMatchObject({ checking: false, isAvailable: true, message: "Username is available" });
  });

  test("taken username", async () => {
    API.post.mockResolvedValue({ data: { available: false, message: "Username already taken" } });
    const { result } = renderHook(() => useCheckUsername());
    act(() => result.current.debouncedCheck("admin"));
    await flush();
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.message).toBe("Username already taken");
  });

  test("shows checking while the request is in flight", async () => {
    let resolve;
    API.post.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useCheckUsername());
    act(() => result.current.debouncedCheck("adam"));
    await flush();
    expect(result.current.checking).toBe(true);
    await act(async () => resolve({ data: { available: true, message: "ok" } }));
    expect(result.current.checking).toBe(false);
  });

  test.each(["", "ab"])("username %p (under 3 chars) is not checked", async (name) => {
    const { result } = renderHook(() => useCheckUsername());
    act(() => result.current.debouncedCheck(name));
    await flush();
    expect(API.post).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ isAvailable: null, message: "" });
  });

  test("a new keystroke clears the previous result", async () => {
    API.post.mockResolvedValue({ data: { available: true, message: "ok" } });
    const { result } = renderHook(() => useCheckUsername());
    act(() => result.current.debouncedCheck("adam"));
    await flush();
    expect(result.current.isAvailable).toBe(true);
    act(() => result.current.debouncedCheck("adams"));
    expect(result.current).toMatchObject({ isAvailable: null, message: "" });
  });

  test("API error shows a message", async () => {
    API.post.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useCheckUsername());
    act(() => result.current.debouncedCheck("adam"));
    await flush();
    expect(result.current).toMatchObject({ checking: false, isAvailable: null, message: "Error checking username" });
  });
});

describe("useCheckEmail", () => {
  test("debounces and posts the email", async () => {
    API.post.mockResolvedValue({ data: { available: false, message: "Email already registered" } });
    const { result } = renderHook(() => useCheckEmail());
    act(() => result.current.debouncedCheck("a@x"));
    act(() => result.current.debouncedCheck("a@x.com"));
    await flush();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith("auth/check-email/", { email: "a@x.com" });
    expect(result.current).toMatchObject({ checking: false, isAvailable: false, message: "Email already registered" });
  });

  test("empty email resets without calling the API", async () => {
    API.post.mockResolvedValue({ data: { available: true, message: "ok" } });
    const { result } = renderHook(() => useCheckEmail());
    act(() => result.current.debouncedCheck("a@x.com"));
    await flush();
    act(() => result.current.debouncedCheck(""));
    await flush();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ isAvailable: null, message: "" });
  });

  test("API error shows a message", async () => {
    API.post.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useCheckEmail());
    act(() => result.current.debouncedCheck("a@x.com"));
    await flush();
    expect(result.current).toMatchObject({ isAvailable: null, message: "Error checking email" });
  });
});
