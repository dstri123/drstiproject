import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API from "../../api/axios";
import AdminProfile from "./Profile";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../layouts/Topbar", () => () => null);
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("../../components/ToastContainer", () => ({ useToast: () => mockToast }));

const PROFILE = {
  username: "admin1",
  email: "a@x.com",
  first_name: "Ann",
  last_name: "Admin",
  bio: "hello",
  role: "admin",
  sub_role: "",
  avatar_url: "",
};

const saveBtn = () => screen.getByRole("button", { name: "Save Changes" });

async function renderLoaded(profile = PROFILE) {
  API.get.mockResolvedValue({ data: profile });
  render(<AdminProfile />);
  await screen.findByLabelText("First name *");
}

test("loads the profile from profile/ and fills the form; admin cannot edit email", async () => {
  await renderLoaded();
  expect(API.get).toHaveBeenCalledWith("profile/");
  expect(screen.getByRole("heading", { name: "Ann Profile Settings" })).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toBeDisabled();
  expect(screen.getByLabelText("Email address")).toBeDisabled();
  expect(screen.getByLabelText("Bio / Description")).toHaveValue("hello");
  expect(screen.getByText("AA")).toBeInTheDocument(); // initials avatar
  expect(screen.getByText("@admin1")).toBeInTheDocument();
});

test("superadmin can edit email and it is validated and sent", async () => {
  const user = userEvent.setup();
  API.put.mockResolvedValue({ data: { email: "new@x.com" } });
  await renderLoaded({ ...PROFILE, role: "superadmin" });
  const email = screen.getByLabelText("Email address *");
  expect(email).toBeEnabled();
  await user.clear(email);
  expect(saveBtn()).toBeDisabled();
  await user.type(email, "new@x.com");
  await user.click(saveBtn());
  const fd = API.put.mock.calls[0][1];
  expect(fd.get("email")).toBe("new@x.com");
});

test("role falls back to localStorage when the API omits it", async () => {
  localStorage.setItem("role", "superadmin");
  await renderLoaded({ ...PROFILE, role: "", sub_role: "" });
  expect(screen.getByLabelText("Email address *")).toBeEnabled();
});

test("load failure shows the server error", async () => {
  API.get.mockRejectedValue({ response: { data: { detail: "Token expired" } } });
  render(<AdminProfile />);
  expect(await screen.findByText("Token expired")).toBeInTheDocument();
});

test("load failure without message uses fallback", async () => {
  API.get.mockRejectedValue(new Error("x"));
  render(<AdminProfile />);
  expect(await screen.findByText("Failed to load profile. Please log in again.")).toBeInTheDocument();
});

test("save is disabled with an empty name", async () => {
  const user = userEvent.setup();
  await renderLoaded();
  await user.clear(screen.getByLabelText("First name *"));
  expect(saveBtn()).toBeDisabled();
  await user.type(screen.getByLabelText("First name *"), "Ann");
  expect(saveBtn()).toBeEnabled();
});

test("there is no Security / password section", async () => {
  await renderLoaded();
  expect(screen.queryByText("Security")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Confirm Password")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
});

test("save sends multipart profile/update/, dispatches profileUpdated, and stores profile", async () => {
  const user = userEvent.setup();
  const listener = jest.fn();
  window.addEventListener("profileUpdated", listener);
  API.put.mockResolvedValue({ data: { avatar_url: "http://x/a.png", email: "a@x.com" } });
  await renderLoaded();
  await user.clear(screen.getByLabelText("Last name *"));
  await user.type(screen.getByLabelText("Last name *"), " Smith ");
  await user.click(saveBtn());
  const [url, fd, cfg] = API.put.mock.calls[0];
  expect(url).toBe("profile/update/");
  expect(cfg.headers["Content-Type"]).toBe("multipart/form-data");
  expect(fd.get("first_name")).toBe("Ann");
  expect(fd.get("last_name")).toBe("Smith");
  expect(fd.get("bio")).toBe("hello");
  expect(fd.has("password")).toBe(false); // profile save never changes the password
  expect(fd.has("email")).toBe(false); // only superadmin sends email
  expect(fd.has("avatar")).toBe(false);
  await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Profile updated successfully!"));
  expect(listener).toHaveBeenCalled();
  expect(listener.mock.calls[0][0].detail).toMatchObject({ last_name: "Smith", avatar_url: "http://x/a.png" });
  expect(JSON.parse(localStorage.getItem("profileUpdated"))).toMatchObject({ last_name: "Smith" });
  expect(await screen.findByAltText("Profile avatar")).toHaveAttribute("src", "http://x/a.png");
  window.removeEventListener("profileUpdated", listener);
});

// The backend may re-issue tokens on save; both must be stored.
test("stores re-issued access AND refresh tokens", async () => {
  const user = userEvent.setup();
  localStorage.setItem("token", "old-a");
  localStorage.setItem("refresh", "old-r");
  API.put.mockResolvedValue({ data: { access: "new-a", refresh: "new-r" } });
  await renderLoaded();
  await user.click(saveBtn());
  await waitFor(() => expect(localStorage.getItem("token")).toBe("new-a"));
  expect(localStorage.getItem("refresh")).toBe("new-r");
});

test.each([
  [{ response: { data: { error: "Only the Super Admin can change the email address." } } }, "Only the Super Admin can change the email address."],
  [{ response: { data: { detail: "D" } } }, "D"],
  [{ response: { data: "Server Error" } }, "Server Error"],
  [new Error("x"), "Failed to update profile."],
])("save error %#", async (err, msg) => {
  const user = userEvent.setup();
  API.put.mockRejectedValue(err);
  await renderLoaded();
  await user.click(saveBtn());
  expect(await screen.findByText(msg)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(msg);
});

describe("avatar", () => {
  const input = () => document.querySelector('input[type="file"]');

  test("rejects non-images and files over 5MB", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderLoaded();
    await user.upload(input(), new File(["x"], "a.txt", { type: "text/plain" }));
    expect(mockToast.error).toHaveBeenCalledWith("Please upload a valid image file.");
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 + 1 });
    await user.upload(input(), big);
    expect(mockToast.error).toHaveBeenCalledWith("Image must be smaller than 5MB.");
    expect(screen.queryByText(/New photo selected/)).not.toBeInTheDocument();
  });

  test("valid image previews, is sent on save, and Change photo opens the picker", async () => {
    const user = userEvent.setup();
    API.put.mockResolvedValue({ data: {} });
    await renderLoaded();
    const click = jest.spyOn(input(), "click");
    await user.click(screen.getByRole("button", { name: /change photo/i }));
    expect(click).toHaveBeenCalled();
    const img = new File(["png"], "a.png", { type: "image/png" });
    await user.upload(input(), img);
    expect(screen.getByText(/New photo selected/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText("Profile avatar").getAttribute("src")).toMatch(/^data:/));
    await user.click(saveBtn());
    expect(API.put.mock.calls[0][1].get("avatar")).toBe(img);
    await waitFor(() => expect(screen.queryByText(/New photo selected/)).not.toBeInTheDocument());
  });
});
