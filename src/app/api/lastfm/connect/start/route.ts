import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { validateLastfmUser } from "@/server/lastfm/service";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  username: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const username = payload.username.trim();

    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    await validateLastfmUser(username);

    await prisma.lastfmConnection.upsert({
      where: { visitorSessionId },
      create: {
        visitorSessionId,
        status: "connected",
        lastfmUsername: username,
        lastVerifiedAt: new Date(),
      },
      update: {
        status: "connected",
        lastfmUsername: username,
        authErrorCode: null,
        lastVerifiedAt: new Date(),
      },
    });

    const response = NextResponse.json({
      ok: true,
      status: "connected",
      lastfmUsername: username,
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
