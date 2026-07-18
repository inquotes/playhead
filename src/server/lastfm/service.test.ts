import { describe, expect, it } from "vitest";
import { latestBoundaryFromWeeks, normalizeArtistName, toNumber, readString } from "./service";

describe("latestBoundaryFromWeeks", () => {
  it("returns null for an empty list", () => {
    expect(latestBoundaryFromWeeks([])).toBeNull();
  });

  it("returns the newest boundary from an ascending (Last.fm order) list", () => {
    const weeks = [
      { from: 100, to: 200 },
      { from: 200, to: 300 },
      { from: 300, to: 400 },
    ];
    expect(latestBoundaryFromWeeks(weeks)).toBe(400);
  });

  it("is order-independent", () => {
    const weeks = [
      { from: 300, to: 400 },
      { from: 100, to: 200 },
      { from: 200, to: 300 },
    ];
    expect(latestBoundaryFromWeeks(weeks)).toBe(400);
  });
});

describe("normalizeArtistName", () => {
  it("trims and lowercases", () => {
    expect(normalizeArtistName("  Radiohead  ")).toBe("radiohead");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeArtistName("")).toBe("");
  });
});

describe("toNumber", () => {
  it("passes through a number", () => {
    expect(toNumber(42)).toBe(42);
  });

  it("coerces a string to number", () => {
    expect(toNumber("123")).toBe(123);
  });

  it("returns null for NaN", () => {
    expect(toNumber(NaN)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(toNumber(Infinity)).toBeNull();
  });

  it("coerces null to 0", () => {
    // Number(null) is 0, which is finite
    expect(toNumber(null)).toBe(0);
  });

  it("returns null for undefined", () => {
    // Number(undefined) is NaN
    expect(toNumber(undefined)).toBeNull();
  });

  it("coerces empty string to 0", () => {
    // Number("") is 0, which is finite
    expect(toNumber("")).toBe(0);
  });

  it("returns null for non-numeric string", () => {
    expect(toNumber("abc")).toBeNull();
  });
});

describe("readString", () => {
  it("passes through a string with trim", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns empty string for non-string", () => {
    expect(readString(42)).toBe("");
    expect(readString(null)).toBe("");
    expect(readString(undefined)).toBe("");
    expect(readString(true)).toBe("");
  });
});
