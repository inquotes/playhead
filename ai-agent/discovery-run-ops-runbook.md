# Discovery Run Ops Runbook

This runbook is the minimal operator path for discovery run health on Cloudflare.

## Scheduled Guardrail

- Cron: every 20 minutes at minute `0,20,40` (`0,20,40 * * * *`)
- Action: call `POST /api/internal/jobs/discovery-runs/stale-sweeper`
- Purpose: fail orphaned `running` or `cancel_requested` runs that exceeded the stale threshold

Environment knobs (optional):

- `DISCOVERY_STALE_RUN_MS` (default `900000`)
- `DISCOVERY_STALE_SWEEP_LIMIT` (default `25`)
- `DISCOVERY_RUN_SWEEPER_SECRET` (recommended in production)

## Manual Operations

One-command smoke check (runs stale sweep, then queries active run statuses when Wrangler auth is available):

```bash
npm run ops:discovery-smoke
```

Run stale sweep manually:

```bash
curl -X POST "https://play-head.com/api/internal/jobs/discovery-runs/stale-sweeper" \
  -H "x-run-sweeper-secret: $DISCOVERY_RUN_SWEEPER_SECRET"
```

Run stale sweep with overrides:

```bash
curl -X POST "https://play-head.com/api/internal/jobs/discovery-runs/stale-sweeper?olderThanMs=600000&limit=50" \
  -H "x-run-sweeper-secret: $DISCOVERY_RUN_SWEEPER_SECRET"
```

Cancel a specific run (authenticated app session required):

```bash
POST /api/discovery/runs/{runId}/cancel
```

## Saved Query Set (D1)

Stale active runs now:

```sql
SELECT id, mode, status, startedAt, createdAt
FROM AgentRun
WHERE status IN ('running', 'cancel_requested')
ORDER BY startedAt ASC;
```

Recent failures by reason (last 24h):

```sql
SELECT
  COALESCE(terminationReason, 'none') AS terminationReason,
  COUNT(*) AS runs
FROM AgentRun
WHERE status = 'failed'
  AND createdAt >= datetime('now', '-1 day')
GROUP BY COALESCE(terminationReason, 'none')
ORDER BY runs DESC;
```

Analyze/recommend latency percentiles (last 24h, approximate by ordered sample):

```sql
SELECT
  mode,
  COUNT(*) AS n,
  AVG((julianday(completedAt) - julianday(startedAt)) * 86400.0) AS avg_seconds,
  MAX((julianday(completedAt) - julianday(startedAt)) * 86400.0) AS max_seconds
FROM AgentRun
WHERE status IN ('completed', 'failed')
  AND startedAt IS NOT NULL
  AND completedAt IS NOT NULL
  AND createdAt >= datetime('now', '-1 day')
GROUP BY mode;
```

Queue backlog proxy (queued count):

```sql
SELECT mode, COUNT(*) AS queued_runs
FROM AgentRun
WHERE status = 'queued'
GROUP BY mode;
```
