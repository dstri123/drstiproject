import { renderHook, act } from "@testing-library/react";
import {
  useConstructionSegmentation,
  segmentUrlOnce,
  renderMasksToCanvas,
  CONSTRUCTION_CLASSES,
} from "./useConstructionSegmentation";

const API_RESPONSE = {
  overlay_base64: "AAAA",
  present_classes: [{ id: 2, key: "concrete", label: "Concrete", emoji: "x", color: [1, 2, 3], extra: 1 }],
  masks: [
    {
      mask_id: 0,
      class_id: 2,
      class_key: "concrete",
      class_label: "Concrete",
      emoji: "x",
      color: [169, 169, 169],
      confidence: 0.9,
      area: 4,
      bbox: [0, 0, 2, 2],
      iou_score: 0.8,
      segmentation: [true, true, false, false],
    },
  ],
  image_width: 2,
  image_height: 2,
  num_masks: 1,
};

const okJson = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(data) });

class MockFileReader {
  readAsDataURL() {
    this.result = "data:image/png;base64,QQ==";
    setTimeout(() => this.onload());
  }
}

beforeEach(() => {
  global.fetch = jest.fn();
  global.FileReader = MockFileReader;
});

describe("segmentUrlOnce", () => {
  test("fetches the image, posts base64 to the SAM service and normalises the result", async () => {
    fetch
      .mockResolvedValueOnce({ blob: () => Promise.resolve(new Blob(["img"])) })
      .mockResolvedValueOnce(okJson(API_RESPONSE));
    const res = await segmentUrlOnce("http://img/1.jpg");

    expect(fetch).toHaveBeenNthCalledWith(1, "http://img/1.jpg");
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("http://localhost:8001/segment/base64");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ image_base64: "data:image/png;base64,QQ==", return_overlay: true });

    expect(res.overlayDataUrl).toBe("data:image/png;base64,AAAA");
    expect(res.presentClasses).toEqual([{ id: 2, key: "concrete", label: "Concrete", emoji: "x", color: [1, 2, 3] }]);
    expect(res.masks[0]).toMatchObject({ maskId: 0, classKey: "concrete", iouScore: 0.8, area: 4 });
    expect(res).toMatchObject({ imageWidth: 2, imageHeight: 2, numMasks: 1 });
  });

  test("handles a sparse response and a custom service URL", async () => {
    fetch
      .mockResolvedValueOnce({ blob: () => Promise.resolve(new Blob(["img"])) })
      .mockResolvedValueOnce(okJson({ image_width: 1, image_height: 1 }));
    const res = await segmentUrlOnce("u", { serviceUrl: "http://sam:9" });
    expect(fetch.mock.calls[1][0]).toBe("http://sam:9/segment/base64");
    expect(res.overlayDataUrl).toBeNull();
    expect(res.masks).toEqual([]);
    expect(res.presentClasses).toEqual([]);
  });

  test("throws on a non-OK service response", async () => {
    fetch
      .mockResolvedValueOnce({ blob: () => Promise.resolve(new Blob(["img"])) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("model crashed") });
    await expect(segmentUrlOnce("u")).rejects.toThrow("Segmentation API error 500: model crashed");
  });
});

describe("useConstructionSegmentation", () => {
  test("segmentImage(File) uploads multipart and stores the result", async () => {
    fetch.mockResolvedValueOnce(okJson(API_RESPONSE));
    const { result } = renderHook(() => useConstructionSegmentation());
    const file = new File(["x"], "photo.jpg");
    let out;
    await act(async () => {
      out = await result.current.segmentImage(file);
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8001/segment?return_overlay=true");
    expect(init.body.get("file").name).toBe("photo.jpg");
    expect(out.numMasks).toBe(1);
    expect(result.current.result).toBe(out);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.CONSTRUCTION_CLASSES).toBe(CONSTRUCTION_CLASSES);
  });

  test("an API error sets error and rethrows", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.reject(new Error()), statusText: "Unavailable" });
    const { result } = renderHook(() => useConstructionSegmentation());
    let caught;
    await act(async () => {
      try {
        await result.current.segmentImage("base64data");
      } catch (e) {
        caught = e;
      }
    });
    expect(caught.message).toBe("Segmentation API error 503: Unavailable");
    expect(result.current.error).toBe("Segmentation API error 503: Unavailable");
    expect(result.current.isLoading).toBe(false);
  });

  test("an aborted request resolves to null without an error", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetch.mockRejectedValueOnce(abortErr);
    const { result } = renderHook(() => useConstructionSegmentation());
    let out;
    await act(async () => {
      out = await result.current.segmentImage("b64");
    });
    expect(out).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test("cancel aborts the in-flight request", async () => {
    let signal;
    fetch.mockImplementationOnce((url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useConstructionSegmentation());
    act(() => {
      result.current.segmentImage("b64");
    });
    expect(result.current.isLoading).toBe(true);
    act(() => result.current.cancel());
    expect(signal.aborted).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  test("segmentImageUrl converts a URL to base64 first", async () => {
    fetch
      .mockResolvedValueOnce({ blob: () => Promise.resolve(new Blob(["img"])) })
      .mockResolvedValueOnce(okJson(API_RESPONSE));
    const { result } = renderHook(() => useConstructionSegmentation({ serviceUrl: "http://s" }));
    await act(async () => {
      await result.current.segmentImageUrl("http://img/2.jpg");
    });
    expect(fetch.mock.calls[1][0]).toBe("http://s/segment/base64");
    expect(result.current.result.numMasks).toBe(1);
  });

  test("renders masks locally when asked", async () => {
    fetch.mockResolvedValueOnce(okJson(API_RESPONSE));
    const ctx = {
      clearRect: jest.fn(),
      createImageData: jest.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })),
      putImageData: jest.fn(),
    };
    const canvas = { getContext: () => ctx };
    const { result } = renderHook(() => useConstructionSegmentation({ renderLocally: true }));
    await act(async () => {
      await result.current.segmentImage("b64", canvas);
    });
    expect(canvas.width).toBe(2);
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  test("checkHealth", async () => {
    const { result } = renderHook(() => useConstructionSegmentation());
    fetch.mockResolvedValueOnce(okJson({ status: "ok" }));
    await expect(result.current.checkHealth()).resolves.toBe(true);
    expect(fetch).toHaveBeenLastCalledWith("http://localhost:8001/health");
    fetch.mockResolvedValueOnce(okJson({ status: "loading" }));
    await expect(result.current.checkHealth()).resolves.toBe(false);
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(result.current.checkHealth()).resolves.toBe(false);
  });
});

describe("renderMasksToCanvas", () => {
  test("paints mask pixels and white class borders", () => {
    const puts = [];
    const ctx = {
      clearRect: jest.fn(),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img) => puts.push(img),
    };
    const canvas = { getContext: () => ctx };
    renderMasksToCanvas(
      canvas,
      [{ color: [10, 20, 30], class_id: 3, segmentation: [true, false, false, false] }],
      2,
      2,
      0.5,
    );
    expect(canvas.width).toBe(2);
    expect(Array.from(puts[0].data.slice(0, 4))).toEqual([10, 20, 30, 128]);
    expect(Array.from(puts[0].data.slice(4, 8))).toEqual([0, 0, 0, 0]);
    // pixel 0 differs from its right/bottom neighbour → border
    expect(Array.from(puts[1].data.slice(0, 4))).toEqual([255, 255, 255, 180]);
  });
});
