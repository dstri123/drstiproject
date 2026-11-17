import { formatDateTime, formatRole, initialsOf } from "./activityFormat";

describe("formatRole", () => {
  test.each([
    ["project_manager", "Project Manager"],
    ["data_contributor", "Data Contributor"],
    ["admin", "Admin"],
    ["superadmin", "Superadmin"],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("%p -> %p", (input, expected) => {
    expect(formatRole(input)).toBe(expected);
  });
});

describe("formatDateTime", () => {
  test("missing values render as a dash", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
    expect(formatDateTime("")).toBe("-");
  });

  test("formats an ISO timestamp in the local short format", () => {
    const iso = "2026-03-04T05:06:00Z";
    expect(formatDateTime(iso)).toBe(
      new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    expect(formatDateTime(iso)).toMatch(/2026/);
  });
});

describe("initialsOf", () => {
  test.each([
    ["Ada Lovelace", "AL"],
    ["ada lovelace byron", "AL"],
    ["john.doe", "JD"],
    ["a_b-c", "AB"],
    ["x", "X"],
    ["  spaced   out  ", "SO"],
    ["", "?"],
    [null, "?"],
    [undefined, "?"],
    ["...", "?"],
  ])("%p -> %p", (input, expected) => {
    expect(initialsOf(input)).toBe(expected);
  });
});
