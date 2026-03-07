import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { RECOMMENDATION_LIMIT_BOUNDS, runRecommendAgent, sanitizeRecommendations } from "@/server/agent/runner";
import type { Lane } from "@/server/discovery/types";
import { generateRecommendations } from "@/server/discovery/recommender";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  analysisRunId: z.string().min(1),
  laneId: z.string().min(1),
  newPreferred: z.boolean().default(true),
  limit: RECOMMENDATION_LIMIT_BOUNDS.default(5),
});

function preferNewerOrder<T extends { isLikelyNewEra: boolean }>(
  recommendations: T[],
  enabled: boolean,
  limit: number,
): T[] {
  if (!enabled) {
    return recommendations.slice(0, limit);
  }

  const newer = recommendations.filter((item) => item.isLikelyNewEra);
  const older = recommendations.filter((item) => !item.isLikelyNewEra);
  const minNewer = Math.ceil(limit * 0.6);
  const pickNewer = Math.min(newer.length, minNewer);

  const combined = [...newer.slice(0, pickNewer), ...older.slice(0, Math.max(0, limit - pickNewer))];
  if (combined.length >= limit) {
    return combined.slice(0, limit);
  }

  const used = new Set(combined.map((item) => JSON.stringify(item)));
  for (const item of recommendations) {
    if (combined.length >= limit) break;
    const key = JSON.stringify(item);
    if (used.has(key)) continue;
    combined.push(item);
  }
  return combined.slice(0, limit);
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const [connection, analysisRun] = await Promise.all([
      prisma.lastfmConnection.findUnique({ where: { visitorSessionId } }),
      prisma.analysisRun.findFirst({ where: { id: payload.analysisRunId, visitorSessionId } }),
    ]);

    if (!connection?.mcpSessionId || connection.status !== "connected") {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before generating recommendations." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

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

    const heardArtists = analysisRun.heardArtistsJson as unknown as string[];
    let strategyNote = "";
    let recommendations: Awaited<ReturnType<typeof generateRecommendations>> = [];
    let traceJson: Record<string, unknown> | null = null;

    try {
      const agentResult = await runRecommendAgent({
        mcpSessionId: connection.mcpSessionId,
        lane: selectedLane,
        heardArtists,
        newPreferred: payload.newPreferred,
        limit: payload.limit,
        maxToolCalls: 10,
      });

      recommendations = sanitizeRecommendations(
        agentResult.output.recommendations,
        heardArtists,
        payload.limit,
        payload.newPreferred,
      );
      strategyNote = agentResult.output.strategyNote;
      traceJson = JSON.parse(JSON.stringify(agentResult.trace)) as Record<string, unknown>;
    } catch {
      const fallback = await generateRecommendations({
        mcpSessionId: connection.mcpSessionId,
        lane: selectedLane,
        heardArtists,
        newOnly: false,
        limit: Math.max(payload.limit * 2, 10),
      });

      recommendations = preferNewerOrder(fallback, payload.newPreferred, payload.limit);
      strategyNote = "Fallback recommendation mode used due to invalid model output shape.";
      traceJson = {
        toolCallsUsed: 0,
        maxToolCalls: 10,
        terminationReason: "error",
        steps: [
          {
            index: 1,
            toolName: "fallback_deterministic_recommender",
            arguments: {},
            status: "success",
            durationMs: 0,
            preview: "Used deterministic recommender fallback after agent output validation failure.",
          },
        ],
      };
    }

    const traceSafe = JSON.parse(JSON.stringify(traceJson)) as Record<string, unknown> | null;
    const resultsJson = JSON.parse(
      JSON.stringify({
        strategyNote,
        recommendations,
        trace: traceSafe,
      }),
    ) as Prisma.InputJsonValue;

    const recommendationRun = await prisma.recommendationRun.create({
      data: {
        visitorSessionId,
        analysisRunId: analysisRun.id,
        selectedLane: selectedLane.id,
        newOnly: payload.newPreferred,
        resultsJson,
      },
    });

    const response = NextResponse.json({
      ok: true,
      recommendationRunId: recommendationRun.id,
      strategyNote,
      lane: selectedLane,
      recommendations,
      trace: traceSafe,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "The model returned an invalid recommendation shape. Please retry."
        : error instanceof Error
          ? error.message
          : "Recommendation generation failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
