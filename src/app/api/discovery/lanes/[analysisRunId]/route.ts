import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";
import type { Lane } from "@/server/discovery/types";

type Params = {
  params: Promise<{ analysisRunId: string }>;
};

export async function GET(_: Request, context: Params) {
  try {
    const { analysisRunId } = await context.params;
    const visitorContext = await getOrCreateVisitorSession();
    const visitorSessionId = visitorContext.sessionId;

    const run = await prisma.analysisRun.findFirst({
      where: {
        id: analysisRunId,
        visitorSessionId,
      },
    });

    if (!run) {
      const response = NextResponse.json({ ok: false, message: "Analysis run not found." }, { status: 404 });
      return attachVisitorCookie(response, visitorContext);
    }

    const lanePayload = run.lanesJson as unknown as
      | { summary?: string; notablePatterns?: string[]; lanes?: Lane[]; trace?: unknown }
      | Lane[];

    const lanes = Array.isArray(lanePayload) ? lanePayload : (lanePayload.lanes ?? []);
    const summary = Array.isArray(lanePayload) ? null : (lanePayload.summary ?? null);
    const notablePatterns = Array.isArray(lanePayload) ? [] : (lanePayload.notablePatterns ?? []);
    const trace = Array.isArray(lanePayload) ? null : (lanePayload.trace ?? null);

    const response = NextResponse.json({
      ok: true,
      analysisRunId: run.id,
      range: {
        from: run.rangeStart,
        to: run.rangeEnd,
      },
      summary,
      notablePatterns,
      lanes,
      trace,
      topArtists: run.artistsJson,
    });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load lanes.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
