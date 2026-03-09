#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toIso(value) {
  if (!value) return "-";
  try {
    return new Date(value).toISOString();
  } catch {
    return "-";
  }
}

function ageSeconds(value) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    username: "alexinquotes",
    intervalMs: 5000,
    durationMs: 10 * 60 * 1000,
    runnerUrl: "",
    runnerSecret: "",
    watchdogUrl: "",
    watchdogSecret: "",
    kickRunnerEveryMs: 0,
    kickWatchdogEveryMs: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--username" && args[i + 1]) {
      config.username = String(args[i + 1]).trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--interval" && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 1000) {
        config.intervalMs = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === "--duration" && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 10000) {
        config.durationMs = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === "--runner-url" && args[i + 1]) {
      config.runnerUrl = String(args[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg === "--runner-secret" && args[i + 1]) {
      config.runnerSecret = String(args[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg === "--watchdog-url" && args[i + 1]) {
      config.watchdogUrl = String(args[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg === "--watchdog-secret" && args[i + 1]) {
      config.watchdogSecret = String(args[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg === "--kick-runner-every" && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 1000) {
        config.kickRunnerEveryMs = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === "--kick-watchdog-every" && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 1000) {
        config.kickWatchdogEveryMs = parsed;
      }
      i += 1;
    }
  }

  return config;
}

async function postEndpoint(url, secretHeaderName, secret) {
  if (!url) return { ok: false, skipped: true, reason: "missing_url" };

  const headers = {};
  if (secret) {
    headers[secretHeaderName] = secret;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { message: error instanceof Error ? error.message : "endpoint call failed" },
    };
  }
}

async function getSnapshot(username) {
  const user = await prisma.userAccount.findUnique({
    where: { lastfmUsername: username },
    select: { id: true, lastfmUsername: true, createdAt: true },
  });

  if (!user) {
    return { user: null };
  }

  const [job, state, ingestedDoneCount, latestRecommendRun] = await Promise.all([
    prisma.userWeeklyBackfillJob.findUnique({
      where: { userAccountId: user.id },
      select: {
        status: true,
        nextRunAt: true,
        lockToken: true,
        lockExpiresAt: true,
        lastHeartbeatAt: true,
        consecutiveFailures: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        updatedAt: true,
      },
    }),
    prisma.userWeeklyListeningState.findUnique({
      where: { userAccountId: user.id },
      select: {
        status: true,
        weeksDiscovered: true,
        weeksProcessed: true,
        recentYearReadyAt: true,
        fullHistoryReadyAt: true,
        lastAttemptAt: true,
        lastSuccessAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        updatedAt: true,
      },
    }),
    prisma.userWeeklyIngestedWeek.count({
      where: { userAccountId: user.id, status: "done" },
    }),
    prisma.agentRun.findFirst({
      where: { userAccountId: user.id, mode: "recommend" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, resultJson: true },
    }),
  ]);

  let knownHistoryCoverage = null;
  let knownHistoryMessage = null;
  if (latestRecommendRun?.resultJson && typeof latestRecommendRun.resultJson === "object") {
    knownHistoryCoverage = latestRecommendRun.resultJson.knownHistoryCoverage ?? null;
    knownHistoryMessage = latestRecommendRun.resultJson.knownHistoryMessage ?? null;
  }

  return {
    user,
    job,
    state,
    ingestedDoneCount,
    latestRecommendRun: latestRecommendRun
      ? {
          id: latestRecommendRun.id,
          createdAt: latestRecommendRun.createdAt,
          knownHistoryCoverage,
          knownHistoryMessage,
        }
      : null,
  };
}

function classifyPath(previous, current) {
  if (!previous || !previous.job || !current.job) return null;

  const prevRunning = previous.job.status === "running";
  const currRunning = current.job.status === "running";
  const prevLock = previous.job.lockToken;
  const currLock = current.job.lockToken;
  const prevHeartbeatAge = ageSeconds(previous.job.lastHeartbeatAt);

  if (prevRunning && !currRunning && current.job.status === "queued") {
    return "primary_yield";
  }

  if (prevRunning && currRunning && prevLock && currLock && prevLock !== currLock) {
    if (prevHeartbeatAge !== null && prevHeartbeatAge > 90) {
      return "watchdog_or_stale_reclaim";
    }
    return "lock_rotation";
  }

  if (previous.job.status === "retry_wait" && current.job.status === "queued") {
    return "watchdog_retry_rescue";
  }

  return null;
}

function printSnapshot(snapshot, previous) {
  const now = new Date().toISOString();
  if (!snapshot.user) {
    console.log(`[${now}] user=absent waiting_for_reauth=true`);
    return;
  }

  const state = snapshot.state;
  const job = snapshot.job;
  const processed = state?.weeksProcessed ?? 0;
  const discovered = state?.weeksDiscovered ?? 0;
  const percent = discovered > 0 ? ((processed / discovered) * 100).toFixed(2) : "0.00";
  const deltaProcessed = previous?.state ? processed - (previous.state.weeksProcessed ?? 0) : 0;
  const pathSignal = classifyPath(previous, snapshot);

  const parts = [
    `[${now}]`,
    `user=${snapshot.user.lastfmUsername}`,
    `job=${job?.status ?? "-"}`,
    `state=${state?.status ?? "-"}`,
    `progress=${processed}/${discovered}(${percent}%)`,
    `deltaProcessed=${deltaProcessed >= 0 ? `+${deltaProcessed}` : String(deltaProcessed)}`,
    `ingestedDone=${snapshot.ingestedDoneCount}`,
    `recentYearReady=${toIso(state?.recentYearReadyAt)}`,
    `fullReady=${toIso(state?.fullHistoryReadyAt)}`,
    `heartbeatAgeSec=${ageSeconds(job?.lastHeartbeatAt) ?? "-"}`,
    `lockExpires=${toIso(job?.lockExpiresAt)}`,
    `jobFailures=${job?.consecutiveFailures ?? 0}`,
  ];

  if (pathSignal) {
    parts.push(`pathSignal=${pathSignal}`);
  }

  if (snapshot.latestRecommendRun) {
    parts.push(`lastRecCoverage=${snapshot.latestRecommendRun.knownHistoryCoverage ?? "-"}`);
  }

  console.log(parts.join(" "));

  const stateError = state?.lastErrorMessage || job?.lastErrorMessage;
  if (stateError) {
    console.log(`  error=${stateError}`);
  }
}

async function main() {
  const config = parseArgs();

  console.log(
    `Monitoring weekly backfill username=${config.username} intervalMs=${config.intervalMs} durationMs=${config.durationMs}`,
  );

  const startedAt = Date.now();
  let previous = null;
  let lastRunnerKickAt = 0;
  let lastWatchdogKickAt = 0;

  while (Date.now() - startedAt < config.durationMs) {
    const nowMs = Date.now();

    if (
      config.kickRunnerEveryMs > 0 &&
      nowMs - lastRunnerKickAt >= config.kickRunnerEveryMs
    ) {
      const result = await postEndpoint(config.runnerUrl, "x-runner-secret", config.runnerSecret);
      console.log(
        `[kick-runner] ok=${result.ok} status=${result.status ?? "-"} body=${JSON.stringify(result.body ?? {})}`,
      );
      lastRunnerKickAt = nowMs;
    }

    if (
      config.kickWatchdogEveryMs > 0 &&
      nowMs - lastWatchdogKickAt >= config.kickWatchdogEveryMs
    ) {
      const result = await postEndpoint(config.watchdogUrl, "x-watchdog-secret", config.watchdogSecret);
      console.log(
        `[kick-watchdog] ok=${result.ok} status=${result.status ?? "-"} body=${JSON.stringify(result.body ?? {})}`,
      );
      lastWatchdogKickAt = nowMs;
    }

    const snapshot = await getSnapshot(config.username);
    printSnapshot(snapshot, previous);
    previous = snapshot;

    if (snapshot.state?.fullHistoryReadyAt) {
      console.log("Full history is ready. Exiting monitor.");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
  }

  console.log("Monitor duration elapsed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
