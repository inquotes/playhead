import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { UserAccount } from "@prisma/client";
import { AUTH_COOKIE_NAME, AUTH_STATE_COOKIE_NAME } from "@/lib/constants";
import { prisma } from "@/server/db";

const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const AUTH_STATE_TOKEN_VERSION = "v1";
const AUTH_COMPLETE_TOKEN_VERSION = "v1";
const AUTH_COMPLETE_MAX_AGE_SECONDS = 60 * 2;

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAuthStateToken(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  const payload = `${AUTH_STATE_TOKEN_VERSION}.${issuedAt}.${nonce}`;
  const signature = signAuthStatePayload(payload);
  return `${payload}.${signature}`;
}

function getAuthStateSigningKey(): Buffer {
  const raw = process.env.LASTFM_SESSION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("LASTFM_SESSION_ENCRYPTION_KEY is not configured.");
  }

  const trimmed = raw.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("LASTFM_SESSION_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).");
  }

  return key;
}

function signAuthStatePayload(payload: string): string {
  return createHmac("sha256", getAuthStateSigningKey()).update(payload).digest("hex");
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function isValidAuthStateToken(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const [version, issuedAtRaw, nonce, signature] = parts;
  if (version !== AUTH_STATE_TOKEN_VERSION || !/^\d+$/.test(issuedAtRaw) || !/^[a-f0-9]{32}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60) {
    return false;
  }
  if (now - issuedAt > AUTH_STATE_MAX_AGE_SECONDS) {
    return false;
  }

  const payload = `${version}.${issuedAtRaw}.${nonce}`;
  const expectedSignature = signAuthStatePayload(payload);

  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createAuthCompletionToken(params: { userAccountId: string; next: string }): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const userAccountId = toBase64Url(params.userAccountId);
  const next = toBase64Url(params.next);
  const nonce = randomBytes(16).toString("hex");
  const payload = `${AUTH_COMPLETE_TOKEN_VERSION}.${issuedAt}.${userAccountId}.${next}.${nonce}`;
  const signature = signAuthStatePayload(payload);
  return `${payload}.${signature}`;
}

export function parseAuthCompletionToken(value: string): { userAccountId: string; next: string } | null {
  const parts = value.split(".");
  if (parts.length !== 6) {
    return null;
  }

  const [version, issuedAtRaw, userAccountIdRaw, nextRaw, nonce, signature] = parts;
  if (
    version !== AUTH_COMPLETE_TOKEN_VERSION
    || !/^\d+$/.test(issuedAtRaw)
    || !/^[a-f0-9]{32}$/i.test(nonce)
    || !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return null;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60) {
    return null;
  }
  if (now - issuedAt > AUTH_COMPLETE_MAX_AGE_SECONDS) {
    return null;
  }

  const payload = `${version}.${issuedAtRaw}.${userAccountIdRaw}.${nextRaw}.${nonce}`;
  const expectedSignature = signAuthStatePayload(payload);

  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const userAccountId = fromBase64Url(userAccountIdRaw).trim();
    const next = fromBase64Url(nextRaw).trim();
    if (!userAccountId || !next || !next.startsWith("/") || next.startsWith("//")) {
      return null;
    }
    return { userAccountId, next };
  } catch {
    return null;
  }
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
