import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";
import type { Lane } from "@/server/discovery/types";

type Params = {
  params: Promise<{ analysisRunId: string }>;
};

function formatRangeLabel(from: number, to: number): string {
  const fromDate = new Date(from * 1000);
  const toDate = new Date(to * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
  return `${fmt.format(fromDate)} - ${fmt.format(toDate)}`;
}

export async function GET(_: Request, context: Params) {
  try {
    const user = await getCurrentUserAccount();
    const visitorContext = await getOrCreateVisitorSession();
    if (!user) {
      const response = NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
      return attachVisitorCookie(response, visitorContext);
    }

    const { analysisRunId } = await context.params;
    const run = await prisma.analysisRun.findFirst({
      where: {
        id: analysisRunId,
        userAccountId: user.id,
        targetLastfmUsername: user.lastfmUsername,
      },
      include: {
        recommendationRuns: {
          where: {
            userAccountId: user.id,
            targetLastfmUsername: user.lastfmUsername,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!run) {
      const response = NextResponse.json({ ok: false, message: "Analysis run not found." }, { status: 404 });
      return attachVisitorCookie(response, visitorContext);
    }

    const lanePayload = run.lanesJson as unknown as
      | { summary?: string; notablePatterns?: string[]; lanes?: Lane[] }
      | Lane[];
    const lanes = Array.isArray(lanePayload) ? lanePayload : (lanePayload.lanes ?? []);
    const summary = Array.isArray(lanePayload) ? null : (lanePayload.summary ?? null);

    const response = NextResponse.json({
      ok: true,
      analysisRunId: run.id,
      targetUsername: run.targetLastfmUsername,
      range: {
        from: run.rangeStart,
        to: run.rangeEnd,
        label: formatRangeLabel(run.rangeStart, run.rangeEnd),
      },
      summary,
      lanes,
      recommendationRuns: run.recommendationRuns.map((rec) => {
        const payload = rec.resultsJson as Prisma.JsonObject;
        return {
          id: rec.id,
          selectedLane: rec.selectedLane,
          createdAt: rec.createdAt,
          strategyNote: typeof payload.strategyNote === "string" ? payload.strategyNote : null,
          recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
        };
      }),
    });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load analysis history.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
