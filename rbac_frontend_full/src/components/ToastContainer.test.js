import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toast from "./Toast";
import { ToastProvider, useToast } from "./ToastContainer";

afterEach(() => {
  jest.useRealTimers();
});

describe("Toast", () => {
  test("renders the message as an alert and closes on X", async () => {
    const onClose = jest.fn();
    render(<Toast message="Saved" onClose={onClose} duration={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Saved");
    await userEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("auto-closes after its duration", () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(<Toast message="Hi" onClose={onClose} duration={1000} />);
    act(() => jest.advanceTimersByTime(999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("duration 0 never auto-closes", () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(<Toast message="Sticky" onClose={onClose} duration={0} />);
    act(() => jest.advanceTimersByTime(60000));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("timer is cleared on unmount", () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const { unmount } = render(<Toast message="x" onClose={onClose} duration={1000} />);
    unmount();
    act(() => jest.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();
  });

  test.each(["success", "error", "info"])("%s type renders", (type) => {
    render(<Toast message={type} type={type} onClose={() => {}} duration={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent(type);
  });
});

describe("ToastProvider / useToast", () => {
  function Buttons() {
    const t = useToast();
    return (
      <>
        <button onClick={() => t.success("ok!")}>s</button>
        <button onClick={() => t.error("bad!")}>e</button>
        <button onClick={() => t.info("fyi")}>i</button>
        <button onClick={() => t.addToast("sticky", "info", 0)}>a</button>
      </>
    );
  }

  test("useToast outside the provider throws", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow("useToast must be used within ToastProvider");
    spy.mockRestore();
  });

  test("success / error / info show toasts", async () => {
    render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>
    );
    await userEvent.click(screen.getByText("s"));
    await userEvent.click(screen.getByText("e"));
    await userEvent.click(screen.getByText("i"));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["ok!", "bad!", "fyi"]);
  });

  test("addToast returns increasing ids and removeToast removes one", () => {
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    let a, b;
    act(() => {
      a = result.current.addToast("first", "info", 0);
      b = result.current.addToast("second", "info", 0);
    });
    expect(b).toBe(a + 1);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    act(() => result.current.removeToast(a));
    expect(screen.getAllByRole("alert").map((x) => x.textContent)).toEqual(["second"]);
  });

  test("success disappears after 3s, error after 4s", () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    act(() => {
      result.current.success("ok!");
      result.current.error("bad!");
    });
    act(() => jest.advanceTimersByTime(3000));
    expect(screen.getAllByRole("alert").map((x) => x.textContent)).toEqual(["bad!"]);
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("closing a toast with X removes only that toast", async () => {
    render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>
    );
    await userEvent.click(screen.getByText("a"));
    await userEvent.click(screen.getByText("i"));
    const [sticky] = screen.getAllByRole("alert");
    await userEvent.click(sticky.querySelector("button"));
    expect(screen.getAllByRole("alert").map((x) => x.textContent)).toEqual(["fyi"]);
  });

  test("adding a new toast does not restart older toasts' timers", () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    act(() => result.current.success("first")); // 3000ms
    act(() => jest.advanceTimersByTime(2000));
    act(() => result.current.addToast("second", "info", 0));
    act(() => jest.advanceTimersByTime(1000));
    // "first" has now been visible for its full 3s and must be gone.
    expect(screen.getAllByRole("alert").map((x) => x.textContent)).toEqual(["second"]);
  });
});
