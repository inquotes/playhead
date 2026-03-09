# Cloudflare Deploy-Readiness Plan

This document captures the "go the extra mile" plan for running this app in a Cloudflare-native architecture with durable background execution.

## Target Architecture

- Next.js on Cloudflare (OpenNext/Cloudflare adapter)
- D1 as the relational database
- Queues for background analyze/recommend execution
- Durable Object (or polling-only fallback) for live progress fanout
- R2 optional later for large logs/artifacts

## Phase 1: Runtime and Data Foundation

1. Choose DB approach for D1:
   - Option A (recommended): migrate from Prisma + SQLite to Drizzle/Kysely + D1
   - Option B: keep Prisma with D1 adapter/runtime support (more complexity)
2. Add `wrangler.toml` with bindings for D1, Queue, and Durable Object (if used).
3. Establish local parity with `wrangler dev` and D1 migration workflow.
4. Replace SQLite-file assumptions with D1-safe migration and seed scripts.

## Phase 2: Durable Job Execution (Critical)

1. Update start endpoints to enqueue work only:
   - `POST /api/discovery/analyze/start`
   - `POST /api/discovery/recommend/start`
2. Keep `AgentRun` as source of truth for queue/run state.
3. Implement queue consumer that:
   - loads run by `runId`
   - applies idempotency/locking guard
   - executes pipeline
   - writes completion/failure and termination reason
4. Configure retries/backoff and poison-message handling.

## Phase 3: Progress Delivery

1. Remove in-memory `EventEmitter` dependency.
2. Persist all progress events in `AgentRunEvent`.
3. Use polling as baseline UX (every 2-5 seconds).
4. Optionally add Durable Object fanout for push updates once baseline is stable.

## Phase 4: Timeouts, Cancellation, Resilience

1. Enforce hard step and run-level deadlines in queue consumer.
2. Add cancellation endpoint (`POST /api/discovery/runs/[runId]/cancel`).
3. Add scheduled stale-run sweeper for orphaned `running` jobs.
4. Standardize error codes (e.g., `NO_HISTORY_WINDOW`, `NO_SEED_DATA`, `LASTFM_RATE_LIMIT`).

## Phase 5: Production Hardening on Cloudflare

1. Add per-user/session rate limits on start endpoints.
2. Prevent duplicate queued/running jobs for same logical request unless forced refresh.
3. Add observability dashboards and alerts (queue failures, timeout rate, run latency).
4. Move and manage all secrets through Wrangler secrets.

## Phase 6: Cost and Performance Tuning

1. Tune Last.fm cache TTLs to reduce repeated API calls.
2. Batch DB writes in worker paths where possible.
3. Keep polling cost-aware (2-5s with backoff on long runs).
4. Bound recommendation expansion and artist-profile fanout conservatively.

## Suggested Rollout Order

1. Queue-backed run execution (retain polling UI).
2. Remove in-memory fanout and rely on DB progress reads.
3. Complete D1 migration.
4. Add Durable Object push fanout only if polling UX is insufficient.

## Scope Guidance

- Minimal acceptable Cloudflare-ready baseline: Phases 1-4.
- Full "extra mile" setup: Phases 1-6.
