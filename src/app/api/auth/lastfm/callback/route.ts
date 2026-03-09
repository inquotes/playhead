import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { AUTH_STATE_COOKIE_NAME } from "@/lib/constants";
import { getAuthSession } from "@/lib/lastfm";
import { clearAuthStateCookie, createAuthSession } from "@/server/auth";
import { encryptSecret } from "@/server/crypto";
import { ensureWeeklyHistoryInBackground } from "@/server/lastfm/weekly-history";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

function safeNext(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNext(requestUrl.searchParams.get("next"));
  const token = requestUrl.searchParams.get("token");
  const state = requestUrl.searchParams.get("state");

  if (!token) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent("missing_token")}`, requestUrl.origin));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent("invalid_state")}`, requestUrl.origin));
  }

  try {
    const sessionResult = await getAuthSession(token);
    const username = sessionResult.session?.name?.trim();
    const sessionKey = sessionResult.session?.key?.trim();

    if (!username || !sessionKey) {
      throw new Error("Last.fm did not return a valid session.");
    }

    const normalized = username.toLowerCase();
    const encryptedSessionKey = encryptSecret(sessionKey);
    const userAccount = await prisma.userAccount.upsert({
      where: { lastfmUsername: normalized },
      create: {
        lastfmUsername: normalized,
        displayName: username,
        lastfmSessionKey: encryptedSessionKey,
        lastLoginAt: new Date(),
        loginCount: 1,
      },
      update: {
        displayName: username,
        lastfmSessionKey: encryptedSessionKey,
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    });

    const visitorContext = await getOrCreateVisitorSession();
    await prisma.visitorSession.update({
      where: { id: visitorContext.sessionId },
      data: { userAccountId: userAccount.id },
    });

    const response = NextResponse.redirect(new URL(next, requestUrl.origin));
    clearAuthStateCookie(response);
    await createAuthSession(response, {
      userAccountId: userAccount.id,
      request,
    });
    ensureWeeklyHistoryInBackground({
      userAccountId: userAccount.id,
      username: userAccount.lastfmUsername,
    });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "lastfm_auth_failed";
    const code = message.includes("not configured") ? "server_config" : "auth_failed";
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, requestUrl.origin));
  }
}
