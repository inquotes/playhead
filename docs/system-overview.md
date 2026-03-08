# System Overview

## Final architecture (post-refactor)

### 1) Data source of truth
- Official Last.fm REST API is the primary source for listening and artist metadata.
- Core methods used:
  - `user.getWeeklyChartList`
  - `user.getWeeklyArtistChart`
  - `library.getArtists`
  - `user.getTopArtists`
  - `user.getTopTracks`
  - `user.getRecentTracks`
  - `artist.getInfo`
  - `artist.getSimilar`

### 2) Service boundary
- `src/lib/lastfm.ts` handles low-level HTTP requests + retries.
- `src/server/lastfm/service.ts` handles parsing/normalization + read-through DB caching.
- Other backend modules do not call raw Last.fm fetches directly.

### 3) Deterministic discovery backend
- `src/server/discovery/pipeline.ts`:
  - builds `ListeningSnapshot`
  - synthesizes lanes from compact artist evidence (LLM)
  - expands/ranks recommendation candidates deterministically
  - asks LLM only for final explanation copy

### 4) Persistence and run orchestration
- Async run system remains (`AgentRun`, `AgentRunEvent`) for UX continuity.
- Final outputs are stored in:
  - `AnalysisRun`
  - `RecommendationRun`
- Response caching is stored in `LastfmApiCache`.

## Request flow

### Analyze
1. `POST /api/discovery/analyze/start`
2. Create queued run
3. Background job:
   - resolve time window
   - build snapshot from direct Last.fm API
   - synthesize 3 lanes with strict schema
   - persist analysis result
4. Client polls `/api/discovery/runs/[runId]` and subscribes to `/stream`.

### Recommend
1. `POST /api/discovery/recommend/start`
2. Create queued run
3. Background job:
   - load selected lane
   - rebuild/reuse cached snapshot
   - deterministic candidate expansion/filter/rank
   - generate explanation copy with LLM
   - persist recommendation result
4. Client reads completed result from run endpoint.

## LLM boundary
- LLM does:
  - lane grouping/naming/description
  - recommendation explanation text
- LLM does not:
  - fetch Last.fm data
  - pick candidates from unconstrained search
  - control recommendation ranking logic

## Migration status
- Core recommendation-critical path no longer depends on MCP.
- MCP modules remain in repo for migration compatibility but are not the primary discovery backend.
