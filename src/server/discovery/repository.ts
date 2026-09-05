import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export async function replaceRecommendationRun(params: {
  visitorSessionId: string;
  userAccountId?: string;
  targetLastfmUsername: string;
  analysisRunId: string;
  selectedLane: string;
  resultsJson: unknown;
}) {
  return prisma.recommendationRun.upsert({
    where: {
      analysisRunId_selectedLane: {
        analysisRunId: params.analysisRunId,
        selectedLane: params.selectedLane,
      },
    },
    create: {
      visitorSessionId: params.visitorSessionId,
      userAccountId: params.userAccountId,
      targetLastfmUsername: params.targetLastfmUsername,
      analysisRunId: params.analysisRunId,
      selectedLane: params.selectedLane,
      newOnly: true,
      resultsJson: params.resultsJson as Prisma.InputJsonValue,
    },
    update: {
      visitorSessionId: params.visitorSessionId,
      userAccountId: params.userAccountId,
      targetLastfmUsername: params.targetLastfmUsername,
      newOnly: true,
      resultsJson: params.resultsJson as Prisma.InputJsonValue,
      createdAt: new Date(),
    },
  });
}
