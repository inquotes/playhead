import { NextResponse } from "next/server";
import { getCurrentUserAccount } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function GET() {
  try {
    const [visitorContext, user] = await Promise.all([getOrCreateVisitorSession(), getCurrentUserAccount()]);

    const response = NextResponse.json({
      ok: true,
      isAuthenticated: Boolean(user),
      user: user
        ? {
            id: user.id,
            lastfmUsername: user.lastfmUsername,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          }
        : null,
    });

    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load auth session.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
