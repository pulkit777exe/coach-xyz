# Backup & Restore Runbook (§31)

## What is backed up (and by whom)

| Data | Store | Backup mechanism |
|---|---|---|
| `analysis_history`, `findings`, `clips`, `player_events`, `chat_messages`, objectives/plans, seasons/matches, wellness, subscriptions, `audit_logs`, org tables, users | Supabase PostgreSQL (`DATABASE_URL`) | Supabase automated daily backups + point-in-time recovery (project dashboard → Database → Backups) |
| Engine jobs, server jobs, rate limits, conversations | Upstash Redis | Ephemeral by design (2h TTLs); **not backed up** — completion truth lives in Supabase |
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
- Redis persistence: job loss on Redis outage = re-upload + re-analyze (jobs
  are reproducible from source video; summaries already persisted stay).
- Object storage with versioning (§10 buckets) — arrives with the signed-URL
  upload migration (Phase 4 follow-up).
