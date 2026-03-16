# AI Agent TODOs

## Backlog

### Discovery + Recommendation UX
- [ ] Expand recommendation card outbound links (Apple Music / Spotify when mapping confidence is high).
- [ ] Add standalone in-app artist pages (instead of routing to Last.fm), including artist-specific recommendation flows.
- [ ] Smooth rehydrate/revisit transitions (avoid landing-page flash before restored analysis/recommendation view appears).
- [ ] Tighten empty-state copy and CTAs across no-data/no-recs flows.
- [ ] Add preference controls for recommendation filtering:
  - "I dislike this artist" persistent blocklist
  - "Artists I love" positive weighting
  - optional Last.fm Love write-back integration

### Platform + Cleanup
- [ ] Set long-term latency budgets after more production-like usage.
- [ ] Remove remaining MCP-era wording in older docs/comments as opportunistic cleanup.
- [ ] Expand listening profile reports.

### Auth + Session UX
- [ ] Verify Cloudflare **Always Use HTTPS** remains enabled in production.
- [ ] Add lightweight mobile auth regression checklist (iOS Chrome + Safari).
- [ ] After several stable days, simplify temporary auth fallback/bridging logic where safe.
- [ ] Support quick re-login on known devices after first Last.fm connect (full OAuth fallback).
- [ ] Split logout UX: simple logout plus explicit "forget this device" full sign-out option.

### Data Quality + Attribution
- [ ] Improve saved-artist progress attribution for collaborations and split credits (for example, "billy woods + Moor Mother").
- [ ] Consider alias/identity-aware matching so "plays since saved" credits intended artists and recommended albums more accurately.

### Backfill Testing and Timing

#### Backfill Correctness + Measurement
- [ ] Tighten readiness semantics (`recentYearReadyAt`/`fullHistoryReadyAt`) under retrigger/retry.
- [ ] Build a repeatable backfill test protocol for long-history users (including ~1,100-week baseline accounts).
- [ ] Define fast iteration test modes (fixed-size week subsets, replay runs, canary users).
- [ ] Add timing instrumentation:
  - workflow iteration duration
  - weeks processed per minute/hour
  - time to `recentYearReadyAt`
  - time to `fullHistoryReadyAt`
- [ ] Add quick operator script/dashboard queries for before/after production comparisons.
- [ ] Document objective pass/fail thresholds for optimization PRs.

#### Backfill Performance Targets
- [ ] Set concrete target: most backfills complete in 5-10 minutes.
- [ ] Define "most" (for example, p50/p75 by discovered-week bucket).
- [ ] Split targets by milestone:
  - target time to `recentYearReadyAt`
  - target time to `fullHistoryReadyAt` for smaller histories
  - explicit expectation for extreme histories (1,000+ weeks)
- [ ] Produce optimization roadmap tied to targets (throughput knobs, batching strategy, workflow loop policy).

## Un-Organized Ideas

- Integrate Apple's MusicKit to enable playlist creation or library additions directly from recommendations.

## Reference

- Cloudflare plan: `ai-agent/cloudflare-deploy-readiness-plan.md`
- Inspiration: https://listentomore.com/
- Source repo reviewed: https://github.com/rianvdm/listentomore
