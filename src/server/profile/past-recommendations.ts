import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export type PastRecommendationItem = {
  analysisRunId: string;
  createdAt: string;
  rangeStart: number;
  rangeEnd: number;
  laneCount: number;
  recommendations: Array<{
    id: string;
    selectedLane: string;
    laneName: string;
    createdAt: string;
    recommendationCount: number;
  }>;
};

export async function getPastRecommendationsPage(params: {
  userAccountId: string;
  lastfmUsername: string;
  limit: number;
  cursorId?: string;
}): Promise<{ items: PastRecommendationItem[]; nextCursor: string | null }> {
  const boundedLimit = Math.min(Math.max(params.limit, 1), 25);
  let cursorFilter: Prisma.AnalysisRunWhereInput | undefined;

  if (params.cursorId) {
    const cursorRun = await prisma.analysisRun.findFirst({
      where: {
        id: params.cursorId,
        userAccountId: params.userAccountId,
        targetLastfmUsername: params.lastfmUsername,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (cursorRun) {
      cursorFilter = {
        OR: [
          { createdAt: { lt: cursorRun.createdAt } },
          {
            createdAt: cursorRun.createdAt,
            id: { lt: cursorRun.id },
          },
        ],
      };
    }
  }

  const rows = await prisma.analysisRun.findMany({
    where: {
      userAccountId: params.userAccountId,
      targetLastfmUsername: params.lastfmUsername,
      ...(cursorFilter ? cursorFilter : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
    include: {
      recommendationRuns: {
        where: {
          userAccountId: params.userAccountId,
          targetLastfmUsername: params.lastfmUsername,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  const hasMore = rows.length > boundedLimit;
  const pageRows = hasMore ? rows.slice(0, boundedLimit) : rows;
  const items: PastRecommendationItem[] = pageRows.map((analysis) => {
    const payload = analysis.lanesJson as
      | { lanes?: Array<{ id?: string; name?: string }> }
      | Array<{ id?: string; name?: string }>;
    const lanes = Array.isArray(payload) ? payload : (Array.isArray(payload?.lanes) ? payload.lanes : []);
    const laneNameById = new Map(lanes.map((lane) => [String(lane.id ?? ""), lane.name ?? "Saved lane"]));

    return {
      analysisRunId: analysis.id,
      createdAt: analysis.createdAt.toISOString(),
      rangeStart: analysis.rangeStart,
      rangeEnd: analysis.rangeEnd,
      laneCount: lanes.length,
      recommendations: analysis.recommendationRuns.map((recommendation) => {
        const results = recommendation.resultsJson as { recommendations?: unknown[] };
        const recommendationCount = Array.isArray(results?.recommendations) ? results.recommendations.length : 0;
        return {
          id: recommendation.id,
          selectedLane: recommendation.selectedLane,
          laneName: laneNameById.get(recommendation.selectedLane) ?? "Saved lane",
          createdAt: recommendation.createdAt.toISOString(),
          recommendationCount,
        };
      }),
    };
  });

  return {
    items,
    nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
  };
}
