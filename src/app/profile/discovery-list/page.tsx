import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
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
      savedAt: true,
      recommendationContextJson: true,
    },
  });

  return (
    <DiscoveryListSection
      initialItems={savedArtists.map((artist) => ({
        id: artist.id,
        artistName: artist.artistName,
        savedAt: artist.savedAt.toISOString(),
        recommendationContext: (artist.recommendationContextJson ?? null) as {
          blurb?: string;
          recommendedAlbum?: string | null;
          chips?: string[];
        } | null,
      }))}
    />
  );
}
