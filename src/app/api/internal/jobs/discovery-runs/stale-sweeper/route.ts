import { NextResponse } from "next/server";
import { sweepStaleDiscoveryRuns } from "@/server/agent/jobs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.DISCOVERY_RUN_SWEEPER_SECRET;
  if (!secret) {
    return true;
  }

  const provided = request.headers.get("x-run-sweeper-secret");
  return Boolean(provided) && provided === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "25");
    const olderThanMsRaw = Number(url.searchParams.get("olderThanMs") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;
    const olderThanMs = Number.isFinite(olderThanMsRaw) && olderThanMsRaw > 0 ? Math.floor(olderThanMsRaw) : undefined;

    const result = await sweepStaleDiscoveryRuns({ limit, olderThanMs });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stale-run sweeper failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
