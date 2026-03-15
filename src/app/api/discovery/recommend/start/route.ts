import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { prisma } from "@/server/db";
import type { Lane } from "@/server/discovery/types";
import { getCurrentUserAccount } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  analysisRunId: z.string().min(1),
  laneId: z.string().min(1),
  limit: z.number().int().min(1).max(8).default(4),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
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

    const lanePayload = analysisRun.lanesJson as unknown as
      | Lane[]
      | { lanes?: Lane[]; summary?: string; notablePatterns?: string[] };
    const lanes = Array.isArray(lanePayload) ? lanePayload : (lanePayload.lanes ?? []);
    const selectedLane = lanes.find((lane) => lane.id === payload.laneId);

    if (!selectedLane) {
      const response = NextResponse.json({ ok: false, message: "Lane not found." }, { status: 404 });
      return attachVisitorCookie(response, context);
    }

    const timeoutMs = Number(process.env.PIPELINE_TIMEOUT_MS ?? 180_000);
    const targetUsername = analysisRun.targetLastfmUsername ?? userAccount.lastfmUsername;

    const run = await prisma.agentRun.create({
      data: {
        visitorSessionId,
        userAccountId: userAccount.id,
        targetLastfmUsername: targetUsername,
        mode: "recommend",
        status: "queued",
        requestJson: payload as Prisma.InputJsonValue,
        maxToolCalls: 0,
        timeoutMs,
      },
    });

    const { env } = getCloudflareContext();
    try {
      await (env as unknown as { RECOMMEND_JOBS: Queue }).RECOMMEND_JOBS.send({
        runId: run.id,
        mode: "recommend",
        enqueuedAt: new Date().toISOString(),
      });
    } catch (error) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Failed to queue recommendation run.",
          completedAt: new Date(),
          terminationReason: "error",
        },
      });
      throw error;
    }

    const response = NextResponse.json({
      ok: true,
      runId: run.id,
      mode: "recommend",
      maxToolCalls: 0,
      timeoutMs,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start recommendation run.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
