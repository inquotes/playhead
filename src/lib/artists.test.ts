import { describe, expect, it } from "vitest";
import { mergeArtistPlaycounts, normalizeArtistName, uniqueArtists } from "./artists";

describe("artist domain helpers", () => {
  it("normalizes artist names", () => {
    expect(normalizeArtistName("  Radiohead  ")).toBe("radiohead");
  });

  it("deduplicates artist names while preserving the first spelling", () => {
    expect(uniqueArtists(["Radiohead", "radiohead", " Björk "])).toEqual(["Radiohead", "Björk"]);
  });

  it("merges and sorts stored playcounts", () => {
    expect(
      mergeArtistPlaycounts(
        [{ artistName: "Radiohead", normalizedName: "radiohead", playcount: 10 }],
        [
          { artistName: "radiohead", normalizedName: "radiohead", playcount: 7 },
          { artistName: "Björk", normalizedName: "björk", playcount: 5 },
        ],
      ),
    ).toEqual([
      { artistName: "Radiohead", normalizedName: "radiohead", playcount: 17 },
      { artistName: "Björk", normalizedName: "björk", playcount: 5 },
    ]);
  });
});
