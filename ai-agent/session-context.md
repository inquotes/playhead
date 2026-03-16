# Session Context

## Start Here
- Read `ai-agent/system-overview.md` first.
- Skim `src/server/discovery/pipeline.ts`, `src/server/agent/jobs.ts`, `src/server/lastfm/service.ts`, `src/server/lastfm/recent-tail.ts`, `src/components/discovery-app.tsx`, and `ai-agent/todos.md`.

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
- Recent-tail refresh should never wipe stored tail data on invalid windows (`to < from`); invalid windows no-op and keep prior snapshot.
- Weekly backfill should progress via workflow-native per-user orchestration; watchdog is rescue-only for stale/failed states.
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
- Cloudflare deploy-readiness Phases 1-7 are complete (scoped/minimal for 6-7) and deployed.
- Discovery run operations now use a lightweight runbook path (`ai-agent/discovery-run-ops-runbook.md`) instead of dashboard/alerting scope.
- Product-facing focus is backlog UX/data-quality improvements, not additional Cloudflare platform work.
- Readiness-semantics tightening and benchmark target instrumentation are deferred backlog items.

## Recent Completed Work
- Data/API cleanup: removed legacy username-connect endpoints and dropped `LastfmConnection` schema model.
- Fixed recent-tail edge case where invalid windows could clear snapshot data and reset saved-artist progress deltas.
- Profile/navigation IA: first-class pages at `/profile`, `/profile/discovery-list`, and `/profile/past-recommendations`.
- Global authenticated navigation: shared top-nav pills (`Discovery List`, `Past Recommendations`, `Profile`) with compact mobile menu.
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
- Cloudflare deploy-readiness:
  - Phase 1 complete (Workers runtime + Wrangler/OpenNext setup)
  - Phase 2 complete (Prisma + D1 adapter and migration workflow)
  - Phase 3 complete (enqueue-only start endpoints, separate analyze/recommend queues with consumers + DLQs)
  - Phase 4 complete (polling-canonical progress delivery with DB-backed incremental run events)
  - custom domain route configured (`play-head.com`)
- Mobile auth hardening:
  - Last.fm callback origin pinned to canonical `APP_ORIGIN` (`https://play-head.com`)
  - callback now uses a signed completion token + finalize endpoint (`/api/auth/lastfm/complete`)
  - production should keep Cloudflare **Always Use HTTPS** enabled to prevent mixed-protocol cookie failures
- Phase 5 scheduling alignment complete:
  - weekly maintenance progression is workflow-native for normal paths
  - workflow loop skips idle waits after productive iterations
  - backfill status exposed at `GET /api/profile/backfill-status`
- Phase 6/7 scoped closeout complete:
  - cancellation endpoint: `POST /api/discovery/runs/[runId]/cancel`
  - stale discovery run sweeper endpoint + cron schedule (`0,20,40 * * * *`)
  - duplicate-run prevention + basic per-user start rate limiting on analyze/recommend starts
  - lightweight ops runbook and one-command smoke check (`npm run ops:discovery-smoke`)

## Commands
- `npm run lint`
- `npm run build`

## Done Checklist
- Type-safe changes and readable code.
- No regression to MCP-first logic.
- Lint/build pass.
- Update `ai-agent/system-overview.md` if architecture behavior changes.
