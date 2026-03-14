# Session Context

## Start Here
- Read `ai-agent/system-overview.md` first.
- Skim `src/server/discovery/pipeline.ts`, `src/server/agent/jobs.ts`, `src/server/lastfm/service.ts`, `src/components/discovery-app.tsx`, and `ai-agent/todos.md`.

## Product Intent
- Build a serious Last.fm discovery tool.
- Recommendations should feel new-to-you while staying musically coherent with the selected lane.

## Non-Negotiables
- Last.fm REST API is the source of truth.
- Do not reintroduce MCP as a recommendation-critical dependency.
- Deterministic backend logic for retrieval, dedupe, filtering, and ranking.
- LLM is only for lane synthesis and recommendation explanations.

## Current Rules
- New-to-you filter: exclude artists with `knownPlaycount >= 10`; allow `< 10`.
- Recommend flow should not rebuild full listening snapshots.
- Recommend should use lane context from analysis + known-history scan.
- Self-target known-history scans should prefer persisted weekly history + rollup, with a short readiness wait and partial-coverage fallback.
- Weekly backfill should progress via primary dispatch path; watchdog is rescue-only for stale/failed states.
- Persist one recommendation run per lane per analysis; refresh replaces prior lane result.
- If selected analysis window has no listening history, return empty lanes with explicit no-history messaging.
- If selected lane has no seed data, return empty recommendations quickly (no long-running expansion).

## UX Guardrails
- Avoid exposing backend internals in user copy.
- Keep progress labels simple and user-facing.
- Keep lane descriptions rich, listener-friendly, and non-technical.
- Rehydrate/revisit should feel smooth (avoid landing-page flash before restored state appears).

## Performance Priorities
- Analyze can be heavier; recommend should be lean.
- Reuse cached data and persisted lane context aggressively.
- Avoid unnecessary Last.fm calls in recommendation runs.
- Skip explanation-generation calls when there are no selected recommendation candidates.
- Enforce run timeouts and fail fast with clear user-visible errors.

## Current Roadmap Focus
- Latency pass is stabilized for now (nano + low effort + benchmark path in place).
- Next feature: history/profile UX polish (Profile home stats/backfill UX + app-level navigation polish).
- Then: legacy API cleanup and docs alignment.
- Then: Cloudflare deploy-readiness via `ai-agent/cloudflare-deploy-readiness-plan.md` (Phase 1-4 baseline).

## Recent Completed Work
- Profile/navigation IA: first-class pages at `/profile`, `/profile/discovery-list`, and `/profile/past-recommendations`.
- Past Recommendations now supports pagination/load-more.
- Profile hero stats (v1):
  - listening-history metric: Explored Artists (`>=10`) out of Total Artists
  - discovery metric: Progressed + Explored saved artists
  - backfill metric: `Complete|Running|Incomplete`, scrobbling since, and indexed weeks
- Discovery List improvements:
  - artist + album links to Last.fm
  - saved recommendation context (blurb, album, chips)
  - "Recommendation based on" chips in list cards
  - save-time baseline capture (`knownPlaycountAtSave`) for progress tracking
- Recommendation card simplification: removed "Seeded from ..." and made album links clickable.
- Cluster detail sidebar: added collapsible "More artists in this cluster" and improved member-artist expansion.

## Commands
- `npm run lint`
- `npm run build`

## Done Checklist
- Type-safe changes and readable code.
- No regression to MCP-first logic.
- Lint/build pass.
- Update `ai-agent/system-overview.md` if architecture behavior changes.
