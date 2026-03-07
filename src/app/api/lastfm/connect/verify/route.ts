import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { callLastfmTool } from "@/server/lastfm/mcp";
import { parseAuthStatus } from "@/server/lastfm/parsers";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST() {
  try {
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const connection = await prisma.lastfmConnection.findUnique({
      where: { visitorSessionId },
    });

    if (!connection?.mcpSessionId) {
      const response = NextResponse.json(
        { ok: false, message: "No Last.fm connection has been started for this session." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

    const auth = await callLastfmTool(connection.mcpSessionId, "lastfm_auth_status", {});
    const parsed = parseAuthStatus(auth.text);

    if (!parsed.authenticated) {
      await prisma.lastfmConnection.update({
        where: { visitorSessionId },
        data: {
          status: "pending",
          authErrorCode: "not_authenticated",
          lastVerifiedAt: new Date(),
        },
      });

      const response = NextResponse.json({
        ok: true,
        status: "pending",
        authenticated: false,
      });
      return attachVisitorCookie(response, context);
    }

    await prisma.lastfmConnection.update({
      where: { visitorSessionId },
      data: {
        status: "connected",
        lastfmUsername: parsed.username,
        authErrorCode: null,
        lastVerifiedAt: new Date(),
      },
    });

    const response = NextResponse.json({
      ok: true,
      status: "connected",
      authenticated: true,
      lastfmUsername: parsed.username,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
