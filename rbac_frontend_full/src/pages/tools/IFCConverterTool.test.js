// Note: IFCConverterTool is not routed or imported anywhere (ToolsPage lists no
// tools), and processing/tools/convert-ifc/ is not mounted in the live backend.
// These tests pin its client-side behaviour in case it is wired up again.
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import IFCConverterTool from "./IFCConverterTool";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

function renderTool() {
  render(
    <MemoryRouter initialEntries={["/tools/ifc"]}>
      <Routes>
        <Route path="/tools/ifc" element={<IFCConverterTool />} />
        <Route path="/tools" element={<div>tools page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const input = () => document.querySelector('input[type="file"]');
const pick = (name, size = 1024 * 1024) =>
  fireEvent.change(input(), { target: { files: [new File([new Uint8Array(size)], name)] } });
const convertBtn = () => screen.getByRole("button", { name: /convert to fbx|converting/i });

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("only .ifc files are accepted", () => {
  renderTool();
  expect(convertBtn()).toBeDisabled();
  pick("model.rvt");
  expect(mockToast.error).toHaveBeenCalledWith("Only .ifc files are supported");
  expect(convertBtn()).toBeDisabled();
  pick("Model.IFC");
  expect(screen.getByText("Model.IFC")).toBeInTheDocument();
  expect(screen.getByText("Size: 1.00 MB")).toBeInTheDocument();
  expect(convertBtn()).toBeEnabled();
});

test("converts, then downloads the result", async () => {
  API.post.mockResolvedValue({ data: { success: true, message: "Converted", file_id: "abc", output_file: "model.fbx" } });
  API.get.mockResolvedValue({ data: new Blob(["fbx"]) });
  window.URL.createObjectURL = jest.fn(() => "blob:fbx");
  window.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  renderTool();
  pick("model.ifc");
  await userEvent.click(convertBtn());
  const [url, form] = API.post.mock.calls[0];
  expect(url).toBe("processing/tools/convert-ifc/");
  expect(form.get("file").name).toBe("model.ifc");
  expect(await screen.findByText("✓ Converted")).toBeInTheDocument();
  expect(mockToast.success).toHaveBeenCalledWith("Conversion successful! Ready to download.");
  expect(convertBtn()).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: /download fbx/i }));
  expect(API.get).toHaveBeenCalledWith("processing/tools/convert-ifc/", { params: { file_id: "abc" }, responseType: "blob" });
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(await screen.findByText("Download complete")).toBeInTheDocument();
  expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fbx");
});

test("download failure is reported", async () => {
  API.post.mockResolvedValue({ data: { success: true, message: "ok", file_id: "abc" } });
  API.get.mockRejectedValue(new Error("x"));
  renderTool();
  pick("model.ifc");
  await userEvent.click(convertBtn());
  await userEvent.click(await screen.findByRole("button", { name: /download fbx/i }));
  expect(await screen.findByText("Download failed")).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith("Download failed");
});

test.each([
  [{ data: { success: false, message: "Bad geometry" } }, "Bad geometry", "Conversion failed"],
  [{ data: { success: false } }, "Conversion failed", "Conversion failed"],
])("server-reported failure %#", async (response, toast, status) => {
  API.post.mockResolvedValue(response);
  renderTool();
  pick("model.ifc");
  await userEvent.click(convertBtn());
  expect(await screen.findByText(status)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(toast);
});

test("request errors show the server error", async () => {
  API.post.mockRejectedValue({ response: { data: { error: "Blender missing" } } });
  renderTool();
  pick("model.ifc");
  await userEvent.click(convertBtn());
  expect(await screen.findByText("Error: Blender missing")).toBeInTheDocument();
});

test("upload progress drives the bar, then processing stages tick until the server answers", async () => {
  jest.useFakeTimers();
  let resolve;
  API.post.mockImplementation((url, form, config) => {
    config.onUploadProgress({ loaded: 50, total: 100 });
    config.onUploadProgress({ loaded: 100, total: 100 });
    return new Promise((r) => (resolve = r));
  });
  renderTool();
  pick("model.ifc");
  fireEvent.click(convertBtn());
  expect(screen.getByText("30% Complete")).toBeInTheDocument();
  expect(screen.getByText("Parsing IFC file...")).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(2000));
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText("Extracting geometry...")).toBeInTheDocument();
  expect(screen.getByText("55% Complete")).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(10000));
  expect(screen.getByText("Almost done...")).toBeInTheDocument();
  await act(async () => resolve({ data: { success: true, message: "Done", file_id: "x" } }));
  expect(screen.getByText("✓ Done")).toBeInTheDocument();
});

test("Back to Tools navigates", async () => {
  renderTool();
  await userEvent.click(screen.getByRole("button", { name: /back to tools/i }));
  expect(screen.getByText("tools page")).toBeInTheDocument();
});
