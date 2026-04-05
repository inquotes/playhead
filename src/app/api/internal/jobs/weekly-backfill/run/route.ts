import { NextResponse } from "next/server";
import { z } from "zod";
import { processWeeklyBackfillForUser, runWeeklyBackfillDispatcher } from "@/server/lastfm/weekly-history";

const bodySchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  userAccountId: z.string().min(1).optional(),
});

function isAuthorized(request: Request): boolean {
  const secret = process.env.QUEUE_PROCESS_SECRET;
  if (!secret) {
    return true;
  }

  const provided = request.headers.get("x-queue-secret");
  return Boolean(provided) && provided === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const payload = parsed.success ? parsed.data : {};
    const result = payload.userAccountId
      ? await processWeeklyBackfillForUser({ userAccountId: payload.userAccountId })
      : await runWeeklyBackfillDispatcher({
          limit: payload.limit ?? 10,
        });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backfill runner failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
