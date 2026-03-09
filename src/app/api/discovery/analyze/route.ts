import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getUserInfo } from "@/lib/lastfm";
import { prisma } from "@/server/db";
import { buildListeningSnapshot, synthesizeTasteLanes } from "@/server/discovery/pipeline";
import { resolveRange } from "@/server/discovery/range";
import { getCurrentUserAccount } from "@/server/auth";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const requestSchema = z.object({
  preset: z.enum(["7d", "1m", "6m", "1y", "custom"]),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  targetUsername: z.string().trim().min(2).max(64).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const context = await getOrCreateVisitorSession();
    const visitorSessionId = context.sessionId;
    const userAccount = await getCurrentUserAccount();
    if (!userAccount) {
      const response = NextResponse.json({ ok: false, message: "Connect Last.fm before running analysis." }, { status: 401 });
      return attachVisitorCookie(response, context);
    }

    const requestedTarget = payload.targetUsername?.trim();
    const isSelfTarget = !requestedTarget || requestedTarget.toLowerCase() === userAccount.lastfmUsername;
    let targetUsername = userAccount.lastfmUsername;

    if (!isSelfTarget && requestedTarget) {
      const info = await getUserInfo({ user: requestedTarget });
      const resolved = typeof info.user?.name === "string" ? info.user.name.trim().toLowerCase() : requestedTarget.toLowerCase();
      if (!resolved) {
        const response = NextResponse.json({ ok: false, message: "Could not resolve that Last.fm username." }, { status: 400 });
        return attachVisitorCookie(response, context);
      }
      targetUsername = resolved;
    }

    const range = resolveRange(payload);

    const snapshot = await buildListeningSnapshot({
      username: targetUsername,
      timeWindow: {
        preset: payload.preset,
        from: range.from,
        to: range.to,
        label: range.label,
      },
    });

    const noHistoryInWindow = snapshot.topArtists.length === 0;
    const laneResult = noHistoryInWindow
      ? {
          summary: `No scrobbles were found in ${range.label.toLowerCase()} for ${targetUsername}. Choose a broader window to generate lanes.`,
          notablePatterns: ["No listening activity was found in the selected period."],
          lanes: [],
        }
      : await synthesizeTasteLanes(snapshot);

    const run = await prisma.analysisRun.create({
      data: {
        visitorSessionId,
        userAccountId: userAccount.id,
        targetLastfmUsername: targetUsername,
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
      targetUsername,
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
