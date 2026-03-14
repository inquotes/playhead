# System Overview

## Architecture
- Last.fm REST API is the source of truth for listening and artist metadata (`user.getWeeklyChartList`, `user.getWeeklyArtistChart`, `library.getArtists`, `user.getTopArtists`, `user.getTopTracks`, `user.getRecentTracks`, `artist.getInfo`, `artist.getSimilar`).
- Auth/account model uses Last.fm Web Auth (`auth.getSession`) with app-side `UserAccount` + `AuthSession` cookies; legacy username-connect routes still exist but are slated for removal.
- Last.fm integration is centralized in `src/lib/lastfm.ts` (HTTP/retry) and `src/server/lastfm/service.ts` (normalization + DB cache).
- Discovery pipeline is deterministic in `src/server/discovery/pipeline.ts`; LLM is used only for lane synthesis and recommendation explanations.
- Async UX remains run-based (`AgentRun`, `AgentRunEvent`, SSE stream) while final outputs are persisted in `AnalysisRun` and `RecommendationRun`.
- Expensive Last.fm responses are cached in `LastfmApiCache`.

## Core Runtime Model
- Analyze step builds a `ListeningSnapshot`; if no in-window listening is found, it persists an empty-lane analysis with explicit no-history summary.
- Analyze supports optional `targetUsername` for "analyze another user" while ownership remains tied to authenticated `userAccountId`.
- Authenticated self-target runs now warm and reuse persisted weekly listening history (`UserWeeklyArtistPlaycount` + `UserKnownArtistRollup`) before falling back to direct weekly API aggregation.
- Weekly history indexing is job-backed (`UserWeeklyBackfillJob`) with primary dispatch progression and watchdog rescue for stale/retry states.
- Each lane includes compact `LaneContext` data: representative/member artists, tags, and bounded `similarHints` for warm-start recommendation expansion.
- Recommend step reuses lane context from `AnalysisRun` and does not rebuild the full listening snapshot.
- Recommend step fetches broad known history (library-first, cached), filters with the rule: exclude artists with `>= 10` known plays, allow `< 10`.
- Recommend self-target runs now wait briefly (up to ~10s) for recent-year weekly history coverage and then filter from rollup; if still partial, run proceeds with best-available history and returns a user warning.
- Recommendation card copy is now playlist-editor style (`blurb`) with optional Last.fm top-album suggestion (`recommendedAlbum`); deterministic ranking remains unchanged.
- Recommendation persistence is lane-scoped: one run per lane per analysis; refresh replaces prior lane run.
- Recommendation execution short-circuits for empty seed lanes and for no-selected-candidate cases to avoid unnecessary long-running calls.

## Account + History UX
- Landing is account-aware: unauthenticated users see `Connect Last.fm`; authenticated users see `Get Recommendations`.
- Profile page exists at `/profile` with logout and nested history: analyses with associated recommendation runs.
- Profile now includes a `Discovery List` section for saved recommendation artists with remove support.
- `Re-Visit` links hydrate stored runs directly into the app via `/?analysisRunId=...` (optionally `&recommendationRunId=...`).
- Profile history currently shows self-target runs only (`targetLastfmUsername === currentUser.lastfmUsername`).
- Opening a lane reuses cached saved recommendations for that lane when available; users can explicitly `Refresh recs`.

## Request Flows

### Analyze (`POST /api/discovery/analyze/start`)
1. Queue run.
2. Build listening snapshot from Last.fm weekly chart aggregation + artist profile enrichment.
3. If snapshot has no in-window artists, persist an empty-lane analysis with a no-history summary.
4. Otherwise generate 3 lanes via strict JSON schema.
5. Attach bounded similar-artist hints per lane.
6. Persist lanes and trace metadata to `AnalysisRun` and run result, including `targetLastfmUsername`.

### Recommend (`POST /api/discovery/recommend/start`)
1. Queue run.
2. Load selected lane context from `AnalysisRun`.
3. Load known artist history for new-to-you filtering.
4. If lane has no seed data, complete with empty recommendations and a clear strategy note.
5. Otherwise expand candidates from lane similar-hints + fresh similar-artist calls.
6. Deterministically dedupe, filter, rank, and return top 4.
7. Generate concise editorial blurbs with LLM, grounded in tags/bio context.
8. Attach top album suggestion per selected artist using Last.fm `artist.getTopAlbums`.
9. Persist a single recommendation record per lane per analysis (refresh replaces prior lane record).

## LLM Boundary
- LLM is allowed to:
  - group artists into taste lanes
  - label and describe lanes
  - write recommendation explanation copy
- LLM is not allowed to:
  - fetch Last.fm data
  - choose candidates from unconstrained search
  - override deterministic ranking/filtering rules

## Performance Notes
- Analyze is heavier; recommend is intentionally lighter and should not repeat snapshot construction.
- Caching strategy is read-through and method-scoped by user.
- Worker paths now enforce run timeouts and set failure termination reason to `timeout` when exceeded.
- Analyze lane synthesis now emits timing detail (`llmLaneModelMs`, `similarHintsMs`, `totalMs`) and recommendation runs emit staged timing fields for optimization work.
- Recommendation progress UI maps to actual steps:
  - Loading lane context
  - Scanning known listening history
  - Finding and ranking recommendations
