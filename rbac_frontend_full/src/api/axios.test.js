import axios from "axios";
import API from "./axios";

// Every request (API's and the bare axios used for the refresh call) goes
// through a fake adapter, so nothing touches the network.
let adapter;
let assign;
const originalLocation = window.location;

const ok = (config, data = {}) => ({ data, status: 200, statusText: "OK", headers: {}, config });
const fail = (config, status, data = {}) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.config = config;
  err.response = { status, data, headers: {}, config };
  err.isAxiosError = true;
  return Promise.reject(err);
};

beforeAll(() => {
  delete window.location;
  window.location = { ...originalLocation, pathname: "/admin", assign: jest.fn() };
});
afterAll(() => {
  window.location = originalLocation;
});

beforeEach(() => {
  adapter = jest.fn();
  API.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
  assign = jest.fn();
  window.location.assign = assign;
  window.location.pathname = "/admin";
});

const authHeader = (call) => {
  const h = adapter.mock.calls[call][0].headers;
  return typeof h.get === "function" ? h.get("Authorization") : h.Authorization;
};

describe("request interceptor", () => {
  test("base URL points at the v1 API", () => {
    expect(API.defaults.baseURL).toBe("http://127.0.0.1:8000/api/v1/");
  });

  test("attaches the token as a Bearer header", async () => {
    localStorage.setItem("token", "tok");
    adapter.mockImplementation((c) => Promise.resolve(ok(c, { a: 1 })));
    const res = await API.get("projects/");
    expect(res.data).toEqual({ a: 1 });
    expect(authHeader(0)).toBe("Bearer tok");
  });

  test("falls back to the 'access' key", async () => {
    localStorage.setItem("access", "acc");
    adapter.mockImplementation((c) => Promise.resolve(ok(c)));
    await API.get("projects/");
    expect(authHeader(0)).toBe("Bearer acc");
  });

  test("'token' wins over 'access'", async () => {
    localStorage.setItem("token", "tok");
    localStorage.setItem("access", "acc");
    adapter.mockImplementation((c) => Promise.resolve(ok(c)));
    await API.get("projects/");
    expect(authHeader(0)).toBe("Bearer tok");
  });

  test("no header when logged out", async () => {
    adapter.mockImplementation((c) => Promise.resolve(ok(c)));
    await API.get("projects/");
    expect(authHeader(0)).toBeFalsy();
  });

  test.each(["auth/signup/", "auth/login/", "check-admin/", "create-admin/", "auth/password-reset/confirm/"])(
    "public endpoint %s never gets the token",
    async (url) => {
      localStorage.setItem("token", "tok");
      adapter.mockImplementation((c) => Promise.resolve(ok(c)));
      await API.post(url, {});
      expect(authHeader(0)).toBeFalsy();
    },
  );
});

describe("response interceptor", () => {
  test("non-401 errors pass straight through without touching the session", async () => {
    localStorage.setItem("token", "tok");
    localStorage.setItem("refresh", "ref");
    adapter.mockImplementation((c) => fail(c, 500));
    await expect(API.get("projects/")).rejects.toMatchObject({ response: { status: 500 } });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("token")).toBe("tok");
    expect(assign).not.toHaveBeenCalled();
  });

  test("401 refreshes the token and retries the original request", async () => {
    localStorage.setItem("token", "old");
    localStorage.setItem("refresh", "ref");
    adapter
      .mockImplementationOnce((c) => fail(c, 401))
      .mockImplementationOnce((c) => Promise.resolve(ok(c, { access: "new" })))
      .mockImplementationOnce((c) => Promise.resolve(ok(c, { done: true })));

    const res = await API.get("projects/");

    expect(res.data).toEqual({ done: true });
    const refreshCall = adapter.mock.calls[1][0];
    expect(refreshCall.url).toBe("http://127.0.0.1:8000/api/v1/auth/token/refresh/");
    expect(refreshCall.method).toBe("post");
    expect(JSON.parse(refreshCall.data)).toEqual({ refresh: "ref" });
    expect(adapter.mock.calls[2][0].url).toBe("projects/");
    expect(authHeader(2)).toBe("Bearer new");
    expect(localStorage.getItem("token")).toBe("new");
    expect(assign).not.toHaveBeenCalled();
  });

  test("a failed refresh clears the session and sends the user to /login", async () => {
    localStorage.setItem("token", "old");
    localStorage.setItem("access", "old");
    localStorage.setItem("refresh", "expired");
    adapter
      .mockImplementationOnce((c) => fail(c, 401))
      .mockImplementationOnce((c) => fail(c, 401, { detail: "Token is invalid" }));

    await expect(API.get("projects/")).rejects.toMatchObject({ response: { data: { detail: "Token is invalid" } } });
    for (const k of ["token", "access", "refresh"]) expect(localStorage.getItem(k)).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  test("no redirect loop when already on /login", async () => {
    window.location.pathname = "/login";
    localStorage.setItem("refresh", "expired");
    adapter.mockImplementationOnce((c) => fail(c, 401)).mockImplementationOnce((c) => fail(c, 401));
    await expect(API.get("projects/")).rejects.toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem("refresh")).toBeNull();
  });

  test("401 without a refresh token clears the session immediately", async () => {
    localStorage.setItem("token", "old");
    adapter.mockImplementation((c) => fail(c, 401));
    await expect(API.get("projects/")).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(1); // no refresh attempt
    expect(localStorage.getItem("token")).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  test("401 on login (bad credentials) is not refreshed and does not redirect", async () => {
    localStorage.setItem("refresh", "ref");
    adapter.mockImplementation((c) => fail(c, 401, { detail: "bad creds" }));
    await expect(API.post("auth/login/", { username: "u", password: "p" })).rejects.toMatchObject({
      response: { data: { detail: "bad creds" } },
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem("refresh")).toBe("ref");
  });

  test("login 401 with no refresh token clears stale tokens but stays put", async () => {
    localStorage.setItem("token", "stale");
    adapter.mockImplementation((c) => fail(c, 401));
    await expect(API.post("auth/login/", {})).rejects.toBeTruthy();
    expect(localStorage.getItem("token")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  test("a retried request that 401s again is not refreshed a second time", async () => {
    localStorage.setItem("refresh", "ref");
    adapter
      .mockImplementationOnce((c) => fail(c, 401))
      .mockImplementationOnce((c) => Promise.resolve(ok(c, { access: "new" })))
      .mockImplementationOnce((c) => fail(c, 401));
    await expect(API.get("projects/")).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  test("network errors (no response) are rejected untouched", async () => {
    localStorage.setItem("token", "tok");
    adapter.mockImplementation((c) => {
      const e = new Error("Network Error");
      e.config = c;
      return Promise.reject(e);
    });
    await expect(API.get("projects/")).rejects.toThrow("Network Error");
    expect(localStorage.getItem("token")).toBe("tok");
  });
});
