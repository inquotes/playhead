import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getAgentMaxToolCalls, getAgentTimeoutMs } from "@/server/agent/config";
import { launchRecommendRun } from "@/server/agent/jobs";
import { RECOMMENDATION_LIMIT_BOUNDS } from "@/server/agent/runner";
import type { Lane } from "@/server/discovery/types";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  analysisRunId: z.string().min(1),
  laneId: z.string().min(1),
  newPreferred: z.boolean().default(true),
  limit: RECOMMENDATION_LIMIT_BOUNDS.default(5),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const [connection, analysisRun] = await Promise.all([
      prisma.lastfmConnection.findUnique({ where: { visitorSessionId } }),
      prisma.analysisRun.findFirst({ where: { id: payload.analysisRunId, visitorSessionId } }),
    ]);

    if (!connection?.mcpSessionId || connection.status !== "connected") {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before generating recommendations." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

    if (!analysisRun) {
      const response = NextResponse.json({ ok: false, message: "Analysis run not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const lanePayload = analysisRun.lanesJson as unknown as
      | Lane[]
      | { lanes?: Lane[]; summary?: string; notablePatterns?: string[] };
    const lanes = Array.isArray(lanePayload) ? lanePayload : (lanePayload.lanes ?? []);
    const selectedLane = lanes.find((lane) => lane.id === payload.laneId);

    if (!selectedLane) {
      const response = NextResponse.json({ ok: false, message: "Lane not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const maxToolCalls = getAgentMaxToolCalls("recommend");
    const timeoutMs = getAgentTimeoutMs("recommend");

    const run = await prisma.agentRun.create({
      data: {
        visitorSessionId,
        mode: "recommend",
        status: "queued",
        requestJson: payload as Prisma.InputJsonValue,
        maxToolCalls,
        timeoutMs,
      },
    });

    void launchRecommendRun({
      runId: run.id,
      visitorSessionId,
      mcpSessionId: connection.mcpSessionId,
      analysisRunId: payload.analysisRunId,
      laneId: payload.laneId,
      newPreferred: payload.newPreferred,
      limit: payload.limit,
    });

    const response = NextResponse.json({
      ok: true,
      runId: run.id,
      mode: "recommend",
      maxToolCalls,
      timeoutMs,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start recommendation run.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
