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
- Next feature: saved artists (persist + view + remove).
- Then: history/profile IA and UX polish.
- Then: legacy API cleanup and docs alignment.
- Then: Cloudflare deploy-readiness via `ai-agent/cloudflare-deploy-readiness-plan.md` (Phase 1-4 baseline).

## Commands
- `npm run lint`
- `npm run build`

## Done Checklist
- Type-safe changes and readable code.
- No regression to MCP-first logic.
- Lint/build pass.
- Update `ai-agent/system-overview.md` if architecture behavior changes.
