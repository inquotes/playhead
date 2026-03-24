import { describe, expect, it } from "vitest";
import { mergeArtistPlaycounts } from "./jobs";

describe("mergeArtistPlaycounts", () => {
  it("merges disjoint arrays", () => {
    const base = [{ artistName: "Radiohead", normalizedName: "radiohead", playcount: 10 }];
    const delta = [{ artistName: "Björk", normalizedName: "björk", playcount: 5 }];

    const result = mergeArtistPlaycounts(base, delta);
    expect(result).toEqual([
      { artistName: "Radiohead", normalizedName: "radiohead", playcount: 10 },
      { artistName: "Björk", normalizedName: "björk", playcount: 5 },
    ]);
  });

  it("sums playcounts for overlapping normalizedName", () => {
    const base = [{ artistName: "Radiohead", normalizedName: "radiohead", playcount: 10 }];
    const delta = [{ artistName: "radiohead", normalizedName: "radiohead", playcount: 7 }];

    const result = mergeArtistPlaycounts(base, delta);
    expect(result).toEqual([
      { artistName: "Radiohead", normalizedName: "radiohead", playcount: 17 },
    ]);
  });

  it("preserves artistName from base entry on overlap", () => {
    const base = [{ artistName: "The Beatles", normalizedName: "the beatles", playcount: 20 }];
    const delta = [{ artistName: "the beatles", normalizedName: "the beatles", playcount: 5 }];

    const result = mergeArtistPlaycounts(base, delta);
    expect(result[0].artistName).toBe("The Beatles");
  });

  it("handles both empty", () => {
    expect(mergeArtistPlaycounts([], [])).toEqual([]);
  });

  it("sorts result descending by playcount", () => {
    const base = [
      { artistName: "A", normalizedName: "a", playcount: 5 },
      { artistName: "B", normalizedName: "b", playcount: 15 },
    ];
    const delta = [
      { artistName: "C", normalizedName: "c", playcount: 10 },
    ];

    const result = mergeArtistPlaycounts(base, delta);
    expect(result.map((r) => r.playcount)).toEqual([15, 10, 5]);
  });
});
