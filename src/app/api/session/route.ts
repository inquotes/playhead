import { NextResponse } from "next/server";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

export async function GET() {
  try {
    const context = await getOrCreateVisitorSession();
    const response = NextResponse.json(
      {
        ok: true,
        sessionId: context.sessionId,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );

    return attachVisitorCookie(response, context);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to initialize session.",
      },
      { status: 500 },
    );
  }
}
