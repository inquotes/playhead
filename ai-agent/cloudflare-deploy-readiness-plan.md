# Cloudflare Deploy-Readiness Plan

This document captures the Cloudflare-native, single-vendor deployment plan for Playhead.

## Implementation Status

- Phase 1 complete:
  - OpenNext + Wrangler CLI deploy path in repo
  - D1 binding configured in `wrangler.jsonc`
  - runtime secrets moved to Wrangler secrets
- Phase 2 complete:
  - Prisma runtime wired for D1 via `@prisma/adapter-d1`
  - D1 migration workflow established (`prisma migrate diff` -> `wrangler d1 migrations apply`)
  - initial schema migration applied locally and remotely
- Phase 3 complete:
  - start endpoints enqueue-only for analyze/recommend
  - separate queues + DLQs configured (`playhead-analyze-jobs`, `playhead-recommend-jobs`)
  - queue consumers deployed and processing via idempotent run-claim flow
- Phase 4 complete:
  - polling is the canonical progress transport for discovery runs
  - run status API supports incremental DB-backed event reads (`sinceSeq`)
  - production UX no longer depends on in-memory fanout semantics
- Phase 5 complete (scoped):
  - per-user weekly backfill progression is workflow-native in normal paths
  - workflow loop avoids idle waits after productive iterations
  - weekly ingestion uses batched week writes + transactional rollup delta updates
  - profile-readable backfill status endpoint is available (`GET /api/profile/backfill-status`)
  - readiness-semantics hardening and benchmark/threshold instrumentation intentionally deferred to backlog
- Deployment status:
  - workers.dev live
  - custom domain route configured (`play-head.com`)

## Decision

- Runtime/platform: Cloudflare (Workers-based Next.js deployment path)
- Database: Cloudflare D1
- ORM/query layer: Prisma ORM + `@prisma/adapter-d1`
- Async execution: Cloudflare Queues
- Scheduling: Cloudflare Cron Triggers
- Progress transport baseline: polling (Durable Object fanout optional later)

## Target Architecture

- Next.js app deployed to Cloudflare runtime
- D1 as the relational store for app data and run/event state
- Queue workers for analyze/recommend background execution
- Cron-driven maintenance for weekly history/backfill/watchdog
- Optional later: Durable Object push fanout, R2 for large artifacts

## Phase 1: Runtime + Bindings Foundation

1. Add/update `wrangler.toml` (or `wrangler.jsonc`) with bindings for:
   - D1 database
   - queue(s) for discovery jobs
   - cron triggers for maintenance jobs
2. Move all runtime secrets to Wrangler secrets (`LASTFM_*`, OpenAI keys, session encryption key).
3. Ensure local parity with `wrangler dev` and Cloudflare-style env loading.
4. Confirm Next.js runtime compatibility path and production build output for Cloudflare.

## Phase 2: Prisma + D1 Data Workflow

1. Keep Prisma as the app ORM; configure Cloudflare runtime usage with D1 adapter.
2. Adopt D1-safe migration workflow:
   - generate SQL diffs from Prisma schema
   - apply via Wrangler D1 migration/execute commands
3. Replace SQLite-file assumptions with D1-backed migration and seed scripts.
4. Execute one-time data migration from local SQLite to D1 with verification checks.

## Phase 3: Queue-Backed Durable Job Execution (Critical)

1. Start endpoints enqueue work only:
   - `POST /api/discovery/analyze/start`
   - `POST /api/discovery/recommend/start`
2. Keep `AgentRun` as source of truth for run state.
3. Queue consumer responsibilities:
   - claim run idempotently
   - execute pipeline
   - persist `AgentRunEvent` progress
   - write completion/failure + termination reason
4. Configure retries/backoff and dead-letter/poison handling.

## Phase 4: Progress Delivery (Cloudflare-safe baseline)

1. Remove production dependence on in-memory `EventEmitter` fanout.
2. Use DB-backed progress reads as canonical state.
3. Use polling baseline UX (2-5s interval + backoff).
4. Optionally add Durable Object fanout only if polling UX is insufficient.

## Phase 5: History Freshness + Scheduling Alignment

Goal: robust backfill completion with early unblock at latest-52-week readiness, while continuing to full-history completion.

1. Complete Option B migration (workflow-native orchestration):
   - move per-user weekly backfill progression into Cloudflare Workflows steps
   - keep one active workflow instance per user (`weekly-backfill:<userAccountId>`)
   - keep legacy dispatcher/watchdog as temporary fallback only during cutover
2. Eliminate idle gaps in the workflow loop:
   - continue immediately after productive iterations
   - sleep/back off only when no progress was made or retry windows apply
3. Reduce D1 write amplification in weekly processing:
   - replace per-row write chains with bounded batched write groups where safe
   - minimize repeated read/write passes per processed week
4. Keep milestone semantics stable and explicit:
   - set `recentYearReadyAt` when latest `min(52, discoveredWeeks)` windows are complete
   - set `fullHistoryReadyAt` when all discovered windows are complete
   - never clear readiness timestamps on normal enqueue/retrigger
5. Keep recent-tail persistence model and pull telemetry as canonical:
   - `UserRecentTailState`
   - `UserRecentTailArtistCount`
   - `UserDataPullLog`
6. Ensure profile `Update now` remains trigger-first and reliable in Cloudflare:
   - enqueue/reuse workflow instance, return quickly, no heavy request-path loops
7. Add minimal backfill status visibility (API/profile):
   - workflow state (`running`/`waiting`/`errored`/`complete`)
   - `weeksProcessed/weeksDiscovered`, readiness timestamps, last error details

## Phase 6: Resilience + Production Hardening

1. Enforce run/step deadlines in queue consumer.
2. Add cancellation endpoint (`POST /api/discovery/runs/[runId]/cancel`).
3. Add stale-run sweeper for orphaned `running` jobs.
4. Add per-user/session rate limits and duplicate-run prevention.
5. Standardize user-facing error codes/messages (`NO_HISTORY_WINDOW`, `NO_SEED_DATA`, `LASTFM_RATE_LIMIT`).

## Phase 7: Observability + Cost Tuning

1. Add dashboards/alerts for queue failures, timeout rate, stale runs, and run latency.
2. Tune Last.fm cache TTLs and keep polling cost-aware.
3. Batch writes where safe in worker paths.
4. Bound recommendation expansion/fanout conservatively for D1 throughput.

## Suggested Rollout Order

1. Phase 5 (history freshness + scheduling)
2. Phase 6 + Phase 7 (hardening and optimization)

## Scope Guidance

- Minimal Cloudflare-ready baseline: Phases 1-4
- Recommended production baseline for current app: Phases 1-6
- Full "extra mile" setup: Phases 1-7
