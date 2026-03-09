import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";

const createSavedArtistSchema = z.object({
  artistName: z.string().trim().min(1),
  savedFromRecommendationRunId: z.string().trim().min(1).optional(),
  savedFromAnalysisRunId: z.string().trim().min(1).optional(),
  savedFromLaneId: z.string().trim().min(1).optional(),
  savedFromTargetUsername: z.string().trim().min(1).optional(),
  knownPlaycountAtSave: z.number().int().min(0).optional(),
  knownArtistAtSave: z.boolean().optional(),
});

function normalizeArtistName(value: string): string {
  return value.trim().toLowerCase();
}

export async function GET() {
  try {
    const [visitorContext, user] = await Promise.all([getOrCreateVisitorSession(), getCurrentUserAccount()]);
    if (!user) {
      const response = NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
      return attachVisitorCookie(response, visitorContext);
    }

    const savedArtists = await prisma.savedArtist.findMany({
      where: { userAccountId: user.id },
      orderBy: { savedAt: "desc" },
      select: {
        id: true,
        artistName: true,
        normalizedName: true,
        savedAt: true,
        savedFromRecommendationRunId: true,
        savedFromAnalysisRunId: true,
        savedFromLaneId: true,
        savedFromTargetUsername: true,
        knownPlaycountAtSave: true,
        knownArtistAtSave: true,
      },
    });

    const response = NextResponse.json({
      ok: true,
      savedArtists,
    });

    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load saved artists.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const [visitorContext, user] = await Promise.all([getOrCreateVisitorSession(), getCurrentUserAccount()]);
    if (!user) {
      const response = NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
      return attachVisitorCookie(response, visitorContext);
    }

    const payload = createSavedArtistSchema.parse(await request.json());
    const artistName = payload.artistName.trim();
    const normalizedName = normalizeArtistName(artistName);

    const existing = await prisma.savedArtist.findUnique({
      where: {
        userAccountId_normalizedName: {
          userAccountId: user.id,
          normalizedName,
        },
      },
      select: {
        id: true,
        artistName: true,
        normalizedName: true,
        savedAt: true,
      },
    });

    if (existing) {
      const response = NextResponse.json({
        ok: true,
        alreadySaved: true,
        savedArtist: existing,
      });
      return attachVisitorCookie(response, visitorContext);
    }

    const savedArtist = await prisma.savedArtist.create({
      data: {
        userAccountId: user.id,
        artistName,
        normalizedName,
        savedFromRecommendationRunId: payload.savedFromRecommendationRunId,
        savedFromAnalysisRunId: payload.savedFromAnalysisRunId,
        savedFromLaneId: payload.savedFromLaneId,
        savedFromTargetUsername: payload.savedFromTargetUsername,
        knownPlaycountAtSave: payload.knownPlaycountAtSave,
        knownArtistAtSave: payload.knownArtistAtSave,
      },
      select: {
        id: true,
        artistName: true,
        normalizedName: true,
        savedAt: true,
      },
    });

    const response = NextResponse.json({
      ok: true,
      alreadySaved: false,
      savedArtist,
    });
    return attachVisitorCookie(response, visitorContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save artist.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
