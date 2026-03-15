import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";

const querySchema = z.object({
  userAccountId: z.string().min(1),
});

function isAuthorized(request: Request): boolean {
  const secret = process.env.WEEKLY_BACKFILL_RUN_SECRET;
  if (!secret) {
    return true;
  }

  const provided = request.headers.get("x-runner-secret");
  return Boolean(provided) && provided === secret;
}

export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const query = querySchema.parse({
      userAccountId: url.searchParams.get("userAccountId") ?? "",
    });

    const [state, job] = await Promise.all([
      prisma.userWeeklyListeningState.findUnique({
        where: { userAccountId: query.userAccountId },
        select: {
          status: true,
          weeksDiscovered: true,
          weeksProcessed: true,
          recentYearReadyAt: true,
          fullHistoryReadyAt: true,
          lastErrorCode: true,
          lastErrorMessage: true,
          lastSuccessAt: true,
        },
      }),
      prisma.userWeeklyBackfillJob.findUnique({
        where: { userAccountId: query.userAccountId },
        select: {
          status: true,
          nextRunAt: true,
          consecutiveFailures: true,
          lastErrorCode: true,
          lastErrorMessage: true,
          lockExpiresAt: true,
          lastHeartbeatAt: true,
        },
      }),
    ]);

    if (!state) {
      return NextResponse.json({ ok: false, message: "Listening state not found." }, { status: 404 });
    }

    const terminal = Boolean(state.fullHistoryReadyAt) || job?.status === "complete" || job?.status === "failed_permanent";
    return NextResponse.json({
      ok: true,
      state: {
        status: state.status,
        weeksDiscovered: state.weeksDiscovered,
        weeksProcessed: state.weeksProcessed,
        recentYearReadyAt: state.recentYearReadyAt,
        fullHistoryReadyAt: state.fullHistoryReadyAt,
        lastErrorCode: state.lastErrorCode,
        lastErrorMessage: state.lastErrorMessage,
        lastSuccessAt: state.lastSuccessAt,
      },
      job: job
        ? {
            status: job.status,
            nextRunAt: job.nextRunAt,
            consecutiveFailures: job.consecutiveFailures,
            lastErrorCode: job.lastErrorCode,
            lastErrorMessage: job.lastErrorMessage,
            lockExpiresAt: job.lockExpiresAt,
            lastHeartbeatAt: job.lastHeartbeatAt,
          }
        : null,
      terminal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch weekly backfill state.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
