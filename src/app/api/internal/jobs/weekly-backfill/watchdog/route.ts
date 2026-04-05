import { NextResponse } from "next/server";
import { runWeeklyHistoryWatchdog } from "@/server/lastfm/weekly-history";

function isAuthorized(request: Request): boolean {
  const secret = process.env.WEEKLY_BACKFILL_WATCHDOG_SECRET;
  if (!secret) {
    return true;
  }

  const provided = request.headers.get("x-watchdog-secret");
  return Boolean(provided) && provided === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const result = await runWeeklyHistoryWatchdog({ limit: 25 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Watchdog failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
