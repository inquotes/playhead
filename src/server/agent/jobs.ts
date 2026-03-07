import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getAgentMaxToolCalls, getAgentTimeoutMs } from "@/server/agent/config";
import { publishAgentRunEvent } from "@/server/agent/events";
import { coerceLaneIds, runAnalyzeAgent, runRecommendAgent, sanitizeRecommendations } from "@/server/agent/runner";
import { resolveRange, type RangePreset } from "@/server/discovery/range";
import { generateRecommendations } from "@/server/discovery/recommender";
import type { Lane } from "@/server/discovery/types";
import { callLastfmTool } from "@/server/lastfm/mcp";
import { parseWeeklyArtistChart } from "@/server/lastfm/parsers";

function normalizeArtist(value: string): string {
  return value.trim().toLowerCase();
}

function enrichAnalyzeLanesWithPlayTotals(
  lanes: ReturnType<typeof coerceLaneIds>,
  topArtists: Array<{ artist: string; plays: number }>,
): ReturnType<typeof coerceLaneIds> {
  const playMap = new Map(topArtists.map((item) => [normalizeArtist(item.artist), item.plays]));

  return lanes.map((lane) => {
    const knownLaneArtists = lane.artists
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !/^unknown artist/i.test(name))
      .filter((name) => playMap.has(normalizeArtist(name)));

    const contextText = [
      lane.name,
      lane.description,
      lane.whyThisLane,
      lane.tags.join(" "),
      lane.evidence.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    const contextualArtists = topArtists
      .map((item) => item.artist)
      .filter((artist) => contextText.includes(artist.toLowerCase()))
      .slice(0, 4);

    const artists = knownLaneArtists.length > 0 ? knownLaneArtists : contextualArtists;

    const totalFromMap = artists.reduce((sum, artist) => sum + (playMap.get(normalizeArtist(artist)) ?? 0), 0);

    return {
      ...lane,
      artists,
      totalPlays: totalFromMap > 0 ? totalFromMap : lane.totalPlays,
    };
  });
}

type RunEventAppender = (event: {
  type: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

async function createRunEventAppender(runId: string): Promise<RunEventAppender> {
  const latest = await prisma.agentRunEvent.findFirst({
    where: { runId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  let nextSeq = (latest?.seq ?? 0) + 1;

  return async ({ type, payload }) => {
    const created = await prisma.agentRunEvent.create({
      data: {
        runId,
        seq: nextSeq,
        type,
        payloadJson: payload as Prisma.InputJsonValue,
      },
    });
    nextSeq += 1;

    publishAgentRunEvent({
      runId,
      seq: created.seq,
      type: created.type,
      payload,
      createdAt: created.createdAt.toISOString(),
    });
  };
}

async function markRunFailed(runId: string, message: string, appendRunEvent: RunEventAppender) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      terminationReason: "error",
    },
  });

  await appendRunEvent({
    type: "run_failed",
    payload: { message: `Run failed: ${message}` },
  });
}

export async function launchAnalyzeRun(params: {
  runId: string;
  visitorSessionId: string;
  mcpSessionId: string;
  preset: RangePreset;
  from?: number;
  to?: number;
}) {
  const appendRunEvent = await createRunEventAppender(params.runId);

  try {
    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });

    const range = resolveRange({
      preset: params.preset,
      from: params.from,
      to: params.to,
    });

    await appendRunEvent({
      type: "analysis_seed_fetch_started",
      payload: {
        range,
        message: "Fetching artist listening window.",
      },
    });

    const artistSeedResult = await callLastfmTool(params.mcpSessionId, "get_weekly_artist_chart", {
      from: range.from,
      to: range.to,
    });

    const topArtists = parseWeeklyArtistChart(artistSeedResult.text);
    const heardArtistsSeed = [...new Set(topArtists.map((artist) => artist.artist.trim()))].slice(0, 200);

    await appendRunEvent({
      type: "analysis_seed_fetch_completed",
      payload: {
        topArtistsCount: topArtists.length,
        message: `Fetched weekly artist chart (${topArtists.length} artists).`,
      },
    });

    const maxToolCalls = getAgentMaxToolCalls("analyze");
    const timeoutMs = getAgentTimeoutMs("analyze");

    const agentResult = await runAnalyzeAgent({
      mcpSessionId: params.mcpSessionId,
      rangeLabel: range.label,
      rangeStart: range.from,
      rangeEnd: range.to,
      heardArtistsSeed,
      maxToolCalls,
      timeoutMs,
      onEvent: (event) => appendRunEvent({ type: event.type, payload: event.payload }),
    });

    const lanes = enrichAnalyzeLanesWithPlayTotals(coerceLaneIds(agentResult.output.lanes), topArtists);
    const heardArtists =
      agentResult.output.heardArtists.length > 0 ? agentResult.output.heardArtists : heardArtistsSeed;
    const traceJson = JSON.parse(JSON.stringify(agentResult.trace));

    const analysisRun = await prisma.analysisRun.create({
      data: {
        visitorSessionId: params.visitorSessionId,
        rangeStart: range.from,
        rangeEnd: range.to,
        sourceVersion: "agentic-v2-stream",
        artistsJson: topArtists as Prisma.InputJsonValue,
        tracksJson: [] as Prisma.InputJsonValue,
        heardArtistsJson: heardArtists as Prisma.InputJsonValue,
        lanesJson: {
          summary: agentResult.output.summary,
          notablePatterns: agentResult.output.notablePatterns,
          lanes,
          trace: traceJson,
        } as Prisma.InputJsonValue,
      },
    });

    const resultJson = {
      analysisRunId: analysisRun.id,
      range,
      laneCount: lanes.length,
      summary: agentResult.output.summary,
      notablePatterns: agentResult.output.notablePatterns,
      lanes,
      topArtists: topArtists.slice(0, 10),
      trace: traceJson,
    } as Prisma.InputJsonValue;

    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        terminationReason: agentResult.trace.terminationReason,
        toolCallsUsed: agentResult.trace.toolCallsUsed,
        maxToolCalls: agentResult.trace.maxToolCalls,
        timeoutMs,
        resultJson,
      },
    });

    await appendRunEvent({
      type: "run_completed",
      payload: {
        analysisRunId: analysisRun.id,
        message: "Analyze run completed.",
      },
    });
  } catch (error) {
    await markRunFailed(
      params.runId,
      error instanceof Error ? error.message : "Analyze run failed unexpectedly.",
      appendRunEvent,
    );
  }
}

function preferNewerOrder<T extends { isLikelyNewEra: boolean }>(
  recommendations: T[],
  enabled: boolean,
  limit: number,
): T[] {
  if (!enabled) return recommendations.slice(0, limit);

  const newer = recommendations.filter((item) => item.isLikelyNewEra);
  const older = recommendations.filter((item) => !item.isLikelyNewEra);
  const minNewer = Math.ceil(limit * 0.6);
  const pickNewer = Math.min(newer.length, minNewer);
  const selected = [...newer.slice(0, pickNewer), ...older.slice(0, Math.max(0, limit - pickNewer))];

  if (selected.length >= limit) return selected.slice(0, limit);

  const used = new Set(selected.map((item) => JSON.stringify(item)));
  for (const item of recommendations) {
    if (selected.length >= limit) break;
    const key = JSON.stringify(item);
    if (used.has(key)) continue;
    selected.push(item);
  }

  return selected.slice(0, limit);
}

export async function launchRecommendRun(params: {
  runId: string;
  visitorSessionId: string;
  mcpSessionId: string;
  analysisRunId: string;
  laneId: string;
  newPreferred: boolean;
  limit: number;
}) {
  const appendRunEvent = await createRunEventAppender(params.runId);

  try {
    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });

    const analysisRun = await prisma.analysisRun.findFirst({
      where: {
        id: params.analysisRunId,
        visitorSessionId: params.visitorSessionId,
      },
    });

    if (!analysisRun) {
      throw new Error("Analysis run not found for this session.");
    }

    const lanePayload = analysisRun.lanesJson as unknown as
      | Lane[]
      | { lanes?: Lane[]; summary?: string; notablePatterns?: string[] };
    const lanes = Array.isArray(lanePayload) ? lanePayload : (lanePayload.lanes ?? []);
    const selectedLane = lanes.find((lane) => lane.id === params.laneId);

    if (!selectedLane) {
      throw new Error("Lane not found.");
    }

    const heardArtists = analysisRun.heardArtistsJson as unknown as string[];

    const maxToolCalls = getAgentMaxToolCalls("recommend");
    const timeoutMs = getAgentTimeoutMs("recommend");

    let strategyNote = "";
    let recommendations: Awaited<ReturnType<typeof generateRecommendations>> = [];
    let traceJson: Record<string, unknown> | null = null;

    try {
      const agentResult = await runRecommendAgent({
        mcpSessionId: params.mcpSessionId,
        lane: selectedLane,
        heardArtists,
        newPreferred: params.newPreferred,
        limit: params.limit,
        maxToolCalls,
        timeoutMs,
        onEvent: (event) => appendRunEvent({ type: event.type, payload: event.payload }),
      });

      recommendations = sanitizeRecommendations(
        agentResult.output.recommendations,
        heardArtists,
        params.limit,
        params.newPreferred,
      );
      strategyNote = agentResult.output.strategyNote;
      traceJson = JSON.parse(JSON.stringify(agentResult.trace)) as Record<string, unknown>;
    } catch {
      const fallback = await generateRecommendations({
        mcpSessionId: params.mcpSessionId,
        lane: selectedLane,
        heardArtists,
        newOnly: false,
        limit: Math.max(params.limit * 2, 10),
      });

      recommendations = preferNewerOrder(fallback, params.newPreferred, params.limit);
      strategyNote = "Fallback recommendation mode used due to invalid model output shape.";
      traceJson = {
        toolCallsUsed: 0,
        maxToolCalls,
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

      await appendRunEvent({
        type: "fallback_recommender_used",
        payload: {
          reason: "invalid_agent_output_shape",
          message: "Used deterministic fallback recommender due to invalid agent output shape.",
        },
      });
    }

    const traceSafe = JSON.parse(JSON.stringify(traceJson)) as Record<string, unknown> | null;
    const resultsJson = {
      strategyNote,
      recommendations,
      trace: traceSafe,
    } as Prisma.InputJsonValue;

    const recommendationRun = await prisma.recommendationRun.create({
      data: {
        visitorSessionId: params.visitorSessionId,
        analysisRunId: analysisRun.id,
        selectedLane: selectedLane.id,
        newOnly: params.newPreferred,
        resultsJson,
      },
    });

    const resultJson = {
      recommendationRunId: recommendationRun.id,
      strategyNote,
      lane: selectedLane,
      recommendations,
      trace: traceSafe,
    } as Prisma.InputJsonValue;

    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        terminationReason: (traceSafe?.terminationReason as string | undefined) ?? "final",
        toolCallsUsed: Number((traceSafe?.toolCallsUsed as number | undefined) ?? 0),
        maxToolCalls: Number((traceSafe?.maxToolCalls as number | undefined) ?? maxToolCalls),
        timeoutMs,
        resultJson,
      },
    });

    await appendRunEvent({
      type: "run_completed",
      payload: {
        recommendationRunId: recommendationRun.id,
        message: "Recommendation run completed.",
      },
    });
  } catch (error) {
    await markRunFailed(
      params.runId,
      error instanceof Error ? error.message : "Recommend run failed unexpectedly.",
      appendRunEvent,
    );
  }
}
