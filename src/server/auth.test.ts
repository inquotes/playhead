import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAuthStateToken,
  isValidAuthStateToken,
  createAuthCompletionToken,
  parseAuthCompletionToken,
} from "./auth";

const TEST_KEY = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

beforeAll(() => {
  process.env.LASTFM_SESSION_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  delete process.env.LASTFM_SESSION_ENCRYPTION_KEY;
});

describe("auth state token", () => {
  it("round-trips: create then validate", () => {
    const token = createAuthStateToken();
    expect(isValidAuthStateToken(token)).toBe(true);
  });

  it("rejects tampered signature", () => {
    const token = createAuthStateToken();
    const parts = token.split(".");
    // Flip a character in the signature
    const sig = parts[3];
    parts[3] = sig[0] === "a" ? "b" + sig.slice(1) : "a" + sig.slice(1);
    expect(isValidAuthStateToken(parts.join("."))).toBe(false);
  });

  it("matches expected format", () => {
    const token = createAuthStateToken();
    expect(token).toMatch(/^v1\.\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
  });

  it("expires after 10 minutes", () => {
    vi.useFakeTimers();
    try {
      const token = createAuthStateToken();
      // Still valid at 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(isValidAuthStateToken(token)).toBe(true);

      // Expired at 11 minutes (from original creation)
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(isValidAuthStateToken(token)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("auth completion token", () => {
  it("round-trips: create then parse", () => {
    const token = createAuthCompletionToken({ userAccountId: "user-123", next: "/dashboard" });
    const parsed = parseAuthCompletionToken(token);
    expect(parsed).toEqual({ userAccountId: "user-123", next: "/dashboard" });
  });

  it("rejects tampered signature", () => {
    const token = createAuthCompletionToken({ userAccountId: "user-123", next: "/home" });
    const parts = token.split(".");
    const sig = parts[5];
    parts[5] = sig[0] === "a" ? "b" + sig.slice(1) : "a" + sig.slice(1);
    expect(parseAuthCompletionToken(parts.join("."))).toBeNull();
  });

  it("expires after 2 minutes", () => {
    vi.useFakeTimers();
    try {
      const token = createAuthCompletionToken({ userAccountId: "user-123", next: "/home" });

      // Still valid at 1 minute
      vi.advanceTimersByTime(60 * 1000);
      expect(parseAuthCompletionToken(token)).not.toBeNull();

      // Expired at 3 minutes (from original creation)
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(parseAuthCompletionToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects next path not starting with /", () => {
    const token = createAuthCompletionToken({ userAccountId: "user-123", next: "http://evil.com" });
    expect(parseAuthCompletionToken(token)).toBeNull();
  });

  it("rejects next path starting with //", () => {
    const token = createAuthCompletionToken({ userAccountId: "user-123", next: "//evil.com" });
    expect(parseAuthCompletionToken(token)).toBeNull();
  });
});
