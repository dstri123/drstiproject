import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API from "../../api/axios";
import EnvironmentalDataCard, { naturalCompare, parseCameraNames, pickCameraFile } from "./EnvironmentalDataCard";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    defaults: { baseURL: "http://127.0.0.1:8000/api/v1/" },
  },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const today = () => new Date().toISOString().split("T")[0];

describe("naturalCompare", () => {
  test("orders numbers numerically and ignores case", () => {
    expect(["img10", "IMG2", "img1"].sort(naturalCompare)).toEqual(["img1", "IMG2", "img10"]);
  });
});

describe("parseCameraNames", () => {
  const POSE = (id, name) => `${id} 1 0 0 0 0 0 0 1 ${name}`;

  test("reads NAME tokens from pose lines, skips POINTS2D lines and comments, sorts naturally", () => {
    const text = [
      "# Image list with two lines of data per image:",
      "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
      POSE(2, "DJI_0010.JPG"),
      "533.2 12.5 -1 600.1 15.2 4 700 1 2 800 3 4",
      "",
      POSE(1, "DJI_0002.JPG"),
      "1.0 2.0 -1",
    ].join("\n");
    expect(parseCameraNames(text)).toEqual(["DJI_0002.JPG", "DJI_0010.JPG"]);
  });

  test("ignores short/malformed lines and numeric-only names without desyncing", () => {
    const text = ["1 2 3", "9 1 0 0 0 0 0 0 1 12345", POSE(3, "frame_3.png"), "1 2 -1"].join("\n");
    expect(parseCameraNames(text)).toEqual(["frame_3.png"]);
  });

  test("handles CRLF files and empty input", () => {
    expect(parseCameraNames(`${POSE(1, "a.jpg")}\r\n1 2 -1\r\n${POSE(2, "b.jpg")}\r\n3 4 -1\r\n`)).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
    expect(parseCameraNames("")).toEqual([]);
  });

  test("keeps every camera of a pose-only file (empty POINTS2D lines)", () => {
    const text = ["# header", POSE(1, "A_1.jpg"), "", POSE(2, "A_2.jpg"), "", POSE(3, "A_3.jpg"), ""].join("\n");
    expect(parseCameraNames(text)).toEqual(["A_1.jpg", "A_2.jpg", "A_3.jpg"]);
  });
});

describe("pickCameraFile", () => {
  const files = [
    { id: 1, date: "2026-01-01", is_latest: false },
    { id: 2, date: "2026-01-01", is_latest: true },
    { id: 3, date: "2026-02-01", is_latest: false },
    { id: 4, date: "2026-03-01", is_latest: true },
  ];
  test("prefers that day's latest, then any upload that day", () => {
    expect(pickCameraFile(files, "2026-01-01").id).toBe(2);
    expect(pickCameraFile(files, "2026-02-01").id).toBe(3);
  });
  test("falls back to the overall latest, then the first, then null", () => {
    expect(pickCameraFile(files, "2030-01-01").id).toBe(2);
    expect(pickCameraFile([{ id: 9, date: "2026-01-01" }], "2030-01-01").id).toBe(9);
    expect(pickCameraFile([], "2030-01-01")).toBeNull();
  });
});

describe("EnvironmentalDataCard", () => {
  const SAVED = { id: 77, date: "2026-01-05", columns: ["Temp"], rows: { "cam1.jpg": { Temp: "21" } } };

  const CAMS = [{ id: 1, file: "/media/cam/images.txt", date: "2025-12-01", batch_name: "b1", is_latest: true }];
  function mockGets({ all = [SAVED], forDate = [], cameras = CAMS } = {}) {
    API.get.mockImplementation((url, config) => {
      if (url.endsWith("/environmental/")) {
        if (config?.params?.date) {
          return Promise.resolve({ data: config.params.date === SAVED.date ? [SAVED] : forDate });
        }
        return Promise.resolve({ data: all });
      }
      if (url.endsWith("/camera/")) return Promise.resolve({ data: cameras });
      return Promise.reject(new Error(url));
    });
  }

  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ text: () => Promise.resolve("1 1 0 0 0 0 0 0 1 cam2.jpg\n1 2 -1\n2 1 0 0 0 0 0 0 1 cam10.jpg\n\n") }),
    );
    jest.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  const saveButton = () => screen.getByRole("button", { name: /^save/i });

  test("without a project nothing loads and Save is disabled", () => {
    render(<EnvironmentalDataCard projectId={null} />);
    expect(API.get).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("No cameras yet")).toBeInTheDocument();
    expect(screen.getByText(/No camera file uploaded yet/)).toBeInTheDocument();
  });

  test("loads saved dates and today's (empty) dataset; camera ids come from the camera file", async () => {
    mockGets({ cameras: [{ id: 1, file: "/media/cam/images.txt", date: "2025-12-01", batch_name: "b1", is_latest: true }] });
    render(<EnvironmentalDataCard projectId={5} />);
    expect(await screen.findByRole("button", { name: "2026-01-05" })).toBeInTheDocument();
    expect(API.get).toHaveBeenCalledWith("projects/5/environmental/");
    expect(API.get).toHaveBeenCalledWith("projects/5/environmental/", { params: { date: today() } });
    expect(API.get).toHaveBeenCalledWith("projects/5/camera/");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/media/cam/images.txt"));
    const rows = await screen.findAllByRole("row");
    expect(rows.slice(1).map((r) => r.cells[0].textContent)).toEqual(["cam2.jpg", "cam10.jpg"]);
    expect(screen.getByText(/Camera IDs from "b1" camera file \(2025-12-01\) — no camera file on this date, using latest/)).toBeInTheDocument();
    expect(screen.getByText(/Add a column to start entering values/)).toBeInTheDocument();
  });

  test("picking a saved date loads that dataset", async () => {
    mockGets();
    render(<EnvironmentalDataCard projectId={5} />);
    await userEvent.click(await screen.findByRole("button", { name: "2026-01-05" }));
    expect(API.get).toHaveBeenCalledWith("projects/5/environmental/", { params: { date: "2026-01-05" } });
    expect(await screen.findByDisplayValue("21")).toBeInTheDocument();
    expect(screen.getByText("Temp")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-01-05")).toBeInTheDocument(); // date picker follows
  });

  test("the date picker switches the dataset", async () => {
    mockGets();
    render(<EnvironmentalDataCard projectId={5} />);
    await screen.findByRole("button", { name: "2026-01-05" });
    fireEvent.change(screen.getByDisplayValue(today()), { target: { value: "2026-01-05" } });
    expect(await screen.findByDisplayValue("21")).toBeInTheDocument();
  });

  test("load failure shows a toast", async () => {
    API.get.mockImplementation((url, config) =>
      config?.params?.date ? Promise.reject(new Error("x")) : Promise.resolve({ data: [] }),
    );
    render(<EnvironmentalDataCard projectId={5} />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to load environmental data."));
  });

  test("columns and cameras: add, reject duplicates, Enter key, remove", async () => {
    mockGets({ all: [] });
    render(<EnvironmentalDataCard projectId={5} />);
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await userEvent.click(saveButton());
    expect(mockToast.error).toHaveBeenCalledWith("Add at least one column before saving.");
    expect(API.post).not.toHaveBeenCalled();

    const colInput = screen.getByPlaceholderText(/New column/);
    await userEvent.click(screen.getByRole("button", { name: /column/i })); // blank: ignored
    await userEvent.type(colInput, "  Temp  {Enter}");
    expect(colInput).toHaveValue("");
    await userEvent.type(colInput, "Temp");
    await userEvent.click(screen.getByRole("button", { name: /column/i }));
    expect(mockToast.error).toHaveBeenCalledWith('Column "Temp" already exists.');
    await userEvent.clear(colInput);
    await userEvent.type(colInput, "RH{Enter}");

    const camInput = screen.getByPlaceholderText(/Camera ID/);
    await userEvent.type(camInput, "m1{Enter}");
    await userEvent.type(camInput, "cam2.jpg");
    await userEvent.click(screen.getByRole("button", { name: /camera$/i }));
    expect(mockToast.error).toHaveBeenCalledWith('Camera "cam2.jpg" already exists.');
    expect(screen.getByRole("button", { name: /^save \*/i })).toBeInTheDocument();

    expect(screen.getByRole("columnheader", { name: /RH/ })).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Remove RH"));
    expect(screen.queryByRole("columnheader", { name: /RH/ })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "m1" })).toBeInTheDocument();
  });

  test("save sends only known, non-empty, trimmed cells and refreshes the date list", async () => {
    mockGets({ all: [] });
    API.post.mockResolvedValue({ data: { id: 90, rows: { "cam2.jpg": { Temp: "20" } } } });
    render(<EnvironmentalDataCard projectId={5} />);
    await screen.findByText("cam10.jpg");
    await userEvent.type(screen.getByPlaceholderText(/New column/), "Temp{Enter}");
    await userEvent.type(screen.getByPlaceholderText(/New column/), "Gone{Enter}");
    const row = (name) => screen.getByRole("cell", { name }).closest("tr");
    const [temp2, gone2] = within(row("cam2.jpg")).getAllByRole("textbox");
    await userEvent.type(temp2, " 20 ");
    await userEvent.type(gone2, "x");
    await userEvent.type(within(row("cam10.jpg")).getAllByRole("textbox")[0], "   ");
    await userEvent.click(screen.getByTitle("Remove Gone"));

    mockGets({ all: [{ id: 90, date: today() }] });
    await userEvent.click(saveButton());
    expect(API.post).toHaveBeenCalledWith("projects/5/environmental/", {
      date: today(),
      columns: ["Temp"],
      rows: { "cam2.jpg": { Temp: "20" } },
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Environmental data saved."));
    expect(await screen.findByRole("button", { name: today() })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument(); // no longer dirty
  });

  test("save failure shows the server error or a fallback", async () => {
    mockGets({ all: [] });
    render(<EnvironmentalDataCard projectId={5} />);
    await screen.findByText("cam10.jpg");
    await userEvent.type(screen.getByPlaceholderText(/New column/), "Temp{Enter}");
    API.post.mockRejectedValueOnce({ response: { data: { error: "You are not assigned to this project" } } });
    await userEvent.click(saveButton());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("You are not assigned to this project"));
    API.post.mockRejectedValueOnce({});
    await userEvent.click(saveButton());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to save environmental data."));
  });

  test("pasting a multi-line column fills downward; single values paste normally", async () => {
    mockGets({ all: [] });
    render(<EnvironmentalDataCard projectId={5} />);
    await screen.findByText("cam10.jpg");
    await userEvent.type(screen.getByPlaceholderText(/New column/), "Temp{Enter}");
    const [first, second] = screen.getAllByRole("textbox").slice(2); // after the two add inputs
    fireEvent.paste(first, { clipboardData: { getData: () => "1\tignored\r\n2\r\n3\r\n" } });
    expect(first).toHaveValue("1");
    expect(second).toHaveValue("2"); // "3" has no row to go to
    fireEvent.paste(second, { clipboardData: { getData: () => "solo" } });
    expect(second).toHaveValue("2"); // default paste path (no preventDefault in jsdom)
  });

  test("delete removes the saved dataset after confirmation", async () => {
    mockGets();
    API.delete.mockResolvedValue({});
    render(<EnvironmentalDataCard projectId={5} />);
    await userEvent.click(await screen.findByRole("button", { name: "2026-01-05" }));
    await screen.findByDisplayValue("21");
    const trash = saveButton().previousSibling;
    window.confirm.mockReturnValueOnce(false);
    await userEvent.click(trash);
    expect(API.delete).not.toHaveBeenCalled();

    mockGets({ all: [] });
    await userEvent.click(trash);
    expect(window.confirm).toHaveBeenLastCalledWith("Delete environmental data for 2026-01-05?");
    expect(API.delete).toHaveBeenCalledWith("environmental/77/delete/");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Environmental data deleted."));
    expect(screen.queryByDisplayValue("21")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2026-01-05" })).not.toBeInTheDocument();
  });

  test("delete failure shows the server error", async () => {
    mockGets();
    API.delete.mockRejectedValue({ response: { data: { error: "nope" } } });
    render(<EnvironmentalDataCard projectId={5} />);
    await userEvent.click(await screen.findByRole("button", { name: "2026-01-05" }));
    await screen.findByDisplayValue("21");
    await userEvent.click(saveButton().previousSibling);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("nope"));
  });

  test("camera file fetch failure leaves only manual cameras", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("offline")));
    mockGets({ cameras: [{ id: 1, file: "http://s/x.txt", date: today(), batch_name: "b", is_latest: true }] });
    render(<EnvironmentalDataCard projectId={5} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await screen.findByText(`Camera IDs from "b" camera file (${today()}).`)).toBeInTheDocument();
    expect(screen.getByText("No cameras yet")).toBeInTheDocument();
  });
});
