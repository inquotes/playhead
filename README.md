# Music Discovery Tool (API-first Last.fm + Next.js)

Music discovery app with deterministic retrieval and LLM-assisted interpretation:
- connect your Last.fm account
- choose a listening window
- fetch and normalize listening data directly from Last.fm API
- synthesize 3 taste lanes from compact artist-level evidence
- expand/rank recommendations deterministically
- use the LLM only to explain lane fit for final picks

The app uses Last.fm Web Authentication and stores an app session cookie after connect.

## Local setup (Node runtime)

1. Install dependencies

```bash
npm install --cache .npm-cache
```

2. Configure env

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

3. Create local database schema

```bash
npm run db:push
```

4. Start app

```bash
npm run dev
```

Open http://localhost:3000.

## Cloudflare CLI deploy setup (Phase 1 + 3)

1. Install dependencies and generate Prisma client

```bash
npm install --cache .npm-cache
npm run db:generate
```

2. Copy local dev vars file (for `wrangler dev` / OpenNext preview)

```bash
cp .dev.vars.example .dev.vars
```

3. Authenticate Wrangler and create your D1/Queue resources

```bash
npx wrangler login
npx wrangler d1 create playhead-db
npx wrangler queues create playhead-analyze-jobs
npx wrangler queues create playhead-recommend-jobs
npx wrangler queues create playhead-analyze-jobs-dlq
npx wrangler queues create playhead-recommend-jobs-dlq
```

4. Update `wrangler.jsonc` with the real `database_id` returned by D1 create.

5. Generate Cloudflare env types

```bash
npm run cf-typegen
```

6. Preview and deploy with CLI

```bash
npm run preview
npm run deploy
```

7. Add required runtime secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put LASTFM_API_KEY
npx wrangler secret put LASTFM_API_SECRET
npx wrangler secret put LASTFM_SESSION_ENCRYPTION_KEY
npx wrangler secret put QUEUE_PROCESS_SECRET
```

8. Optional: attach a custom domain and keep route config in source control.

- Dashboard path: Workers & Pages -> `playhead` -> Triggers -> Custom Domains.
- For apex custom domain (`play-head.com`), keep this in `wrangler.jsonc`:

```jsonc
"routes": [
  {
    "pattern": "play-head.com",
    "custom_domain": true
  }
]
```

9. Redeploy after secret/route changes:

```bash
npm run deploy
```

## D1 migration workflow (Prisma schema -> SQL)

Prisma Migrate is not the source of truth for D1 apply. Use Prisma for SQL generation and Wrangler for apply.

1. Create a migration file:

```bash
npm run db:d1:migrations:create -- add_initial_schema
```

2. Generate SQL from Prisma schema and write to that file:

```bash
npm run db:d1:diff -- migrations/0001_add_initial_schema.sql
```

3. Apply migrations locally and remotely:

```bash
npm run db:d1:migrations:apply:local
npm run db:d1:migrations:apply:remote
```

4. (Optional) Execute SQL file directly against D1:

```bash
npm run db:d1:execute:local -- migrations/0001_add_initial_schema.sql
npm run db:d1:execute:remote -- migrations/0001_add_initial_schema.sql
```

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
- Analyze and recommend jobs execute through Cloudflare Queues (`playhead-analyze-jobs`, `playhead-recommend-jobs`) with DLQs configured.
- Start endpoints:
  - `POST /api/discovery/analyze/start`
  - `POST /api/discovery/recommend/start`
- Run status endpoint:
  - `GET /api/discovery/runs/[runId]`
- Live SSE stream endpoint:
  - `GET /api/discovery/runs/[runId]/stream`
- Frontend polls run status + incremental run events (`sinceSeq`) and applies a client-side max wait guard to avoid infinite loading UI.
- Production posture: polling is canonical; SSE stream is optional compatibility transport.

## Cloudflare status

- Phases 1-4 are implemented and deployed.
- workers.dev URL: `https://playhead.ataitague.workers.dev`
- custom domain: `https://play-head.com`
- Auth callback origin is pinned via `APP_ORIGIN` (`https://play-head.com`) to avoid mixed-protocol OAuth return URLs.
- For production auth reliability, Cloudflare zone setting **Always Use HTTPS** should be enabled for `play-head.com`.
- Phase 5 (next): align weekly maintenance scheduling with Cloudflare-native triggers (cron/queue).

## Empty-data behavior

- If the selected analysis window has no listening history, analysis completes with an explicit no-history summary and no lanes.
- Recommendation runs short-circuit for lanes without seed data and return an empty recommendation list with clear user-facing messaging.
- Recommendation persistence is lane-scoped: one saved recommendation run per lane per analysis; refresh replaces the prior lane result.

## Pipeline env

- `PIPELINE_TIMEOUT_MS` (default `180000`)
- `LASTFM_API_KEY`
- `LASTFM_API_SECRET`
- `LASTFM_SESSION_ENCRYPTION_KEY` (32-byte key in base64 or 64-char hex)
- `APP_ORIGIN` (canonical public origin used for Last.fm callback URL, ex: `https://play-head.com`)
- `QUEUE_PROCESS_SECRET` (optional but recommended for `/api/internal/queue/process`)

In Cloudflare, set sensitive values as Worker secrets (CLI: `wrangler secret put <KEY>`).

## Key API routes

- `GET /api/session`
- `GET /api/auth/lastfm/start`
- `GET /api/auth/lastfm/callback`
- `GET|POST /api/auth/lastfm/complete`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/discovery/analyze/start`
- `POST /api/discovery/recommend/start`
- `GET /api/discovery/runs/[runId]`
- `GET /api/discovery/runs/[runId]/stream`
- `GET /api/history/analysis/[analysisRunId]`
- `GET /api/profile/backfill-status`

Account auth is fully Last.fm Web Auth + app-side session based; legacy username-connect routes have been removed.
