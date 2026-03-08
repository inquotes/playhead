# System Overview

## Architecture
- Last.fm REST API is the source of truth for listening and artist metadata (`user.getWeeklyChartList`, `user.getWeeklyArtistChart`, `library.getArtists`, `user.getTopArtists`, `user.getTopTracks`, `user.getRecentTracks`, `artist.getInfo`, `artist.getSimilar`).
- Auth/account model now uses Last.fm Web Auth (`auth.getSession`) with app-side `UserAccount` + `AuthSession` cookies; username-input connect remains as legacy fallback.
- Last.fm integration is centralized in `src/lib/lastfm.ts` (HTTP/retry) and `src/server/lastfm/service.ts` (normalization + DB cache).
- Discovery pipeline is deterministic in `src/server/discovery/pipeline.ts`; LLM is used only for lane synthesis and recommendation explanations.
- Async UX remains run-based (`AgentRun`, `AgentRunEvent`, SSE stream) while final outputs are persisted in `AnalysisRun` and `RecommendationRun`.
- Expensive Last.fm responses are cached in `LastfmApiCache`.

## Core Runtime Model
- Analyze step builds a `ListeningSnapshot` for the selected window and produces 3 lanes.
- Analyze supports optional `targetUsername` for "analyze another user" while ownership remains tied to authenticated `userAccountId`.
- Each lane includes compact `LaneContext` data: representative/member artists, tags, and bounded `similarHints` for warm-start recommendation expansion.
- Recommend step reuses lane context from `AnalysisRun` and does not rebuild the full listening snapshot.
- Recommend step fetches broad known history (library-first, cached), filters with the rule: exclude artists with `>= 10` known plays, allow `< 10`.
- Recommendation card copy is now playlist-editor style (`blurb`) with optional Last.fm top-album suggestion (`recommendedAlbum`); deterministic ranking remains unchanged.

## Account + History UX
- Landing is account-aware: unauthenticated users see `Connect Last.fm`; authenticated users see `Get Recommendations`.
- Profile page exists at `/profile` with logout and nested history: analyses with associated recommendation runs.
- `Re-Visit` links hydrate stored runs directly into the app via `/?analysisRunId=...` (optionally `&recommendationRunId=...`).
- Profile history currently shows self-target runs only (`targetLastfmUsername === currentUser.lastfmUsername`).

## Request Flows

### Analyze (`POST /api/discovery/analyze/start`)
1. Queue run.
2. Build listening snapshot from Last.fm weekly chart aggregation + artist profile enrichment.
3. Generate 3 lanes via strict JSON schema.
4. Attach bounded similar-artist hints per lane.
5. Persist lanes and trace metadata to `AnalysisRun` and run result, including `targetLastfmUsername`.

### Recommend (`POST /api/discovery/recommend/start`)
1. Queue run.
2. Load selected lane context from `AnalysisRun`.
3. Load known artist history for new-to-you filtering.
4. Expand candidates from lane similar-hints + fresh similar-artist calls.
5. Deterministically dedupe, filter, rank, and return top 4.
6. Generate concise editorial blurbs with LLM, grounded in tags/bio context.
7. Attach top album suggestion per selected artist using Last.fm `artist.getTopAlbums`.

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
- Recommendation progress UI maps to actual steps:
  - Loading lane context
  - Scanning known listening history
  - Finding and ranking recommendations
