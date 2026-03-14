# Music Discovery Tool (API-first Last.fm + Next.js)

Music discovery app with deterministic retrieval and LLM-assisted interpretation:
- connect your Last.fm account
- choose a listening window
- fetch and normalize listening data directly from Last.fm API
- synthesize 3 taste lanes from compact artist-level evidence
- expand/rank recommendations deterministically
- use the LLM only to explain lane fit for final picks

The app uses Last.fm Web Authentication and stores an app session cookie after connect.

## Local setup

1. Install dependencies

```bash
npm install --cache .npm-cache
```

2. Configure env

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

3. Create database schema

```bash
npm run db:push
```

4. Start app

```bash
npm run dev
```

Open http://localhost:3000.

## Last.fm connect flow

1. Click `Connect Last.fm`.
2. Approve access on Last.fm.
3. The callback exchanges token -> Last.fm session key.
4. App stores an authenticated session and runs analysis/recommendations.

Primary auth routes:

- `GET /api/auth/lastfm/start`
- `GET /api/auth/lastfm/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`

## API-first flow notes

- Direct Last.fm API is the source of truth for listening and artist metadata.
- Service layer is centralized in `src/lib/lastfm.ts` + `src/server/lastfm/service.ts`.
- Cache is persisted in `LastfmApiCache` (Prisma).
- LLM is used for lane synthesis and recommendation explanations only.
- Candidate expansion/filter/ranking is deterministic in `src/server/discovery/pipeline.ts`.

## Streaming run progress

- Analyze and recommend runs now execute asynchronously.
- Start endpoints:
  - `POST /api/discovery/analyze/start`
  - `POST /api/discovery/recommend/start`
- Run status endpoint:
  - `GET /api/discovery/runs/[runId]`
- Live SSE stream endpoint:
  - `GET /api/discovery/runs/[runId]/stream`
- Frontend also polls run status and applies a client-side max wait guard to avoid infinite loading UI.

## Empty-data behavior

- If the selected analysis window has no listening history, analysis completes with an explicit no-history summary and no lanes.
- Recommendation runs short-circuit for lanes without seed data and return an empty recommendation list with clear user-facing messaging.
- Recommendation persistence is lane-scoped: one saved recommendation run per lane per analysis; refresh replaces the prior lane result.

## Pipeline env

- `PIPELINE_TIMEOUT_MS` (default `180000`)
- `LASTFM_API_KEY`
- `LASTFM_API_SECRET`
- `LASTFM_SESSION_ENCRYPTION_KEY` (32-byte key in base64 or 64-char hex)

## Key API routes

- `GET /api/session`
- `GET /api/auth/lastfm/start`
- `GET /api/auth/lastfm/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/discovery/analyze/start`
- `POST /api/discovery/recommend/start`
- `GET /api/discovery/runs/[runId]`
- `GET /api/discovery/runs/[runId]/stream`
- `GET /api/history/analysis/[analysisRunId]`

Account auth is fully Last.fm Web Auth + app-side session based; legacy username-connect routes have been removed.
