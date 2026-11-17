import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import PhotoUpload from "./PhotoUpload";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const IMAGES = [
  { id: 1, batch_name: "old", image: "http://s/media/old/a.jpg", original_name: "a.jpg", uploaded_at: "2026-01-01T00:00:00Z" },
  { id: 2, batch_name: "new", image: "http://s/media/new/c.jpg", original_name: "c.jpg", uploaded_at: "2026-02-01T00:00:00Z" },
  { id: 3, batch_name: "new", image: "http://s/media/new/b.jpg", original_name: "b.jpg", uploaded_at: "2026-02-02T00:00:00Z" },
  { id: 4, batch_name: "", image: "http://s/media/z.jpg", original_name: "", date: null },
];

const CAMERA = [
  { id: 30, file: "http://s/media/cam/old.txt", date: "2026-01-01", is_latest: false },
  { id: 31, file: "http://s/media/cam/latest.txt", date: "2026-02-01", is_latest: true },
];
const MATRIX = [{ id: 40, file: "http://s/media/mat/m.json", date: "2026-02-01", is_latest: false }];

function mockGets({ images = IMAGES, camera = CAMERA, matrix = MATRIX } = {}) {
  API.get.mockImplementation((url) => {
    if (url.endsWith("/images/")) return Promise.resolve({ data: images });
    if (url.endsWith("/camera/")) return Promise.resolve({ data: camera });
    if (url.endsWith("/matrix/")) return Promise.resolve({ data: matrix });
    return Promise.reject(new Error(url));
  });
}

function renderPage(state = { projectId: 5, projectName: "Tower" }) {
  render(
    <MemoryRouter initialEntries={["/start", { pathname: "/upload", state }]} initialIndex={1}>
      <Routes>
        <Route path="/upload" element={<PhotoUpload />} />
        <Route path="/start" element={<div>previous page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const zipInput = () => document.querySelector('input[accept=".zip"]');
const cameraInput = () => document.querySelector('input[accept=".txt"]');
const matrixInput = () => document.querySelector('input[accept=".json"]');
const section = (title) => screen.getByText(title).parentElement.parentElement;
const file = (name) => new File(["x"], name);

beforeEach(() => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("without a project id: nothing is fetched and uploads are refused", async () => {
  renderPage(null);
  expect(screen.getByRole("heading", { name: "Upload Images" })).toBeInTheDocument();
  expect(screen.getByText("No images uploaded yet")).toBeInTheDocument();
  expect(API.get).not.toHaveBeenCalled();
  const upload = screen.getByRole("button", { name: "Extract & Upload" });
  expect(upload).toBeDisabled();
  await userEvent.upload(zipInput(), file("site.zip"));
  expect(screen.getByText("Selected: site.zip")).toBeInTheDocument();
  await userEvent.click(upload);
  expect(mockToast.error).toHaveBeenCalledWith("No project selected. Cannot save images to the database.");
  expect(API.post).not.toHaveBeenCalled();
});

test("groups images into batches, newest first, and loads that batch's camera/matrix files", async () => {
  mockGets();
  renderPage();
  expect(screen.getByRole("heading", { name: "Upload Images - Tower" })).toBeInTheDocument();
  expect(await screen.findByText("Uploaded Folders (3)")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("projects/5/images/");
  const folderButtons = screen.getAllByRole("button").filter((b) => ["old", "new", "default"].includes(b.textContent));
  expect(folderButtons.map((b) => b.textContent)).toEqual(["new", "old", "default"]);

  expect(screen.getByText("✓ MOST RECENT")).toBeInTheDocument();
  expect(screen.getByText("2 image(s)")).toBeInTheDocument();
  const names = screen.getAllByRole("img").map((i) => i.getAttribute("alt"));
  expect(names).toEqual(["b.jpg", "c.jpg"]); // sorted by original name

  await waitFor(() =>
    expect(API.get).toHaveBeenCalledWith("projects/5/camera/", { params: { batch_name: "new" } }),
  );
  expect(API.get).toHaveBeenCalledWith("projects/5/matrix/", { params: { batch_name: "new" } });
  expect(await screen.findByText("latest.txt")).toBeInTheDocument();
  expect(screen.getByText("old.txt")).toBeInTheDocument();
  // no is_latest matrix -> the first one is shown as latest
  expect(screen.getByText("m.json")).toBeInTheDocument();
});

test("selecting another folder reloads its camera/matrix files; unnamed rows fall back to the URL", async () => {
  mockGets();
  renderPage();
  await screen.findByText("Uploaded Folders (3)");
  await userEvent.click(screen.getByRole("button", { name: "default" }));
  expect(screen.queryByText("✓ MOST RECENT")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "z.jpg" })).toBeInTheDocument();
  expect(screen.getByText("Uploaded: —")).toBeInTheDocument();
  await waitFor(() =>
    expect(API.get).toHaveBeenCalledWith("projects/5/camera/", { params: { batch_name: "default" } }),
  );
});

test("ZIP upload posts the archive with date and folder name, then selects the new batch", async () => {
  mockGets({ images: [] });
  API.post.mockResolvedValue({ data: [] });
  renderPage();
  await waitFor(() => expect(API.get).toHaveBeenCalledWith("projects/5/images/"));
  await userEvent.upload(zipInput(), file("Site Photos.ZIP"));
  expect(screen.getByLabelText("Folder Name")).toHaveValue("Site Photos");
  expect(screen.getByText("Site Photos", { selector: "strong" })).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Folder Name"));
  await userEvent.type(screen.getByLabelText("Folder Name"), "  March  ");
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-03-01" } });

  mockGets({ images: [{ id: 9, batch_name: "March", image: "http://s/m/p.jpg", original_name: "p.jpg" }] });
  await userEvent.click(screen.getByRole("button", { name: "Extract & Upload" }));

  const [url, body, config] = API.post.mock.calls[0];
  expect(url).toBe("projects/5/images/");
  expect(body.get("zip_file").name).toBe("Site Photos.ZIP");
  expect(body.get("date")).toBe("2026-03-01");
  expect(body.get("batch_name")).toBe("March");
  expect(config.headers["Content-Type"]).toBe("multipart/form-data");
  expect(await screen.findByText("ZIP uploaded and saved to the database")).toBeInTheDocument();
  expect(await screen.findByText("Uploaded Folders (1)")).toBeInTheDocument();
  expect(screen.getByLabelText("Folder Name")).toHaveValue("");
  expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
});

test("ZIP upload with a blank folder name falls back to the file name", async () => {
  mockGets({ images: [] });
  API.post.mockResolvedValue({ data: [] });
  renderPage();
  await userEvent.upload(zipInput(), file("site.zip"));
  await userEvent.clear(screen.getByLabelText("Folder Name"));
  await userEvent.click(screen.getByRole("button", { name: "Extract & Upload" }));
  expect(API.post.mock.calls[0][1].get("batch_name")).toBe("site");
});

// Regression: the backend returns {"zip_file": "<message>"} (a string), so
// zip_file[0] used to toast just the first letter ("U").
test.each([
  [{ zip_file: "Upload must be a valid ZIP file." }, "Upload must be a valid ZIP file."],
  [{ zip_file: ["List style message"] }, "List style message"],
  [{ error: "You are not assigned to this project" }, "You are not assigned to this project"],
  [undefined, "Failed to upload ZIP file."],
])("ZIP upload error %p shows %p", async (data, message) => {
  mockGets({ images: [] });
  API.post.mockRejectedValue({ response: data && { data } });
  renderPage();
  await userEvent.upload(zipInput(), file("site.zip"));
  await userEvent.click(screen.getByRole("button", { name: "Extract & Upload" }));
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(message));
  expect(screen.queryByText("ZIP uploaded and saved to the database")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Extract & Upload" })).toBeEnabled();
});

describe("camera and matrix files", () => {
  test("camera upload requires a file", async () => {
    mockGets();
    renderPage();
    await screen.findByText("latest.txt");
    await userEvent.click(screen.getByRole("button", { name: "Upload Camera File" }));
    expect(mockToast.error).toHaveBeenCalledWith("Please choose a .txt camera file.");
    expect(API.post).not.toHaveBeenCalled();
  });

  test("camera upload posts batch/date/is_latest and demotes the old latest", async () => {
    mockGets();
    API.post.mockResolvedValue({ data: { id: 32, file: "http://s/media/cam/fresh.txt", date: "2026-03-01", is_latest: true } });
    renderPage();
    await screen.findByText("latest.txt");
    await userEvent.upload(cameraInput(), file("images.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Upload Camera File" }));
    const [url, body] = API.post.mock.calls[0];
    expect(url).toBe("projects/5/camera/");
    expect(body.get("batch_name")).toBe("new");
    expect(body.get("is_latest")).toBe("true");
    expect(body.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Camera file uploaded successfully!"));
    expect(screen.getByText("fresh.txt")).toBeInTheDocument();
    expect(API.post).toHaveBeenCalledTimes(1); // nothing else staged
  });

  test("camera upload also sends a staged ZIP and matrix file into the same batch", async () => {
    mockGets();
    API.post.mockImplementation((url) =>
      Promise.resolve({ data: url.endsWith("/camera/") ? { id: 50, file: "c.txt", is_latest: true } : { id: 51, file: "m2.json", is_latest: true } }),
    );
    renderPage();
    await screen.findByText("latest.txt");
    await userEvent.upload(zipInput(), file("extra.zip"));
    await userEvent.upload(matrixInput(), file("m2.json"));
    await userEvent.upload(cameraInput(), file("images.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Upload Camera File" }));
    await waitFor(() => expect(API.post).toHaveBeenCalledTimes(3));
    const urls = API.post.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["projects/5/camera/", "projects/5/images/", "projects/5/matrix/"]);
    expect(API.post.mock.calls[1][1].get("batch_name")).toBe("new");
    expect(API.post.mock.calls[2][1].get("batch_name")).toBe("new");
  });

  test("camera upload failure shows the field error", async () => {
    mockGets();
    API.post.mockRejectedValue({ response: { data: { file: ["Only .txt allowed"] } } });
    renderPage();
    await screen.findByText("latest.txt");
    await userEvent.upload(cameraInput(), file("images.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Upload Camera File" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Only .txt allowed"));
  });

  test("matrix upload: required file, not-latest flag, success and failure", async () => {
    mockGets();
    renderPage();
    await screen.findByText("m.json");
    await userEvent.click(screen.getByRole("button", { name: "Upload Matrix File" }));
    expect(mockToast.error).toHaveBeenCalledWith("Please choose a .json matrix file.");

    const matrix = section("Matrix File (.json)");
    await userEvent.click(within(matrix).getByRole("checkbox", { name: "Latest" }));
    await userEvent.upload(matrixInput(), file("m2.json"));
    API.post.mockResolvedValueOnce({ data: { id: 41, file: "http://s/media/mat/m2.json", is_latest: false, date: "2026-03-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Upload Matrix File" }));
    expect(API.post.mock.calls[0][0]).toBe("projects/5/matrix/");
    expect(API.post.mock.calls[0][1].get("is_latest")).toBe("false");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Matrix file uploaded successfully!"));
    expect(screen.getByText("m2.json")).toBeInTheDocument();

    await userEvent.upload(matrixInput(), file("m3.json"));
    API.post.mockRejectedValueOnce({});
    await userEvent.click(screen.getByRole("button", { name: "Upload Matrix File" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to upload matrix file"));
  });

  test("deleting the latest camera and matrix files", async () => {
    mockGets();
    API.delete.mockResolvedValue({});
    renderPage();
    await screen.findByText("latest.txt");
    await userEvent.click(within(section("Camera File (.txt)")).getByRole("button", { name: /delete/i }));
    expect(API.delete).toHaveBeenCalledWith("camera/31/delete/");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Camera file deleted."));

    await userEvent.click(within(section("Matrix File (.json)")).getByRole("button", { name: /delete/i }));
    expect(API.delete).toHaveBeenCalledWith("matrix/40/delete/");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Matrix file deleted."));
  });

  test("delete: cancel does nothing, failure shows the server error", async () => {
    mockGets();
    renderPage();
    await screen.findByText("latest.txt");
    window.confirm.mockReturnValueOnce(false);
    await userEvent.click(within(section("Camera File (.txt)")).getByRole("button", { name: /delete/i }));
    expect(API.delete).not.toHaveBeenCalled();

    API.delete.mockRejectedValue({ response: { data: { error: "Camera file not found" } } });
    await userEvent.click(within(section("Camera File (.txt)")).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Camera file not found"));
    API.delete.mockRejectedValue({});
    await userEvent.click(within(section("Matrix File (.json)")).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to delete matrix file."));
  });
});

describe("deleting an image folder", () => {
  test("deletes by batch name and reloads", async () => {
    mockGets();
    API.delete.mockResolvedValue({});
    renderPage();
    await screen.findByText("✓ MOST RECENT");
    const header = screen.getByText("✓ MOST RECENT").parentElement;
    await userEvent.click(within(header).getByRole("button", { name: /delete/i }));
    expect(window.confirm).toHaveBeenCalledWith("Delete all images in 'new'?");
    expect(API.delete).toHaveBeenCalledWith("projects/5/images/", { params: { batch_name: "new" } });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Image folder deleted."));
  });

  test("failure shows the server error", async () => {
    mockGets();
    API.delete.mockRejectedValue({ response: { data: { error: "No images found for that folder." } } });
    renderPage();
    await screen.findByText("✓ MOST RECENT");
    await userEvent.click(within(screen.getByText("✓ MOST RECENT").parentElement).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("No images found for that folder."));
  });
});

test("a failed image load leaves the empty state", async () => {
  API.get.mockRejectedValue(new Error("down"));
  renderPage();
  await waitFor(() => expect(API.get).toHaveBeenCalled());
  expect(screen.getByText("No images uploaded yet")).toBeInTheDocument();
});

test("Back goes to the previous page", async () => {
  mockGets({ images: [] });
  renderPage();
  await userEvent.click(screen.getByRole("button", { name: /back/i }));
  expect(screen.getByText("previous page")).toBeInTheDocument();
});
