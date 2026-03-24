"use client";

import type { Lane } from "./types";
import { uniqueArtists } from "./types";

export function ClustersView({
  displayUsername,
  rangeLabel,
  summary,
  lanes,
  onOpenLane,
  onBack,
}: {
  displayUsername: string;
  rangeLabel: string | null;
  summary: string | null;
  lanes: Lane[];
  onOpenLane: (lane: Lane) => void;
  onBack: () => void;
}) {
  return (
    <main className="mp-page">
      <section className="mp-panel mp-panel-wide">
        <button className="mp-back" onClick={onBack}>
          ← Back to time selection
        </button>
        <p className="mp-kicker">TASTE ANALYSIS</p>
        <h2>{displayUsername}&apos;s Listening Clusters</h2>
        {rangeLabel && <p className="mp-muted">Analysis based on listening activity from {rangeLabel.toLowerCase()}.</p>}
        {summary && <p className="mp-summary">{summary}</p>}

        <div className="mp-divider" />
        {lanes.length === 0 ? (
          <p className="mp-muted">No listening history was found for this time window. Go back and choose a broader date range.</p>
        ) : (
          <div className="mp-cluster-list">
            {lanes.map((lane, idx) => (
              <button key={lane.id} className="mp-cluster-card" onClick={() => onOpenLane(lane)}>
                <div>
                  <p className="mp-kicker">CLUSTER {String(idx + 1).padStart(2, "0")}</p>
                  <h3>{lane.name}</h3>
                  <small>{uniqueArtists(lane.artists).length} core artists · {lane.totalPlays} plays</small>
                </div>
                <p>{lane.description}</p>
                <div className="mp-tag-wrap">
                  {uniqueArtists(lane.artists).slice(0, 7).map((artist) => (
                    <span key={`${lane.id}-${artist.toLowerCase()}`} className="mp-tag">
                      {artist}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
