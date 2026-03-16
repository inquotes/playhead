import { NextResponse } from "next/server";
import { getLastfmApiKey } from "@/lib/lastfm";
import { attachAuthStateCookie, createAuthStateToken } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

function safeNext(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function getAppOrigin(requestUrl: URL): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) {
    return requestUrl.origin;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("APP_ORIGIN must be a valid absolute URL.");
  }

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use https in production.");
  }

  return parsed.origin;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const next = safeNext(url.searchParams.get("next"));
    const origin = getAppOrigin(url);
    const state = createAuthStateToken();
    const callback = `${origin}/api/auth/lastfm/callback?next=${encodeURIComponent(next)}&state=${state}`;

    const authUrl = new URL("https://www.last.fm/api/auth/");
    authUrl.searchParams.set("api_key", getLastfmApiKey());
    authUrl.searchParams.set("cb", callback);

    const context = await getOrCreateVisitorSession();

    const response = NextResponse.redirect(authUrl);
    attachAuthStateCookie(response, state);
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Last.fm auth.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
