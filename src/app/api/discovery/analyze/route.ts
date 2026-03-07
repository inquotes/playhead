import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { resolveRange } from "@/server/discovery/range";
import { callLastfmTool } from "@/server/lastfm/mcp";
import { parseWeeklyArtistChart } from "@/server/lastfm/parsers";
import { coerceLaneIds, runAnalyzeAgent } from "@/server/agent/runner";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  preset: z.enum(["7d", "1m", "6m", "1y", "summer2025", "custom"]),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;

    const connection = await prisma.lastfmConnection.findUnique({
      where: { visitorSessionId },
    });

    if (!connection?.mcpSessionId || connection.status !== "connected") {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before running analysis." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

    const range = resolveRange(payload);
    const artistSeedResult = await callLastfmTool(connection.mcpSessionId, "get_weekly_artist_chart", {
      from: range.from,
      to: range.to,
    });
    const topArtists = parseWeeklyArtistChart(artistSeedResult.text);
    const heardArtistsSeed = [...new Set(topArtists.map((artist) => artist.artist.trim()))].slice(0, 200);

    const agentResult = await runAnalyzeAgent({
      mcpSessionId: connection.mcpSessionId,
      rangeLabel: range.label,
      rangeStart: range.from,
      rangeEnd: range.to,
      heardArtistsSeed,
      maxToolCalls: 10,
    });

    const lanes = coerceLaneIds(agentResult.output.lanes);
    const heardArtists =
      agentResult.output.heardArtists.length > 0 ? agentResult.output.heardArtists : heardArtistsSeed;
    const traceJson = JSON.parse(JSON.stringify(agentResult.trace));

    const run = await prisma.analysisRun.create({
      data: {
        visitorSessionId,
        rangeStart: range.from,
        rangeEnd: range.to,
        sourceVersion: "agentic-v1",
        artistsJson: topArtists,
        tracksJson: [],
        heardArtistsJson: heardArtists,
        lanesJson: {
          summary: agentResult.output.summary,
          notablePatterns: agentResult.output.notablePatterns,
          lanes,
          trace: traceJson,
        },
      },
    });

    const response = NextResponse.json({
      ok: true,
      analysisRunId: run.id,
      range,
      laneCount: lanes.length,
      summary: agentResult.output.summary,
      notablePatterns: agentResult.output.notablePatterns,
      lanes,
      topArtists: topArtists.slice(0, 10),
      trace: traceJson,
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "The model returned an invalid analysis shape. Please retry."
        : error instanceof Error
          ? error.message
          : "Analysis failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
