# Music Discovery Tool (API-first Last.fm + Next.js)

Music discovery app with deterministic retrieval and LLM-assisted interpretation:
- connect a Last.fm username
- choose a listening window
- fetch and normalize listening data directly from Last.fm API
- synthesize 3 taste lanes from compact artist-level evidence
- expand/rank recommendations deterministically
- use the LLM only to explain lane fit for final picks

No site account is required. The app uses an anonymous session cookie and stores run history per visitor session.

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

1. Enter your Last.fm username.
2. Click `Connect Username`.
3. Backend validates direct API access for that username.
4. Run analysis and recommendations.

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

## Pipeline env

- `PIPELINE_TIMEOUT_MS` (default `180000`)
- `LASTFM_API_KEY`
- `LASTFM_API_SECRET` (reserved for future signed methods)

## Key API routes

- `GET /api/session`
- `POST /api/lastfm/connect/start`
- `GET /api/lastfm/connect/status`
- `POST /api/lastfm/connect/verify`
- `POST /api/lastfm/disconnect`
- `POST /api/discovery/analyze`
- `GET /api/discovery/lanes/[analysisRunId]`
- `POST /api/discovery/recommend`
