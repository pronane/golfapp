import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertAuthSecret, isPlaceholderSecret } from "@/lib/session";

const REAL_SECRET = "Qm7v1sJ0mZ0Xk3lP9wR2tY5uI8oA1sD4fG7hJ0kL2nM5bV8cX1zQ4";

describe("session secret guard", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...process.env, NODE_ENV: "production" };
  });

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it("accepts a real random secret in production", () => {
    process.env.AUTH_SECRET = REAL_SECRET;
    expect(() => assertAuthSecret()).not.toThrow();
    expect(isPlaceholderSecret(REAL_SECRET)).toBe(false);
  });

  it("rejects a missing secret in production", () => {
    delete process.env.AUTH_SECRET;
    expect(() => assertAuthSecret()).toThrow(/AUTH_SECRET/);
  });

  it("rejects a short secret in production", () => {
    process.env.AUTH_SECRET = "short-secret";
    expect(() => assertAuthSecret()).toThrow(/32 characters/);
  });

  it("rejects the placeholder that used to ship in .env.example", () => {
    // 33 characters, so a length check alone would have accepted it.
    process.env.AUTH_SECRET = "change-me-to-a-long-random-string";
    expect(() => assertAuthSecret()).toThrow(/placeholder/i);
    expect(isPlaceholderSecret("change-me-to-a-long-random-string")).toBe(true);
  });

  it("rejects the committed dev fallback and other obvious placeholders", () => {
    for (const value of [
      "golfday-dev-secret-change-me-in-production",
      "please-change-this-to-something-longer-than-32",
      "your-secret-here-your-secret-here-your-secret-here",
      "REPLACE-ME-REPLACE-ME-REPLACE-ME-REPLACE-ME",
    ]) {
      expect(isPlaceholderSecret(value), value).toBe(true);
      process.env.AUTH_SECRET = value;
      expect(() => assertAuthSecret(), value).toThrow();
    }
  });

  it("does not police local development", () => {
    process.env = { ...process.env, NODE_ENV: "development" };
    delete process.env.AUTH_SECRET;
    expect(() => assertAuthSecret()).not.toThrow();
  });
});
