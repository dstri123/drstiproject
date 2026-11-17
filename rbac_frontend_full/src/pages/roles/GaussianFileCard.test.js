import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API from "../../api/axios";
import GaussianFileCard from "./GaussianFileCard";

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

const UPLOADS = [
  { id: 1, file: "/media/g/points3D.txt", original_name: "points3D.txt", date: "2026-01-02", uploaded_at: "2026-01-02T00:00:00Z" },
  { id: 2, file: "http://cdn/x/other.txt", original_name: "", date: "2026-01-01", uploaded_at: "2026-01-01T00:00:00Z" },
];

function renderCard(props = {}) {
  render(
    <GaussianFileCard projectId={5} kind="points3d" title="COLMAP points3D.txt" description="desc" accept=".txt" {...props} />,
  );
}

const fileInput = () => document.querySelector('input[type="file"]');
const saveBtn = () => screen.getByRole("button", { name: /^sav/i });

beforeEach(() => jest.spyOn(window, "confirm").mockReturnValue(true));
afterEach(() => jest.restoreAllMocks());

test("without a project nothing loads and Save is disabled", () => {
  renderCard({ projectId: null });
  expect(API.get).not.toHaveBeenCalled();
  expect(screen.getByText("No uploads yet.")).toBeInTheDocument();
  expect(saveBtn()).toBeDisabled();
});

test("lists uploads of its kind with resolved links", async () => {
  API.get.mockResolvedValue({ data: UPLOADS });
  renderCard();
  expect(await screen.findByRole("link", { name: /points3D.txt/ })).toHaveAttribute(
    "href",
    "http://127.0.0.1:8000/media/g/points3D.txt",
  );
  expect(API.get).toHaveBeenCalledWith("projects/5/gaussian-files/", { params: { kind: "points3d" } });
  expect(screen.getByRole("link", { name: /other.txt/ })).toHaveAttribute("href", "http://cdn/x/other.txt");
  expect(screen.getByText("COLMAP points3D.txt")).toBeInTheDocument();
});

test("load failure shows the empty list", async () => {
  API.get.mockRejectedValue(new Error("x"));
  renderCard();
  await waitFor(() => expect(API.get).toHaveBeenCalled());
  expect(await screen.findByText("No uploads yet.")).toBeInTheDocument();
});

test("rejects a file with the wrong extension", async () => {
  API.get.mockResolvedValue({ data: [] });
  renderCard({ accept: ".ply" });
  await screen.findByText("No uploads yet.");
  fireEvent.change(fileInput(), { target: { files: [new File(["x"], "model.txt")] } });
  expect(mockToast.error).toHaveBeenCalledWith("Please choose a .ply file.");
  expect(screen.getByText("No file selected")).toBeInTheDocument();
  expect(saveBtn()).toBeDisabled();
});

test("uploads the chosen file with kind and date, then reloads", async () => {
  API.get.mockResolvedValue({ data: [] });
  API.post.mockResolvedValue({ data: {} });
  renderCard({ accept: ".ply", kind: "trained_ply", title: "Trained" });
  await screen.findByText("No uploads yet.");
  const f = new File([new Uint8Array(2 * 1024 * 1024)], "Splat.PLY");
  fireEvent.change(fileInput(), { target: { files: [f] } });
  expect(screen.getByText("Splat.PLY (2.0 MB)")).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), { target: { value: "2026-02-03" } });
  await userEvent.click(saveBtn());
  const [url, form, config] = API.post.mock.calls[0];
  expect(url).toBe("projects/5/gaussian-files/");
  expect(form.get("kind")).toBe("trained_ply");
  expect(form.get("date")).toBe("2026-02-03");
  expect(form.get("file").name).toBe("Splat.PLY");
  expect(config.timeout).toBe(0);
  await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Trained saved."));
  expect(screen.getByText("No file selected")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledTimes(2);
});

test("small files show KB", async () => {
  API.get.mockResolvedValue({ data: [] });
  renderCard();
  fireEvent.change(fileInput(), { target: { files: [new File([new Uint8Array(2048)], "p.txt")] } });
  expect(screen.getByText("p.txt (2.0 KB)")).toBeInTheDocument();
});

test.each([
  [{ error: "You are not assigned to this project" }, "You are not assigned to this project"],
  [{ file: ["Bad file"] }, "Bad file"],
  [{ file: "Plain message" }, "Plain message"],
  [undefined, "Failed to save COLMAP points3D.txt."],
])("save error %p -> %p", async (data, message) => {
  API.get.mockResolvedValue({ data: [] });
  API.post.mockRejectedValue({ response: data && { data } });
  renderCard();
  fireEvent.change(fileInput(), { target: { files: [new File(["x"], "p.txt")] } });
  await userEvent.click(saveBtn());
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(message));
  expect(screen.getByText(/p\.txt/)).toBeInTheDocument(); // still selected for retry
});

test("delete asks first, then deletes and reloads; failures show the error", async () => {
  API.get.mockResolvedValue({ data: UPLOADS });
  API.delete.mockResolvedValue({});
  renderCard();
  await screen.findByRole("link", { name: /points3D.txt/ });
  window.confirm.mockReturnValueOnce(false);
  await userEvent.click(screen.getAllByTitle("Delete")[0]);
  expect(window.confirm).toHaveBeenCalledWith("Delete points3D.txt (2026-01-02)?");
  expect(API.delete).not.toHaveBeenCalled();

  await userEvent.click(screen.getAllByTitle("Delete")[1]);
  expect(window.confirm).toHaveBeenLastCalledWith("Delete COLMAP points3D.txt (2026-01-01)?");
  expect(API.delete).toHaveBeenCalledWith("gaussian-files/2/delete/");
  await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("COLMAP points3D.txt deleted."));

  API.delete.mockRejectedValue({});
  await userEvent.click(screen.getAllByTitle("Delete")[0]);
  await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Failed to delete COLMAP points3D.txt."));
});
