import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { VISITOR_COOKIE_NAME } from "@/lib/constants";

type VisitorSessionContext = {
  sessionId: string;
  createdCookie: boolean;
};

export async function getOrCreateVisitorSession(): Promise<VisitorSessionContext> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(VISITOR_COOKIE_NAME)?.value;
  const sessionId = existing ?? crypto.randomUUID();

  await ensureVisitorSession(sessionId);

  return {
    sessionId,
    createdCookie: !existing,
  };
}

export async function ensureVisitorSession(sessionId: string) {
  return prisma.visitorSession.upsert({
    where: { id: sessionId },
    create: { id: sessionId },
    update: {},
  });
}

export function attachVisitorCookie(
  response: NextResponse,
  context: VisitorSessionContext,
): NextResponse {
  if (!context.createdCookie) {
    return response;
  }

  response.cookies.set(VISITOR_COOKIE_NAME, context.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
