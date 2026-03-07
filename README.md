# Music Discovery Tool (AI-first Next.js + Last.fm MCP)

AI-first lane discovery app:
- connect Last.fm
- choose a listening window
- let an agentic LLM decide which MCP tools to call (budgeted)
- pick a lane and generate recommendations with LLM-written explanations
- get unseen artist recommendations with AI-written explanations

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

1. Click `Connect Last.fm`.
2. You are redirected to Last.fm MCP login (`session_id` is generated server-side).
3. Return and click `I finished login, verify now`.
4. Run analysis and recommendations.

## AI-first flow notes

- Last.fm MCP provides listening data and candidate artist pools.
- OpenAI agent loop decides tool calls and synthesis.
- Prompt policy is server-owned in `src/server/agent/prompts.ts`.
- Tool-call budget defaults to 10 calls per run (configurable via env).
- Tool results include normalized parsed data for key MCP tools in `src/server/agent/tool-parsers.ts`.
- UI includes an optional trace panel showing tools used and termination reason.
- Recommendation toggle is `newPreferred` (prefer newer artists, not strict-only).
- With `newPreferred`, backend aims for ~60-80% newer picks when quality candidates exist, then backfills with strong older gap-fits.

## Streaming agent progress

- Analyze and recommend runs now execute asynchronously.
- Start endpoints:
  - `POST /api/discovery/analyze/start`
  - `POST /api/discovery/recommend/start`
- Run status endpoint:
  - `GET /api/discovery/runs/[runId]`
- Live SSE stream endpoint:
  - `GET /api/discovery/runs/[runId]/stream`

## Agent timeout and budget env

- `AGENT_TIMEOUT_MS` (default `240000`)
- `AGENT_MAX_TOOL_CALLS` (default `10`)
- Optional per-mode overrides:
  - `AGENT_ANALYZE_TIMEOUT_MS`
  - `AGENT_RECOMMEND_TIMEOUT_MS`
  - `AGENT_ANALYZE_MAX_TOOL_CALLS`
  - `AGENT_RECOMMEND_MAX_TOOL_CALLS`

## Key API routes

- `GET /api/session`
- `POST /api/lastfm/connect/start`
- `GET /api/lastfm/connect/status`
- `POST /api/lastfm/connect/verify`
- `POST /api/lastfm/disconnect`
- `POST /api/discovery/analyze`
- `GET /api/discovery/lanes/[analysisRunId]`
- `POST /api/discovery/recommend`
