import { NextResponse } from "next/server";
import { runWeeklyBackfillDispatcher } from "@/server/lastfm/weekly-history";

function isAuthorized(request: Request): boolean {
  const secret = process.env.WEEKLY_BACKFILL_RUN_SECRET;
  if (!secret) {
    return true;
  }

  const provided = request.headers.get("x-runner-secret");
  return Boolean(provided) && provided === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const result = await runWeeklyBackfillDispatcher({ limit: 10 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backfill runner failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
