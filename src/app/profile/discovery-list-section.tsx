"use client";

import { useMemo, useState } from "react";

type DiscoveryListItem = {
  id: string;
  artistName: string;
  savedAt: string;
  recommendationContext: {
    blurb?: string;
    recommendedAlbum?: string | null;
    chips?: string[];
  } | null;
};

type DiscoveryListSectionProps = {
  initialItems: DiscoveryListItem[];
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function DiscoveryListSection({ initialItems }: DiscoveryListSectionProps) {
  const [items, setItems] = useState<DiscoveryListItem[]>(initialItems);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()),
    [items],
  );

  async function removeSavedArtist(savedArtistId: string) {
    setRemovingId(savedArtistId);
    setError(null);
    try {
      const response = await fetch(`/api/saved-artists/${savedArtistId}`, { method: "DELETE" });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? "Failed to remove artist.");
      }

      setItems((prev) => prev.filter((item) => item.id !== savedArtistId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove artist.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section>
      <p className="mp-kicker">DISCOVERY LIST</p>
      {sortedItems.length === 0 ? (
        <p className="mp-muted">No saved artists yet. Save artists from your recommendations.</p>
      ) : (
        <div className="mp-history-list">
          {sortedItems.map((item) => (
            <article key={item.id} className="mp-history-card">
              <div className="mp-history-head">
                <strong>
                  <a
                    className="mp-lastfm-link"
                    href={`https://www.last.fm/music/${encodeURIComponent(item.artistName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.artistName}
                  </a>
                </strong>
                {item.recommendationContext?.blurb && <p className="mp-muted">{item.recommendationContext.blurb}</p>}
                {item.recommendationContext?.recommendedAlbum && (
                  <p className="mp-muted mp-saved-meta-line">
                    Start with album:{" "}
                    <a
                      className="mp-lastfm-link"
                      href={`https://www.last.fm/music/${encodeURIComponent(item.artistName)}/${encodeURIComponent(item.recommendationContext.recommendedAlbum)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.recommendationContext.recommendedAlbum}
                    </a>
                  </p>
                )}
                {Array.isArray(item.recommendationContext?.chips) && item.recommendationContext.chips.length > 0 && (
                  <div className="mp-saved-chip-row">
                    <p className="mp-kicker">RECOMMENDATION BASED ON</p>
                    <div className="mp-tag-wrap">
                      {item.recommendationContext.chips.slice(0, 3).map((chip) => (
                        <span key={`${item.id}-${chip.toLowerCase()}`} className="mp-tag">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.6rem" }}>
                <button
                  className="mp-button mp-button-ghost mp-button-compact"
                  onClick={() => void removeSavedArtist(item.id)}
                  disabled={removingId === item.id}
                >
                  {removingId === item.id ? "Removing..." : "Remove"}
                </button>
                <p className="mp-muted mp-saved-date">Saved {formatDate(item.savedAt)}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      {error && <p className="mp-inline-error">{error}</p>}
    </section>
  );
}
