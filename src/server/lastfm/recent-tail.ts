import { prisma } from "@/server/db";
import { getRecentArtistCounts } from "@/server/lastfm/service";
import { recordDataPull } from "@/server/lastfm/data-pulls";

export async function refreshRecentTailSnapshot(params: {
  userAccountId: string;
  username: string;
  from: number;
  to: number;
  latestWeeklyBoundary: number | null;
}): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  const from = Math.floor(params.from);
  const to = Math.floor(params.to);

  if (to < from) {
    return getRecentTailArtistCountsFromStore({ userAccountId: params.userAccountId });
  }

  const startedAt = new Date();

  await prisma.userRecentTailState.upsert({
    where: { userAccountId: params.userAccountId },
    create: {
      userAccountId: params.userAccountId,
      lastfmUsername: params.username,
      status: "running",
      latestWeeklyBoundary: params.latestWeeklyBoundary,
      tailFrom: from,
      tailTo: to,
      artistCount: 0,
      lastPullStartedAt: startedAt,
      lastErrorMessage: null,
    },
    update: {
      lastfmUsername: params.username,
      status: "running",
      latestWeeklyBoundary: params.latestWeeklyBoundary,
      tailFrom: from,
      tailTo: to,
      artistCount: 0,
      lastPullStartedAt: startedAt,
      lastErrorMessage: null,
    },
  });

  try {
    const rows = await getRecentArtistCounts({
      username: params.username,
      from,
      to,
    });

    const pulledAt = new Date();
    const txOps = [
      prisma.userRecentTailArtistCount.deleteMany({
        where: { userAccountId: params.userAccountId },
      }),
      ...(rows.length > 0
        ? [
            prisma.userRecentTailArtistCount.createMany({
              data: rows.map((row) => ({
                userAccountId: params.userAccountId,
                artistName: row.artistName,
                normalizedName: row.normalizedName,
                playcount: row.playcount,
                tailFrom: from,
                tailTo: to,
                pulledAt,
              })),
            }),
          ]
        : []),
      prisma.userRecentTailState.update({
        where: { userAccountId: params.userAccountId },
        data: {
          status: "idle",
          latestWeeklyBoundary: params.latestWeeklyBoundary,
          tailFrom: from,
          tailTo: to,
          artistCount: rows.length,
          lastPullCompletedAt: pulledAt,
          lastErrorMessage: null,
        },
      }),
    ];
    await prisma.$transaction(txOps);

    await recordDataPull({
      userAccountId: params.userAccountId,
      source: "recent_tail",
      status: "success",
      windowFrom: from,
      windowTo: to,
      recordCount: rows.length,
    });

    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recent-tail pull failed.";
    await prisma.$transaction([
      prisma.userRecentTailArtistCount.deleteMany({
        where: { userAccountId: params.userAccountId },
      }),
      prisma.userRecentTailState.update({
        where: { userAccountId: params.userAccountId },
        data: {
          status: "failed",
          artistCount: 0,
          lastErrorMessage: message,
          lastPullCompletedAt: new Date(),
        },
      }),
    ]);

    await recordDataPull({
      userAccountId: params.userAccountId,
      source: "recent_tail",
      status: "failed",
      windowFrom: from,
      windowTo: to,
      errorMessage: message,
    });

    throw error;
  }
}

export async function getRecentTailArtistCountsFromStore(params: {
  userAccountId: string;
}): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  return prisma.userRecentTailArtistCount.findMany({
    where: { userAccountId: params.userAccountId },
    orderBy: { playcount: "desc" },
    select: {
      artistName: true,
      normalizedName: true,
      playcount: true,
    },
  });
}
