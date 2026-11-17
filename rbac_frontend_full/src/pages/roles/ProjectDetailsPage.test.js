import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import API from "../../api/axios";
import ProjectDetailsPage from "./ProjectDetailsPage";

// The page calls API(...) directly for saves, so the default export must be callable.
jest.mock("../../api/axios", () => {
  const api = jest.fn();
  Object.assign(api, { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() });
  return { __esModule: true, default: api };
});
jest.mock("./GaussianFileCard", () => ({ kind, projectId }) => <div>gaussian {kind} {String(projectId)}</div>);
jest.mock("./EnvironmentalDataCard", () => ({ projectId }) => <div>environmental {String(projectId)}</div>);

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const PROJECT = { id: 5, slug: "tower-a", project_name: "Tower A", description: "Full description", image: "/media/c.png" };
const BIM = [
  { id: 11, description: "v1", file: "http://s/media/bim/v1.ifc", date: "2026-01-01", is_latest: false },
  { id: 12, description: "v2", file: "http://s/media/bim/v2.ifc", date: "2026-02-01", is_latest: true },
];
const POINT = [{ id: 21, description: "scan", file: "http://s/media/pc/s.e57", date: "2026-01-10", is_latest: true }];

function mockGets({ projects = [PROJECT], bim = BIM, point = POINT } = {}) {
  API.get.mockImplementation((url) => {
    if (url === "projects/") return Promise.resolve({ data: projects });
    if (url.endsWith("/bim/")) return Promise.resolve({ data: bim });
    if (url.endsWith("/pointcloud/")) return Promise.resolve({ data: point });
    return Promise.reject(new Error(url));
  });
}

function Shown() {
  const loc = useLocation();
  const { slug } = useParams();
  return <div>at {loc.pathname} {slug} {JSON.stringify(loc.state)}</div>;
}

function renderPage(state = { projectName: "Tower A" }) {
  render(
    <MemoryRouter initialEntries={["/data", { pathname: "/project/tower-a/data", state }]} initialIndex={1}>
      <Routes>
        <Route path="/data" element={<div>dashboard</div>} />
        <Route path="/project/:slug/data" element={<ProjectDetailsPage />} />
        <Route path="/project/:slug/data/upload-images" element={<Shown />} />
        <Route path="/viewer/:slug" element={<Shown />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowOf = (description) => screen.getByDisplayValue(description).parentElement;

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("loads the project by slug and its BIM / point cloud rows", async () => {
  mockGets();
  renderPage();
  expect(screen.getByText("Loading project data…")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Tower A" })).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledWith("projects/");
  expect(API.get).toHaveBeenCalledWith("projects/5/bim/");
  expect(API.get).toHaveBeenCalledWith("projects/5/pointcloud/");
  expect(screen.getByText("Full description")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Tower A" })).toHaveAttribute("src", "http://127.0.0.1:8000/media/c.png");
  expect(screen.getByDisplayValue("v1")).toBeDisabled();
  expect(screen.getByText("v2.ifc")).toBeInTheDocument();
  expect(within(rowOf("v2")).getByRole("button", { name: "✓ LATEST" })).toBeInTheDocument();
  expect(within(rowOf("v1")).getByRole("button", { name: "Set Latest" })).toBeInTheDocument();
  // the only saved point cloud cannot be deleted
  expect(within(rowOf("scan")).getByRole("button", { name: /delete/i })).toBeDisabled();
  expect(within(rowOf("v1")).getByRole("button", { name: /delete/i })).toBeEnabled();
  expect(screen.getByText("gaussian points3d 5")).toBeInTheDocument();
  expect(screen.getByText("environmental 5")).toBeInTheDocument();
});

test("unknown slug renders empty sections without a project id", async () => {
  mockGets({ projects: [{ ...PROJECT, slug: "other" }] });
  renderPage(null);
  expect(await screen.findByRole("heading", { name: "Selected Project" })).toBeInTheDocument();
  expect(screen.getByText("No BIM data available")).toBeInTheDocument();
  expect(screen.getByText("No Point Cloud data available")).toBeInTheDocument();
  expect(screen.getByText("Manage BIM, Point Cloud, and Image data for this project")).toBeInTheDocument();
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(screen.getByText("environmental null")).toBeInTheDocument();
});

test("a load failure still renders the page", async () => {
  API.get.mockRejectedValue(new Error("down"));
  renderPage();
  expect(await screen.findByText("No BIM data available")).toBeInTheDocument();
});

test("Open 3D Viewer, Upload Images and Back navigate", async () => {
  mockGets();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /open 3d viewer/i }));
  expect(screen.getByText(/at \/viewer\/5_Tower A/)).toBeInTheDocument();
});

test("Upload Images passes the project id and name", async () => {
  mockGets();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /upload images/i }));
  expect(screen.getByText('at /project/tower-a/data/upload-images tower-a {"projectId":5,"projectName":"Tower A"}')).toBeInTheDocument();
});

test("Back returns to the previous page", async () => {
  mockGets();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /^back$/i }));
  expect(screen.getByText("dashboard")).toBeInTheDocument();
});

describe("adding and saving rows", () => {
  test("first new row is auto-latest; save posts multipart to the project endpoint", async () => {
    mockGets({ bim: [] });
    API.mockResolvedValue({ data: { id: 13, description: "model", file: "http://s/media/bim/m.ifc", date: "2026-03-01", is_latest: true } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add BIM File" }));
    const desc = screen.getAllByPlaceholderText("Description")[0];
    expect(desc).toBeEnabled();
    const row = desc.parentElement;
    expect(within(row).getByRole("button", { name: "✓ LATEST" })).toBeInTheDocument();
    await userEvent.type(desc, "model");
    const fileInput = row.querySelector('input[type="file"]');
    expect(fileInput).toHaveAttribute("accept", ".rvt,.ifc,.dwg,.nwd,.nwc,.fbx");
    await userEvent.upload(fileInput, new File(["x"], "m.ifc"));
    expect(within(row).getByText("m.ifc")).toBeInTheDocument();
    fireEvent.change(within(row).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), { target: { value: "2026-03-01" } });
    await userEvent.click(within(row).getByRole("button", { name: /save/i }));

    const cfg = API.mock.calls[0][0];
    expect(cfg.method).toBe("post");
    expect(cfg.url).toBe("projects/5/bim/");
    expect(cfg.data.get("description")).toBe("model");
    expect(cfg.data.get("date")).toBe("2026-03-01");
    expect(cfg.data.get("is_latest")).toBe("true");
    expect(cfg.data.get("file").name).toBe("m.ifc");
    cfg.onUploadProgress({ loaded: 1, total: 0 }); // ignored without a total
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Saved Successfully"));
    expect(screen.getByDisplayValue("model")).toBeDisabled();
  });

  test("point cloud rows use the point cloud endpoint and accepted formats", async () => {
    mockGets();
    API.mockResolvedValue({ data: { id: 22, description: "", date: "2026-03-01", is_latest: false } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add Point Cloud" }));
    const descs = screen.getAllByPlaceholderText("Description");
    const row = descs[descs.length - 1].parentElement;
    expect(row.querySelector('input[type="file"]')).toHaveAttribute("accept", ".e57,.las,.laz,.pts,.xyz,.ply");
    expect(within(row).getByRole("button", { name: "Set Latest" })).toBeInTheDocument(); // not first
    await userEvent.click(within(row).getByRole("button", { name: /save/i }));
    expect(API.mock.calls[0][0]).toMatchObject({ method: "post", url: "projects/5/pointcloud/" });
    expect(API.mock.calls[0][0].data.has("is_latest")).toBe(false);
    expect(API.mock.calls[0][0].data.has("file")).toBe(false);
  });

  test("a missing date is rejected before saving", async () => {
    mockGets({ bim: [] });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add BIM File" }));
    const row = screen.getAllByPlaceholderText("Description")[0].parentElement;
    fireEvent.change(within(row).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), { target: { value: "" } });
    await userEvent.click(within(row).getByRole("button", { name: /save/i }));
    expect(mockToast.error).toHaveBeenCalledWith("Please select a valid date (YYYY-MM-DD format)");
    expect(API).not.toHaveBeenCalled();
  });

  test("editing an existing row PUTs to the update endpoint; Set Latest sends is_latest", async () => {
    mockGets();
    API.mockResolvedValue({ data: { ...BIM[0], description: "v1 fixed", is_latest: true } });
    renderPage();
    await screen.findByDisplayValue("v1");
    const row = rowOf("v1");
    expect(within(row).getByRole("button", { name: /save/i })).toBeDisabled();
    await userEvent.click(within(row).getByRole("button", { name: "Set Latest" }));
    // marking latest opens the row for editing and moves the flag locally
    expect(within(row).getByRole("button", { name: "✓ LATEST" })).toBeInTheDocument();
    expect(within(rowOf("v2")).getByRole("button", { name: "Set Latest" })).toBeInTheDocument();
    await userEvent.type(screen.getByDisplayValue("v1"), " fixed");
    await userEvent.click(within(row).getByRole("button", { name: /save/i }));
    const cfg = API.mock.calls[0][0];
    expect(cfg).toMatchObject({ method: "put", url: "bim/11/update/" });
    expect(cfg.data.get("is_latest")).toBe("true");
    expect(cfg.data.get("description")).toBe("v1 fixed");
    await waitFor(() => expect(screen.getByDisplayValue("v1 fixed")).toBeDisabled());
  });

  test("Edit / Cancel toggles the row", async () => {
    mockGets();
    renderPage();
    await screen.findByDisplayValue("v1");
    await userEvent.click(within(rowOf("v1")).getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("v1")).toBeEnabled();
    await userEvent.click(within(rowOf("v1")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByDisplayValue("v1")).toBeDisabled();
  });

  test("save errors show the server payload", async () => {
    mockGets();
    API.mockRejectedValue({ response: { data: { file: ["This field is required."] } } });
    renderPage();
    await screen.findByDisplayValue("v1");
    await userEvent.click(within(rowOf("v1")).getByRole("button", { name: "Edit" }));
    await userEvent.click(within(rowOf("v1")).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('{"file":["This field is required."]}'));
    expect(screen.getByDisplayValue("v1")).toBeEnabled();
  });

  test("upload progress is shown while saving a file", async () => {
    mockGets({ bim: [] });
    let finish;
    API.mockImplementation((cfg) => {
      cfg.onUploadProgress({ loaded: 50, total: 100 });
      return new Promise((r) => (finish = r));
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add BIM File" }));
    const row = screen.getAllByPlaceholderText("Description")[0].parentElement;
    await userEvent.upload(row.querySelector('input[type="file"]'), new File(["x"], "m.ifc"));
    await userEvent.click(within(row).getByRole("button", { name: /save/i }));
    expect(await within(row).findByRole("button", { name: /uploading 50%/i })).toBeDisabled();
    finish({ data: { id: 13, description: "", date: "2026-03-01", is_latest: true } });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });
});

describe("deleting rows", () => {
  async function confirmDelete(row) {
    await userEvent.click(within(row).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("alertdialog");
    return dialog;
  }

  test("deleting a saved row calls the delete endpoint and reloads", async () => {
    mockGets();
    API.delete.mockResolvedValue({});
    renderPage();
    await screen.findByDisplayValue("v1");
    const dialog = await confirmDelete(rowOf("v1"));
    expect(within(dialog).getByText(/The BIM entry will be permanently removed/)).toBeInTheDocument();
    mockGets({ bim: [BIM[1]] });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(API.delete).toHaveBeenCalledWith("bim/11/delete/");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Deleted."));
    expect(screen.queryByDisplayValue("v1")).not.toBeInTheDocument();
  });

  test("delete failures show the backend reason", async () => {
    mockGets({ point: [...POINT, { ...POINT[0], id: 22, description: "scan2" }] });
    API.delete.mockRejectedValue({ response: { data: { error: "Cannot delete the only point cloud" } } });
    renderPage();
    await screen.findByDisplayValue("scan2");
    const dialog = await confirmDelete(rowOf("scan2"));
    expect(within(dialog).getByText(/Point Cloud entry/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(API.delete).toHaveBeenCalledWith("pointcloud/22/delete/");
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Cannot delete the only point cloud"));
  });

  test("an unsaved row is dropped locally; Cancel keeps it", async () => {
    mockGets();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add BIM File" }));
    expect(screen.getAllByPlaceholderText("Description")).toHaveLength(4);
    const newRow = screen.getAllByPlaceholderText("Description")[2].parentElement;
    let dialog = await confirmDelete(newRow);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByPlaceholderText("Description")).toHaveLength(4);
    dialog = await confirmDelete(newRow);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getAllByPlaceholderText("Description")).toHaveLength(3));
    expect(API.delete).not.toHaveBeenCalled();
  });

  test("an unsaved point cloud row is dropped locally", async () => {
    mockGets();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add Point Cloud" }));
    const descs = screen.getAllByPlaceholderText("Description");
    const dialog = await confirmDelete(descs[descs.length - 1].parentElement);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getAllByPlaceholderText("Description")).toHaveLength(3));
  });
});

