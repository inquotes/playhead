import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { guardDiscoveryRunStart } from "@/server/agent/start-guard";

type DiscoveryRunMode = "analyze" | "recommend";

export async function enqueueDiscoveryRun(params: {
  visitorSessionId: string;
  userAccountId: string;
  targetLastfmUsername: string;
  mode: DiscoveryRunMode;
  request: unknown;
}) {
  const startGuard = await guardDiscoveryRunStart({
    userAccountId: params.userAccountId,
    mode: params.mode,
  });

  if (!startGuard.ok) {
    return startGuard;
  }

  const configuredTimeout = Number(process.env.PIPELINE_TIMEOUT_MS ?? 180_000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.max(5_000, Math.floor(configuredTimeout))
    : 180_000;

  const run = await prisma.agentRun.create({
    data: {
      visitorSessionId: params.visitorSessionId,
      userAccountId: params.userAccountId,
      targetLastfmUsername: params.targetLastfmUsername,
      mode: params.mode,
      status: "queued",
      requestJson: params.request as Prisma.InputJsonValue,
      maxToolCalls: 0,
      timeoutMs,
    },
  });

  const { env } = getCloudflareContext();
  const queue =
    params.mode === "analyze"
      ? (env as unknown as { ANALYZE_JOBS: Queue }).ANALYZE_JOBS
      : (env as unknown as { RECOMMEND_JOBS: Queue }).RECOMMEND_JOBS;

  try {
    await queue.send({
      runId: run.id,
      mode: params.mode,
      enqueuedAt: new Date().toISOString(),
    });
  } catch (error) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : `Failed to queue ${params.mode} run.`,
        completedAt: new Date(),
        terminationReason: "error",
      },
    });
    throw error;
  }

  return { ok: true as const, run };
}
