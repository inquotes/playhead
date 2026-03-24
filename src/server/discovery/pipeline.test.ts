import { describe, expect, it } from "vitest";
import { normalizeArtist, uniqueNormalizedArtists, countTagOverlap, rankCandidate } from "./pipeline";

describe("normalizeArtist", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeArtist("  Radiohead  ")).toBe("radiohead");
  });

  it("lowercases mixed case", () => {
    expect(normalizeArtist("The Beatles")).toBe("the beatles");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeArtist("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeArtist("   ")).toBe("");
  });
});

describe("uniqueNormalizedArtists", () => {
  it("deduplicates preserving first casing", () => {
    expect(uniqueNormalizedArtists(["Radiohead", "radiohead", "RADIOHEAD"])).toEqual(["Radiohead"]);
  });

  it("filters empty and whitespace entries", () => {
    expect(uniqueNormalizedArtists(["Radiohead", "", "  ", "Björk"])).toEqual(["Radiohead", "Björk"]);
  });

  it("preserves order of first occurrence", () => {
    expect(uniqueNormalizedArtists(["B", "A", "b", "a"])).toEqual(["B", "A"]);
  });

  it("returns empty for empty input", () => {
    expect(uniqueNormalizedArtists([])).toEqual([]);
  });
});

describe("countTagOverlap", () => {
  it("counts case-insensitive intersection", () => {
    expect(countTagOverlap(["Rock", "Pop"], ["rock", "jazz"])).toBe(1);
  });

  it("returns 0 for empty candidate tags", () => {
    expect(countTagOverlap([], ["rock", "pop"])).toBe(0);
  });

  it("returns 0 for empty lane tags", () => {
    expect(countTagOverlap(["rock", "pop"], [])).toBe(0);
  });

  it("counts multiple overlaps", () => {
    expect(countTagOverlap(["rock", "indie", "alternative"], ["rock", "alternative", "pop"])).toBe(2);
  });

  it("returns 0 for disjoint sets", () => {
    expect(countTagOverlap(["rock", "metal"], ["jazz", "blues"])).toBe(0);
  });
});

describe("rankCandidate", () => {
  it("scores a strong novel candidate", () => {
    const result = rankCandidate({
      supportCount: 2,
      supportMatchTotal: 50,
      candidateTags: ["rock", "indie"],
      laneTags: ["rock", "alternative"],
      knownPlaycount: null,
      listeners: 500_000,
    });

    // supportScore = 2 * 26 = 52
    // similarityScore = min(36, 50 * 0.35) = 17.5
    // overlapScore = 1 * 9 = 9 (only "rock" overlaps — candidateTags not lowercased by rankCandidate)
    // noveltyScore = 16 (null playcount)
    // listenerScore = max(0, 8 - log10(500000)) ≈ 8 - 5.699 ≈ 2.301
    expect(result.score).toBeGreaterThan(90);
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence[0]).toBe("Supported by 2 lane seed artists.");
    expect(result.evidence[2]).toContain("Not found in broad known-history scan");
  });

  it("penalizes heavily-known artist (playcount >= 10)", () => {
    const result = rankCandidate({
      supportCount: 1,
      supportMatchTotal: 20,
      candidateTags: [],
      laneTags: [],
      knownPlaycount: 50,
      listeners: null,
    });

    // supportScore = 26, similarityScore = 7, overlapScore = 0, noveltyScore = -30, listenerScore = 0
    // total = 26 + 7 + 0 - 30 + 0 = 3
    expect(result.score).toBe(3);
    expect(result.evidence[2]).toContain("Known heavily (50 plays all-time), penalized");
  });

  it("treats lightly-known artist as discovery-eligible", () => {
    const result = rankCandidate({
      supportCount: 1,
      supportMatchTotal: 10,
      candidateTags: [],
      laneTags: [],
      knownPlaycount: 3,
      listeners: null,
    });

    // noveltyScore = max(0, 14 - 3) = 11
    expect(result.evidence[2]).toContain("Known lightly (3 plays all-time), treated as discovery-eligible");
  });

  it("caps similarity score at 36", () => {
    const result = rankCandidate({
      supportCount: 1,
      supportMatchTotal: 200,
      candidateTags: [],
      laneTags: [],
      knownPlaycount: null,
      listeners: null,
    });

    // similarityScore = min(36, 200 * 0.35) = min(36, 70) = 36
    // supportScore = 26, overlapScore = 0, noveltyScore = 16, listenerScore = 0
    // total = 26 + 36 + 0 + 16 + 0 = 78
    expect(result.score).toBe(78);
  });

  it("floors score at zero", () => {
    const result = rankCandidate({
      supportCount: 0,
      supportMatchTotal: 0,
      candidateTags: [],
      laneTags: [],
      knownPlaycount: 100,
      listeners: null,
    });

    // supportScore = 0, similarityScore = 0, overlapScore = 0, noveltyScore = -30, listenerScore = 0
    // max(0, -30) = 0
    expect(result.score).toBe(0);
  });

  it("pluralizes evidence correctly for 1 seed artist", () => {
    const result = rankCandidate({
      supportCount: 1,
      supportMatchTotal: 10,
      candidateTags: [],
      laneTags: [],
      knownPlaycount: null,
      listeners: null,
    });

    expect(result.evidence[0]).toBe("Supported by 1 lane seed artist.");
  });

  it("shows tag overlap evidence when tags match", () => {
    const result = rankCandidate({
      supportCount: 1,
      supportMatchTotal: 10,
      candidateTags: ["rock", "indie"],
      laneTags: ["rock", "indie", "pop"],
      knownPlaycount: null,
      listeners: null,
    });

    expect(result.evidence[1]).toBe("Shares 2 lane tags.");
  });

  it("shows similarity message when no tag overlap", () => {
    const result = rankCandidate({
      supportCount: 1,
      supportMatchTotal: 10,
      candidateTags: ["metal"],
      laneTags: ["jazz"],
      knownPlaycount: null,
      listeners: null,
    });

    expect(result.evidence[1]).toBe("Primary signal is artist-neighborhood similarity.");
  });
});
