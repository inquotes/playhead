import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function GET() {
  try {
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const connection = await prisma.lastfmConnection.findUnique({
      where: { visitorSessionId },
    });

    const response = NextResponse.json({
      ok: true,
      status: connection?.status ?? "disconnected",
      lastfmUsername: connection?.lastfmUsername ?? null,
      hasConnection: Boolean(connection?.mcpSessionId),
      lastVerifiedAt: connection?.lastVerifiedAt ?? null,
      authErrorCode: connection?.authErrorCode ?? null,
    });

    return attachVisitorCookie(response, context);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load connection status.",
      },
      { status: 500 },
    );
  }
}
