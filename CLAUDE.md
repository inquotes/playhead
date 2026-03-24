# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Playhead

A Last.fm-powered music discovery app. Users connect their Last.fm account, analyze a listening window to generate 3 "taste lanes" (thematic artist groupings), then get deterministic recommendations within each lane. Deployed at play-head.com.

## Commands

```bash
npm install --cache .npm-cache   # Install dependencies (uses local cache)
npm run dev                      # Local dev server at localhost:3000
npm run build                    # TypeScript check + Next.js build
npm run lint                     # ESLint
npm run deploy                   # Build + deploy to Cloudflare Workers

# Database
npm run db:push                  # Push Prisma schema to local SQLite
npm run db:generate              # Regenerate Prisma client
npm run db:d1:diff               # Generate SQL migration from schema diff
npm run db:d1:migrations:apply:local   # Apply migrations to local D1
npm run db:d1:migrations:apply:remote  # Apply migrations to production D1

# Ops
npm run ops:discovery-smoke      # Smoke check for discovery runs
npm run bench:llm                # LLM latency benchmark
```

## Architecture

**Stack:** Next.js 16 (App Router, React 19) + Tailwind CSS 4, deployed on Cloudflare Workers via OpenNext. Database is Cloudflare D1 (SQLite) with Prisma ORM. Async jobs via Cloudflare Queues. Weekly backfill via Cloudflare Workflows.

**Key boundaries:**
- Last.fm REST API is the sole source of truth for listening data and artist metadata
- LLM (OpenAI gpt-4o-mini) is scoped to lane synthesis and recommendation copy only — never for retrieval, ranking, or filtering
- All recommendation logic (dedupe, filtering, ranking) is deterministic

**Request flow — Analyze:** API route enqueues to Cloudflare Queue → worker consumer builds listening snapshot from Last.fm weekly charts → LLM generates 3 taste lanes → persisted to `AnalysisRun`

**Request flow — Recommend:** API route enqueues to Cloudflare Queue → worker consumer loads lane context from prior analysis → expands candidates via similar-artist hints → deterministic filter/rank → LLM writes editorial blurbs → persisted to `RecommendationRun` (one per lane per analysis, refresh replaces)

**Progress delivery:** Polling-canonical via `AgentRun` + `AgentRunEvent` rows in DB. No WebSockets or in-memory fanout.

**Key source layout:**
- `src/app/api/` — API routes (auth, discovery, profile, internal jobs)
- `src/server/discovery/pipeline.ts` — core analyze/recommend orchestration
- `src/server/lastfm/service.ts` — Last.fm API wrapper with DB caching
- `src/server/lastfm/weekly-history.ts` — backfill orchestration
- `src/server/ai/client.ts` — OpenAI integration
- `src/server/agent/jobs.ts` — queue consumer entrypoints
- `src/components/discovery-app.tsx` — main discovery UI (large file)
- `worker.ts` — Cloudflare Worker: queue consumers, workflow, cron handler
- `prisma/schema.prisma` — 20+ models (auth, discovery, backfill, cache)
- `wrangler.jsonc` — Cloudflare config (D1, queues, cron, workflows)

## Non-Negotiables

- Do not reintroduce MCP as a recommendation-critical dependency
- New-to-you filter: exclude artists with `knownPlaycount >= 10`; allow `< 10`
- Recommend flow must not rebuild full listening snapshots — reuse lane context from analysis
- Recent-tail refresh must never wipe stored tail data on invalid windows
- Persist one recommendation run per lane per analysis; refresh replaces prior lane result
- Empty seed lanes should short-circuit quickly (no long-running expansion)

## Additional Context

Read `ai-agent/session-context.md` for current rules, guardrails, and roadmap focus. Read `ai-agent/system-overview.md` for detailed request flows and runtime model. The `ai-agent/todos.md` file has the current backlog.

## Environment Setup

Copy `.env.example` → `.env` and set: `OPENAI_API_KEY`, `LASTFM_API_KEY`, `LASTFM_API_SECRET`, `LASTFM_SESSION_ENCRYPTION_KEY`. Then `npm run db:push` to initialize local SQLite.

TypeScript path alias: `@/*` maps to `src/*`.
