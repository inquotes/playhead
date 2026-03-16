# Playhead

Playhead is a Last.fm-powered discovery app that helps you find artists that feel new-to-you while still matching your taste.

## Product Overview

- Analyze a listening window and generate 3 taste lanes.
- Open a lane and get deterministic recommendations (LLM writes copy only).
- Save artists into your Discovery List with lane context, blurb, and album suggestion.
- Track discovery progress in Profile:
  - explored artists in your listening history
  - progressed/explored saved artists
  - weekly history backfill status
- Revisit past analysis/recommendation runs.

## Core Principles

- Last.fm REST API is the source of truth.
- Ranking/filtering/dedupe are deterministic.
- LLM is limited to lane synthesis and recommendation explanations.

## Quick Start (Local)

1. Install dependencies:

```bash
npm install --cache .npm-cache
```

2. Configure env:

```bash
cp .env.example .env
```

3. Set required values in `.env`:

- `OPENAI_API_KEY`
- `LASTFM_API_KEY`
- `LASTFM_API_SECRET`
- `LASTFM_SESSION_ENCRYPTION_KEY` (32-byte key in base64 or 64-char hex)

4. Create schema and run:

```bash
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

## Cloudflare Deploy (Current Production Path)

```bash
npm run deploy
```

Required Worker secrets:

- `OPENAI_API_KEY`
- `LASTFM_API_KEY`
- `LASTFM_API_SECRET`
- `LASTFM_SESSION_ENCRYPTION_KEY`
- `QUEUE_PROCESS_SECRET` (recommended)

Required Worker vars:

- `APP_ORIGIN` (example: `https://play-head.com`)
- `PIPELINE_TIMEOUT_MS` (default `180000`)

Production auth reliability:

- Keep Cloudflare **Always Use HTTPS** enabled for `play-head.com`.

## Contributor Notes

- Build and typecheck:

```bash
npm run build
```

- Lint:

```bash
npm run lint
```

- D1 schema migrations use Prisma diff + Wrangler apply scripts in `package.json`.

## Future Feature Ideas

- Expand recommendation links beyond Last.fm (Apple Music / Spotify where mapping confidence is high).
- Add standalone in-app artist pages with artist-specific recommendation flows.
- Improve returning-user auth UX with faster known-device re-login and a clearer "forget this device" logout path.
- Add recommendation preference controls (block artists, boost favorites, optional Last.fm Love integration).
- Improve collaboration/split-credit attribution so "plays since saved" better reflects intended artists.
- Add playlist creation from recommendations via Apple MusicKit integration.
