import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST() {
  try {
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    await prisma.lastfmConnection.upsert({
      where: { visitorSessionId },
      create: {
        visitorSessionId,
        status: "disconnected",
      },
      update: {
        status: "disconnected",
        lastfmUsername: null,
        authErrorCode: null,
        lastVerifiedAt: new Date(),
      },
    });

    const response = NextResponse.json({ ok: true, status: "disconnected" });
    return attachVisitorCookie(response, context);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to disconnect.",
      },
      { status: 500 },
    );
  }
}
