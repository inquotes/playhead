import { NextResponse } from "next/server";
import { z } from "zod";
import { processAnalyzeRunById, processRecommendRunById } from "@/server/agent/jobs";

const requestSchema = z.object({
  runId: z.string().min(1),
  mode: z.enum(["analyze", "recommend"]),
});

function isAuthorized(request: Request): boolean {
  const secret = process.env.QUEUE_PROCESS_SECRET;
  if (!secret) {
    return false;
  }

  const provided = request.headers.get("x-queue-secret");
  return Boolean(provided) && provided === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const payload = requestSchema.parse(await request.json());

    if (payload.mode === "analyze") {
      await processAnalyzeRunById(payload.runId);
      return NextResponse.json({ ok: true, mode: payload.mode, runId: payload.runId });
    }

    await processRecommendRunById(payload.runId);
    return NextResponse.json({ ok: true, mode: payload.mode, runId: payload.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue process handler failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
