# AI Agent TODOs

## Current Focus (Next)

1. Data + API cleanup

- remove stale legacy Last.fm username-connect endpoints after full cutover validation
- remove remaining MCP-era remnants in code/docs/config
- align docs with current account-first auth and history behavior

## Deploy Readiness (Cloudflare-first)

- implement `ai-agent/cloudflare-deploy-readiness-plan.md` in phased order
- prioritize Phase 1-4 as the minimum production baseline

## Backlog Ideas

- outbound links expansion on recommendation cards (Apple Music / Spotify when mapping confidence is high)
- standalone artist pages in-app (instead of routing to Last.fm), including artist-specific recommendation flows to find new recommendations from one selected artist
- smoother returning-user auth UX: support quick re-login on known devices after first Last.fm connect, with full OAuth as fallback.
- logout UX split: keep standard logout simple, and add an explicit "forget this device" option for full sign-out/re-auth behavior.
- smooth rehydrate/revisit transitions (avoid landing-page flash before restored analysis/recommendation view appears)
- tighten empty-state copy and CTAs across no-data/no-recs flows
- set long-term latency budgets after more production-like usage
- preference controls for recommendation filtering
  - "I dislike this artist" + persistent blocklist
  - "Artists I love" positive weighting
  - optional Last.fm Love write-back integration
- expanded listening profile reports

## Reference

- Cloudflare plan: `ai-agent/cloudflare-deploy-readiness-plan.md`
- Inspiration: https://listentomore.com/
- Source repo reviewed: https://github.com/rianvdm/listentomore
