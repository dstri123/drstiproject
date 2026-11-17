import { generateStrongPassword, isPasswordStrong, validatePassword } from "./passwordGenerator";

describe("generateStrongPassword", () => {
  test("is 12 chars and always strong (many samples)", () => {
    for (let i = 0; i < 500; i++) {
      const pw = generateStrongPassword();
      expect(pw).toHaveLength(12);
      expect(isPasswordStrong(pw)).toBe(true);
      expect(pw).toMatch(/^[A-Za-z0-9!@#$%^&*_\-+=]+$/);
    }
  });

  test("produces different passwords", () => {
    const set = new Set(Array.from({ length: 50 }, generateStrongPassword));
    expect(set.size).toBeGreaterThan(45);
  });
});

describe("validatePassword", () => {
  test("all rules pass", () => {
    expect(validatePassword("Abcdef1!")).toEqual({
      length: true,
      uppercase: true,
      lowercase: true,
      number: true,
      special: true,
    });
  });

  test.each([
    ["Abcde1!", "length"],
    ["abcdef1!", "uppercase"],
    ["ABCDEF1!", "lowercase"],
    ["Abcdefg!", "number"],
    ["Abcdefg1", "special"],
  ])("%p fails only %s", (pw, rule) => {
    const v = validatePassword(pw);
    expect(v[rule]).toBe(false);
    expect(Object.entries(v).filter(([, ok]) => !ok).map(([k]) => k)).toEqual([rule]);
  });

  test("space and unicode count as special", () => {
    expect(validatePassword("Abcdef1 ").special).toBe(true);
    expect(validatePassword("Abcdef1é").special).toBe(true);
  });

  test("empty string fails everything", () => {
    expect(Object.values(validatePassword("")).every((v) => v === false)).toBe(true);
  });
});

test("isPasswordStrong", () => {
  expect(isPasswordStrong("Abcdef1!")).toBe(true);
  expect(isPasswordStrong("abcdef1!")).toBe(false);
  expect(isPasswordStrong("")).toBe(false);
});
