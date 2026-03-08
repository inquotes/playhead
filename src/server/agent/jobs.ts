import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { publishAgentRunEvent } from "@/server/agent/events";
import { type RangePreset, resolveRange } from "@/server/discovery/range";
import {
  buildListeningSnapshot,
  generateDeterministicRecommendations,
  laneToContext,
  synthesizeTasteLanes,
} from "@/server/discovery/pipeline";
import type { Lane } from "@/server/discovery/types";
import { getKnownArtists } from "@/server/lastfm/service";

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
  username: string;
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
      type: "snapshot_started",
      payload: {
        username: params.username,
        range,
        message: "Fetching and normalizing direct Last.fm listening data.",
      },
    });

    const snapshot = await buildListeningSnapshot({
      username: params.username,
      timeWindow: {
        preset: params.preset,
        from: range.from,
        to: range.to,
        label: range.label,
      },
    });

    await appendRunEvent({
      type: "snapshot_completed",
      payload: {
        artistCount: snapshot.topArtists.length,
        profileCount: snapshot.artistProfiles.length,
        knownArtistCount: snapshot.knownArtists.length,
        message: `Snapshot ready (${snapshot.topArtists.length} artists, ${snapshot.knownArtists.length} known-history artists).`,
      },
    });

    await appendRunEvent({
      type: "lane_synthesis_started",
      payload: {
        message: "Generating taste lanes from normalized artist-level evidence.",
      },
    });

    const laneResult = await synthesizeTasteLanes(snapshot);

    await appendRunEvent({
      type: "lane_synthesis_completed",
      payload: {
        laneCount: laneResult.lanes.length,
        message: `Generated ${laneResult.lanes.length} taste lanes.`,
      },
    });

    const heardArtists = snapshot.knownArtists.map((item) => item.artistName);
    const traceJson = {
      pipeline: "api-first-v1",
      dataSource: "official-lastfm-api",
      modelRole: "lane-synthesis-only",
      cacheEnabled: true,
      counts: {
        topArtists: snapshot.topArtists.length,
        artistProfiles: snapshot.artistProfiles.length,
        knownArtists: snapshot.knownArtists.length,
      },
    };

    const analysisRun = await prisma.analysisRun.create({
      data: {
        visitorSessionId: params.visitorSessionId,
        rangeStart: range.from,
        rangeEnd: range.to,
        sourceVersion: "api-first-v1",
        artistsJson: snapshot.topArtists as Prisma.InputJsonValue,
        tracksJson: (snapshot.metadata?.topTracks ?? []) as Prisma.InputJsonValue,
        heardArtistsJson: heardArtists as Prisma.InputJsonValue,
        lanesJson: {
          summary: laneResult.summary,
          notablePatterns: laneResult.notablePatterns,
          lanes: laneResult.lanes,
          trace: traceJson,
        } as Prisma.InputJsonValue,
      },
    });

    const resultJson = {
      analysisRunId: analysisRun.id,
      range,
      laneCount: laneResult.lanes.length,
      summary: laneResult.summary,
      notablePatterns: laneResult.notablePatterns,
      lanes: laneResult.lanes,
      topArtists: snapshot.topArtists.slice(0, 12),
      trace: traceJson,
    } as Prisma.InputJsonValue;

    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        terminationReason: "final",
        toolCallsUsed: 0,
        maxToolCalls: 0,
        resultJson,
      },
    });

    await appendRunEvent({
      type: "run_completed",
      payload: {
        analysisRunId: analysisRun.id,
        message: "Analysis run completed via API-first deterministic pipeline.",
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

export async function launchRecommendRun(params: {
  runId: string;
  visitorSessionId: string;
  username: string;
  analysisRunId: string;
  laneId: string;
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

    await appendRunEvent({
      type: "recommendation_context_loaded",
      payload: {
        message: "Loading lane context from your analysis.",
      },
    });

    await appendRunEvent({
      type: "recommendation_known_history_started",
      payload: {
        message: "Scanning your known listening history for new-to-you filtering.",
      },
    });

    const knownArtists = await getKnownArtists({ username: params.username });

    await appendRunEvent({
      type: "recommendation_known_history_completed",
      payload: {
        knownArtistCount: knownArtists.length,
        message: `Known-history scan ready (${knownArtists.length} artists).`,
      },
    });

    const laneContext = laneToContext(selectedLane);

    await appendRunEvent({
      type: "recommendation_expansion_started",
      payload: {
        laneId: selectedLane.id,
        laneName: selectedLane.name,
        message: "Expanding lane seeds through similar-artist graph and ranking candidates deterministically.",
      },
    });

    const recommendationResult = await generateDeterministicRecommendations({
      username: params.username,
      laneContext,
      knownArtists,
      limit: params.limit,
    });

    await appendRunEvent({
      type: "recommendation_expansion_completed",
      payload: {
        candidateCount: recommendationResult.candidates.length,
        selectedCount: recommendationResult.recommendations.length,
        message: `Ranked ${recommendationResult.candidates.length} candidates and selected ${recommendationResult.recommendations.length}.`,
      },
    });

    const traceJson = {
      pipeline: "api-first-v1",
      dataSource: "official-lastfm-api",
      candidateCount: recommendationResult.candidates.length,
      selectedCount: recommendationResult.recommendations.length,
      deterministicRanking: true,
      llmRole: "explanations-only",
    };

    const recommendationRun = await prisma.recommendationRun.create({
      data: {
        visitorSessionId: params.visitorSessionId,
        analysisRunId: analysisRun.id,
        selectedLane: selectedLane.id,
        newOnly: true,
        resultsJson: {
          strategyNote: recommendationResult.strategyNote,
          recommendations: recommendationResult.recommendations,
          candidates: recommendationResult.candidates,
          trace: traceJson,
        } as Prisma.InputJsonValue,
      },
    });

    const resultJson = {
      recommendationRunId: recommendationRun.id,
      strategyNote: recommendationResult.strategyNote,
      lane: selectedLane,
      recommendations: recommendationResult.recommendations,
      trace: traceJson,
    } as Prisma.InputJsonValue;

    await prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        terminationReason: "final",
        toolCallsUsed: 0,
        maxToolCalls: 0,
        resultJson,
      },
    });

    await appendRunEvent({
      type: "run_completed",
      payload: {
        recommendationRunId: recommendationRun.id,
        message: "Recommendation run completed via deterministic API-first pipeline.",
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
