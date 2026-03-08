import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { buildListeningSnapshot, synthesizeTasteLanes } from "@/server/discovery/pipeline";
import { resolveRange } from "@/server/discovery/range";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  preset: z.enum(["7d", "1m", "6m", "1y", "custom"]),
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

    if (!connection?.lastfmUsername || connection.status !== "connected") {
      const response = NextResponse.json(
        { ok: false, message: "Connect Last.fm before running analysis." },
        { status: 400 },
      );
      return attachVisitorCookie(response, context);
    }

    const range = resolveRange(payload);

    const snapshot = await buildListeningSnapshot({
      username: connection.lastfmUsername,
      timeWindow: {
        preset: payload.preset,
        from: range.from,
        to: range.to,
        label: range.label,
      },
    });

    const laneResult = await synthesizeTasteLanes(snapshot);

    const run = await prisma.analysisRun.create({
      data: {
        visitorSessionId,
        rangeStart: range.from,
        rangeEnd: range.to,
        sourceVersion: "api-first-v1",
        artistsJson: snapshot.topArtists,
        tracksJson: (snapshot.metadata?.topTracks ?? []) as Prisma.InputJsonValue,
        heardArtistsJson: snapshot.knownArtists.map((artist) => artist.artistName),
        lanesJson: {
          summary: laneResult.summary,
          notablePatterns: laneResult.notablePatterns,
          lanes: laneResult.lanes,
        },
      },
    });

    const response = NextResponse.json({
      ok: true,
      analysisRunId: run.id,
      range,
      laneCount: laneResult.lanes.length,
      summary: laneResult.summary,
      notablePatterns: laneResult.notablePatterns,
      lanes: laneResult.lanes,
      topArtists: snapshot.topArtists.slice(0, 12),
      trace: {
        pipeline: "api-first-v1",
        dataSource: "official-lastfm-api",
      },
    });
    return attachVisitorCookie(response, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
