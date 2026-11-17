import { render } from "@testing-library/react";
import { DayPicker } from "react-day-picker";
import { Calendar } from "./calendar";

// react-day-picker v10 pulls in ESM-only date-fns locales that CRA's Jest
// config doesn't transform, so the real DayPicker can't load here. Check the
// wrapper's own logic (defaults + class merging) against a stub instead.
jest.mock("react-day-picker", () => ({ DayPicker: jest.fn(() => null) }));

const lastProps = () => DayPicker.mock.calls[DayPicker.mock.calls.length - 1][0];

beforeEach(() => DayPicker.mockImplementation(() => null));

test("shows outside days by default and pads the root", () => {
  render(<Calendar className="mine" />);
  const p = lastProps();
  expect(p.showOutsideDays).toBe(true);
  expect(p.className).toBe("p-3 mine");
  expect(p.classNames.day_selected).toMatch(/bg-black/);
  expect(typeof p.components.IconLeft).toBe("function");
});

test("callers can override showOutsideDays, classNames and pass through props", () => {
  const onSelect = jest.fn();
  render(<Calendar showOutsideDays={false} classNames={{ day: "custom" }} mode="single" onSelect={onSelect} />);
  const p = lastProps();
  expect(p.showOutsideDays).toBe(false);
  expect(p.classNames.day).toBe("custom");
  expect(p.classNames.month).toBe("space-y-4"); // defaults kept
  expect(p.mode).toBe("single");
  expect(p.onSelect).toBe(onSelect);
});
