import React, { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GanttChart, { buildHeader, fmtRange, isoWeek, LEFT_W } from "./GanttChart";
import { parseDay } from "./scheduleParser";

const D = (s) => parseDay(s);

// ---------------------------------------------------------------- helpers

describe("fmtRange", () => {
  test("single day, same month, cross month, cross year", () => {
    expect(fmtRange("2024-01-05", "2024-01-05")).toBe("Jan 5");
    expect(fmtRange("2024-01-05", "2024-01-19")).toBe("Jan 5 - 19");
    expect(fmtRange("2024-01-30", "2024-02-02")).toBe("Jan 30 - Feb 2");
    expect(fmtRange("2024-12-30", "2025-12-31")).toBe("Dec 30 - Dec 31");
  });
  test("invalid input -> empty string", () => {
    expect(fmtRange("", "2024-01-01")).toBe("");
    expect(fmtRange("2024-01-01", "nope")).toBe("");
  });
});

describe("isoWeek", () => {
  test.each([
    ["2024-01-01", 1], // Monday
    ["2024-12-30", 1], // belongs to 2025-W01
    ["2021-01-03", 53], // Sunday, still 2020-W53
    ["2026-12-31", 53],
    ["2023-06-15", 24],
  ])("%s -> W%d", (iso, wk) => {
    expect(isoWeek(D(iso))).toBe(wk);
  });
});

describe("buildHeader", () => {
  const start = D("2024-01-01"); // Monday

  test("days zoom: weeks on top, day numbers with weekend flags below", () => {
    const { top, bottom } = buildHeader(start, 14, 30);
    expect(top).toEqual([
      { x: 0, w: 210, label: "Week 1", sub: "Jan 1 - Jan 7" },
      { x: 210, w: 210, label: "Week 2", sub: "Jan 8 - Jan 14" },
    ]);
    expect(bottom).toHaveLength(14);
    expect(bottom[0]).toEqual({ x: 0, w: 30, label: "1", weekend: false, iso: "2024-01-01" });
    expect(bottom[5]).toMatchObject({ label: "6", weekend: true });
    expect(bottom[6]).toMatchObject({ label: "7", weekend: true });
  });

  test("days zoom clips the last partial week to the range", () => {
    const { top } = buildHeader(start, 10, 20);
    expect(top[1]).toMatchObject({ x: 140, w: 60 });
  });

  test("weeks zoom: months on top (clipped to the range), week labels below", () => {
    const { top, bottom } = buildHeader(D("2024-01-29"), 14, 9);
    expect(top).toEqual([
      { x: 0, w: 27, label: "Jan 2024" },
      { x: 27, w: 99, label: "Feb 2024" },
    ]);
    expect(bottom.map((u) => u.label)).toEqual(["W5 · 29", "W6 · 5"]);
    // Narrower zoom drops the day number.
    expect(buildHeader(D("2024-01-29"), 14, 6).bottom.map((u) => u.label)).toEqual(["W5", "W6"]);
  });

  test("months zoom: years on top, month initials below", () => {
    const { top, bottom } = buildHeader(D("2024-12-01"), 62, 3);
    expect(top.map((u) => u.label)).toEqual(["2024", "2025"]);
    expect(top[0]).toEqual({ x: 0, w: 93, label: "2024" });
    expect(bottom.map((u) => u.label)).toEqual(["Dec", "Jan"]);
  });
});

// ---------------------------------------------------------------- component

const act = (over) => ({
  id: "A1",
  name: "Columns",
  wbs: "",
  level: "L1",
  start: "2024-01-01",
  finish: "2024-01-03",
  duration: 3,
  predecessors: [],
  dependency: "",
  status: "Not Started",
  plannedPct: 0,
  milestone: false,
  ifcTypes: "",
  elementCount: null,
  ...over,
});

const GROUPS = [
  {
    key: "L1",
    label: "L1",
    color: "#b0384f",
    start: "2024-01-01",
    finish: "2024-01-05",
    days: 5,
    activities: [
      act({ wbs: "1.1", ifcTypes: "IfcColumn", elementCount: 4, plannedPct: 50 }),
      act({ id: "A2", name: "Beams", start: "2024-01-04", finish: "2024-01-05", duration: 2, predecessors: ["A1"] }),
    ],
  },
  {
    key: "L2",
    label: "L2",
    color: "#ee6a3b",
    start: "2024-01-10",
    finish: "2024-01-10",
    days: 1,
    activities: [
      act({
        id: "M1",
        name: "Handover",
        start: "2024-01-10",
        finish: "2024-01-10",
        duration: 0,
        milestone: true,
        predecessors: ["A1", "ZZZ"],
        status: "Completed",
        actual: { matched: 2, completed: 1, actual_pct: 50.4, scan_date: "2024-01-09", actual_start: "2024-01-02" },
        progress: { label: "On track" },
      }),
    ],
  },
];

function renderGantt(props = {}) {
  const ref = createRef();
  const onToggleGroup = jest.fn();
  const onSelect = jest.fn();
  const utils = render(
    <GanttChart
      ref={ref}
      groups={GROUPS}
      collapsed={new Set()}
      onToggleGroup={onToggleGroup}
      pxPerDay={30}
      rangeStart={D("2024-01-01")}
      totalDays={28}
      today={null}
      selectedId={null}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { ...utils, ref, onToggleGroup, onSelect };
}

const taskRow = (id, name) => screen.getByTitle(`${id} · ${name}`).parentElement.parentElement;

test("renders group headers with task counts and date summaries, and every task", () => {
  renderGantt();
  expect(screen.getByText("2 tasks")).toBeInTheDocument();
  expect(screen.getByText("1 task")).toBeInTheDocument();
  expect(screen.getByText(/• Jan 1 - 5 • 5 days/)).toBeInTheDocument();
  expect(screen.getByText(/• Jan 10 • 1 day$/)).toBeInTheDocument();
  expect(screen.getByTitle("A1 · Columns")).toBeInTheDocument();
  expect(screen.getByTitle("A2 · Beams")).toBeInTheDocument();
  expect(screen.getByTitle("M1 · Handover")).toBeInTheDocument();
  expect(screen.getByTitle("2024-01-01 → 2024-01-03")).toHaveTextContent("Jan 1 - 3");
});

test("collapsed groups hide their tasks; clicking a group header toggles it", async () => {
  const { onToggleGroup } = renderGantt({ collapsed: new Set(["L1"]) });
  expect(screen.queryByTitle("A1 · Columns")).not.toBeInTheDocument();
  expect(screen.getByTitle("M1 · Handover")).toBeInTheDocument();
  await userEvent.click(screen.getByText("2 tasks"));
  expect(onToggleGroup).toHaveBeenCalledWith("L1");
});

test("clicking a task selects it; clicking the selected one clears the selection", async () => {
  const { onSelect, rerender } = renderGantt();
  await userEvent.click(screen.getByTitle("A2 · Beams"));
  expect(onSelect).toHaveBeenLastCalledWith("A2");
  rerender(
    <GanttChart
      groups={GROUPS}
      collapsed={new Set()}
      onToggleGroup={jest.fn()}
      pxPerDay={30}
      rangeStart={D("2024-01-01")}
      totalDays={28}
      today={null}
      selectedId="A2"
      onSelect={onSelect}
    />,
  );
  await userEvent.click(screen.getByTitle("A2 · Beams"));
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

test("bars are positioned by date; planned progress shades the bar", () => {
  renderGantt();
  const bar = taskRow("A1", "Columns").children[1].children[0];
  expect(bar).toHaveStyle({ left: "0px", width: "90px" });
  // 50% planned -> inner fill
  expect(bar.firstChild).toHaveStyle({ width: "50%" });
  const bar2 = taskRow("A2", "Beams").children[1].children[0];
  expect(bar2).toHaveStyle({ left: "90px", width: "60px" });
  expect(bar2.firstChild).toBeNull();
});

test("milestones draw a diamond at the start date", () => {
  renderGantt();
  const diamond = taskRow("M1", "Handover").children[1].children[0];
  expect(diamond).toHaveStyle({ left: `${9 * 30 - 8}px`, transform: "rotate(45deg)" });
});

test("finish-to-start arrows connect visible predecessors only", () => {
  const { container } = renderGantt();
  const paths = Array.from(container.querySelectorAll('path[marker-end="url(#gantt-arrow)"]')).map((p) => p.getAttribute("d"));
  // A1 finishes Jan 3 (x=90), A2 starts Jan 4 (x=90): too close -> detour.
  expect(paths).toContain("M90,65 H98 V84 H82 V103 H88");
  // A1 -> M1 (Jan 10, x=270): straight elbow. Group L2 header sits at y=122.
  expect(paths).toContain("M90,65 H98 V187 H268");
  // Unknown predecessor ZZZ draws nothing.
  expect(paths).toHaveLength(2);
});

test("no arrows to tasks of a collapsed group", () => {
  const { container } = renderGantt({ collapsed: new Set(["L1"]) });
  expect(container.querySelectorAll('path[marker-end="url(#gantt-arrow)"]')).toHaveLength(0);
});

test("hovering a bar shows a tooltip with the activity details; leaving hides it", () => {
  renderGantt();
  const bar = taskRow("A1", "Columns").children[1].children[0];
  fireEvent.mouseMove(bar, { clientX: 10, clientY: 10 });
  expect(screen.getByText("Level: L1 (WBS 1.1)")).toBeInTheDocument();
  expect(screen.getByText("2024-01-01 → 2024-01-03 · 3 workdays")).toBeInTheDocument();
  expect(screen.getByText("IFC: IfcColumn")).toBeInTheDocument();
  expect(screen.getByText("Elements: 4")).toBeInTheDocument();
  expect(screen.getByText(/Status: Not Started · Planned 50% by today/)).toBeInTheDocument();
  expect(screen.queryByText(/Predecessor:/)).not.toBeInTheDocument();
  fireEvent.mouseLeave(bar);
  expect(screen.queryByText("Level: L1 (WBS 1.1)")).not.toBeInTheDocument();
});

test("tooltip for a dependent task and for a scanned milestone", () => {
  renderGantt();
  fireEvent.mouseMove(taskRow("A2", "Beams").children[1].children[0], { clientX: 1, clientY: 1 });
  expect(screen.getByText("Predecessor: A1 (FS)")).toBeInTheDocument();
  expect(screen.getByText("Level: L1")).toBeInTheDocument();

  fireEvent.mouseMove(taskRow("M1", "Handover").children[1].children[0], { clientX: 1, clientY: 1 });
  expect(screen.getByText("2024-01-10 → 2024-01-10 · 0 workdays")).toBeInTheDocument();
  expect(screen.getByText("Predecessor: A1, ZZZ (FS)")).toBeInTheDocument();
  expect(screen.getByText(/Status: Completed \(from scan\)/)).toBeInTheDocument();
  expect(screen.getByText(/Actual 50% \(1\/2 built,/)).toHaveTextContent(
    "Actual 50% (1/2 built, scan 2024-01-09) · On track · started 2024-01-02",
  );
});

test("today's day number is highlighted in the header", () => {
  renderGantt({ today: D("2024-01-17") });
  const header = screen.getByText("Activity").parentElement.parentElement;
  const todayLabel = within(header).getByText("17");
  expect(todayLabel).toHaveStyle({ fontWeight: 700 });
  expect(within(header).getByText("16")).not.toHaveStyle({ fontWeight: 700 });
});

test("imperative handle: scrollToDate and chartViewportWidth", () => {
  const scrollTo = jest.fn();
  Element.prototype.scrollTo = scrollTo;
  const { ref } = renderGantt();
  // jsdom reports clientWidth 0 -> falls back to 1200.
  expect(ref.current.chartViewportWidth()).toBe(1200 - LEFT_W - 2);
  ref.current.scrollToDate("2024-01-11");
  const { left, behavior } = scrollTo.mock.calls[0][0];
  expect(behavior).toBe("smooth");
  expect(left).toBeCloseTo(300 + LEFT_W / 3);
  delete Element.prototype.scrollTo;
});
