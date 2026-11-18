import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Layout from "./Layout";

const mockPanel = { props: null };
jest.mock("./Sidebar", () => ({
  __esModule: true,
  default: (props) => {
    mockPanel.props = props;
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "panel" },
      React.createElement("span", null, `panel:${props.activePanel}`),
      React.createElement("button", { onClick: props.onClosePanel }, "close-panel"),
    );
  },
}));

function renderLayout(role = "admin") {
  localStorage.setItem("role", role);
  render(
    <MemoryRouter initialEntries={["/viewer/7_Tower"]}>
      <Layout projectSlug="7_Tower" sidebarProps={{ bimFile: { name: "a.ifc" } }}>
        <div>viewport</div>
      </Layout>
    </MemoryRouter>,
  );
}

test("renders header, toolbar and children with no panel open", () => {
  renderLayout();
  expect(screen.getByText("viewport")).toBeInTheDocument();
  expect(screen.getByText("3D Workspace")).toBeInTheDocument();
  expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
});

test("toolbar opens, switches, toggles and closes the context panel", async () => {
  renderLayout("project_manager");
  await userEvent.click(screen.getByRole("button", { name: "Models" }));
  expect(screen.getByText("panel:models")).toBeInTheDocument();
  expect(mockPanel.props.bimFile).toEqual({ name: "a.ifc" });
  expect(mockPanel.props.role).toBe("project_manager");

  await userEvent.click(screen.getByRole("button", { name: "Cameras" }));
  expect(screen.getByText("panel:cameras")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Cameras" }));
  expect(screen.queryByTestId("panel")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Upload Files" }));
  await userEvent.click(screen.getByText("close-panel"));
  expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
});

test("viewer role gets no Picking/Alignment tools", () => {
  renderLayout("viewer");
  expect(screen.queryByRole("button", { name: "Picking" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Alignment" })).not.toBeInTheDocument();
});

test("icons in the viewer get the dark icon-bar tooltip on hover", async () => {
  renderLayout();
  await userEvent.hover(screen.getByRole("button", { name: "Cameras" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Cameras");
  await userEvent.unhover(screen.getByRole("button", { name: "Cameras" }));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
