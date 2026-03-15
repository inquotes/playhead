import { NextResponse } from "next/server";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { refreshRecentTailSnapshot } from "@/server/lastfm/recent-tail";
import { getLatestCompletedWeekEndFromStore } from "@/server/lastfm/weekly-history";

const RECENT_TAIL_FALLBACK_SECONDS = 14 * 24 * 60 * 60;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUserAccount();
    if (!user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }

    const state = await prisma.userRecentTailState.findUnique({
      where: { userAccountId: user.id },
      select: { status: true, lastPullStartedAt: true },
    });

    const now = Date.now();
    const startedRecently = state?.lastPullStartedAt ? now - state.lastPullStartedAt.getTime() < 120_000 : false;
    const shouldRefreshTail = !(state?.status === "running" && startedRecently);

    if (shouldRefreshTail) {
      const latestCompletedWeekEnd = await getLatestCompletedWeekEndFromStore({ userAccountId: user.id });
      const nowSec = Math.floor(now / 1000);
      const from = latestCompletedWeekEnd ? latestCompletedWeekEnd + 1 : nowSec - RECENT_TAIL_FALLBACK_SECONDS;

      await refreshRecentTailSnapshot({
        userAccountId: user.id,
        username: user.lastfmUsername,
        from,
        to: nowSec,
        latestWeeklyBoundary: latestCompletedWeekEnd,
      });
    }

    const triggerSecret = process.env.BACKFILL_WORKFLOW_TRIGGER_SECRET;
    const triggerUrl = new URL("/__internal/workflows/weekly-backfill/trigger", request.url);
    const triggerResponse = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(triggerSecret ? { "x-workflow-trigger-secret": triggerSecret } : {}),
      },
      body: JSON.stringify({
        userAccountId: user.id,
        username: user.lastfmUsername,
        trigger: "update_now",
      }),
    });

    if (!triggerResponse.ok) {
      const triggerPayload = (await triggerResponse.json().catch(() => null)) as { message?: string } | null;
      throw new Error(triggerPayload?.message ?? "Failed to trigger weekly backfill workflow.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh profile data.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
