# AI Agent TODOs

## Near-Term Roadmap

1. Lane + recommendation timing optimization
   - reduce `llmLaneModelMs` (test model choices, temperature, prompt size/shape, and schema pressure)
   - break out and benchmark deterministic analyze stages beyond current coarse snapshot timing
   - benchmark recommendation stage timings (candidate expansion, profile enrichment, explanation, album lookup)
   - compare quality/latency tradeoffs and set target p50/p95 budgets for analyze + recommend

2. History and UX polish
      - add pagination/load-more on profile history
      - smooth rehydrate/revisit transitions (avoid landing-page flash before restored analysis/recommendation view appears)
      - redesign profile/navigation IA to support future sections as first-class pages (for example: Profile Stats, Saved Artists, Analysis History)
      - add a dedicated Listening History page (separate from profile summary)
      - surface weekly backfill/index status in account UI (for example: recent-year ready, full-history completion progress)
      - add a top-nav entry for Discovery List so it is directly reachable from app flow
      - improve visual appearance/prominence of the "Analyze a different user" button
      - recommendation-card explanation polish when many cards repeat the same "Seeded from ..." artist (for example: enforce seed variety in selection or hide/soften repetitive seed labels)
      - cluster detail sidebar enhancement: add a collapsible "More artists in this cluster" list so seed context feels connected to visible cluster members
      - tighten empty-state copy and CTAs across no-data/no-recs flows

3. Data and API cleanup
     - remove stale legacy Last.fm username-connect endpoints after full cutover validation
     - remove remaining MCP-era remnants in code/docs/config
     - align docs with current account-first auth and history behavior

4. Deploy readiness (Cloudflare-first)
     - implement `ai-agent/cloudflare-deploy-readiness-plan.md` in phased order
     - prioritize Phase 1-4 as the minimum production baseline

## Backlog Ideas

- Outbound links expansion on recommendation cards
  - Apple Music and Spotify links when mapping confidence is high
- Discovery Progress for saved artists
  - report when a saved artist is scrobbled again (first seen after save + latest listen)
  - show lightweight per-artist progress signals (recent scrobble count window, last heard timestamp)
  - optionally surface a "rediscovered" state when an artist reappears after inactivity
- Preference controls for recommendation filtering
  - "I dislike this artist" action and persistent blocklist for future recommendation exclusion
  - "Artists I love" list to positively weight future recommendations
  - explore optional Last.fm "Love" write-back integration for compatible actions
- Expanded listening profile reports

## Reference

- Cloudflare plan: `ai-agent/cloudflare-deploy-readiness-plan.md`
- Inspiration: https://listentomore.com/
- Source repo reviewed: https://github.com/rianvdm/listentomore
