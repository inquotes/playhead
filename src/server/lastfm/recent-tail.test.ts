import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getRecentArtistCountsMock, recordDataPullMock } = vi.hoisted(() => {
  return {
    prismaMock: {
      userRecentTailState: {
        upsert: vi.fn(),
        update: vi.fn(),
      },
      userRecentTailArtistCount: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    },
    getRecentArtistCountsMock: vi.fn(),
    recordDataPullMock: vi.fn(),
  };
});

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/lastfm/service", () => ({ getRecentArtistCounts: getRecentArtistCountsMock }));
vi.mock("@/server/lastfm/data-pulls", () => ({ recordDataPull: recordDataPullMock }));

import { refreshRecentTailSnapshot } from "./recent-tail";

const baseParams = {
  userAccountId: "user-1",
  username: "listener",
  from: 1_000,
  to: 2_000,
  latestWeeklyBoundary: 999,
};

describe("refreshRecentTailSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.userRecentTailArtistCount.findMany.mockResolvedValue([]);
  });

  it("replaces snapshot rows on success", async () => {
    getRecentArtistCountsMock.mockResolvedValue([
      { artistName: "Ana Frango Elétrico", normalizedName: "ana frango elétrico", playcount: 5 },
    ]);

    const rows = await refreshRecentTailSnapshot(baseParams);

    expect(rows).toHaveLength(1);
    expect(prismaMock.userRecentTailArtistCount.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.userRecentTailArtistCount.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(recordDataPullMock).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
  });

  it("preserves stored snapshot rows when the pull fails", async () => {
    getRecentArtistCountsMock.mockRejectedValue(new Error("Last.fm request failed."));

    await expect(refreshRecentTailSnapshot(baseParams)).rejects.toThrow("Last.fm request failed.");

    expect(prismaMock.userRecentTailArtistCount.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.userRecentTailState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", lastErrorMessage: "Last.fm request failed." }),
      }),
    );
    expect(recordDataPullMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("does not overwrite window fields when marking the pull running", async () => {
    getRecentArtistCountsMock.mockRejectedValue(new Error("boom"));

    await expect(refreshRecentTailSnapshot(baseParams)).rejects.toThrow("boom");

    const upsertArgs = prismaMock.userRecentTailState.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArgs.update).not.toHaveProperty("tailFrom");
    expect(upsertArgs.update).not.toHaveProperty("tailTo");
    expect(upsertArgs.update).not.toHaveProperty("artistCount");
  });

  it("no-ops and returns stored rows for invalid windows", async () => {
    prismaMock.userRecentTailArtistCount.findMany.mockResolvedValue([
      { artistName: "Stored", normalizedName: "stored", playcount: 2 },
    ]);

    const rows = await refreshRecentTailSnapshot({ ...baseParams, from: 2_000, to: 1_000 });

    expect(rows).toHaveLength(1);
    expect(getRecentArtistCountsMock).not.toHaveBeenCalled();
    expect(prismaMock.userRecentTailState.upsert).not.toHaveBeenCalled();
  });
});
