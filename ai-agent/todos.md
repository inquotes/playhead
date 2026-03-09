# AI Agent TODOs

## Near-Term Roadmap

1. Saving artists feature (next build target)
   - add "Save artist" action on recommendation cards
   - add persisted saved-artists model tied to authenticated account
   - add saved artists view (profile section or dedicated page)
   - support remove/un-save and basic duplicate prevention

2. History and UX polish
   - add pagination/load-more on profile history
   - smooth rehydrate/revisit transitions (avoid landing-page flash before restored analysis/recommendation view appears)
   - redesign profile/navigation IA to support future sections as first-class pages (for example: Profile Stats, Saved Artists, Analysis History)
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
- Account-level preferences and personalization
- Expanded listening profile reports
- Additional saved-artists workflows (notes, tags, triage status)

## Reference

- Cloudflare plan: `ai-agent/cloudflare-deploy-readiness-plan.md`
- Inspiration: https://listentomore.com/
- Source repo reviewed: https://github.com/rianvdm/listentomore
