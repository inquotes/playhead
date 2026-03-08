# AI Agent TODOs

## Completed This Session

- Implemented true Last.fm Web Auth account model (`/api/auth/lastfm/start`, `/api/auth/lastfm/callback`, app `AuthSession`).
- Added encrypted storage for Last.fm session keys (`LASTFM_SESSION_ENCRYPTION_KEY`).
- Migrated main UX from username-first to account-first (`Connect Last.fm` / `Get Recommendations`).
- Added profile page (`/profile`) with logout and account summary.
- Added optional "Analyze a different user" flow on time-range screen with real username validation.
- Added run ownership + target tracking fields (`userAccountId`, `targetLastfmUsername`) across run tables.
- Added profile history with nested recommendation runs (self-target history only).
- Added `Re-Visit` hydration links from profile back into the main app.
- Improved recommendation copy to playlist-editor blurbs and added recommended album suggestions.

## Current Product Decisions

- Keep legacy username-connect API paths temporarily; do not remove yet.
- Profile history should show only analyses about the logged-in user (not target-user history).
- Recommendation card copy should be listener-facing and non-technical.
- Preserve deterministic recommendation ranking; LLM is for lane synthesis and user-facing copy only.

## Next Priority TODOs

1. Add outbound links on recommendation cards:
   - Last.fm artist page (baseline)
   - optional Apple Music / Spotify links when mapping confidence is high

2. Deploy-readiness hardening:
   - replace in-memory event fanout with multi-instance-safe transport
   - replace request-lifecycle fire-and-forget job execution with durable/background-safe execution
   - enforce timeout/termination behavior in worker execution path

3. History UX polish:
   - add pagination/load-more on profile history
   - add richer revisit options (e.g., reopen directly to lane)

4. Data/infra cleanup:
   - remove stale legacy endpoints once cutover is complete
   - remove any remaining MCP-era remnants in code/docs/config

5. Product follow-ons:
   - saved artists/watchlist
   - account-level preferences and personalization
   - expanded listening profile reports

## Reference

- Inspiration: https://listentomore.com/
- Source repo reviewed: https://github.com/rianvdm/listentomore
