import { createHash } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { UserAccount } from "@prisma/client";
import { AUTH_COOKIE_NAME, AUTH_STATE_COOKIE_NAME } from "@/lib/constants";
import { prisma } from "@/server/db";

const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAuthStateToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function attachAuthStateCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(AUTH_STATE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_STATE_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearAuthStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(AUTH_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function createAuthSession(response: NextResponse, params: {
  userAccountId: string;
  request: Request;
}): Promise<NextResponse> {
  const token = crypto.randomUUID();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.authSession.create({
    data: {
      userAccountId: params.userAccountId,
      tokenHash,
      expiresAt,
      userAgent: params.request.headers.get("user-agent"),
      ipAddress: params.request.headers.get("x-forwarded-for"),
    },
  });

  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });

  return response;
}

export async function getCurrentUserAccount(): Promise<UserAccount | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { userAccount: true },
  });

  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() },
  }).catch(() => {});

  return session.userAccount;
}

export async function requireCurrentUserAccount(): Promise<UserAccount> {
  const user = await getCurrentUserAccount();
  if (!user) {
    throw new Error("You must connect your Last.fm account first.");
  }
  return user;
}

export async function destroyCurrentAuthSession(response: NextResponse): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await prisma.authSession.deleteMany({ where: { tokenHash } });
  }

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
