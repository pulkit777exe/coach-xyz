# Backup & Restore Runbook (§31)

## What is backed up (and by whom)

| Data | Store | Backup mechanism |
|---|---|---|
| `analysis_history`, `findings`, `clips`, `player_events`, `chat_messages`, objectives/plans, seasons/matches, wellness, subscriptions, `audit_logs`, org tables, users | Supabase PostgreSQL (`DATABASE_URL`) | Supabase automated daily backups + point-in-time recovery (project dashboard → Database → Backups) |
| Engine jobs, server jobs, share tokens, AI-report jobs, rate limits | Postgres (`server_jobs`, `share_tokens`, `ai_report_jobs`) + bounded in-memory limiter | Jobs are durable rows; rate-limit counters are per-instance and intentionally ephemeral |
| Source uploads, rendered videos | Engine local disk (`LOCAL_STORAGE_DIR`) | Ephemeral (session TTL / retention sweep); re-uploadable from the coach's originals |

## Restore testing (do this quarterly — an untested backup is not a backup)

1. Supabase: restore the latest backup to a **new preview branch** (dashboard
   → Backups → Restore → new branch, or `supabase db branch`).
2. Point a local server at the branch (`DATABASE_URL=<branch>`) and run:
   `cd server && bun test` — the DB-gated notification tests exercise live reads.
3. Spot-check: coach dashboard history, one analysis detail, findings trends.
4. Record the result (date, backup id, branch, tester) in the ops log.

## Retention

- Analyses + findings + clips + player events + chat prune after `RETENTION_DAYS` (default 365, min
  30) via the server's daily sweep (`pruneRetention` in `historyStore.ts`/`analyses.ts`,
  scheduled in `queue.ts`).
- Engine uploads die with their session (2h TTL / 10-session cap); rendered
  videos expire with the engine job record (2h TTL).
- A coach deleting an analysis (`DELETE analyses/:jobId`) removes history +
  findings + chat immediately and fails the engine job.

## What this does NOT cover (explicit gaps)

- Cross-region copies: Supabase single-region until the workload justifies it.
- Rate-limit counters: in-process per instance; a restart resets them. Raise
  `*_RATE_LIMIT` or add a shared `RateLimitBackend` for multi-instance deploys.
- In-flight job rows: `server_jobs` is durable, but a job lost mid-engine-call is
  re-claimed by `reclaimStuckJobs` (attempts left) or failed by `failStuckJobs`;
  the analysis is reproducible from the source video.
- Object storage with versioning (§10 buckets) — arrives with the signed-URL
  upload migration (Phase 4 follow-up).
