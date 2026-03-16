import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { createAuthSession, parseAuthCompletionToken } from "@/server/auth";
import { ensureWeeklyHistoryInBackground } from "@/server/lastfm/weekly-history";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

type CompletionBody = { token?: string };

function withConnectedAuthParam(nextPath: string): string {
  const redirectUrl = new URL(nextPath, "http://localhost");
  redirectUrl.searchParams.set("auth", "connected");
  const query = redirectUrl.searchParams.toString();
  return query ? `${redirectUrl.pathname}?${query}` : redirectUrl.pathname;
}

function redirectToError(request: Request, errorCode: string): NextResponse {
  const requestUrl = new URL(request.url);
  return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(errorCode)}`, requestUrl.origin));
}

async function finalizeAuthCompletion(request: Request, rawToken: string): Promise<NextResponse> {
  const parsed = parseAuthCompletionToken(rawToken);
  if (!parsed) {
    return redirectToError(request, "invalid_state");
  }

  const userAccount = await prisma.userAccount.findUnique({
    where: { id: parsed.userAccountId },
    select: { id: true, lastfmUsername: true },
  });
  if (!userAccount) {
    return redirectToError(request, "auth_failed");
  }

  const visitorContext = await getOrCreateVisitorSession();
  await prisma.visitorSession.update({
    where: { id: visitorContext.sessionId },
    data: { userAccountId: userAccount.id },
  });

  const redirectTo = withConnectedAuthParam(parsed.next);
  const requestUrl = new URL(request.url);
  const response = NextResponse.redirect(new URL(redirectTo, requestUrl.origin));
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  await createAuthSession(response, {
    userAccountId: userAccount.id,
    request,
  });

  ensureWeeklyHistoryInBackground({
    userAccountId: userAccount.id,
    username: userAccount.lastfmUsername,
  });

  return attachVisitorCookie(response, visitorContext);
}

async function readCompletionToken(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as CompletionBody;
    return typeof payload.token === "string" ? payload.token : "";
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const value = formData.get("token");
    return typeof value === "string" ? value : "";
  }

  return "";
}

export async function POST(request: Request) {
  try {
    const rawToken = await readCompletionToken(request);
    return finalizeAuthCompletion(request, rawToken);
  } catch (error) {
    return redirectToError(request, "auth_failed");
  }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const rawToken = requestUrl.searchParams.get("token") ?? "";
    return finalizeAuthCompletion(request, rawToken);
  } catch {
    return redirectToError(request, "auth_failed");
  }
}
