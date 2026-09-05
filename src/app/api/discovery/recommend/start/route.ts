import { NextResponse } from "next/server";
import { recommendDiscoveryRequestSchema } from "@/lib/discovery-contracts";
import { prisma } from "@/server/db";
import { enqueueDiscoveryRun } from "@/server/agent/enqueue";
import { decodeAnalysisLanesPayload } from "@/server/discovery/payloads";
import { getCurrentUserAccount } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST(request: Request) {
  try {
    const payload = recommendDiscoveryRequestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;
    const userAccount = await getCurrentUserAccount();
    if (!userAccount) {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before generating recommendations." },
        { status: 401 },
      );
      return attachVisitorCookie(response, context);
    }

    const analysisRun = await prisma.analysisRun.findFirst({ where: { id: payload.analysisRunId, visitorSessionId } });

    if (!analysisRun) {
      const response = NextResponse.json({ ok: false, message: "Analysis run not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const { lanes } = decodeAnalysisLanesPayload(analysisRun.lanesJson);
    const selectedLane = lanes.find((lane) => lane.id === payload.laneId);

    if (!selectedLane) {
      const response = NextResponse.json({ ok: false, message: "Lane not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const targetUsername = analysisRun.targetLastfmUsername ?? userAccount.lastfmUsername;
    const queued = await enqueueDiscoveryRun({
      visitorSessionId,
      userAccountId: userAccount.id,
      targetLastfmUsername: targetUsername,
      mode: "recommend",
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
      mode: "recommend",
      maxToolCalls: 0,
      timeoutMs: queued.run.timeoutMs,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start recommendation run.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
