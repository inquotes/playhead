import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { getPastRecommendationsPage } from "@/server/profile/past-recommendations";
import { PastRecommendationsSection } from "../past-recommendations-section";

export default async function PastRecommendationsPage() {
  const user = await getCurrentUserAccount();
  if (!user) {
    redirect("/");
  }

  const initialPage = await getPastRecommendationsPage({
    userAccountId: user.id,
    lastfmUsername: user.lastfmUsername,
    limit: 10,
  });

  return <PastRecommendationsSection initialItems={initialPage.items} initialCursor={initialPage.nextCursor} />;
}
