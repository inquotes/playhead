# AI Agent TODOs

## Current Focus (Next)

1. Phase 6 kickoff: resilience hardening

- add cancellation endpoint for queued/running discovery runs
- add stale-run sweeper for orphaned `running` runs
- add duplicate-run prevention + basic per-user rate limits

2. Deferred from Phase 5 (backlog-priority)

- readiness semantics hardening (`recentYearReadyAt`/`fullHistoryReadyAt` strictness under retrigger/retry)
- backfill testing + measurement playbook

- create a repeatable test protocol for long-history users (including ~1,100-week account baseline)
- define exactly how to run tests without waiting for full completion every time (for example: fixed-size week subsets, replay runs, and canary users)
- add timing instrumentation to capture throughput and latency:
  - workflow iteration duration
  - weeks processed per minute/hour
  - time to `recentYearReadyAt`
  - time to `fullHistoryReadyAt`
- add a quick operator script/dashboard query set for before/after comparisons on production data
- document pass/fail thresholds so optimization PRs can be judged objectively

3. Deferred from Phase 5 (backlog-priority)

- establish a concrete target: most backfills should complete in 5-10 minutes
- define what "most" means (for example p50/p75 by discovered-week bucket)
- split targets by milestone:
  - target time to `recentYearReadyAt`
  - target time to `fullHistoryReadyAt` for smaller histories
  - explicit expectation for extreme histories (1,000+ weeks)
- produce an optimization roadmap tied to these targets (throughput knobs, batching strategy, workflow loop policy)


## Backlog Ideas

- auth reliability follow-up:
  - verify Cloudflare **Always Use HTTPS** remains enabled in production
  - add a lightweight auth regression checklist for mobile (iOS Chrome + Safari)
  - once stable for multiple days, simplify any temporary auth fallback/bridging logic where safe
- outbound links expansion on recommendation cards (Apple Music / Spotify when mapping confidence is high)
- standalone artist pages in-app (instead of routing to Last.fm), including artist-specific recommendation flows to find new recommendations from one selected artist
- improve saved-artist progress attribution for collaborations and split credits (for example, album/artist strings like "billy woods + Moor Mother").
- consider alias- or identity-aware matching so "plays since saved" can credit intended artists and recommended albums more accurately.
- smoother returning-user auth UX: support quick re-login on known devices after first Last.fm connect, with full OAuth as fallback.
- logout UX split: keep standard logout simple, and add an explicit "forget this device" option for full sign-out/re-auth behavior.
- smooth rehydrate/revisit transitions (avoid landing-page flash before restored analysis/recommendation view appears)
- tighten empty-state copy and CTAs across no-data/no-recs flows
- set long-term latency budgets after more production-like usage
- remove remaining MCP-era wording in older docs/comments as opportunistic cleanup
- preference controls for recommendation filtering
  - "I dislike this artist" + persistent blocklist
  - "Artists I love" positive weighting
  - optional Last.fm Love write-back integration
- expanded listening profile reports

## Reference

- Cloudflare plan: `ai-agent/cloudflare-deploy-readiness-plan.md`
- Inspiration: https://listentomore.com/
- Source repo reviewed: https://github.com/rianvdm/listentomore
