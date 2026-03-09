# AI Agent TODOs

## Near-Term Roadmap

1. Saving artists feature (next build target)
   - add "Save artist" action on recommendation cards
   - add persisted saved-artists model tied to authenticated account
   - add saved artists view (profile section or dedicated page)
   - support remove/un-save and basic duplicate prevention

2. Per-user known-artist snapshot (for speed + future features)
   - persist a normalized `library.getArtists` snapshot by authenticated account
   - refresh snapshot on a bounded cadence/TTL and expose last refresh metadata
   - use snapshot to reduce repeated wide Last.fm history scans in recommendation runs
   - Rationale: speed up artist recommendation. Future backbone for Discovery Progress.
   - Idea: library.getArtists is good endpoint, but in an earlier experiment we tried taking a long range of getWeeklyArtistChart and then aggregating rough listens per artist by year...this is more of a rich dataset and maybe helps in the long term with some user profile concepts...debatable if this approach is valuable now or not.

3. History and UX polish
     - add pagination/load-more on profile history
     - smooth rehydrate/revisit transitions (avoid landing-page flash before restored analysis/recommendation view appears)
     - redesign profile/navigation IA to support future sections as first-class pages (for example: Profile Stats, Saved Artists, Analysis History)
     - add a top-nav entry for Discovery List so it is directly reachable from app flow
     - improve visual appearance/prominence of the "Analyze a different user" button
     - recommendation-card explanation polish when many cards repeat the same "Seeded from ..." artist (for example: enforce seed variety in selection or hide/soften repetitive seed labels)
     - cluster detail sidebar enhancement: add a collapsible "More artists in this cluster" list so seed context feels connected to visible cluster members
     - tighten empty-state copy and CTAs across no-data/no-recs flows

4. Data and API cleanup
    - remove stale legacy Last.fm username-connect endpoints after full cutover validation
    - remove remaining MCP-era remnants in code/docs/config
    - align docs with current account-first auth and history behavior

5. Deploy readiness (Cloudflare-first)
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
