// Note: CreateProjectUser is not imported anywhere (superseded by CreateProjectContributor).
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API from "../../api/axios";
import CreateProjectUser from "./CreateProjectUser";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

afterEach(() => jest.useRealTimers());

const createBtn = () => screen.getByRole("button", { name: /^create$/i });

async function fill(user, { username = "u1", password = "Abcdef1!", confirm = password, role = "project_engineer" } = {}) {
  if (username) await user.type(screen.getByLabelText("Username"), username);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  if (confirm) await user.type(screen.getByLabelText("Confirm Password"), confirm);
  if (role) await user.selectOptions(screen.getByLabelText("Select Role"), role);
}

test("rules list shows until password is strong; Create needs username, strong matching password and role", async () => {
  const user = userEvent.setup();
  render(<CreateProjectUser />);
  expect(screen.getByText("Password must contain:")).toBeInTheDocument();
  expect(createBtn()).toBeDisabled();
  await fill(user, { role: "" });
  expect(screen.getByText(/Strong Password/)).toBeInTheDocument();
  expect(createBtn()).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Select Role"), "data_contributor");
  expect(createBtn()).toBeEnabled();
  await user.type(screen.getByLabelText("Confirm Password"), "x");
  expect(createBtn()).toBeDisabled();
});

test("success posts with bearer token, shows message, resets, and clears message after 3s", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  localStorage.setItem("token", "tkn");
  API.post.mockResolvedValue({ data: {} });
  render(<CreateProjectUser />);
  await fill(user);
  await user.click(createBtn());
  expect(API.post).toHaveBeenCalledWith(
    "create-user-assign/",
    { username: "u1", password: "Abcdef1!", sub_role: "project_engineer" },
    { headers: { Authorization: "Bearer tkn" } }
  );
  expect(await screen.findByText("Created Successfully ✅")).toBeInTheDocument();
  expect(screen.getByLabelText("Username").value).toBe("");
  act(() => jest.advanceTimersByTime(3000));
  expect(screen.queryByText("Created Successfully ✅")).not.toBeInTheDocument();
});

test("failure shows a generic error", async () => {
  const user = userEvent.setup();
  API.post.mockRejectedValue(new Error("x"));
  render(<CreateProjectUser />);
  await fill(user);
  await user.click(createBtn());
  expect(await screen.findByText("Error ❌")).toBeInTheDocument();
});
