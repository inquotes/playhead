import { NextResponse } from "next/server";
import { analyzeDiscoveryRequestSchema } from "@/lib/discovery-contracts";
import { getUserInfo } from "@/lib/lastfm";
import { enqueueDiscoveryRun } from "@/server/agent/enqueue";
import { getCurrentUserAccount } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST(request: Request) {
  try {
    const payload = analyzeDiscoveryRequestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;
    const userAccount = await getCurrentUserAccount();
    if (!userAccount) {
      const response = NextResponse.json({ ok: false, message: "Connect Last.fm before running analysis." }, { status: 401 });
      return attachVisitorCookie(response, context);
    }

    const requestedTarget = payload.targetUsername?.trim();
    const isSelfTarget = !requestedTarget || requestedTarget.toLowerCase() === userAccount.lastfmUsername;
    let targetUsername = userAccount.lastfmUsername;

    if (!isSelfTarget && requestedTarget) {
      const info = await getUserInfo({ user: requestedTarget });
      const resolved = typeof info.user?.name === "string" ? info.user.name.trim().toLowerCase() : requestedTarget.toLowerCase();
      if (!resolved) {
        const response = NextResponse.json({ ok: false, message: "Could not resolve that Last.fm username." }, { status: 400 });
        return attachVisitorCookie(response, context);
      }
      targetUsername = resolved;
    }

    const queued = await enqueueDiscoveryRun({
      visitorSessionId,
      userAccountId: userAccount.id,
      targetLastfmUsername: targetUsername,
      mode: "analyze",
      request: payload,
    });

    if (!queued.ok) {
      const response = NextResponse.json(
        {
          ok: false,
          reason: queued.reason,
          message: queued.message,
          activeRunId: queued.activeRunId,
          activeRunStatus: queued.activeRunStatus,
          retryAfterSeconds: queued.retryAfterSeconds,
        },
        { status: queued.reason === "rate_limited" ? 429 : 409 },
      );
      return attachVisitorCookie(response, context);
    }

    const response = NextResponse.json({
      ok: true,
      runId: queued.run.id,
      mode: "analyze",
      maxToolCalls: 0,
      timeoutMs: queued.run.timeoutMs,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start analyze run.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
