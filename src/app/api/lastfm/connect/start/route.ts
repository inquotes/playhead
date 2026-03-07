import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { buildLastfmLoginUrl, createMcpSessionId } from "@/server/lastfm/mcp";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST() {
  try {
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const mcpSessionId = createMcpSessionId();
    const loginUrl = buildLastfmLoginUrl(mcpSessionId);

    await prisma.lastfmConnection.upsert({
      where: { visitorSessionId },
      create: {
        visitorSessionId,
        mcpSessionId,
        status: "pending",
      },
      update: {
        mcpSessionId,
        status: "pending",
        authErrorCode: null,
      },
    });

    const response = NextResponse.json({
      ok: true,
      loginUrl,
      status: "pending",
    });

    return attachVisitorCookie(response, context);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to start Last.fm connect flow.",
      },
      { status: 500 },
    );
  }
}
