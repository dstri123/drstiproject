import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IssuesPanel from "./IssuesPanel";

const ISSUES = [
  { id: 1, number: 1, title: "Leak", status: "open", assignee_name: "Asha", due_date: "2000-01-01" },
  { id: 2, number: 2, title: "Crack", status: "in_progress", due_date: "2999-01-01" },
  { id: 3, number: 3, title: "Paint", status: "resolved" },
  { id: 4, number: 4, title: "Odd", status: "weird" },
];

function renderPanel(props = {}) {
  const handlers = {
    onTogglePinMode: jest.fn(),
    onOpen: jest.fn(),
    onExport: jest.fn().mockResolvedValue(),
    onToggleVisible: jest.fn(),
  };
  render(
    <IssuesPanel
      issues={ISSUES}
      loading={false}
      pinMode={false}
      hasBim
      hiddenIds={new Set([2])}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

test("default filter shows open and in-progress issues with meta", () => {
  renderPanel();
  expect(screen.getByText("Leak")).toBeInTheDocument();
  expect(screen.getByText("Crack")).toBeInTheDocument();
  expect(screen.queryByText("Paint")).not.toBeInTheDocument();
  expect(screen.getByText(/· Asha/)).toBeInTheDocument();
  expect(screen.getByText("· overdue 2000-01-01")).toBeInTheDocument();
  expect(screen.getByText("· due 2999-01-01")).toBeInTheDocument();
});

test("filters by status and all", async () => {
  renderPanel();
  const select = screen.getByRole("combobox");
  await userEvent.selectOptions(select, "resolved");
  expect(screen.getByText("Paint")).toBeInTheDocument();
  expect(screen.queryByText("Leak")).not.toBeInTheDocument();
  await userEvent.selectOptions(select, "closed");
  expect(screen.getByText("No issues match this filter.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /BCF/ })).toBeDisabled();
  await userEvent.selectOptions(select, "all");
  expect(screen.getByText("Odd")).toBeInTheDocument();
  // unknown status falls back to the Open style
  expect(within(screen.getByText("Odd").closest("button")).getByText("Open")).toBeInTheDocument();
});

test("clicking a row opens the issue; the eye toggles its pin", async () => {
  const h = renderPanel();
  await userEvent.click(screen.getByText("Leak"));
  expect(h.onOpen).toHaveBeenCalledWith(ISSUES[0]);
  await userEvent.click(screen.getByTitle("Show pin in viewer"));
  expect(h.onToggleVisible).toHaveBeenCalledWith(2);
  await userEvent.click(screen.getByTitle("Hide pin in viewer"));
  expect(h.onToggleVisible).toHaveBeenCalledWith(1);
});

test("export passes the current status filter", async () => {
  const h = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: /BCF/ }));
  expect(h.onExport).toHaveBeenLastCalledWith({ status: "open,in_progress" });
  await userEvent.selectOptions(screen.getByRole("combobox"), "all");
  await userEvent.click(screen.getByRole("button", { name: /BCF/ }));
  expect(h.onExport).toHaveBeenLastCalledWith({});
});

test("export button is disabled while exporting and re-enabled after", async () => {
  let resolve;
  const onExport = jest.fn(() => new Promise((r) => (resolve = r)));
  renderPanel({ onExport });
  const btn = screen.getByRole("button", { name: /BCF/ });
  await userEvent.click(btn);
  expect(btn).toBeDisabled();
  resolve();
  await waitFor(() => expect(btn).toBeEnabled());
});

test("pin button toggles pin mode", async () => {
  const h = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: /Pin new issue/ }));
  expect(h.onTogglePinMode).toHaveBeenCalled();
});

test("pin mode shows the hint and a cancel button even without BIM", () => {
  renderPanel({ pinMode: true, hasBim: false });
  expect(screen.getByRole("button", { name: /Cancel pinning/ })).toBeEnabled();
  expect(screen.getByText(/Click a spot on the model/)).toBeInTheDocument();
});

test("pinning is disabled without a BIM model", () => {
  renderPanel({ hasBim: false });
  const btn = screen.getByRole("button", { name: /Pin new issue/ });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute("title", "Load a BIM model to pin issues");
});

test("loading and empty states", () => {
  const base = {
    pinMode: false,
    hasBim: true,
    onTogglePinMode: jest.fn(),
    onOpen: jest.fn(),
    onExport: jest.fn(),
  };
  const { rerender } = render(<IssuesPanel issues={[]} loading {...base} />);
  expect(screen.getByText("Loading issues…")).toBeInTheDocument();
  rerender(<IssuesPanel issues={[]} loading={false} {...base} />);
  expect(screen.getByText("No issues yet.")).toBeInTheDocument();
});
