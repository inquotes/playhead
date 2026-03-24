import { NextResponse } from "next/server";
import { getCurrentUserAccount } from "@/server/auth";
import { getPastRecommendationsPage } from "@/server/profile/past-recommendations";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function GET(request: Request) {
  try {
    const [visitorContext, user] = await Promise.all([getOrCreateVisitorSession(), getCurrentUserAccount()]);
    if (!user) {
      const response = NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
      return attachVisitorCookie(response, visitorContext);
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor")?.trim() || undefined;
    const limitRaw = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;

    const page = await getPastRecommendationsPage({
      userAccountId: user.id,
      lastfmUsername: user.lastfmUsername,
      limit,
      cursorId: cursor,
    });

    const response = NextResponse.json({
      ok: true,
      items: page.items,
      nextCursor: page.nextCursor,
    });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load recommendation history.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
