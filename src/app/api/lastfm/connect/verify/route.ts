import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { validateLastfmUser } from "@/server/lastfm/service";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST() {
  try {
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const connection = await prisma.lastfmConnection.findUnique({
      where: { visitorSessionId },
    });

    if (!connection?.lastfmUsername) {
      const response = NextResponse.json(
        { ok: false, message: "No Last.fm username configured for this session." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

    await validateLastfmUser(connection.lastfmUsername);

    await prisma.lastfmConnection.update({
      where: { visitorSessionId },
      data: {
        status: "connected",
        lastfmUsername: connection.lastfmUsername,
        authErrorCode: null,
        lastVerifiedAt: new Date(),
      },
    });

    const response = NextResponse.json({
      ok: true,
      status: "connected",
      lastfmUsername: connection.lastfmUsername,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
