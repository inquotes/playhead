import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getUserInfo } from "@/lib/lastfm";
import { prisma } from "@/server/db";
import { getCurrentUserAccount } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  preset: z.enum(["7d", "1m", "6m", "1y", "custom"]),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  targetUsername: z.string().trim().min(2).max(64).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
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

    const timeoutMs = Number(process.env.PIPELINE_TIMEOUT_MS ?? 180_000);

    const run = await prisma.agentRun.create({
      data: {
        visitorSessionId,
        userAccountId: userAccount.id,
        targetLastfmUsername: targetUsername,
        mode: "analyze",
        status: "queued",
        requestJson: payload as Prisma.InputJsonValue,
        maxToolCalls: 0,
        timeoutMs,
      },
    });

    const { env } = getCloudflareContext();
    try {
      await (env as unknown as { ANALYZE_JOBS: Queue }).ANALYZE_JOBS.send({
        runId: run.id,
        mode: "analyze",
        enqueuedAt: new Date().toISOString(),
      });
    } catch (error) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Failed to queue analyze run.",
          completedAt: new Date(),
          terminationReason: "error",
        },
      });
      throw error;
    }

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
