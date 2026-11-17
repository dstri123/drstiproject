import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PhotoFolderView from "./PhotoFolderView";

function renderAt(id) {
  render(
    <MemoryRouter initialEntries={["/photos", `/photos/${id}`]} initialIndex={1}>
      <Routes>
        <Route path="/photos" element={<div>folders list</div>} />
        <Route path="/photos/:id" element={<PhotoFolderView />} />
      </Routes>
    </MemoryRouter>,
  );
}

const FOLDER = {
  id: 7,
  name: "March",
  uploadedAt: "2026-03-01T00:00:00Z",
  cameraMatrixFileName: "cam.json",
  images: [
    { name: "a.jpg", url: "blob:a" },
    { name: "b.jpg", url: "blob:b" },
  ],
};

test("shows the folder's images and metadata (id matched as a string)", () => {
  localStorage.setItem("photoFolders", JSON.stringify([FOLDER]));
  renderAt("7");
  expect(screen.getByRole("heading", { name: "March" })).toBeInTheDocument();
  expect(screen.getByText("Camera Matrix: cam.json")).toBeInTheDocument();
  expect(screen.getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual(["blob:a", "blob:b"]);
});

test("missing camera matrix shows a dash", () => {
  localStorage.setItem("photoFolders", JSON.stringify([{ ...FOLDER, cameraMatrixFileName: "" }]));
  renderAt("7");
  expect(screen.getByText("Camera Matrix: —")).toBeInTheDocument();
});

test.each([
  ["nothing stored", null],
  ["unknown id", JSON.stringify([FOLDER])],
])("%s -> folder not found, Back works", async (_label, value) => {
  if (value) localStorage.setItem("photoFolders", value);
  renderAt("99");
  expect(screen.getByRole("heading", { name: "Folder not found" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("folders list")).toBeInTheDocument();
});

test("Back from a folder", async () => {
  localStorage.setItem("photoFolders", JSON.stringify([FOLDER]));
  renderAt("7");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("folders list")).toBeInTheDocument();
});
