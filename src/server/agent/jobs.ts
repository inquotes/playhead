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
import {
  ensureRecentYearHistory,
  ensureWeeklyHistoryInBackground,
  getAggregatedWeeklyArtistsFromStore,
  getKnownArtistsFromWeeklyRollup,
  isRangeWithinRecentYear,
} from "@/server/lastfm/weekly-history";

type RunEventAppender = (event: {
  type: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

class RunTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new RunTimeoutError(`${label} exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

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

async function markRunFailed(
  runId: string,
  message: string,
  appendRunEvent: RunEventAppender,
  terminationReason: "error" | "timeout" = "error",
) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      terminationReason,
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
  userAccountId?: string;
  targetLastfmUsername?: string;
  useAccountWeeklyHistory?: boolean;
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

    const run = await prisma.agentRun.findUnique({
      where: { id: params.runId },
      select: { timeoutMs: true },
    });
    const timeoutMs = Math.max(5_000, run?.timeoutMs ?? 180_000);

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

    let weeklyArtistsOverride: Array<{ artistName: string; normalizedName: string; playcount: number }> | undefined;
    let knownArtistsOverride: Array<{ artistName: string; normalizedName: string; playcount: number }> | undefined;

    if (params.useAccountWeeklyHistory && params.userAccountId) {
      ensureWeeklyHistoryInBackground({ userAccountId: params.userAccountId, username: params.username });
      const coverage = await ensureRecentYearHistory({
        userAccountId: params.userAccountId,
        username: params.username,
        waitMs: 10_000,
      });
      knownArtistsOverride = await getKnownArtistsFromWeeklyRollup({ userAccountId: params.userAccountId });

      if (coverage.coverage === "full_recent_year" && isRangeWithinRecentYear(range.from, range.to)) {
        weeklyArtistsOverride = await getAggregatedWeeklyArtistsFromStore({
          userAccountId: params.userAccountId,
          from: range.from,
          to: range.to,
        });
      }
    }

    const snapshot = await withTimeout(
      buildListeningSnapshot({
        username: params.username,
        timeWindow: {
          preset: params.preset,
          from: range.from,
          to: range.to,
          label: range.label,
        },
        weeklyArtistsOverride,
        knownArtistsOverride,
      }),
      timeoutMs,
      "Analyze snapshot build",
    );

    await appendRunEvent({
      type: "snapshot_completed",
      payload: {
        artistCount: snapshot.topArtists.length,
        profileCount: snapshot.artistProfiles.length,
        knownArtistCount: snapshot.knownArtists.length,
        message: `Snapshot ready (${snapshot.topArtists.length} artists, ${snapshot.knownArtists.length} known-history artists).`,
      },
    });

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

    if (snapshot.topArtists.length === 0) {
      const summary = `No scrobbles were found in ${range.label.toLowerCase()} for ${params.username}. Choose a broader window to generate lanes.`;

      const analysisRun = await prisma.analysisRun.create({
        data: {
          visitorSessionId: params.visitorSessionId,
          userAccountId: params.userAccountId,
          targetLastfmUsername: params.targetLastfmUsername ?? params.username,
          rangeStart: range.from,
          rangeEnd: range.to,
          sourceVersion: "api-first-v1",
          artistsJson: snapshot.topArtists as Prisma.InputJsonValue,
          tracksJson: (snapshot.metadata?.topTracks ?? []) as Prisma.InputJsonValue,
          heardArtistsJson: snapshot.knownArtists.map((item) => item.artistName) as Prisma.InputJsonValue,
          lanesJson: {
            summary,
            notablePatterns: ["No listening activity was found in the selected period."],
            lanes: [],
            trace: traceJson,
          } as Prisma.InputJsonValue,
        },
      });

      await appendRunEvent({
        type: "analysis_no_history_window",
        payload: {
          message: "No listening history found in this window.",
          range,
        },
      });

      await prisma.agentRun.update({
        where: { id: params.runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          terminationReason: "final",
          toolCallsUsed: 0,
          maxToolCalls: 0,
          resultJson: {
            analysisRunId: analysisRun.id,
            targetUsername: params.targetLastfmUsername ?? params.username,
            range,
            laneCount: 0,
            summary,
            notablePatterns: ["No listening activity was found in the selected period."],
            lanes: [],
            topArtists: [],
            trace: traceJson,
          } as Prisma.InputJsonValue,
        },
      });

      await appendRunEvent({
        type: "run_completed",
        payload: {
          analysisRunId: analysisRun.id,
          message: "Analysis run completed with no listening data in the selected window.",
        },
      });
      return;
    }

    await appendRunEvent({
      type: "lane_synthesis_started",
      payload: {
        message: "Generating taste lanes from normalized artist-level evidence.",
      },
    });

    const laneResult = await withTimeout(synthesizeTasteLanes(snapshot), timeoutMs, "Lane synthesis");
    const traceJsonWithTiming = {
      ...traceJson,
      timing: laneResult.timing,
    };

    await appendRunEvent({
      type: "lane_synthesis_completed",
      payload: {
        laneCount: laneResult.lanes.length,
        timing: laneResult.timing,
        message: `Generated ${laneResult.lanes.length} taste lanes.`,
      },
    });

    const heardArtists = snapshot.knownArtists.map((item) => item.artistName);
    const analysisRun = await prisma.analysisRun.create({
      data: {
        visitorSessionId: params.visitorSessionId,
        userAccountId: params.userAccountId,
        targetLastfmUsername: params.targetLastfmUsername ?? params.username,
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
          trace: traceJsonWithTiming,
        } as Prisma.InputJsonValue,
      },
    });

    const resultJson = {
      analysisRunId: analysisRun.id,
      targetUsername: params.targetLastfmUsername ?? params.username,
      range,
      laneCount: laneResult.lanes.length,
      summary: laneResult.summary,
      notablePatterns: laneResult.notablePatterns,
      lanes: laneResult.lanes,
      topArtists: snapshot.topArtists.slice(0, 12),
      trace: traceJsonWithTiming,
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
      error instanceof RunTimeoutError ? "timeout" : "error",
    );
  }
}

export async function launchRecommendRun(params: {
  runId: string;
  visitorSessionId: string;
  userAccountId?: string;
  targetLastfmUsername?: string;
  useAccountWeeklyHistory?: boolean;
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

    const run = await prisma.agentRun.findUnique({
      where: { id: params.runId },
      select: { timeoutMs: true },
    });
    const timeoutMs = Math.max(5_000, run?.timeoutMs ?? 180_000);

    const analysisRun = await prisma.analysisRun.findFirst({
      where: {
        id: params.analysisRunId,
        visitorSessionId: params.visitorSessionId,
      },
    });

    if (!analysisRun) {
      throw new Error("Analysis run not found for this session.");
    }

    const targetUsername = analysisRun.targetLastfmUsername ?? params.targetLastfmUsername ?? params.username;

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

    let knownHistoryCoverage: "full_recent_year" | "partial" = "full_recent_year";
    let knownArtists: Array<{ artistName: string; normalizedName: string; playcount: number }> = [];

    if (params.useAccountWeeklyHistory && params.userAccountId) {
      const coverage = await ensureRecentYearHistory({
        userAccountId: params.userAccountId,
        username: targetUsername,
        waitMs: 10_000,
      });
      knownHistoryCoverage = coverage.coverage;
      knownArtists = await getKnownArtistsFromWeeklyRollup({ userAccountId: params.userAccountId });
    } else {
      knownArtists = await getKnownArtists({ username: targetUsername });
    }

    await appendRunEvent({
      type: "recommendation_known_history_completed",
      payload: {
        knownArtistCount: knownArtists.length,
        coverage: knownHistoryCoverage,
        message:
          knownHistoryCoverage === "full_recent_year"
            ? `Known-history scan ready (${knownArtists.length} artists).`
            : `Known-history scan is still warming up (${knownArtists.length} artists indexed so far).`,
      },
    });

    const laneContext = laneToContext(selectedLane);

    const hasLaneSeedData =
      laneContext.memberArtists.length > 0 ||
      laneContext.representativeArtists.length > 0 ||
      laneContext.similarHints.length > 0;

    if (!hasLaneSeedData) {
      const traceJson = {
        pipeline: "api-first-v1",
        dataSource: "official-lastfm-api",
        candidateCount: 0,
        selectedCount: 0,
        deterministicRanking: true,
        llmRole: "explanations-only",
      };

      const recommendationRun = await prisma.$transaction(async (tx) => {
        await tx.recommendationRun.deleteMany({
          where: {
            analysisRunId: analysisRun.id,
            selectedLane: selectedLane.id,
            userAccountId: params.userAccountId ?? null,
            targetLastfmUsername: targetUsername,
          },
        });

        return tx.recommendationRun.create({
          data: {
            visitorSessionId: params.visitorSessionId,
            userAccountId: params.userAccountId,
            targetLastfmUsername: targetUsername,
            analysisRunId: analysisRun.id,
            selectedLane: selectedLane.id,
            newOnly: true,
            resultsJson: {
              strategyNote: "No recommendation seeds are available for this lane in the selected analysis window.",
              recommendations: [],
              candidates: [],
              trace: traceJson,
            } as Prisma.InputJsonValue,
          },
        });
      });

      await appendRunEvent({
        type: "recommendation_no_seed_data",
        payload: {
          laneId: selectedLane.id,
          laneName: selectedLane.name,
          message: "No recommendation seeds are available for this lane.",
        },
      });

      await prisma.agentRun.update({
        where: { id: params.runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          terminationReason: "final",
          toolCallsUsed: 0,
          maxToolCalls: 0,
          resultJson: {
            recommendationRunId: recommendationRun.id,
            targetUsername,
            strategyNote: "No recommendation seeds are available for this lane in the selected analysis window.",
            lane: selectedLane,
            recommendations: [],
            trace: traceJson,
          } as Prisma.InputJsonValue,
        },
      });

      await appendRunEvent({
        type: "run_completed",
        payload: {
          recommendationRunId: recommendationRun.id,
          message: "Recommendation run completed with no available lane seed data.",
        },
      });
      return;
    }

    await appendRunEvent({
      type: "recommendation_expansion_started",
      payload: {
        laneId: selectedLane.id,
        laneName: selectedLane.name,
        message: "Expanding lane seeds through similar-artist graph and ranking candidates deterministically.",
      },
    });

    const recommendationResult = await withTimeout(
      generateDeterministicRecommendations({
        username: targetUsername,
        laneContext,
        knownArtists,
        limit: params.limit,
      }),
      timeoutMs,
      "Recommendation expansion",
    );

    await appendRunEvent({
      type: "recommendation_expansion_completed",
      payload: {
        candidateCount: recommendationResult.candidates.length,
        selectedCount: recommendationResult.recommendations.length,
        timing: recommendationResult.timing ?? null,
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
      timing: recommendationResult.timing ?? null,
    };

    const recommendationRun = await prisma.$transaction(async (tx) => {
      await tx.recommendationRun.deleteMany({
        where: {
          analysisRunId: analysisRun.id,
          selectedLane: selectedLane.id,
          userAccountId: params.userAccountId ?? null,
          targetLastfmUsername: targetUsername,
        },
      });

      return tx.recommendationRun.create({
        data: {
          visitorSessionId: params.visitorSessionId,
          userAccountId: params.userAccountId,
          targetLastfmUsername: targetUsername,
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
    });

    const resultJson = {
      recommendationRunId: recommendationRun.id,
      targetUsername,
      strategyNote: recommendationResult.strategyNote,
      knownHistoryCoverage,
      knownHistoryMessage:
        knownHistoryCoverage === "partial"
          ? "Still building full profile history; some recommendations may not be completely new-to-you."
          : null,
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
      error instanceof RunTimeoutError ? "timeout" : "error",
    );
  }
}
