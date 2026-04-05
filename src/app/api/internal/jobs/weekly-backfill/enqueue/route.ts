import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueWeeklyBackfillJob } from "@/server/lastfm/weekly-history";

const bodySchema = z.object({
  userAccountId: z.string().min(1),
  username: z.string().min(1),
  priority: z.number().int().min(1).max(1000).optional(),
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

    const payload = bodySchema.parse(await request.json());
    await enqueueWeeklyBackfillJob(payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue weekly backfill job.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
