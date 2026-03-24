"use client";

import Link from "next/link";

export function LandingView({
  status,
  username,
  busy,
  onConnect,
  onGetRecommendations,
}: {
  status: { isAuthenticated: boolean } | null;
  username: string;
  busy: boolean;
  onConnect: () => void;
  onGetRecommendations: () => void;
}) {
  return (
    <main className="mp-landing">
      <section className="mp-landing-card">
        <p className="mp-kicker">PLAYHEAD</p>
        <h1>Discover artists you don&apos;t know yet.</h1>
        <p>Recommendations based on what you already love, optimized for what is missing from your history.</p>
        <div className="mp-actions-row">
          {status?.isAuthenticated ? (
            <button className="mp-button mp-button-primary" onClick={onGetRecommendations} disabled={busy}>
              Get Recommendations
            </button>
          ) : (
            <button className="mp-button mp-button-primary" onClick={onConnect} disabled={busy}>
              Connect Last.fm
            </button>
          )}
        </div>
        {status?.isAuthenticated && (
          <p className="mp-kicker mp-auth-label">
            Logged in as{" "}
            <Link href="/profile" className="mp-auth-link">
              {username}
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
