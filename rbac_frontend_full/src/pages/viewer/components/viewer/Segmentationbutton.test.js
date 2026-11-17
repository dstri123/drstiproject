import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SegmentationButton from "./Segmentationbutton";

test("inactive button shows segments on click", async () => {
  const onToggle = jest.fn();
  render(<SegmentationButton onToggle={onToggle} />);
  const btn = screen.getByRole("button", { name: "Show Segments" });
  expect(btn).toHaveAttribute("title", "Show spatial segmentation");
  await userEvent.click(btn);
  expect(onToggle).toHaveBeenCalled();
  expect(screen.queryByText(/Compressed/)).not.toBeInTheDocument();
});

test("active button restores colours and shows the compressed badge", () => {
  render(<SegmentationButton onToggle={jest.fn()} active wasCompressed />);
  expect(screen.getByRole("button", { name: "Hide Segments" })).toHaveAttribute(
    "title",
    "Restore original colours",
  );
  expect(screen.getByText("⚡ Compressed")).toBeInTheDocument();
});

test("disabled until a point cloud is loaded", async () => {
  const onToggle = jest.fn();
  render(<SegmentationButton onToggle={onToggle} disabled />);
  const btn = screen.getByRole("button");
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute("title", "Load a point cloud first");
  await userEvent.click(btn);
  expect(onToggle).not.toHaveBeenCalled();
});
