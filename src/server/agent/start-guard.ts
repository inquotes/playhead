import { prisma } from "@/server/db";

export type StartGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: "duplicate_run" | "rate_limited";
      message: string;
      activeRunId?: string;
      activeRunStatus?: string;
      retryAfterSeconds?: number;
    };

export async function guardDiscoveryRunStart(params: {
  userAccountId: string;
  mode: "analyze" | "recommend";
  now?: Date;
}): Promise<StartGuardResult> {
  const now = params.now ?? new Date();
  const windowMsRaw = Number(process.env.DISCOVERY_START_RATE_LIMIT_WINDOW_MS ?? 120_000);
  const maxStartsRaw = Number(process.env.DISCOVERY_START_RATE_LIMIT_MAX ?? 6);
  const windowMs = Number.isFinite(windowMsRaw) ? Math.max(10_000, Math.floor(windowMsRaw)) : 120_000;
  const maxStarts = Number.isFinite(maxStartsRaw) ? Math.max(1, Math.floor(maxStartsRaw)) : 6;
  const windowStart = new Date(now.getTime() - windowMs);

  const [activeRun, startCountInWindow] = await prisma.$transaction([
    prisma.agentRun.findFirst({
      where: {
        userAccountId: params.userAccountId,
        mode: params.mode,
        status: { in: ["queued", "running", "cancel_requested"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
    prisma.agentRun.count({
      where: {
        userAccountId: params.userAccountId,
        mode: params.mode,
        createdAt: { gte: windowStart },
      },
    }),
  ]);

  if (activeRun) {
    return {
      ok: false,
      reason: "duplicate_run",
      message: "A run of this type is already in progress for your account.",
      activeRunId: activeRun.id,
      activeRunStatus: activeRun.status,
    };
  }

  if (startCountInWindow >= maxStarts) {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many run starts in a short period. Please wait and try again.",
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }

  return { ok: true };
}
