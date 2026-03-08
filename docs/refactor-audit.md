# Refactor Audit

## Current stack and framework
- Next.js App Router (`src/app/**`), React client app in `src/components/discovery-app.tsx`.
- Prisma + SQLite (`prisma/schema.prisma`, `src/server/db.ts`).
- OpenAI chat completions used in multiple places (`src/server/agent/**`, `src/server/ai/**`).

## What exists today
- Async run system for analyze/recommend based on `AgentRun` + `AgentRunEvent` with SSE streaming (`src/app/api/discovery/runs/[runId]/stream/route.ts`).
- Last.fm connection model in DB (`LastfmConnection`) and session cookie model (`VisitorSession`).
- A working UI flow: connect -> pick range -> analyze lanes -> choose lane -> recommendations.

## Weaknesses found

### 1) Core data layer was MCP-centric
- Critical retrieval/recommendation logic depended on MCP tool calls or MCP-shaped parser behavior (`src/server/lastfm/mcp.ts`, `src/server/agent/runner.ts`, `src/server/discovery/recommender.ts`).
- This makes the product backend nondeterministic and harder to reason about.

### 2) Agent loop over-owned product logic
- Recommendation candidates and evidence path were previously delegated to an agent loop, increasing variance and latency.
- LLM had too much authority over retrieval decisions.

### 3) Service boundaries were weak
- Last.fm data fetching concerns were scattered between agent tools, parsers, and recommender code.
- There was no single API-first service module as source of truth for Last.fm retrieval and normalization.

### 4) Cache strategy was underpowered
- Existing persistence tracked runs and outputs, but did not aggressively cache expensive Last.fm API responses.
- Repeated windows and artist metadata lookups incurred repeat network work.

### 5) Product framing in UI skewed “agent/tool” over “music product”
- UI text and trace concepts emphasized agent internals over lane framing and deterministic recommendation rationale.

## What should be kept
- Session model and anonymous user flow.
- Async run orchestration + SSE updates (good UX for long operations).
- `AnalysisRun` / `RecommendationRun` storage shape with room for trace data.
- Existing range handling and lane-based interaction model.

## What should be refactored
- Replace recommendation-critical MCP retrieval with direct Last.fm API calls.
- Add a small Last.fm service layer that owns:
  - request handling
  - retry behavior
  - parsing
  - normalization
  - cache access
- Move lane generation and explanation generation to constrained LLM use cases only.
- Keep candidate generation/filter/ranking deterministic in backend code.

## What should be removed or retired
- MCP as primary backend dependency for discovery/recommendation.
- “Agent uses tools” as core runtime architecture for product logic.
- MCP-shaped recommendation internals as source of truth.

## MCP-specific dependencies to retire
- Direct reliance on `mcpSessionId` for analyze/recommend pipelines.
- MCP-first fetch path in recommendation-critical flow.
- Agent-tool framing as default flow (can remain as migration fallback if needed, but non-critical).

## Proposed target architecture
- **Last.fm API (direct)**: authoritative source of listening + artist metadata.
- **Last.fm service layer** (`src/server/lastfm/service.ts` + `src/lib/lastfm.ts`): fetch, normalize, retry, cache.
- **Deterministic discovery pipeline** (`src/server/discovery/pipeline.ts`):
  - build `ListeningSnapshot`
  - deterministic candidate expansion/ranking/filtering
  - strict typed intermediate objects
- **LLM usage**:
  - lane synthesis from compact artist-level summaries
  - explanation generation for already-ranked candidates
- **Persistence + cache**:
  - run outputs in `AnalysisRun` / `RecommendationRun`
  - API cache in `LastfmApiCache`
- **UI**:
  - lane-first product framing
  - async run progress remains
  - reduced emphasis on internal agent mechanics
