# Perf baseline (local, 2026-09-29)

Seed: `server/scripts/seedPerf.ts` (refuses non-local `PERF_DATABASE_URL`).
Rig: local Postgres 16 + local Redis, server on :8000
(`SERVICE_TOKEN=perf-token`), data via `scripts/loadPerf.ts` (N=50,
sequential) and `scripts/loadPut.ts` / `scripts/loadBatch.ts`.

## Data volume

500 students, 50,000 analyses, 200,000 attendance rows, 20,000 findings,
10,000 metrics. Seed time: ~10s.

## Endpoint latency (ms, N=50 sequential)

| Endpoint | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| Roster (`GET /students`) | 5 | 5 | 16 | 500 rows, seq scan + sort |
| Attendance unfiltered | 811 | 1466 | 1695 | 200k rows serialized; synthetic worst case — the UI always sends a month window |
| Reports | 0 | 1 | 8 | |
| History (20) | 1 | 2 | 4 | index scan |
| Findings trends | 22 | 25 | 29 | hash join over 20k findings |
| Overview | 9 | 12 | 13 | |
| PUT student (coach) | 1–3 | 2–5 | 3–21 | 2 caller resolutions × 2 trips |
| POST attendance/batch (200) | 141 med | — | 185 | 200 sequential upserts + verifies + sequential fan-out |

## EXPLAIN (ANALYZE, BUFFERS) summary

- History: index scan, 0.05ms.
- Roster: seq scan 500 + sort, 0.45ms.
- Attendance (100-row): nested loop over indexes, 0.4ms.
- Trends: seq scan 20k findings + hash join, 2.9ms — watch past ~2M findings
  (`idx_findings_server_job_id` exists; planner chose hash at this scale).
- Overview counts: seq scan 500, 0.1ms.

No index additions: every hot path is indexed or trivially small. Revisit past
10× data or when a plan flips to an unindexed seq scan.

## Optimizations shipped (before → after, same rig)

- Caller memo (`resolveCaller`, per-request WeakMap): 50 resolutions cost 1
  flight (`scripts/benchCaller.ts`: shared-request 0ms vs 13ms distinct for
  50). PUT latency within local noise (1–3ms → 1–2ms); value is 2 fewer
  sequential round trips per multi-resolve request (~2×RTT on hosted DB).
- Batch upsert + single verify (`setAttendanceBatch`, `getStudentsByIds`):
  200-entry batch 107–185ms → 4–16ms (~23×).
- Fan-out pool (5): exact-once preserved (targets precomputed); covered by
  the batch number above. Order-sensitive test made order-insensitive.

## Deliberately skipped (measured or out of scope)

- `includeArchived` predicate: boolean bind, no plan change.
- jsonb repair scan at boot: 31ms on 280k rows — not worth a schema_meta flag.
- Advisory lock for concurrent replicas: single-replica deploy; DDL already
  idempotent.
- Import bulk rewrite: not a hot path; import region owned by parallel work.
- Pool tuning (`max: 5`, statement_timeout): no pooler in this deploy; revisit
  with one.
- Unfiltered attendance cap: UI always filters; export path has own caps.
- Web bundle/Lighthouse: deps uninstallable in this worktree (blocked).
- Per-org monthly budget, spend alerts, queue aging: need prod traffic to
  tune; current controls are the daily quota, video-hash cache + dedup keys,
  and tier-weighted priority.
