import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { launchAnalyzeRun } from "@/server/agent/jobs";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  preset: z.enum(["7d", "1m", "6m", "1y", "summer2025", "custom"]),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const connection = await prisma.lastfmConnection.findUnique({
      where: { visitorSessionId },
    });

    if (!connection?.lastfmUsername || connection.status !== "connected") {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before running analysis." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

    const timeoutMs = Number(process.env.PIPELINE_TIMEOUT_MS ?? 180_000);

    const run = await prisma.agentRun.create({
      data: {
        visitorSessionId,
        mode: "analyze",
        status: "queued",
        requestJson: payload as Prisma.InputJsonValue,
        maxToolCalls: 0,
        timeoutMs,
      },
    });

    void launchAnalyzeRun({
      runId: run.id,
      visitorSessionId,
      username: connection.lastfmUsername,
      preset: payload.preset,
      from: payload.from,
      to: payload.to,
    });

    const response = NextResponse.json({
      ok: true,
      runId: run.id,
      mode: "analyze",
      maxToolCalls: 0,
      timeoutMs,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start analyze run.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
