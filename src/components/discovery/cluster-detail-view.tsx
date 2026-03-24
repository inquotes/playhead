"use client";

import type { Lane, Recommendation } from "./types";
import { normalizeArtistName } from "./types";

export function ClusterDetailView({
  lane,
  coreArtists,
  moreArtists,
  hasSeedData,
  recommendations,
  showingCached,
  knownHistoryMessage,
  busy,
  activeRunId,
  recommendSteps,
  savedArtistNameSet,
  savingArtistName,
  saveError,
  onRunRecommendations,
  onSaveArtist,
  onBack,
}: {
  lane: Lane;
  coreArtists: string[];
  moreArtists: string[];
  hasSeedData: boolean;
  recommendations: Recommendation[];
  showingCached: boolean;
  knownHistoryMessage: string | null;
  busy: boolean;
  activeRunId: string | null;
  recommendSteps: ReadonlyArray<{ id: string; label: string; state: string }>;
  savedArtistNameSet: Set<string>;
  savingArtistName: string | null;
  saveError: string | null;
  onRunRecommendations: () => void;
  onSaveArtist: (rec: Recommendation) => void;
  onBack: () => void;
}) {
  return (
    <main className="mp-detail-layout">
      <aside className="mp-detail-sidebar">
        <button className="mp-back" onClick={onBack}>
          ← All Clusters
        </button>
        <h2>{lane.name}</h2>
        <p className="mp-muted">{lane.description}</p>

        <div className="mp-block">
          <p className="mp-kicker">CORE ARTISTS</p>
          {coreArtists.length > 0 ? (
            <div className="mp-tag-wrap">
              {coreArtists.map((artist) => (
                <a
                  key={`${lane.id}-${artist.toLowerCase()}`}
                  className="mp-tag mp-tag-link"
                  href={`https://www.last.fm/music/${encodeURIComponent(artist)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {artist}
                </a>
              ))}
            </div>
          ) : (
            <p className="mp-muted">No clear lane artists found yet. Try rerunning analysis.</p>
          )}
        </div>

        {moreArtists.length > 0 && (
          <div className="mp-block">
            <details className="mp-collapsible-section">
              <summary>
                <span className="mp-kicker">MORE ARTISTS IN THIS CLUSTER ({moreArtists.length})</span>
              </summary>
              <div className="mp-tag-wrap mp-tag-wrap-compact">
                {moreArtists.map((artist) => (
                  <a
                    key={`${lane.id}-more-${artist.toLowerCase()}`}
                    className="mp-tag mp-tag-link"
                    href={`https://www.last.fm/music/${encodeURIComponent(artist)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {artist}
                  </a>
                ))}
              </div>
            </details>
          </div>
        )}

        <div className="mp-divider" />

        <div className="mp-meta-stack">
          <div>
            <p className="mp-kicker">TOTAL PLAYS</p>
            <strong>{lane.totalPlays}</strong>
          </div>
          <div>
            <p className="mp-kicker">CORE TAGS</p>
            <strong>{lane.tags.slice(0, 2).join(" + ") || "n/a"}</strong>
          </div>
        </div>
      </aside>

      <section className="mp-detail-main">
        <p className="mp-kicker">NEW FOR YOU</p>
        <h1>Recommended Artists</h1>
        <p className="mp-muted">Artists that match this cluster and are still likely underexplored in your history.</p>
        {knownHistoryMessage && <p className="mp-inline-warning">{knownHistoryMessage}</p>}

        {showingCached && (
          <div className="mp-actions-row mp-actions-left">
            <p className="mp-kicker">Showing saved recommendations</p>
            <button className="mp-button mp-button-ghost mp-button-compact" onClick={onRunRecommendations} disabled={busy}>
              Refresh recs
            </button>
          </div>
        )}

        {!busy && recommendations.length === 0 && hasSeedData && (
          <div className="mp-center-cta mp-detail-cta">
            <button className="mp-button mp-button-primary" onClick={onRunRecommendations}>
              Get Recommendations
            </button>
          </div>
        )}

        {!busy && recommendations.length === 0 && !hasSeedData && (
          <p className="mp-muted">This lane has no recommendation seed data in the selected time window. Try another lane or rerun analysis with a broader window.</p>
        )}

        {busy && activeRunId && (
          <div className="mp-progress-block">
            <p className="mp-kicker">BUILDING RECOMMENDATIONS</p>
            <div className="mp-status-lines mp-status-compact">
              {recommendSteps.map((step) => (
                <div key={step.id} className={`mp-status-line is-${step.state}`}>
                  <span />
                  <p>{step.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mp-rec-grid">
          {recommendations.map((rec) => (
            <article key={rec.artist} className="mp-rec-card">
              <h3>
                <a
                  className="mp-rec-artist-link"
                  href={`https://www.last.fm/music/${encodeURIComponent(rec.artist)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {rec.artist}
                </a>
              </h3>
              <p>{rec.blurb ?? rec.reason ?? "A strong fit for this lane."}</p>
              {rec.recommendedAlbum && (
                <small>
                  Start with album:{" "}
                  <a
                    className="mp-rec-album-link"
                    href={`https://www.last.fm/music/${encodeURIComponent(rec.artist)}/${encodeURIComponent(rec.recommendedAlbum)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {rec.recommendedAlbum}
                  </a>
                </small>
              )}
              <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.7rem" }}>
                {savedArtistNameSet.has(normalizeArtistName(rec.artist)) ? (
                  <span className="mp-chip">Saved to Discovery List</span>
                ) : (
                  <button
                    className="mp-button mp-button-ghost mp-button-compact"
                    onClick={() => onSaveArtist(rec)}
                    disabled={savingArtistName === rec.artist}
                  >
                    {savingArtistName === rec.artist ? "Saving..." : "Save to Discovery List"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {saveError && <p className="mp-inline-error">{saveError}</p>}
      </section>
    </main>
  );
}
