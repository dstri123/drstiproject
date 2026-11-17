import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ElementMetadata from "./ElementMetadata";

const countEl = () =>
  screen.getByText("Overlapping PointCloud Points:").parentElement.nextElementSibling;

test("renders nothing without a selection", () => {
  const { container } = render(<ElementMetadata selectedElement={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("shows element properties formatted to 2 decimals", () => {
  render(
    <ElementMetadata
      selectedElement={{
        name: "Wall A",
        type: "IFCWALL",
        position: [1, 2.345, -3],
        rotation: [0, 1.5708, 0],
        scale: [1, 1, 1],
        visible: false,
      }}
      bimElementCount={40}
      overlapElementCount={3}
      overlappingPoints={1200}
      highlightOverlap
      setHighlightOverlap={jest.fn()}
    />,
  );
  expect(screen.getByText("📦 BIM Elements: 40")).toBeInTheDocument();
  expect(screen.getByText("🟢 Overlapping Elements: 3")).toBeInTheDocument();
  expect(screen.getByText("Name:").parentElement).toHaveTextContent("Name: Wall A");
  expect(screen.getByText("Type:").parentElement).toHaveTextContent("Type: IFCWALL");
  expect(screen.getByText("Position:").parentElement).toHaveTextContent(
    "Position: [1.00, 2.35, -3.00]",
  );
  expect(screen.getByText("Rotation:").parentElement).toHaveTextContent(
    'Rotation: [0.00, 1.57, 0.00, "XYZ"]',
  );
  expect(screen.getByText("Scale:").parentElement).toHaveTextContent("Scale: [1.00, 1.00, 1.00]");
  expect(screen.getByText("Visible:").parentElement).toHaveTextContent("Visible: false");
  expect(countEl()).toHaveTextContent("1200");
  expect(countEl()).toHaveStyle({ color: "#16a34a" });
  expect(screen.getByRole("button", { name: "ON" })).toBeInTheDocument();
});

test("missing fields fall back to dashes and 0", () => {
  render(<ElementMetadata selectedElement={{}} setHighlightOverlap={jest.fn()} />);
  expect(screen.getByText("Name:").parentElement).toHaveTextContent("Name: —");
  expect(screen.getByText("Type:").parentElement).toHaveTextContent("Type: —");
  expect(screen.getByText("Position:").parentElement).toHaveTextContent("Position: [—]");
  expect(screen.getByText("Visible:").parentElement).toHaveTextContent("Visible: —");
  expect(countEl()).toHaveTextContent("0");
  expect(countEl()).toHaveStyle({ color: "black" });
  expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
});

test("toggle flips the highlight and Save Data calls back", async () => {
  let value = false;
  const setHighlightOverlap = jest.fn((fn) => {
    value = fn(value);
  });
  const onSaveOverlapData = jest.fn();
  render(
    <ElementMetadata
      selectedElement={{ name: "x" }}
      setHighlightOverlap={setHighlightOverlap}
      onSaveOverlapData={onSaveOverlapData}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "OFF" }));
  expect(value).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Save Data" }));
  expect(onSaveOverlapData).toHaveBeenCalled();
});

test("Save Data without a handler is harmless", async () => {
  render(<ElementMetadata selectedElement={{ name: "x" }} setHighlightOverlap={jest.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Save Data" }));
});
