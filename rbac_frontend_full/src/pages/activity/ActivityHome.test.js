import { render, screen } from "@testing-library/react";
import ActivityHome from "./ActivityHome";

jest.mock("./SuperAdminActivityPage", () => () => <div>superadmin overview</div>);
jest.mock("./ActivityLogPage", () => (props) => <div>admin log: {props.description}</div>);

test("superadmin gets the by-admin overview", () => {
  localStorage.setItem("role", "superadmin");
  render(<ActivityHome />);
  expect(screen.getByText("superadmin overview")).toBeInTheDocument();
  expect(screen.queryByText(/admin log/)).not.toBeInTheDocument();
});

test.each(["admin", "project_manager", "data_contributor", null])(
  "role %p gets the plain activity log for the users they created",
  (role) => {
    if (role) localStorage.setItem("role", role);
    render(<ActivityHome />);
    expect(screen.getByText(/admin log: .*users you created/)).toBeInTheDocument();
    expect(screen.queryByText("superadmin overview")).not.toBeInTheDocument();
  },
);
