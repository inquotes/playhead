import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserInfo } from "@/lib/lastfm";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  username: z.string().trim().min(2).max(64),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const visitorContext = await getOrCreateVisitorSession();

    const info = await getUserInfo({ user: payload.username });
    const userNode = info.user ?? {};
    const resolvedUsername = typeof userNode.name === "string" ? userNode.name.trim() : payload.username;
    const normalizedUsername = resolvedUsername.toLowerCase();

    const response = NextResponse.json({
      ok: true,
      username: resolvedUsername,
      normalizedUsername,
    });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not validate Last.fm username.";
    const status = message.includes("API error") ? 400 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
