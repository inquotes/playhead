import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    userKnownArtistRollup: { findMany: vi.fn() },
    userRecentTailArtistCount: { findMany: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { getCurrentArtistPlaycount, getCurrentArtistPlaycounts } from "./service";

describe("current listening-history playcounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.userKnownArtistRollup.findMany.mockResolvedValue([]);
    prismaMock.userRecentTailArtistCount.findMany.mockResolvedValue([]);
  });

  it("combines weekly rollup and recent-tail counts", async () => {
    prismaMock.userKnownArtistRollup.findMany.mockResolvedValue([
      { artistName: "Radiohead", normalizedName: "radiohead", playcount: 10 },
    ]);
    prismaMock.userRecentTailArtistCount.findMany.mockResolvedValue([
      { artistName: "Radiohead", normalizedName: "radiohead", playcount: 3 },
    ]);

    await expect(
      getCurrentArtistPlaycount({ userAccountId: "user-1", normalizedName: "radiohead" }),
    ).resolves.toBe(13);
  });

  it("does not query storage for an empty artist selection", async () => {
    await expect(
      getCurrentArtistPlaycounts({ userAccountId: "user-1", normalizedNames: [] }),
    ).resolves.toEqual([]);

    expect(prismaMock.userKnownArtistRollup.findMany).not.toHaveBeenCalled();
    expect(prismaMock.userRecentTailArtistCount.findMany).not.toHaveBeenCalled();
  });
});
