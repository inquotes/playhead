# System Overview

## Architecture
- Last.fm REST API is the source of truth for listening and artist metadata (`user.getWeeklyChartList`, `user.getWeeklyArtistChart`, `library.getArtists`, `user.getTopArtists`, `user.getTopTracks`, `user.getRecentTracks`, `artist.getInfo`, `artist.getSimilar`).
- Auth/account model uses Last.fm Web Auth (`auth.getSession`) with app-side `UserAccount` + `AuthSession` cookies.
- Auth start now uses canonical `APP_ORIGIN` for callback URL generation to avoid protocol drift on mobile (`/api/auth/lastfm/start` -> `/api/auth/lastfm/callback`).
- OAuth completion uses a short-lived signed completion token and top-level finalize step (`/api/auth/lastfm/complete`) before redirecting back to app UI.
- Legacy username-connect/disconnect API flow has been removed (`/api/lastfm/connect/*`, `/api/lastfm/disconnect`).
- Last.fm integration is centralized in `src/lib/lastfm.ts` (HTTP/retry) and `src/server/lastfm/service.ts` (normalization + DB cache).
- Discovery pipeline is deterministic in `src/server/discovery/pipeline.ts`; LLM is used only for lane synthesis and recommendation explanations.
- Async UX remains run-based (`AgentRun`, `AgentRunEvent`) with polling-canonical progress reads while final outputs are persisted in `AnalysisRun` and `RecommendationRun`.
- Cloudflare deploy-readiness Phases 1-5 are complete (Workers runtime + D1 adapter/migrations + queue-backed analyze/recommend execution + polling-canonical progress delivery + workflow-native weekly maintenance).
- Readiness-semantics hardening and benchmark-target instrumentation are intentionally deferred to backlog after Phase 5 closeout.
- Expensive Last.fm responses are cached in `LastfmApiCache`.

## Core Runtime Model
- Analyze step builds a `ListeningSnapshot`; if no in-window listening is found, it persists an empty-lane analysis with explicit no-history summary.
- Analyze supports optional `targetUsername` for "analyze another user" while ownership remains tied to authenticated `userAccountId`.
- Authenticated self-target runs warm and reuse persisted weekly listening history (`UserWeeklyArtistPlaycount` + `UserKnownArtistRollup`) and now refresh a persisted recent-tail snapshot before lane synthesis.
- Weekly history indexing is workflow-native per user (`WeeklyBackfillWorkflow` + `UserWeeklyBackfillJob`) with watchdog rescue for stale/retry states.
- Backfill status is exposed to authenticated app reads via `GET /api/profile/backfill-status` (workflow-style state + counters + readiness + last error).
- Weekly ingestion write path now batches per-week artist rows (`deleteMany` + `createMany`) and applies rollup deltas transactionally to reduce D1 write amplification.
- Recent-tail freshness is persisted in `UserRecentTailState` + `UserRecentTailArtistCount` (latest snapshot only per user) and merged into known-history/weekly-store reads for self-target runs.
- Recent-tail invalid windows now no-op and keep the previous stored snapshot (prevents accidental tail wipe/regression in profile progress counters).
- Pull recency telemetry is persisted in `UserDataPullLog` for both weekly backfill and recent-tail pulls; profile "Data Last Updated" reads from this table.
- Profile supports a manual refresh action (`POST /api/profile/update-now`) that refreshes recent-tail snapshot immediately and kicks weekly backfill progression.
- Each lane includes compact `LaneContext` data: representative/member artists, tags, and bounded `similarHints` for warm-start recommendation expansion.
- Recommend step reuses lane context from `AnalysisRun` and does not rebuild the full listening snapshot.
- Recommend step fetches broad known history (library-first, cached), filters with the rule: exclude artists with `>= 10` known plays, allow `< 10`.
- Recommend self-target runs now wait briefly (up to ~10s) for recent-year weekly history coverage and then filter from rollup; if still partial, run proceeds with best-available history and returns a user warning.
- Recommendation card copy is now playlist-editor style (`blurb`) with optional Last.fm top-album suggestion (`recommendedAlbum`); deterministic ranking remains unchanged.
- Recommendation persistence is lane-scoped: one run per lane per analysis; refresh replaces prior lane run.
- Recommendation execution short-circuits for empty seed lanes and for no-selected-candidate cases to avoid unnecessary long-running calls.

## Account + History UX
- Landing is account-aware: unauthenticated users see `Connect Last.fm`; authenticated users see `Get Recommendations`.
- HTTPS-only entry is required for reliable mobile auth cookies (Cloudflare **Always Use HTTPS** should be enabled for `play-head.com`).
- Authenticated navigation is global and consistent via shared top-nav pills (`Discovery List`, `Past Recommendations`, `Profile`) with a compact mobile menu.
- `PLAYHEAD` branding in authenticated headers links back to `/` and replaces a dedicated Home nav pill.
- Profile IA is first-class and split across `/profile`, `/profile/discovery-list`, and `/profile/past-recommendations`.
- `Discovery List` cards now preserve recommendation context at save-time (blurb, album, chips) and link directly to Last.fm artist/album pages.
- Discovery List cards now include `Plays since saved` (delta from save-time baseline against merged rollup + recent-tail current counts).
- `Re-Visit` links hydrate stored runs directly into the app via `/?analysisRunId=...` (optionally `&recommendationRunId=...`).
- Past Recommendations currently show self-target runs only (`targetLastfmUsername === currentUser.lastfmUsername`).
- Opening a lane reuses cached saved recommendations for that lane when available; users can explicitly `Refresh recs`.

## Request Flows

### Analyze (`POST /api/discovery/analyze/start`)
1. Create `AgentRun` with `queued` status and enqueue work to Cloudflare analyze queue.
2. Build listening snapshot from Last.fm weekly chart aggregation + artist profile enrichment.
3. If snapshot has no in-window artists, persist an empty-lane analysis with a no-history summary.
4. Otherwise generate 3 lanes via strict JSON schema.
5. Attach bounded similar-artist hints per lane.
6. Persist lanes and trace metadata to `AnalysisRun` and run result, including `targetLastfmUsername`.

### Recommend (`POST /api/discovery/recommend/start`)
1. Create `AgentRun` with `queued` status and enqueue work to Cloudflare recommend queue.
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
- Internal LLM benchmarking is available via `npm run bench:llm` (supports model/effort matrix testing).
- Recommendation progress UI maps to actual steps:
  - Loading lane context
  - Scanning known listening history
  - Finding and ranking recommendations
