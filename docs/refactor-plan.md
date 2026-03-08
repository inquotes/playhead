# Refactor Plan

## Scope
Incrementally migrate the app from MCP-first agentic retrieval to an API-first deterministic pipeline, without rewriting framework or async run infrastructure.

## Modules/files to add or change

### New / expanded Last.fm integration
- `src/lib/lastfm.ts`
  - direct Last.fm REST methods
  - retry-aware request handling
- `src/server/lastfm/service.ts`
  - cached read-through wrappers
  - parsing + normalization for weekly charts, artist info, similar artists, known-library artists

### Discovery pipeline
- `src/server/discovery/types.ts`
  - explicit domain objects (`ListeningSnapshot`, `ArtistProfile`, `TasteLane`, `RecommendationCandidate`, `RecommendationResult`)
- `src/server/discovery/pipeline.ts`
  - snapshot construction
  - lane synthesis (LLM, strict schema, fallback)
  - deterministic recommendation expansion/filter/rank
  - explanation generation (LLM, evidence-grounded)

### Async run integration
- `src/server/agent/jobs.ts`
  - keep run/event infra
  - replace agent-tool execution with deterministic pipeline calls
- `src/app/api/discovery/analyze/start/route.ts`
- `src/app/api/discovery/recommend/start/route.ts`
  - pass username-based context and launch deterministic runs

### Direct endpoints (compatibility)
- `src/app/api/discovery/analyze/route.ts`
- `src/app/api/discovery/recommend/route.ts`
  - use same deterministic pipeline for non-run synchronous path

### Connection flow
- `src/app/api/lastfm/connect/start/route.ts`
  - connect by username + direct API validation
- `src/app/api/lastfm/connect/verify/route.ts`
  - revalidate configured username
- `src/app/api/lastfm/connect/status/route.ts`
  - derive connection presence from username

### Cache model
- `prisma/schema.prisma`
  - add `LastfmApiCache`

### UI flow
- `src/components/discovery-app.tsx`
  - username-based connect
  - API-first product language
  - 4-rec result target

## MCP replacement plan
1. Keep MCP code present but non-critical.
2. Move analyze/recommend paths to direct Last.fm API-only retrieval.
3. Remove dependency on `mcpSessionId` for core routes.
4. Keep old modules as migration residue until cleanup PR.

## Backend/data flow plan

### Analyze flow
1. Resolve selected range.
2. Build `ListeningSnapshot` from direct Last.fm methods:
   - `user.getWeeklyChartList` + `user.getWeeklyArtistChart` aggregate
   - `artist.getInfo` on top artists for tags/similar/listener metadata
   - `library.getArtists` (fallback `user.getTopArtists`) for known-history set
3. Synthesize 3 lanes via LLM with strict JSON schema.
4. Store result in `AnalysisRun` and `AgentRun.resultJson`.

### Recommend flow
1. Load selected lane + rebuild cached snapshot for same range.
2. Deterministically expand candidates via `artist.getSimilar` from lane seeds.
3. Enrich with `artist.getInfo`.
4. Filter known artists using broad known-history set (exclude >= 10 plays, allow low-play candidates).
5. Rank deterministically and select top 4.
6. Generate concise explanations via LLM using only evidence payload.
7. Persist to `RecommendationRun` and `AgentRun.resultJson`.

## Endpoint/run plan
- Preserve `/analyze/start`, `/recommend/start`, `/runs/[runId]`, `/runs/[runId]/stream`.
- Replace internals only, so UI behavior and streaming contract stay stable.

## Data model plan
- Keep existing run/session models.
- Add `LastfmApiCache` to store expensive response payloads.
- Keep `LastfmConnection` with username/status as canonical user identity for pipeline.

## Cache strategy
- Read-through cache keyed by `(scope=username, method, params-hash)`.
- Suggested TTLs implemented:
  - weekly chart list: 6h
  - weekly artist chart windows: 12h
  - aggregated window snapshot pieces: 1h
  - artist info: 14d
  - similar artists: 7d
  - known artists scan: 6h

## UI state flow
- Connect via username input.
- Analyze/recommend still async with run polling + SSE event stream.
- Lane page remains core framing; traces now pipeline-oriented.

## Phased implementation order
1. Add Last.fm API service + retry + cache model.
2. Implement deterministic snapshot/lane/recommend pipeline.
3. Wire async run jobs to deterministic pipeline.
4. Wire sync compatibility endpoints.
5. Update connection flow and UI messaging.
6. Validate with lint/build.

## Risks / assumptions
- Assumes API key access to public profile data for target usernames.
- `library.getArtists` coverage can vary; fallback paths are required.
- Some artist metadata fields are sparse; ranking must degrade gracefully.
- Existing agent modules remain in repo temporarily and should be cleaned in follow-up.
