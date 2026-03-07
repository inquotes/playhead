import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

type Params = {
  params: Promise<{ runId: string }>;
};

export async function GET(_: Request, context: Params) {
  try {
    const { runId } = await context.params;
    const session = await getOrCreateVisitorSession();

    const run = await prisma.agentRun.findFirst({
      where: {
        id: runId,
        visitorSessionId: session.sessionId,
      },
      include: {
        events: {
          orderBy: { seq: "asc" },
        },
      },
    });

    if (!run) {
      const response = NextResponse.json({ ok: false, message: "Run not found." }, { status: 404 });
      return attachVisitorCookie(response, session);
    }

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
      events: run.events.map((event) => ({
        seq: event.seq,
        type: event.type,
        payload: event.payloadJson,
        createdAt: event.createdAt,
      })),
    });

    return attachVisitorCookie(response, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch run status.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
