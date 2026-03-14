"use client";

import { useState } from "react";
import Link from "next/link";
import type { PastRecommendationItem } from "@/server/profile/past-recommendations";

type PastRecommendationsSectionProps = {
  initialItems: PastRecommendationItem[];
  initialCursor: string | null;
};

type HistoryResponse = {
  ok: boolean;
  items: PastRecommendationItem[];
  nextCursor: string | null;
  message?: string;
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRangeLabel(from: number, to: number): string {
  const fromDate = new Date(from * 1000);
  const toDate = new Date(to * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${fmt.format(fromDate)} - ${fmt.format(toDate)}`;
}

export function PastRecommendationsSection({ initialItems, initialCursor }: PastRecommendationsSectionProps) {
  const [items, setItems] = useState<PastRecommendationItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!nextCursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/profile/past-recommendations?cursor=${encodeURIComponent(nextCursor)}&limit=10`);
      const data = (await response.json()) as HistoryResponse;
      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? "Failed to load more history.");
      }

      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more history.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="mp-kicker">PAST RECOMMENDATIONS</p>
      {items.length === 0 ? (
        <p className="mp-muted">No recommendation history yet. Run your first analysis from home.</p>
      ) : (
        <div className="mp-history-list">
          {items.map((analysis) => (
            <article key={analysis.analysisRunId} className="mp-history-card">
              <div className="mp-history-head">
                <p className="mp-kicker">{formatDate(analysis.createdAt)}</p>
                <strong>{formatRangeLabel(analysis.rangeStart, analysis.rangeEnd)}</strong>
              </div>
              <p className="mp-muted">{analysis.laneCount} lanes generated</p>
              <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.6rem" }}>
                <Link href={`/?analysisRunId=${analysis.analysisRunId}`} className="mp-button mp-button-ghost mp-button-compact">
                  Re-Visit Analysis
                </Link>
              </div>

              {analysis.recommendations.length > 0 ? (
                <div className="mp-history-nested">
                  <p className="mp-kicker">RECOMMENDATION RUNS</p>
                  <ul className="mp-notes">
                    {analysis.recommendations.map((recommendation) => (
                      <li key={recommendation.id}>
                        <Link
                          href={`/?analysisRunId=${analysis.analysisRunId}&recommendationRunId=${recommendation.id}`}
                          className="mp-auth-link"
                        >
                          {formatDate(recommendation.createdAt)} - {recommendation.laneName} ({recommendation.recommendationCount} artists)
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mp-muted">No recommendation runs yet.</p>
              )}
            </article>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.9rem" }}>
          <button className="mp-button mp-button-ghost" onClick={() => void loadMore()} disabled={busy}>
            {busy ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
      {error && <p className="mp-inline-error">{error}</p>}
    </section>
  );
}
