import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueWeeklyBackfillJob } from "@/server/lastfm/weekly-history";

const bodySchema = z.object({
  userAccountId: z.string().min(1),
  username: z.string().min(1),
  priority: z.number().int().min(1).max(1000).optional(),
});

function isAuthorized(request: Request): boolean {
  const secret = process.env.WEEKLY_BACKFILL_RUN_SECRET;
  if (!secret) {
    return false;
  }

  const provided = request.headers.get("x-runner-secret");
  return Boolean(provided) && provided === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const payload = bodySchema.parse(await request.json());
    await enqueueWeeklyBackfillJob(payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue weekly backfill job.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
