# Session Context

## Start Here
- Read `ai-agent/system-overview.md` first.
- Skim `src/server/discovery/pipeline.ts`, `src/server/agent/jobs.ts`, `src/server/lastfm/service.ts`, and `src/components/discovery-app.tsx`.

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

## UX Guardrails
- Avoid exposing backend internals in user copy.
- Keep progress labels simple and user-facing.
- Keep lane descriptions rich, listener-friendly, and non-technical.

## Performance Priorities
- Analyze can be heavier; recommend should be lean.
- Reuse cached data and persisted lane context aggressively.
- Avoid unnecessary Last.fm calls in recommendation runs.

## Commands
- `npm run lint`
- `npm run build`

## Done Checklist
- Type-safe changes and readable code.
- No regression to MCP-first logic.
- Lint/build pass.
- Update `ai-agent/system-overview.md` if architecture behavior changes.
