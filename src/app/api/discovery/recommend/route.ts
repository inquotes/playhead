import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { generateDeterministicRecommendations, laneToContext } from "@/server/discovery/pipeline";
import type { Lane } from "@/server/discovery/types";
import { getCurrentUserAccount } from "@/server/auth";
import { getKnownArtists } from "@/server/lastfm/service";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  analysisRunId: z.string().min(1),
  laneId: z.string().min(1),
  limit: z.number().int().min(1).max(8).default(4),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;
    const userAccount = await getCurrentUserAccount();
    if (!userAccount) {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before generating recommendations." },
        { status: 401 },
      );
      return attachVisitorCookie(response, context);
    }

    const analysisRun = await prisma.analysisRun.findFirst({ where: { id: payload.analysisRunId, visitorSessionId } });

    if (!analysisRun) {
      const response = NextResponse.json({ ok: false, message: "Analysis run not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const lanePayload = analysisRun.lanesJson as unknown as
      | Lane[]
      | { lanes?: Lane[]; summary?: string; notablePatterns?: string[] };
    const lanes = Array.isArray(lanePayload) ? lanePayload : (lanePayload.lanes ?? []);
    const selectedLane = lanes.find((lane) => lane.id === payload.laneId);

    if (!selectedLane) {
      const response = NextResponse.json({ ok: false, message: "Lane not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const targetUsername = analysisRun.targetLastfmUsername ?? userAccount.lastfmUsername;
    const knownArtists = await getKnownArtists({ username: targetUsername });
    const laneContext = laneToContext(selectedLane);

    const recommendationResult = await generateDeterministicRecommendations({
      username: targetUsername,
      laneContext,
      knownArtists,
      limit: payload.limit,
    });

    await prisma.recommendationRun.deleteMany({
      where: {
        analysisRunId: analysisRun.id,
        selectedLane: selectedLane.id,
        userAccountId: userAccount.id,
        targetLastfmUsername: targetUsername,
      },
    });

    const recommendationRun = await prisma.recommendationRun.create({
      data: {
        visitorSessionId,
        userAccountId: userAccount.id,
        targetLastfmUsername: targetUsername,
        analysisRunId: analysisRun.id,
        selectedLane: selectedLane.id,
        newOnly: true,
        resultsJson: {
          strategyNote: recommendationResult.strategyNote,
          recommendations: recommendationResult.recommendations,
          candidates: recommendationResult.candidates,
          trace: {
            pipeline: "api-first-v1",
            dataSource: "official-lastfm-api",
            deterministicRanking: true,
            llmRole: "explanations-only",
          },
        } as Prisma.InputJsonValue,
      },
    });

    const response = NextResponse.json({
      ok: true,
      recommendationRunId: recommendationRun.id,
      strategyNote: recommendationResult.strategyNote,
      lane: selectedLane,
      recommendations: recommendationResult.recommendations,
      trace: {
        pipeline: "api-first-v1",
        candidateCount: recommendationResult.candidates.length,
      },
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recommendation generation failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
