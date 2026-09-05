import type { Prisma } from "@prisma/client";
import { mergeArtistPlaycounts, type ArtistPlaycount } from "@/lib/artists";
import { prisma } from "@/server/db";

export async function getCurrentArtistPlaycounts(params: {
  userAccountId: string;
  normalizedNames?: string[];
}): Promise<ArtistPlaycount[]> {
  const normalizedNames = params.normalizedNames
    ? [...new Set(params.normalizedNames)].filter(Boolean)
    : undefined;

  if (normalizedNames && normalizedNames.length === 0) {
    return [];
  }

  const nameFilter: Prisma.StringFilter | undefined = normalizedNames
    ? { in: normalizedNames }
    : undefined;

  const [weeklyRollup, recentTail] = await Promise.all([
    prisma.userKnownArtistRollup.findMany({
      where: {
        userAccountId: params.userAccountId,
        ...(nameFilter ? { normalizedName: nameFilter } : {}),
      },
      select: {
        artistName: true,
        normalizedName: true,
        playcount: true,
      },
    }),
    prisma.userRecentTailArtistCount.findMany({
      where: {
        userAccountId: params.userAccountId,
        ...(nameFilter ? { normalizedName: nameFilter } : {}),
      },
      select: {
        artistName: true,
        normalizedName: true,
        playcount: true,
      },
    }),
  ]);

  return mergeArtistPlaycounts(weeklyRollup, recentTail);
}

export async function getCurrentArtistPlaycount(params: {
  userAccountId: string;
  normalizedName: string;
}): Promise<number> {
  const rows = await getCurrentArtistPlaycounts({
    userAccountId: params.userAccountId,
    normalizedNames: [params.normalizedName],
  });

  return rows[0]?.playcount ?? 0;
}
