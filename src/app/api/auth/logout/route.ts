import { NextResponse } from "next/server";
import { destroyCurrentAuthSession } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function POST() {
  try {
    const context = await getOrCreateVisitorSession();
    const response = NextResponse.json({ ok: true, isAuthenticated: false });
    await destroyCurrentAuthSession(response);
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to logout.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
