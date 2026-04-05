import { randomUUID } from "crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getWeeklyArtistChart, getWeeklyChartList } from "@/lib/lastfm";
import { prisma } from "@/server/db";
import { recordDataPull } from "@/server/lastfm/data-pulls";

type WeeklyWindow = { from: number; to: number };
type Coverage = "full_recent_year" | "partial";

const RECENT_YEAR_WEEK_COUNT = 52;
const JOB_TIME_BUDGET_MS = 25_000;
const WEEK_BATCH_SIZE = 10;
const LOCK_TTL_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
const RETRY_BASE_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 8;

type WorkflowTrigger = "update_now" | "recent_year_gate" | "watchdog" | "other";

function normalizeArtistName(value: string): string {
  return value.trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function weekKey(week: WeeklyWindow): string {
  return `${week.from}:${week.to}`;
}

function parseWeeklyChartList(input: unknown): WeeklyWindow[] {
  const list =
    input && typeof input === "object"
      ? ((input as { weeklychartlist?: { chart?: unknown[] } }).weeklychartlist?.chart ?? [])
      : [];

  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const from = toNumber((item as { from?: unknown }).from);
      const to = toNumber((item as { to?: unknown }).to);
      if (!from || !to) return null;
      return { from, to };
    })
    .filter((item): item is WeeklyWindow => Boolean(item))
    .sort((a, b) => b.from - a.from);
}

function parseWeeklyArtistChart(input: unknown): Array<{ artistName: string; normalizedName: string; playcount: number }> {
  const artists =
    input && typeof input === "object"
      ? ((input as { weeklyartistchart?: { artist?: unknown[] } }).weeklyartistchart?.artist ?? [])
      : [];

  return (Array.isArray(artists) ? artists : [])
    .map((item) => {
      const artistName = readString((item as { name?: unknown }).name);
      const playcount = toNumber((item as { playcount?: unknown }).playcount) ?? 0;
      if (!artistName) return null;
      return { artistName, normalizedName: normalizeArtistName(artistName), playcount };
    })
    .filter((item): item is { artistName: string; normalizedName: string; playcount: number } => Boolean(item));
}

async function upsertState(userAccountId: string, username: string): Promise<void> {
  await prisma.userWeeklyListeningState.upsert({
    where: { userAccountId },
    create: {
      userAccountId,
      lastfmUsername: username,
      status: "idle",
    },
    update: {
      lastfmUsername: username,
    },
  });
}

async function enqueueJob(params: { userAccountId: string; username: string; priority?: number }): Promise<void> {
  await upsertState(params.userAccountId, params.username);

  await prisma.userWeeklyListeningState.update({
    where: { userAccountId: params.userAccountId },
    data: {
      status: "idle",
    },
  });

  await prisma.userWeeklyBackfillJob.upsert({
    where: { userAccountId: params.userAccountId },
    create: {
      userAccountId: params.userAccountId,
      lastfmUsername: params.username,
      status: "queued",
      priority: params.priority ?? 100,
      nextRunAt: new Date(),
    },
    update: {
      lastfmUsername: params.username,
      status: "queued",
      priority: params.priority ?? 100,
      nextRunAt: new Date(),
      consecutiveFailures: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
}

async function claimJob(job: { userAccountId: string; status: string }): Promise<string | null> {
  const now = new Date();
  const lockToken = randomUUID();
  const lockExpiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  const where =
    job.status === "running"
      ? {
          userAccountId: job.userAccountId,
          status: "running" as const,
          OR: [{ lockExpiresAt: { lt: now } }, { lockExpiresAt: null }],
        }
      : {
          userAccountId: job.userAccountId,
          status: { in: ["queued", "retry_wait"] },
          nextRunAt: { lte: now },
        };

  const claimed = await prisma.userWeeklyBackfillJob.updateMany({
    where,
    data: {
      status: "running",
      lockToken,
      lockExpiresAt,
      lastHeartbeatAt: now,
      attemptCount: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  await prisma.userWeeklyListeningState.update({
    where: { userAccountId: job.userAccountId },
    data: {
      status: "running",
      lastAttemptAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  return lockToken;
}

async function heartbeat(userAccountId: string, lockToken: string): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.userWeeklyBackfillJob.updateMany({
    where: {
      userAccountId,
      status: "running",
      lockToken,
    },
    data: {
      lastHeartbeatAt: now,
      lockExpiresAt: new Date(now.getTime() + LOCK_TTL_MS),
    },
  });

  return updated.count > 0;
}

async function refreshProgress(userAccountId: string, weeks: WeeklyWindow[]): Promise<{ recentYearReady: boolean; fullReady: boolean }> {
  const attemptedWeeks = await prisma.userWeeklyIngestedWeek.findMany({
    where: { userAccountId },
    select: { weekStart: true, weekEnd: true, status: true },
  });
  const attemptedSet = new Set(attemptedWeeks.map((week) => `${week.weekStart}:${week.weekEnd}`));
  const doneCount = attemptedWeeks.filter((w) => w.status === "done").length;

  const recentWeeks = weeks.slice(0, Math.min(RECENT_YEAR_WEEK_COUNT, weeks.length));
  const recentYearReady = recentWeeks.length > 0 && recentWeeks.every((week) => attemptedSet.has(weekKey(week)));
  const fullReady = weeks.length > 0 && weeks.every((week) => attemptedSet.has(weekKey(week)));

  await prisma.userWeeklyListeningState.update({
    where: { userAccountId },
    data: {
      weeksDiscovered: weeks.length,
      weeksProcessed: doneCount,
      newestWeekStart: weeks[0]?.from ?? null,
      oldestWeekStart: weeks[weeks.length - 1]?.from ?? null,
      recentYearReadyAt: recentYearReady ? new Date() : null,
      fullHistoryReadyAt: fullReady ? new Date() : null,
      lastSuccessAt: new Date(),
    },
  });

  return { recentYearReady, fullReady };
}

async function processSingleWeek(params: {
  userAccountId: string;
  username: string;
  week: WeeklyWindow;
}): Promise<boolean> {
  const { userAccountId, username, week } = params;
  try {
    const payload = await getWeeklyArtistChart({ user: username, from: week.from, to: week.to });
    const rows = parseWeeklyArtistChart(payload);

    const incomingByArtist = new Map<string, { artistName: string; normalizedName: string; playcount: number }>();
    for (const row of rows) {
      const existing = incomingByArtist.get(row.normalizedName);
      if (existing) {
        existing.playcount += row.playcount;
        existing.artistName = row.artistName;
      } else {
        incomingByArtist.set(row.normalizedName, { ...row });
      }
    }

    const incomingRows = [...incomingByArtist.values()];

    const existingRows = await prisma.userWeeklyArtistPlaycount.findMany({
      where: {
        userAccountId,
        weekStart: week.from,
        weekEnd: week.to,
      },
      select: {
        artistName: true,
        normalizedName: true,
        playcount: true,
      },
    });

    const existingByArtist = new Map(existingRows.map((row) => [row.normalizedName, row]));

    const deltaByArtist = new Map<string, { artistName: string; normalizedName: string; delta: number }>();
    for (const row of incomingRows) {
      const previous = existingByArtist.get(row.normalizedName)?.playcount ?? 0;
      const delta = row.playcount - previous;
      if (delta !== 0) {
        deltaByArtist.set(row.normalizedName, {
          artistName: row.artistName,
          normalizedName: row.normalizedName,
          delta,
        });
      }
    }

    for (const row of existingRows) {
      if (incomingByArtist.has(row.normalizedName)) {
        continue;
      }
      if (row.playcount !== 0) {
        deltaByArtist.set(row.normalizedName, {
          artistName: row.artistName,
          normalizedName: row.normalizedName,
          delta: -row.playcount,
        });
      }
    }

    const hasWeeklyChanges =
      incomingRows.length !== existingRows.length
      || incomingRows.some((row) => {
        const existing = existingByArtist.get(row.normalizedName);
        return !existing || existing.playcount !== row.playcount || existing.artistName !== row.artistName;
      });

    // Prepare rollup changes (read existing rollups before batch write)
    const rollupsToCreate: Array<{ userAccountId: string; artistName: string; normalizedName: string; playcount: number }> = [];
    const rollupUpdates: Array<ReturnType<typeof prisma.userKnownArtistRollup.update>> = [];

    if (deltaByArtist.size > 0) {
      const normalizedNames = [...deltaByArtist.keys()];
      const existingRollups = await prisma.userKnownArtistRollup.findMany({
        where: {
          userAccountId,
          normalizedName: { in: normalizedNames },
        },
        select: {
          normalizedName: true,
          playcount: true,
        },
      });

      const existingRollupByArtist = new Map(existingRollups.map((row) => [row.normalizedName, row.playcount]));

      for (const row of deltaByArtist.values()) {
        const current = existingRollupByArtist.get(row.normalizedName);
        if (current == null) {
          if (row.delta > 0) {
            rollupsToCreate.push({
              userAccountId,
              artistName: row.artistName,
              normalizedName: row.normalizedName,
              playcount: row.delta,
            });
          }
          continue;
        }

        const nextPlaycount = Math.max(0, current + row.delta);
        if (nextPlaycount !== current || row.delta !== 0) {
          rollupUpdates.push(
            prisma.userKnownArtistRollup.update({
              where: {
                userAccountId_normalizedName: {
                  userAccountId,
                  normalizedName: row.normalizedName,
                },
              },
              data: {
                artistName: row.artistName,
                playcount: nextPlaycount,
              },
            }),
          );
        }
      }
    }

    // Batch transaction: all writes in a single D1-compatible batch
    const batchOps: Array<ReturnType<typeof prisma.userWeeklyArtistPlaycount.deleteMany>> = [];

    if (hasWeeklyChanges) {
      batchOps.push(
        prisma.userWeeklyArtistPlaycount.deleteMany({
          where: {
            userAccountId,
            weekStart: week.from,
            weekEnd: week.to,
          },
        }),
      );

      if (incomingRows.length > 0) {
        batchOps.push(
          prisma.userWeeklyArtistPlaycount.createMany({
            data: incomingRows.map((row) => ({
              userAccountId,
              weekStart: week.from,
              weekEnd: week.to,
              artistName: row.artistName,
              normalizedName: row.normalizedName,
              playcount: row.playcount,
            })),
          }) as unknown as ReturnType<typeof prisma.userWeeklyArtistPlaycount.deleteMany>,
        );
      }
    }

    if (rollupsToCreate.length > 0) {
      batchOps.push(
        prisma.userKnownArtistRollup.createMany({
          data: rollupsToCreate,
        }) as unknown as ReturnType<typeof prisma.userWeeklyArtistPlaycount.deleteMany>,
      );
    }

    batchOps.push(...(rollupUpdates as unknown as Array<ReturnType<typeof prisma.userWeeklyArtistPlaycount.deleteMany>>));

    batchOps.push(
      prisma.userWeeklyIngestedWeek.upsert({
        where: {
          userAccountId_weekStart_weekEnd: {
            userAccountId,
            weekStart: week.from,
            weekEnd: week.to,
          },
        },
        create: {
          userAccountId,
          weekStart: week.from,
          weekEnd: week.to,
          status: "done",
          artistCount: incomingRows.length,
          attemptCount: 1,
          lastAttemptAt: new Date(),
          lastErrorMessage: null,
        },
        update: {
          status: "done",
          artistCount: incomingRows.length,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          lastErrorMessage: null,
        },
      }) as unknown as ReturnType<typeof prisma.userWeeklyArtistPlaycount.deleteMany>,
    );

    await prisma.$transaction(batchOps);

    return true;
  } catch (error) {
    await prisma.userWeeklyIngestedWeek.upsert({
      where: {
        userAccountId_weekStart_weekEnd: {
          userAccountId,
          weekStart: week.from,
          weekEnd: week.to,
        },
      },
      create: {
        userAccountId,
        weekStart: week.from,
        weekEnd: week.to,
        status: "failed",
        artistCount: 0,
        attemptCount: 1,
        lastAttemptAt: new Date(),
        lastErrorMessage: error instanceof Error ? error.message : "Weekly chart fetch failed.",
      },
      update: {
        status: "failed",
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        lastErrorMessage: error instanceof Error ? error.message : "Weekly chart fetch failed.",
      },
    });

    return false;
  }
}

async function finishJob(params: {
  userAccountId: string;
  lockToken: string;
  fullReady: boolean;
  hadErrors: boolean;
  madeProgress: boolean;
  existingFailures: number;
}): Promise<void> {
  const now = new Date();
  if (params.fullReady) {
    await prisma.userWeeklyBackfillJob.updateMany({
      where: {
        userAccountId: params.userAccountId,
        status: "running",
        lockToken: params.lockToken,
      },
      data: {
        status: "complete",
        lockToken: null,
        lockExpiresAt: null,
        lastHeartbeatAt: now,
        nextRunAt: now,
        consecutiveFailures: 0,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    await prisma.userWeeklyListeningState.update({
      where: { userAccountId: params.userAccountId },
      data: {
        status: "complete",
        fullHistoryReadyAt: now,
        lastSuccessAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await recordDataPull({
      userAccountId: params.userAccountId,
      source: "weekly_backfill",
      status: "success",
    });
    return;
  }

  const nextFailureCount = params.hadErrors && !params.madeProgress ? params.existingFailures + 1 : 0;
  const nextStatus = nextFailureCount >= MAX_CONSECUTIVE_FAILURES ? "failed_permanent" : params.hadErrors ? "retry_wait" : "queued";
  const nextRunAt =
    nextStatus === "retry_wait"
      ? new Date(now.getTime() + Math.min(RETRY_BASE_MS * Math.max(1, nextFailureCount), 15 * 60_000))
      : now;

  await prisma.userWeeklyBackfillJob.updateMany({
    where: {
      userAccountId: params.userAccountId,
      status: "running",
      lockToken: params.lockToken,
    },
    data: {
      status: nextStatus,
      nextRunAt,
      lockToken: null,
      lockExpiresAt: null,
      lastHeartbeatAt: now,
      consecutiveFailures: nextFailureCount,
      lastErrorCode: params.hadErrors ? "week_errors" : null,
      lastErrorMessage: params.hadErrors ? "Some weekly chart windows failed and will retry." : null,
    },
  });

  await prisma.userWeeklyListeningState.update({
    where: { userAccountId: params.userAccountId },
    data: {
      status: nextStatus === "failed_permanent" ? "failed" : "idle",
      lastSuccessAt: now,
      lastErrorCode: params.hadErrors ? "week_errors" : null,
      lastErrorMessage: params.hadErrors ? "Some weekly chart windows failed and will retry." : null,
    },
  });

  await recordDataPull({
    userAccountId: params.userAccountId,
    source: "weekly_backfill",
    status: "success",
  });
}

async function runClaimedJob(params: {
  userAccountId: string;
  username: string;
  lockToken: string;
}): Promise<void> {
  const started = Date.now();
  let hadErrors = false;
  let processedCount = 0;
  const failedThisRun = new Set<string>();

  const existingJob = await prisma.userWeeklyBackfillJob.findUnique({
    where: { userAccountId: params.userAccountId },
    select: { consecutiveFailures: true },
  });

  try {
    while (Date.now() - started < JOB_TIME_BUDGET_MS) {
      const lockOk = await heartbeat(params.userAccountId, params.lockToken);
      if (!lockOk) {
        return;
      }

      const chartListRaw = await getWeeklyChartList({ user: params.username });
      const weeks = parseWeeklyChartList(chartListRaw);

      if (weeks.length === 0) {
        await finishJob({
          userAccountId: params.userAccountId,
          lockToken: params.lockToken,
          fullReady: true,
          hadErrors: false,
          madeProgress: processedCount > 0,
          existingFailures: existingJob?.consecutiveFailures ?? 0,
        });
        return;
      }

      const doneRows = await prisma.userWeeklyIngestedWeek.findMany({
        where: { userAccountId: params.userAccountId, status: "done" },
        select: { weekStart: true, weekEnd: true },
      });
      const doneSet = new Set(doneRows.map((row) => `${row.weekStart}:${row.weekEnd}`));
      const remaining = weeks.filter((week) => !doneSet.has(weekKey(week)) && !failedThisRun.has(weekKey(week)));

      if (remaining.length === 0) {
        await refreshProgress(params.userAccountId, weeks);
        await finishJob({
          userAccountId: params.userAccountId,
          lockToken: params.lockToken,
          fullReady: true,
          hadErrors: false,
          madeProgress: processedCount > 0,
          existingFailures: existingJob?.consecutiveFailures ?? 0,
        });
        return;
      }

      for (const week of remaining.slice(0, WEEK_BATCH_SIZE)) {
        const ok = await processSingleWeek({
          userAccountId: params.userAccountId,
          username: params.username,
          week,
        });
        if (!ok) {
          hadErrors = true;
          failedThisRun.add(weekKey(week));
        } else {
          processedCount++;
        }
      }

      const readiness = await refreshProgress(params.userAccountId, weeks);
      if (readiness.fullReady) {
        await finishJob({
          userAccountId: params.userAccountId,
          lockToken: params.lockToken,
          fullReady: true,
          hadErrors: false,
          madeProgress: processedCount > 0,
          existingFailures: existingJob?.consecutiveFailures ?? 0,
        });
        return;
      }
    }

    await finishJob({
      userAccountId: params.userAccountId,
      lockToken: params.lockToken,
      fullReady: false,
      hadErrors,
      madeProgress: processedCount > 0,
      existingFailures: existingJob?.consecutiveFailures ?? 0,
    });
  } catch (error) {
    const now = new Date();
    const failures = processedCount > 0 ? 0 : (existingJob?.consecutiveFailures ?? 0) + 1;

    await prisma.userWeeklyBackfillJob.updateMany({
      where: {
        userAccountId: params.userAccountId,
        status: "running",
        lockToken: params.lockToken,
      },
      data: {
        status: failures >= MAX_CONSECUTIVE_FAILURES ? "failed_permanent" : "retry_wait",
        nextRunAt: new Date(now.getTime() + Math.min(RETRY_BASE_MS * failures, 15 * 60_000)),
        lockToken: null,
        lockExpiresAt: null,
        lastHeartbeatAt: now,
        consecutiveFailures: failures,
        lastErrorCode: "job_error",
        lastErrorMessage: error instanceof Error ? error.message : "Backfill job failed.",
      },
    });

    await prisma.userWeeklyListeningState.update({
      where: { userAccountId: params.userAccountId },
      data: {
        status: failures >= MAX_CONSECUTIVE_FAILURES ? "failed" : "idle",
        lastErrorCode: "job_error",
        lastErrorMessage: error instanceof Error ? error.message : "Backfill job failed.",
      },
    });

    await recordDataPull({
      userAccountId: params.userAccountId,
      source: "weekly_backfill",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Backfill job failed.",
    });
  }
}

export async function runWeeklyBackfillDispatcher(params?: {
  limit?: number;
  userAccountId?: string;
}): Promise<{ processed: number }> {
  const now = new Date();
  const limit = Math.max(1, Math.min(50, params?.limit ?? 5));

  const where = params?.userAccountId
    ? { userAccountId: params.userAccountId }
    : {
        OR: [
          { status: { in: ["queued", "retry_wait"] }, nextRunAt: { lte: now } },
          { status: "running" as const, lockExpiresAt: { lt: now } },
        ],
      };

  const jobs = await prisma.userWeeklyBackfillJob.findMany({
    where,
    orderBy: [{ priority: "desc" }, { nextRunAt: "asc" }],
    take: limit,
    select: {
      userAccountId: true,
      lastfmUsername: true,
      status: true,
    },
  });

  let processed = 0;
  for (const job of jobs) {
    if (job.status === "complete" || job.status === "failed_permanent") continue;
    const lockToken = await claimJob({ userAccountId: job.userAccountId, status: job.status });
    if (!lockToken) continue;
    await runClaimedJob({ userAccountId: job.userAccountId, username: job.lastfmUsername, lockToken });
    processed += 1;
  }

  return { processed };
}

export async function processWeeklyBackfillForUser(params: {
  userAccountId: string;
}): Promise<{ processed: number; reason?: "missing" | "terminal" | "not_ready" | "locked" }> {
  const job = await prisma.userWeeklyBackfillJob.findUnique({
    where: { userAccountId: params.userAccountId },
    select: {
      userAccountId: true,
      lastfmUsername: true,
      status: true,
      nextRunAt: true,
    },
  });

  if (!job) {
    return { processed: 0, reason: "missing" };
  }

  if (job.status === "complete" || job.status === "failed_permanent") {
    return { processed: 0, reason: "terminal" };
  }

  if ((job.status === "queued" || job.status === "retry_wait") && job.nextRunAt && job.nextRunAt.getTime() > Date.now()) {
    return { processed: 0, reason: "not_ready" };
  }

  const lockToken = await claimJob({ userAccountId: job.userAccountId, status: job.status });
  if (!lockToken) {
    return { processed: 0, reason: "locked" };
  }

  await runClaimedJob({
    userAccountId: job.userAccountId,
    username: job.lastfmUsername,
    lockToken,
  });

  return { processed: 1 };
}

async function triggerBackfillWorkflow(params: {
  userAccountId: string;
  username: string;
  trigger?: WorkflowTrigger;
}): Promise<boolean> {
  try {
    const { env } = getCloudflareContext();
    const runtime = env as unknown as {
      WORKER_SELF_REFERENCE?: { fetch: (request: Request) => Promise<Response> };
      QUEUE_PROCESS_SECRET?: string;
    };

    if (!runtime.WORKER_SELF_REFERENCE?.fetch) {
      return false;
    }

    const response = await runtime.WORKER_SELF_REFERENCE.fetch(
      new Request("https://internal/__internal/workflows/weekly-backfill/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(runtime.QUEUE_PROCESS_SECRET
            ? { "x-queue-secret": runtime.QUEUE_PROCESS_SECRET }
            : {}),
        },
        body: JSON.stringify({
          userAccountId: params.userAccountId,
          username: params.username,
          trigger: params.trigger ?? "other",
        }),
      }),
    );

    return response.ok;
  } catch {
    return false;
  }
}

export function ensureWeeklyHistoryInBackground(params: { userAccountId: string; username: string }): void {
  void (async () => {
    await enqueueJob({ userAccountId: params.userAccountId, username: params.username, priority: 200 });

    const triggered = await triggerBackfillWorkflow({
      userAccountId: params.userAccountId,
      username: params.username,
      trigger: "other",
    });

    if (!triggered) {
      await runWeeklyBackfillDispatcher({
        limit: 1,
        userAccountId: params.userAccountId,
      });
    }
  })();
}

export async function runWeeklyHistoryWatchdog(params?: { limit?: number }): Promise<{ rescued: number; kicked: number }> {
  const now = new Date();
  const limit = Math.max(1, Math.min(100, params?.limit ?? 25));

  const targets = await prisma.userWeeklyBackfillJob.findMany({
    where: {
      OR: [
        { status: "running", OR: [{ lockExpiresAt: { lt: now } }, { lockExpiresAt: null }] },
        { status: "retry_wait", nextRunAt: { lte: now } },
        { status: "queued", nextRunAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } },
      ],
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
    select: { userAccountId: true, lastfmUsername: true },
  });

  let rescued = 0;
  for (const target of targets) {
    await prisma.userWeeklyBackfillJob.update({
      where: { userAccountId: target.userAccountId },
      data: {
        status: "queued",
        nextRunAt: new Date(),
        lockToken: null,
        lockExpiresAt: null,
      },
    });
    rescued += 1;
  }

  let kicked = 0;
  for (const target of targets) {
    const triggered = await triggerBackfillWorkflow({
      userAccountId: target.userAccountId,
      username: target.lastfmUsername,
      trigger: "watchdog",
    });

    if (!triggered) {
      await runWeeklyBackfillDispatcher({
        limit: 1,
        userAccountId: target.userAccountId,
      });
    }

    kicked += 1;
  }
  return { rescued, kicked };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureRecentYearHistory(params: {
  userAccountId: string;
  username: string;
  waitMs: number;
}): Promise<{ coverage: Coverage }> {
  ensureWeeklyHistoryInBackground({ userAccountId: params.userAccountId, username: params.username });

  const deadline = Date.now() + Math.max(0, params.waitMs);
  while (Date.now() < deadline) {
    const state = await prisma.userWeeklyListeningState.findUnique({
      where: { userAccountId: params.userAccountId },
      select: { recentYearReadyAt: true },
    });

    if (state?.recentYearReadyAt) {
      return { coverage: "full_recent_year" };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const state = await prisma.userWeeklyListeningState.findUnique({
    where: { userAccountId: params.userAccountId },
    select: { recentYearReadyAt: true },
  });
  return { coverage: state?.recentYearReadyAt ? "full_recent_year" : "partial" };
}

export async function getKnownArtistsFromWeeklyRollup(params: {
  userAccountId: string;
}): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  return prisma.userKnownArtistRollup.findMany({
    where: { userAccountId: params.userAccountId },
    orderBy: { playcount: "desc" },
    select: {
      artistName: true,
      normalizedName: true,
      playcount: true,
    },
  });
}

export function isRangeWithinRecentYear(from: number, to: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - RECENT_YEAR_WEEK_COUNT * 7 * 24 * 60 * 60;
  return from >= oneYearAgo && to <= now;
}

export async function enqueueWeeklyBackfillJob(params: {
  userAccountId: string;
  username: string;
  priority?: number;
}): Promise<void> {
  await enqueueJob(params);
}

export async function getAggregatedWeeklyArtistsFromStore(params: {
  userAccountId: string;
  from: number;
  to: number;
}): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  const rows = await prisma.userWeeklyArtistPlaycount.findMany({
    where: {
      userAccountId: params.userAccountId,
      weekEnd: { gte: params.from },
      weekStart: { lte: params.to },
    },
    select: {
      artistName: true,
      normalizedName: true,
      playcount: true,
    },
  });

  const byArtist = new Map<string, { artistName: string; normalizedName: string; playcount: number }>();
  for (const row of rows) {
    const existing = byArtist.get(row.normalizedName);
    if (existing) {
      existing.playcount += row.playcount;
    } else {
      byArtist.set(row.normalizedName, {
        artistName: row.artistName,
        normalizedName: row.normalizedName,
        playcount: row.playcount,
      });
    }
  }

  return [...byArtist.values()].sort((a, b) => b.playcount - a.playcount);
}

export async function getLatestCompletedWeekEndFromStore(params: {
  userAccountId: string;
}): Promise<number | null> {
  const latest = await prisma.userWeeklyIngestedWeek.findFirst({
    where: {
      userAccountId: params.userAccountId,
      status: "done",
    },
    orderBy: {
      weekEnd: "desc",
    },
    select: {
      weekEnd: true,
    },
  });

  return latest?.weekEnd ?? null;
}
