import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import PhotoFolders from "./PhotoFolders";

const FOLDERS = [
  {
    id: 1,
    name: "March",
    uploadedAt: "2026-03-01T00:00:00Z",
    cameraMatrixFileName: "cam.json",
    cameraMatrixUrl: "blob:cam",
    isLatest: true,
    images: [{ name: "a.jpg", url: "blob:a" }],
  },
  { id: 2, name: "April", uploadedAt: "2026-04-01T00:00:00Z", images: [] },
];

function Folder() {
  return <div>folder {useParams().id}</div>;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/photos"]}>
      <Routes>
        <Route path="/photos" element={<PhotoFolders />} />
        <Route path="/photos/upload" element={<div>upload page</div>} />
        <Route path="/photos/:id" element={<Folder />} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = (name) => screen.getByText(name).closest("div").parentElement.parentElement;
const stored = () => JSON.parse(localStorage.getItem("photoFolders"));

beforeEach(() => {
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => jest.restoreAllMocks());

test("empty state when nothing is stored", () => {
  renderPage();
  expect(screen.getByText("No folders uploaded yet.")).toBeInTheDocument();
  expect(stored()).toEqual([]);
});

test("corrupt storage falls back to an empty list", () => {
  localStorage.setItem("photoFolders", "{not json");
  renderPage();
  expect(screen.getByText("No folders uploaded yet.")).toBeInTheDocument();
});

test("lists stored folders with images, camera matrix and latest flag", () => {
  localStorage.setItem("photoFolders", JSON.stringify(FOLDERS));
  renderPage();
  expect(screen.getByText("March")).toBeInTheDocument();
  expect(screen.getByText("April")).toBeInTheDocument();
  expect(screen.getByText("cam.json")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(screen.getAllByText("Latest")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "a.jpg" })).toHaveAttribute("src", "blob:a");
});

test("rename via prompt persists; cancelling the prompt keeps the name", async () => {
  localStorage.setItem("photoFolders", JSON.stringify(FOLDERS));
  const prompt = jest.spyOn(window, "prompt").mockReturnValueOnce(null).mockReturnValueOnce("Spring");
  renderPage();
  await userEvent.click(within(card("March")).getByRole("button", { name: "Edit" }));
  expect(screen.getByText("March")).toBeInTheDocument();
  await userEvent.click(within(card("March")).getByRole("button", { name: "Edit" }));
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Spring")).toBeInTheDocument();
  expect(stored()[0].name).toBe("Spring");
});

test("delete removes the folder, revokes its object URLs and persists", async () => {
  localStorage.setItem("photoFolders", JSON.stringify(FOLDERS));
  renderPage();
  await userEvent.click(within(card("March")).getByRole("button", { name: "Delete" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cam");
  expect(screen.queryByText("March")).not.toBeInTheDocument();
  expect(stored().map((f) => f.id)).toEqual([2]);

  await userEvent.click(within(card("April")).getByRole("button", { name: "Delete" }));
  expect(screen.getByText("No folders uploaded yet.")).toBeInTheDocument();
});

test("copy link writes the folder URL to the clipboard", async () => {
  localStorage.setItem("photoFolders", JSON.stringify(FOLDERS));
  const writeText = jest.fn();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  renderPage();
  await userEvent.click(within(card("April")).getByRole("button", { name: "Copy Link" }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/photos/2`);
});

test("Open Folder and Upload navigate", async () => {
  localStorage.setItem("photoFolders", JSON.stringify(FOLDERS));
  renderPage();
  await userEvent.click(within(card("April")).getByRole("button", { name: "Open Folder" }));
  expect(screen.getByText("folder 2")).toBeInTheDocument();
});

test("Upload goes to the upload page", async () => {
  renderPage();
  await userEvent.click(screen.getByRole("button", { name: "Upload" }));
  expect(screen.getByText("upload page")).toBeInTheDocument();
});
