import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { getCurrentArtistPlaycounts } from "@/server/listening-history/service";
import { DiscoveryListSection } from "../discovery-list-section";

export default async function DiscoveryListPage() {
  const user = await getCurrentUserAccount();
  if (!user) {
    redirect("/");
  }

  const savedArtists = await prisma.savedArtist.findMany({
    where: { userAccountId: user.id },
    orderBy: { savedAt: "desc" },
    take: 100,
    select: {
      id: true,
      artistName: true,
      normalizedName: true,
      knownPlaycountAtSave: true,
      savedAt: true,
      recommendationContextJson: true,
    },
  });

  const savedNames = [...new Set(savedArtists.map((artist) => artist.normalizedName))];
  const currentPlaycounts = await getCurrentArtistPlaycounts({
    userAccountId: user.id,
    normalizedNames: savedNames,
  });
  const currentPlaycountByName = new Map(
    currentPlaycounts.map((row) => [row.normalizedName, row.playcount]),
  );

  return (
    <DiscoveryListSection
      initialItems={savedArtists.map((artist) => ({
        id: artist.id,
        artistName: artist.artistName,
        savedAt: artist.savedAt.toISOString(),
        playsSinceSaved: Math.max(0, (currentPlaycountByName.get(artist.normalizedName) ?? 0) - (artist.knownPlaycountAtSave ?? 0)),
        recommendationContext: (artist.recommendationContextJson ?? null) as {
          blurb?: string;
          recommendedAlbum?: string | null;
          chips?: string[];
        } | null,
      }))}
    />
  );
}
