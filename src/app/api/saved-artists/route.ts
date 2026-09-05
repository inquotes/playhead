import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { DISCOVERY_PLAYCOUNT_THRESHOLD, normalizeArtistName } from "@/lib/artists";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { attachVisitorCookie, getOrCreateVisitorSession } from "@/server/session";
import { getCurrentArtistPlaycount } from "@/server/listening-history/service";

const recommendationContextSchema = z.object({
  blurb: z.string().trim().min(1).max(320).optional(),
  recommendedAlbum: z.string().trim().min(1).max(160).nullable().optional(),
  chips: z.array(z.string().trim().min(1).max(80)).min(1).max(3).optional(),
});

const createSavedArtistSchema = z.object({
  artistName: z.string().trim().min(1),
  savedFromRecommendationRunId: z.string().trim().min(1).optional(),
  savedFromAnalysisRunId: z.string().trim().min(1).optional(),
  savedFromLaneId: z.string().trim().min(1).optional(),
  savedFromTargetUsername: z.string().trim().min(1).optional(),
  knownPlaycountAtSave: z.number().int().min(0).optional(),
  knownArtistAtSave: z.boolean().optional(),
  recommendationContext: recommendationContextSchema.optional(),
});

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
        recommendationContextJson: true,
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
    const knownPlaycountAtSave = await getCurrentArtistPlaycount({
      userAccountId: user.id,
      normalizedName,
    });
    const recommendationContext = payload.recommendationContext
      ? {
          blurb: payload.recommendationContext.blurb,
          recommendedAlbum: payload.recommendationContext.recommendedAlbum ?? null,
          chips: payload.recommendationContext.chips,
        }
      : null;

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
        knownPlaycountAtSave: true,
        recommendationContextJson: true,
      },
    });

    if (existing) {
      const updateData: Prisma.SavedArtistUpdateInput = {};
      if (recommendationContext) {
        updateData.recommendationContextJson = recommendationContext as Prisma.InputJsonValue;
      }
      if (existing.knownPlaycountAtSave == null) {
        updateData.knownPlaycountAtSave = knownPlaycountAtSave;
        updateData.knownArtistAtSave = knownPlaycountAtSave >= DISCOVERY_PLAYCOUNT_THRESHOLD;
      }

      const updated =
        Object.keys(updateData).length > 0
          ? await prisma.savedArtist.update({
              where: {
                userAccountId_normalizedName: {
                  userAccountId: user.id,
                  normalizedName,
                },
              },
              data: updateData,
              select: {
                id: true,
                artistName: true,
                normalizedName: true,
                savedAt: true,
                knownPlaycountAtSave: true,
                recommendationContextJson: true,
              },
            })
          : existing;

      const response = NextResponse.json({
        ok: true,
        alreadySaved: true,
        savedArtist: updated,
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
        knownPlaycountAtSave,
        knownArtistAtSave: knownPlaycountAtSave >= DISCOVERY_PLAYCOUNT_THRESHOLD,
        recommendationContextJson: recommendationContext as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        artistName: true,
        normalizedName: true,
        savedAt: true,
        knownPlaycountAtSave: true,
        recommendationContextJson: true,
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
