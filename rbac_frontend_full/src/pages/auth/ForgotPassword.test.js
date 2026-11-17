import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../api/axios";
import ForgotPassword from "./ForgotPassword";

jest.mock("../../api/axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../components/AuthHeroPanel", () => () => null);

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const sendBtn = () => screen.getByRole("button", { name: "Send code" });
const digit = (n) => screen.getByLabelText(`Digit ${n}`);

async function requestCode(user, email = "admin@acme.com", data = { email: "ad***@acme.com", resend_in: 30 }) {
  API.post.mockResolvedValueOnce({ data });
  await user.type(screen.getByLabelText("Email"), email);
  await user.click(sendBtn());
  await screen.findByText("Check your email");
}

async function typeCode(user, code = "123456") {
  await user.click(digit(1));
  await user.paste(code);
}

async function reachPasswordStep(user) {
  await requestCode(user);
  await typeCode(user);
  API.post.mockResolvedValueOnce({ data: { reset_token: "tok-1" } });
  await user.click(screen.getByRole("button", { name: "Verify" }));
  await screen.findByText("Create a new password");
}

afterEach(() => {
  jest.useRealTimers();
});

describe("step 1: email", () => {
  test("send button is disabled until an email is typed; invalid email shows an error without calling the API", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(sendBtn()).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    expect(sendBtn()).toBeEnabled();
    await user.click(sendBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email address.");
    expect(API.post).not.toHaveBeenCalled();
    // typing clears the error
    await user.type(screen.getByLabelText("Email"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("valid email posts trimmed address and moves to the code step with the masked email", async () => {
    const user = userEvent.setup();
    renderPage();
    API.post.mockResolvedValueOnce({ data: { email: "ad***@acme.com", resend_in: 30 } });
    await user.type(screen.getByLabelText("Email"), "  admin@acme.com ");
    await user.click(sendBtn());
    expect(API.post).toHaveBeenCalledWith("auth/password-reset/request/", { email: "admin@acme.com" });
    expect(await screen.findByText("ad***@acme.com")).toBeInTheDocument();
    expect(screen.getByText(/Resend code in 00:30/)).toBeInTheDocument();
  });

  test("masked email falls back to the typed email and cooldown to 30s when the server omits them", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user, "admin@acme.com", {});
    expect(screen.getByText("admin@acme.com")).toBeInTheDocument();
    expect(screen.getByText(/Resend code in 00:30/)).toBeInTheDocument();
  });

  test.each([
    [{ response: { status: 429, data: { error: "Please wait a few seconds before requesting another code." } } }, "Please wait a few seconds before requesting another code."],
    [{ response: { status: 404, data: { error: "No account found with that email." } } }, "No account found with that email."],
    [{ response: { status: 500, data: { detail: "Server exploded" } } }, "Server exploded"],
    [new Error("Network Error"), "Couldn't send the code. Please try again."],
  ])("request error %#: shows the message and stays on step 1", async (err, msg) => {
    const user = userEvent.setup();
    renderPage();
    API.post.mockRejectedValueOnce(err);
    await user.type(screen.getByLabelText("Email"), "admin@acme.com");
    await user.click(sendBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent(msg);
    expect(screen.getByText("Reset your password")).toBeInTheDocument();
  });

  test("Back to sign in navigates to /login", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
});

describe("403: non-admin roles are sent to their admin", () => {
  function reject403(data) {
    API.post.mockRejectedValueOnce({ response: { status: 403, data } });
  }

  test("shows role label and admin contact with mailto + copy", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    reject403({
      role: "data_contributor",
      admin: { name: "Jane Mary Doe", email: "jane@acme.com", organization: "Acme" },
    });
    await user.type(screen.getByLabelText("Email"), "dc@acme.com");
    await user.click(sendBtn());

    expect(await screen.findByText("Data Contributor passwords are reset by your admin, not by email.")).toBeInTheDocument();
    expect(screen.getByText("Jane Mary Doe")).toBeInTheDocument();
    expect(screen.getByText("JM")).toBeInTheDocument(); // initials capped at 2
    expect(screen.getByText("Primary admin · Acme")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /email/i })).toHaveAttribute(
      "href",
      "mailto:jane@acme.com?subject=Password%20reset%20request"
    );

    await user.click(screen.getByRole("button", { name: /copy email/i }));
    expect(writeText).toHaveBeenCalledWith("jane@acme.com");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  test.each([
    ["project_manager", "Manager"],
    ["manager", "Manager"],
    ["project_engineer", "Project Engineer"],
    ["site_engineer", "Site Engineer"],
    ["member", "Member"],
    ["viewer", "Your"],
    [undefined, "Your"],
  ])("role %s is labelled %s", async (role, label) => {
    const user = userEvent.setup();
    renderPage();
    reject403({ role, admin: null });
    await user.type(screen.getByLabelText("Email"), "x@acme.com");
    await user.click(sendBtn());
    expect(await screen.findByText(`${label} passwords are reset by your admin, not by email.`)).toBeInTheDocument();
    expect(screen.getByText("Contact your organisation's administrator.")).toBeInTheDocument();
  });

  test("admin without email or organization hides the email actions", async () => {
    const user = userEvent.setup();
    renderPage();
    reject403({ role: "member", admin: { name: "Bob" } });
    await user.type(screen.getByLabelText("Email"), "x@acme.com");
    await user.click(sendBtn());
    expect(await screen.findByText("Primary admin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy email/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /email/i })).not.toBeInTheDocument();
  });

  test("clipboard failure is swallowed", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    renderPage();
    reject403({ role: "member", admin: { name: "Bob", email: "bob@a.co" } });
    await user.type(screen.getByLabelText("Email"), "x@acme.com");
    await user.click(sendBtn());
    await user.click(await screen.findByRole("button", { name: /copy email/i }));
    expect(screen.getByRole("button", { name: /copy email/i })).toBeInTheDocument();
  });

  test("Back returns to the email form; Back to sign in goes to /login", async () => {
    const user = userEvent.setup();
    renderPage();
    reject403({ role: "member", admin: null });
    await user.type(screen.getByLabelText("Email"), "x@acme.com");
    await user.click(sendBtn());
    await screen.findByText(/passwords are reset by your admin/);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Reset your password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("x@acme.com");

    reject403({ role: "member", admin: null });
    await user.click(sendBtn());
    await screen.findByText(/passwords are reset by your admin/);
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
});

describe("step 2: code", () => {
  test("verify is disabled until all 6 digits; typing auto-advances; non-digits are ignored", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    const verify = screen.getByRole("button", { name: "Verify" });
    expect(verify).toBeDisabled();

    await user.click(digit(1));
    await user.keyboard("1a2");
    expect(digit(1)).toHaveValue("1");
    expect(digit(2)).toHaveValue("2");
    expect(digit(3)).toHaveFocus();
    await user.keyboard("3456");
    expect(verify).toBeEnabled();
  });

  test("Backspace on an empty box clears the previous box; arrow keys move focus", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    await user.click(digit(1));
    await user.keyboard("12");
    expect(digit(3)).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(digit(2)).toHaveFocus();
    expect(digit(2)).toHaveValue("");
    await user.keyboard("{ArrowLeft}");
    expect(digit(1)).toHaveFocus();
    await user.keyboard("{ArrowLeft}"); // already first — stays
    expect(digit(1)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(digit(2)).toHaveFocus();
    await user.click(digit(6));
    await user.keyboard("{ArrowRight}"); // already last — stays
    expect(digit(6)).toHaveFocus();
  });

  test("pasting a code fills all boxes (non-digits stripped, extra digits dropped)", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    await user.click(digit(1));
    await user.paste("12-34 5678");
    expect([1, 2, 3, 4, 5, 6].map((n) => digit(n).value).join("")).toBe("123456");
  });

  test("multi-character change (autofill) fills from that box onwards", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    fireEvent.change(digit(3), { target: { value: "987" } });
    expect(digit(3)).toHaveValue("9");
    expect(digit(4)).toHaveValue("8");
    expect(digit(5)).toHaveValue("7");
    expect(digit(1)).toHaveValue("");
  });

  test("clearing a box via change empties it", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    fireEvent.change(digit(1), { target: { value: "5" } });
    expect(digit(1)).toHaveValue("5");
    fireEvent.change(digit(1), { target: { value: "" } });
    expect(digit(1)).toHaveValue("");
  });

  test("wrong code shows tries_left message; editing clears the error", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user, " admin@acme.com ");
    await typeCode(user, "111111");
    API.post.mockRejectedValueOnce({
      response: { status: 400, data: { error: "That code isn't right. You have 4 tries left.", tries_left: 4 } },
    });
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(API.post).toHaveBeenLastCalledWith("auth/password-reset/verify/", { email: "admin@acme.com", code: "111111" });
    expect(await screen.findByRole("alert")).toHaveTextContent("You have 4 tries left.");
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();

    fireEvent.change(digit(6), { target: { value: "2" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("tries_left 0 locks the inputs and keeps the error until a resend", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderPage();
    await requestCode(user, "admin@acme.com", { email: "a***@acme.com", resend_in: 2 });
    await typeCode(user, "111111");
    API.post.mockRejectedValueOnce({
      response: { status: 400, data: { error: "Too many incorrect attempts. Please request a new code.", tries_left: 0 } },
    });
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many incorrect attempts");
    expect(digit(1)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();

    // cooldown counts down, then Resend appears
    expect(screen.getByText(/Resend code in 00:02/)).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText(/Resend code in 00:01/)).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1000));

    API.post.mockResolvedValueOnce({ data: { resend_in: 45 } });
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(API.post).toHaveBeenLastCalledWith("auth/password-reset/request/", { email: "admin@acme.com" });
    expect(await screen.findByText(/Resend code in 00:45/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(digit(1)).toBeEnabled();
    expect(digit(1)).toHaveValue("");
  });

  test("resend failure (429 cooldown) shows the server error; generic failure falls back", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderPage();
    await requestCode(user, "admin@acme.com", { resend_in: 1 });
    act(() => jest.advanceTimersByTime(1000));

    API.post.mockRejectedValueOnce({ response: { status: 429, data: { error: "Please wait a few seconds before requesting another code." } } });
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please wait a few seconds");

    API.post.mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("Couldn't resend the code. Please try again.")).toBeInTheDocument();
  });

  test("resend without resend_in falls back to 30s; minute formatting", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderPage();
    await requestCode(user, "admin@acme.com", { resend_in: 61 });
    expect(screen.getByText(/Resend code in 01:01/)).toBeInTheDocument();
    for (let i = 0; i < 61; i++) act(() => jest.advanceTimersByTime(1000));
    API.post.mockResolvedValueOnce({ data: {} });
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText(/Resend code in 00:30/)).toBeInTheDocument();
  });

  test("verify network failure uses fallback message and does not lock", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    await typeCode(user);
    API.post.mockRejectedValueOnce(new Error("Network Error"));
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't verify the code. Please try again.");
    expect(digit(1)).toBeEnabled();
  });

  test("Back returns to the email step keeping the email", async () => {
    const user = userEvent.setup();
    renderPage();
    await requestCode(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Email")).toHaveValue("admin@acme.com");
  });
});

describe("step 3: new password", () => {
  test("rules update live and Save stays disabled until all are met", async () => {
    const user = userEvent.setup();
    renderPage();
    await reachPasswordStep(user);
    const save = screen.getByRole("button", { name: "Save password" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("New password"), "abcdefgh");
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), "abcd1234");
    expect(save).toBeDisabled(); // no symbol
    await user.type(screen.getByLabelText("New password"), "!");
    await user.type(screen.getByLabelText("Confirm new password"), "abcd1234?");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "abcd1234!");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-invalid", "false");
    expect(save).toBeEnabled();
  });

  test("show/hide toggles each password field independently", async () => {
    const user = userEvent.setup();
    renderPage();
    await reachPasswordStep(user);
    const toggles = screen.getAllByRole("button", { name: "Show password" });
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    await user.click(toggles[0]);
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    await user.click(toggles[1]);
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "text");
    await user.click(screen.getAllByRole("button", { name: "Hide password" })[0]);
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
  });

  async function fillValid(user) {
    await user.type(screen.getByLabelText("New password"), "Secret12!");
    await user.type(screen.getByLabelText("Confirm new password"), "Secret12!");
  }

  test("success posts reset_token + new_password and shows Done; Sign in goes to /login", async () => {
    const user = userEvent.setup();
    renderPage();
    await reachPasswordStep(user);
    await fillValid(user);
    API.post.mockResolvedValueOnce({ data: { detail: "Password changed." } });
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(API.post).toHaveBeenLastCalledWith("auth/password-reset/confirm/", { reset_token: "tok-1", new_password: "Secret12!" });
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  test("server error (e.g. same as current password) is shown and cleared on edit", async () => {
    const user = userEvent.setup();
    renderPage();
    await reachPasswordStep(user);
    await fillValid(user);
    API.post.mockRejectedValueOnce({ response: { status: 400, data: { error: "New password must be different from your current password." } } });
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("New password must be different");
    await user.type(screen.getByLabelText("New password"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("network failure uses fallback message", async () => {
    const user = userEvent.setup();
    renderPage();
    await reachPasswordStep(user);
    await fillValid(user);
    API.post.mockRejectedValueOnce(new Error("x"));
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your password. Please try again.");
  });

  test("expired session sends the user back to step 1 with a notice", async () => {
    const user = userEvent.setup();
    renderPage();
    await reachPasswordStep(user);
    await fillValid(user);
    API.post.mockRejectedValueOnce({ response: { status: 400, data: { error: "Your reset session has expired. Please start again." } } });
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your reset session has expired. Please start again.");

    // notice is cleared once a new code is sent
    API.post.mockResolvedValueOnce({ data: { email: "m@x" } });
    await user.click(sendBtn());
    await screen.findByText("Check your email");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByText(/session has expired/)).not.toBeInTheDocument();
  });
});
