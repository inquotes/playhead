import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { LogoutButton } from "./logout-button";

function formatMonthYearFromUnix(value: number | null): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value * 1000));
}

function backfillStatusLabel(params: {
  fullHistoryReadyAt: Date | null;
  status: string | null;
  weeksProcessed: number;
  weeksDiscovered: number;
}): "Complete" | "Running" | "Incomplete" {
  if (params.fullHistoryReadyAt || (params.weeksDiscovered > 0 && params.weeksProcessed >= params.weeksDiscovered)) {
    return "Complete";
  }
  if (params.status === "running") {
    return "Running";
  }
  return "Incomplete";
}

export default async function ProfilePage() {
  const user = await getCurrentUserAccount();
  if (!user) {
    redirect("/");
  }

  const name = user.displayName ?? user.lastfmUsername;
  const [totalHistoryArtists, exploredArtists, weeklyState, savedArtists] = await Promise.all([
    prisma.userKnownArtistRollup.count({
      where: { userAccountId: user.id },
    }),
    prisma.userKnownArtistRollup.count({
      where: {
        userAccountId: user.id,
        playcount: { gte: 10 },
      },
    }),
    prisma.userWeeklyListeningState.findUnique({
      where: { userAccountId: user.id },
      select: {
        status: true,
        weeksProcessed: true,
        weeksDiscovered: true,
        oldestWeekStart: true,
        fullHistoryReadyAt: true,
      },
    }),
    prisma.savedArtist.findMany({
      where: { userAccountId: user.id },
      select: {
        normalizedName: true,
        knownPlaycountAtSave: true,
      },
    }),
  ]);

  const savedArtistCount = savedArtists.length;
  const savedNames = [...new Set(savedArtists.map((artist) => artist.normalizedName))];
  const savedArtistRollups = savedNames.length
    ? await prisma.userKnownArtistRollup.findMany({
        where: {
          userAccountId: user.id,
          normalizedName: { in: savedNames },
        },
        select: {
          normalizedName: true,
          playcount: true,
        },
      })
    : [];

  const currentPlaycountByName = new Map(savedArtistRollups.map((row) => [row.normalizedName, row.playcount]));
  const progressedSavedArtists = savedArtists.reduce((count, artist) => {
    const currentPlaycount = currentPlaycountByName.get(artist.normalizedName) ?? 0;
    if (artist.knownPlaycountAtSave == null) {
      return currentPlaycount > 0 ? count + 1 : count;
    }

    return currentPlaycount > artist.knownPlaycountAtSave ? count + 1 : count;
  }, 0);
  const exploredSavedArtists = savedArtists.reduce((count, artist) => {
    const currentPlaycount = currentPlaycountByName.get(artist.normalizedName) ?? 0;
    return currentPlaycount >= 10 ? count + 1 : count;
  }, 0);

  const weeksProcessed = weeklyState?.weeksProcessed ?? 0;
  const weeksDiscovered = weeklyState?.weeksDiscovered ?? 0;
  const scrobblingSince = formatMonthYearFromUnix(weeklyState?.oldestWeekStart ?? null);
  const statusLabel = backfillStatusLabel({
    fullHistoryReadyAt: weeklyState?.fullHistoryReadyAt ?? null,
    status: weeklyState?.status ?? null,
    weeksProcessed,
    weeksDiscovered,
  });

  return (
    <section>
      <p className="mp-kicker">PROFILE HOME</p>
      <h2>{name}</h2>
      <p className="mp-muted">Last.fm username: {user.lastfmUsername}</p>

      <article className="mp-profile-hero" style={{ marginTop: "1rem" }}>
        <p className="mp-kicker">PROFILE STATS</p>
        <h3>Listening + discovery snapshot</h3>

        <div className="mp-profile-stat-flow">
          <article className="mp-profile-stat-card is-primary">
            <div className="mp-profile-stat-head">
              <p className="mp-kicker">EXPLORED ARTISTS</p>
              <span className="mp-info-wrap">
                <span className="mp-info-dot" role="img" aria-label="Info">
                  i
                </span>
                <span className="mp-info-tooltip" role="tooltip">
                  Explored Artists are artists in your listening history with 10 or more total scrobbles.
                </span>
              </span>
            </div>
            <strong>{exploredArtists}</strong>
            <p className="mp-profile-subtext">
              {exploredArtists} of {totalHistoryArtists} Total Artists
            </p>
          </article>

          <article className="mp-profile-stat-card">
            <div className="mp-profile-stat-head">
              <p className="mp-kicker">DISCOVERY PROGRESS</p>
              <span className="mp-info-wrap">
                  <span className="mp-info-dot" role="img" aria-label="Info">
                    i
                  </span>
                  <span className="mp-info-tooltip" role="tooltip">
                    Progressed means current scrobbles are higher than at save time. Explored means current scrobbles are 10 or more.
                  </span>
                </span>
              </div>
              <div className="mp-progress-modules">
                <div className="mp-progress-module">
                  <p className="mp-profile-mini-label">Progressed</p>
                  <strong>{progressedSavedArtists}</strong>
                  <p className="mp-profile-subtext">of {savedArtistCount} saved artists</p>
                </div>
                <div className="mp-progress-module">
                  <p className="mp-profile-mini-label">Explored</p>
                  <strong>{exploredSavedArtists}</strong>
                  <p className="mp-profile-subtext">of {savedArtistCount} saved artists</p>
                </div>
              </div>
            </article>

          <article className="mp-profile-stat-card">
            <div className="mp-profile-stat-head">
              <p className="mp-kicker">BACKFILL</p>
              <span className={`mp-status-chip is-${statusLabel.toLowerCase()}`}>{statusLabel}</span>
            </div>
            <p className="mp-profile-mini-label">Scrobbling since</p>
            <strong>{scrobblingSince}</strong>
            <p className="mp-profile-subtext">
              {weeksProcessed} / {weeksDiscovered} weeks indexed
            </p>
          </article>
        </div>

        <div className="mp-profile-subsection">
          <p className="mp-muted">Listening history stats use your indexed Last.fm history. Discovery progress uses your saved Discovery List only.</p>
        </div>
      </article>

      <div className="mp-profile-entry-grid" style={{ marginTop: "0.9rem" }}>
        <article className="mp-profile-card">
          <p className="mp-kicker">DISCOVERY LIST</p>
          <strong>Saved artists</strong>
          <p className="mp-muted">Open your full Discovery List page to manage saved artists.</p>
          <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.7rem" }}>
            <Link href="/profile/discovery-list" className="mp-button mp-button-ghost mp-button-compact">
              Open Discovery List
            </Link>
          </div>
        </article>

        <article className="mp-profile-card">
          <p className="mp-kicker">PAST RECOMMENDATIONS</p>
          <strong>Analysis history</strong>
          <p className="mp-muted">Browse past recommendation runs with load more paging.</p>
          <div className="mp-actions-row mp-actions-left" style={{ marginTop: "0.7rem" }}>
            <Link href="/profile/past-recommendations" className="mp-button mp-button-ghost mp-button-compact">
              Open Past Recommendations
            </Link>
          </div>
        </article>
      </div>

      <div className="mp-actions-row mp-actions-left" style={{ marginTop: "1.1rem" }}>
        <LogoutButton />
      </div>
    </section>
  );
}
