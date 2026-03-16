import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { AUTH_STATE_COOKIE_NAME } from "@/lib/constants";
import { getAuthSession } from "@/lib/lastfm";
import { clearAuthStateCookie, createAuthCompletionToken, isValidAuthStateToken } from "@/server/auth";
import { encryptSecret } from "@/server/crypto";

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
  const stateValue = state ?? "";

  if (!token) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent("missing_token")}`, requestUrl.origin));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value;
  const hasValidStateToken = isValidAuthStateToken(stateValue);
  if (!hasValidStateToken) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent("invalid_state")}`, requestUrl.origin));
  }

  if (expectedState && stateValue !== expectedState) {
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

    const completionToken = createAuthCompletionToken({
      userAccountId: userAccount.id,
      next,
    });

    const response = new NextResponse(renderCompletionPage({ completionToken }), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
    clearAuthStateCookie(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "lastfm_auth_failed";
    const code = message.includes("not configured") ? "server_config" : "auth_failed";
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, requestUrl.origin));
  }
}

function renderCompletionPage(params: { completionToken: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Completing Sign-In...</title>
  </head>
  <body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;background:#f8fafc;color:#0f172a;">
    <main style="text-align:center;max-width:30rem;padding:1.5rem;">
      <h1 style="font-size:1.1rem;margin:0 0 .75rem;">Completing sign-in...</h1>
      <p style="margin:0 0 1rem;color:#475569;">Please wait while we finish connecting your Last.fm account.</p>
      <p id="status" style="margin:0;color:#334155;"></p>
      <form id="complete-form" method="post" action="/api/auth/lastfm/complete" style="margin:0;">
        <input type="hidden" name="token" value="${params.completionToken}" />
        <button type="submit" style="margin-top:1rem;padding:.6rem 1rem;border-radius:.5rem;border:1px solid #94a3b8;background:#fff;">Continue</button>
      </form>
    </main>
    <script>
      (() => {
        const status = document.getElementById("status");
        const form = document.getElementById("complete-form");
        if (status) {
          status.textContent = "Redirecting...";
        }
        if (form instanceof HTMLFormElement) {
          form.submit();
        }
      })();
    </script>
  </body>
</html>`;
}
