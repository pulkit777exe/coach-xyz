# Backup & Restore Runbook (§31)

## What is backed up (and by whom)

| Data | Store | Backup mechanism |
|---|---|---|
| `analysis_history`, `findings`, `chat_messages`, org tables, users | Supabase PostgreSQL (`DATABASE_URL`) | Supabase automated daily backups + point-in-time recovery (project dashboard → Database → Backups) |
| Engine jobs, server jobs, rate limits, conversations | Upstash Redis | Ephemeral by design (2h TTLs); **not backed up** — completion truth lives in Supabase |
| Source uploads, rendered videos | Engine local disk (`LOCAL_STORAGE_DIR`) | Ephemeral (session TTL / retention sweep); re-uploadable from the coach's originals |

## Restore testing (do this quarterly — an untested backup is not a backup)

1. Supabase: restore the latest backup to a **new preview branch** (dashboard
   → Backups → Restore → new branch, or `supabase db branch`).
2. Point a local server at the branch (`DATABASE_URL=<branch>`) and run:
   `cd server && bun test` — the DB-gated notification tests exercise live reads.
3. Spot-check: coach dashboard history, one analysis detail, findings trends.
4. Record the result (date, backup id, branch, tester) in the ops log.

## Drill log

- **2026-09-29, tester: agent (Phase 6.5).** Production Neon was
  deliberately not touched (no destructive tests against Neon, no preview
  branch available from here), so the drill ran the exact procedure
  against local Postgres instead: `pg_dump -Fc` of the ephemeral
  `coachxyz` DB (16,679 analyses, 6,679 findings, 501 students, 9.9 MB
  dump, ~2 s) → `pg_restore` into scratch `drill_restore` (~3 s).
  Findings: all 33 tables row-identical between source and restore;
  server booted on the restored DB and served roster (500), student
  detail, and owner history; an empty findings list for the sampled
  student was confirmed faithful (0 linked findings on source too);
  `notifications` + `notificationRoutes` suites green against the
  scratch DB (15/15). Scratch DB dropped afterwards. Total ~4 min wall.
  Next due: 2026-12-29 (quarterly).

## Retention

- Analyses + findings + chat prune after `RETENTION_DAYS` (default 365, min
  30) via the server's daily sweep (`pruneRetention` in `lib/analyses.ts`,
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
