import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { prisma } from "@/server/db";
import { LogoutButton } from "./logout-button";
import { UpdateNowButton } from "./update-now-button";

function formatMonthYearFromUnix(value: number | null): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value * 1000));
}

function formatConnectedAt(value: Date | null): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatLastUpdatedAt(value: Date | null): { date: string; time: string } {
  if (!value) return { date: "n/a", time: "" };
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
  return { date, time };
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
  const connectedAtLabel = formatConnectedAt(user.lastLoginAt ?? user.createdAt);
  const [knownArtistRollupRows, recentTailRows, weeklyState, latestDataPull, savedArtists] = await Promise.all([
    prisma.userKnownArtistRollup.findMany({
      where: { userAccountId: user.id },
      select: {
        normalizedName: true,
        playcount: true,
      },
    }),
    prisma.userRecentTailArtistCount.findMany({
      where: { userAccountId: user.id },
      select: {
        normalizedName: true,
        playcount: true,
      },
    }),
    prisma.userWeeklyListeningState.findUnique({
      where: { userAccountId: user.id },
      select: {
        status: true,
        weeksProcessed: true,
        weeksDiscovered: true,
        oldestWeekStart: true,
        lastSuccessAt: true,
        fullHistoryReadyAt: true,
      },
    }),
    prisma.userDataPullLog.aggregate({
      where: {
        userAccountId: user.id,
        status: "success",
      },
      _max: {
        pulledAt: true,
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

  const mergedPlaycountByName = new Map<string, number>();
  for (const row of knownArtistRollupRows) {
    mergedPlaycountByName.set(row.normalizedName, row.playcount);
  }
  for (const row of recentTailRows) {
    const previous = mergedPlaycountByName.get(row.normalizedName) ?? 0;
    mergedPlaycountByName.set(row.normalizedName, previous + row.playcount);
  }

  const totalHistoryArtists = mergedPlaycountByName.size;
  const exploredArtists = [...mergedPlaycountByName.values()].reduce((count, playcount) => {
    return playcount >= 10 ? count + 1 : count;
  }, 0);

  const savedArtistCount = savedArtists.length;
  const savedNames = [...new Set(savedArtists.map((artist) => artist.normalizedName))];
  const savedNameSet = new Set(savedNames);
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
  for (const row of recentTailRows) {
    if (!savedNameSet.has(row.normalizedName)) continue;
    const previous = currentPlaycountByName.get(row.normalizedName) ?? 0;
    currentPlaycountByName.set(row.normalizedName, previous + row.playcount);
  }
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
  const historyLastUpdated = formatLastUpdatedAt(latestDataPull._max.pulledAt ?? weeklyState?.lastSuccessAt ?? null);
  const statusLabel = backfillStatusLabel({
    fullHistoryReadyAt: weeklyState?.fullHistoryReadyAt ?? null,
    status: weeklyState?.status ?? null,
    weeksProcessed,
    weeksDiscovered,
  });
  const missingWeeks = Math.max(0, weeksDiscovered - weeksProcessed);

  return (
    <section>
      <p className="mp-kicker">PROFILE HOME</p>
      <h2>{name}</h2>
      <p className="mp-kicker mp-profile-connect">LAST.FM CONNECTED @ {connectedAtLabel}</p>

      <article className="mp-profile-hero" style={{ marginTop: "1rem" }}>
        <p className="mp-kicker">PROFILE STATS</p>
        <h3>Listening + Discovery Snapshot</h3>

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
              <p className="mp-kicker">HISTORY</p>
              <UpdateNowButton />
            </div>
            <div className="mp-history-modules">
              <div className="mp-progress-module">
                <p className="mp-profile-mini-label">Scrobbling Since</p>
                <strong className="mp-module-value">{scrobblingSince}</strong>
              </div>

              <div className="mp-progress-module">
                <div className="mp-profile-stat-head">
                  <p className="mp-profile-mini-label">Data Backfilled</p>
                  <span className={`mp-status-chip is-${statusLabel.toLowerCase()}`}>{statusLabel}</span>
                </div>
                <strong className="mp-module-value">
                  {weeksProcessed} / {weeksDiscovered}
                </strong>
                <p className="mp-profile-subtext">weeks indexed</p>
              </div>

              <div className="mp-progress-module">
                <p className="mp-profile-mini-label">Data Last Updated</p>
                <strong className="mp-module-value-text">{historyLastUpdated.date}</strong>
                {historyLastUpdated.time && <p className="mp-profile-subtext">{historyLastUpdated.time}</p>}
              </div>
            </div>
            {statusLabel === "Incomplete" && (
              <p className="mp-profile-subtext mp-history-remediation">
                History needs attention. {missingWeeks > 0 ? `${missingWeeks} week${missingWeeks === 1 ? "" : "s"} still missing.` : "Try Update now to retry."}
              </p>
            )}
          </article>
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
