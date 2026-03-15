import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

type Params = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: Request, context: Params) {
  try {
    const { runId } = await context.params;
    const url = new URL(request.url);
    const includeEventsParam = url.searchParams.get("includeEvents");
    const includeEvents = includeEventsParam === "1" || includeEventsParam === "true";
    const sinceSeqRaw = Number(url.searchParams.get("sinceSeq") ?? "0");
    const sinceSeq = Number.isFinite(sinceSeqRaw) ? Math.max(0, Math.floor(sinceSeqRaw)) : 0;
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;
    const session = await getOrCreateVisitorSession();

    const run = await prisma.agentRun.findFirst({
      where: {
        id: runId,
        visitorSessionId: session.sessionId,
      },
    });

    if (!run) {
      const response = NextResponse.json({ ok: false, message: "Run not found." }, { status: 404 });
      return attachVisitorCookie(response, session);
    }

    const events = includeEvents
      ? await prisma.agentRunEvent.findMany({
          where: {
            runId,
            ...(sinceSeq > 0 ? { seq: { gt: sinceSeq } } : {}),
          },
          orderBy: { seq: "asc" },
          take: limit,
        })
      : [];

    const latestSeq = events.length > 0 ? events[events.length - 1]?.seq ?? sinceSeq : sinceSeq;

    const response = NextResponse.json({
      ok: true,
      run: {
        id: run.id,
        mode: run.mode,
        status: run.status,
        toolCallsUsed: run.toolCallsUsed,
        maxToolCalls: run.maxToolCalls,
        timeoutMs: run.timeoutMs,
        terminationReason: run.terminationReason,
        result: run.resultJson,
        errorMessage: run.errorMessage,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      events: events.map((event) => ({
        seq: event.seq,
        type: event.type,
        payload: event.payloadJson,
        createdAt: event.createdAt,
      })),
      latestSeq,
    });

    return attachVisitorCookie(response, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch run status.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
