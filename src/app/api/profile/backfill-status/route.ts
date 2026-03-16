import { NextResponse } from "next/server";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";

export async function GET() {
  try {
    const user = await getCurrentUserAccount();
    if (!user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }

    const [state, job] = await Promise.all([
      prisma.userWeeklyListeningState.findUnique({
        where: { userAccountId: user.id },
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
        where: { userAccountId: user.id },
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

    const workflowState: "running" | "waiting" | "errored" | "complete" =
      job?.status === "failed_permanent"
        ? "errored"
        : job?.status === "complete" || Boolean(state.fullHistoryReadyAt)
          ? "complete"
          : job?.status === "running"
            ? "running"
            : "waiting";

    return NextResponse.json(
      {
        ok: true,
        workflowState,
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
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch backfill status.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
