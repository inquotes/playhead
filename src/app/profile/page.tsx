import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { LogoutButton } from "./logout-button";

function formatDate(iso: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(iso);
}

function formatRangeLabel(from: number, to: number): string {
  const fromDate = new Date(from * 1000);
  const toDate = new Date(to * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${fmt.format(fromDate)} - ${fmt.format(toDate)}`;
}

export default async function ProfilePage() {
  const user = await getCurrentUserAccount();
  if (!user) {
    redirect("/");
  }

  const name = user.displayName ?? user.lastfmUsername;
  const recentAnalyses = await prisma.analysisRun.findMany({
    where: {
      userAccountId: user.id,
      targetLastfmUsername: user.lastfmUsername,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      recommendationRuns: {
        where: {
          userAccountId: user.id,
          targetLastfmUsername: user.lastfmUsername,
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
  });

  return (
    <main className="mp-page">
      <section className="mp-panel mp-panel-narrow">
        <p className="mp-kicker">PROFILE</p>
        <h2>{name}</h2>
        <p className="mp-muted">Last.fm username: {user.lastfmUsername}</p>
        <div className="mp-actions-row mp-actions-left" style={{ marginTop: "1rem" }}>
          <LogoutButton />
          <Link href="/" className="mp-button mp-button-ghost">
            Back Home
          </Link>
        </div>

        <div className="mp-divider" />

        <section>
          <p className="mp-kicker">RECENT ANALYSES</p>
          {recentAnalyses.length === 0 ? (
            <p className="mp-muted">No self-analysis history yet. Run your first analysis from home.</p>
          ) : (
            <div className="mp-history-list">
              {recentAnalyses.map((analysis) => {
                const payload = analysis.lanesJson as
                  | { lanes?: Array<{ id?: string; name?: string }> }
                  | Array<{ id?: string; name?: string }>;
                const lanes = Array.isArray(payload) ? payload : (Array.isArray(payload?.lanes) ? payload.lanes : []);
                const laneCount = lanes.length;
                const laneNameById = new Map(lanes.map((lane) => [String(lane.id ?? ""), lane.name ?? null]));
                return (
                  <article key={analysis.id} className="mp-history-card">
                    <div className="mp-history-head">
                      <p className="mp-kicker">{formatDate(analysis.createdAt)}</p>
                      <strong>{formatRangeLabel(analysis.rangeStart, analysis.rangeEnd)}</strong>
                    </div>
                    <p className="mp-muted">{laneCount} lanes generated</p>
                    <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.6rem" }}>
                      <Link href={`/?analysisRunId=${analysis.id}`} className="mp-button mp-button-ghost mp-button-compact">
                        Re-Visit Analysis
                      </Link>
                    </div>

                    {analysis.recommendationRuns.length > 0 ? (
                      <div className="mp-history-nested">
                        <p className="mp-kicker">RECOMMENDATIONS</p>
                        <ul className="mp-notes">
                          {analysis.recommendationRuns.map((recommendation) => {
                            const results = recommendation.resultsJson as { recommendations?: unknown[]; strategyNote?: string };
                            const recommendationCount = Array.isArray(results?.recommendations) ? results.recommendations.length : 0;
                            const laneName = laneNameById.get(recommendation.selectedLane) ?? "Saved lane";
                            return (
                              <li key={recommendation.id}>
                                <Link
                                  href={`/?analysisRunId=${analysis.id}&recommendationRunId=${recommendation.id}`}
                                  className="mp-auth-link"
                                >
                                  {formatDate(recommendation.createdAt)} - {laneName} ({recommendationCount} artists)
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <p className="mp-muted">No recommendation runs yet.</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
