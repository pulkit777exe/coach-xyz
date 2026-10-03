# Perf baseline (local, 2026-09-29 — **re-measured 2026-10-03**)

> The 2026-09-29 table below is retained as the historical record. The
> **Current state** table further down is the live one; where the two disagree,
> the newer measurement wins. One entry in *Deliberately skipped* was wrong and
> has been corrected in place — see the import-bulk line, which was listed as
> "not a hot path" and is now the second-fastest write in the suite.

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

## Current state (local, 2026-10-03)

Same rig and seed as above, re-run after the optimisation round. Harness
`/tmp/opencode/perf-latency.ts`: 5 discarded warmups, then **N=50 sequential**
requests through the real service boundary, reporting **response body size** as
well as latency - the size is the number CI can actually assert on, because
latency on a shared runner is too noisy to gate.

| Endpoint | p50 | p95 | p99 | body | vs 2026-09-29 |
|---|---|---|---|---|---|
| History (20) | 1 | 2 | 2 | **10.4 KB** | was ~1.4 MB before the list projection |
| Roster (500 students) | 3 | 6 | 6 | 313 KB | 5 -> 3 ms |
| Student detail (analyses) | 1 | 1 | 1 | 51.7 KB | was ~19 MB |
| Attendance (month window) | 4 | 6 | 8 | 321 KB | - |
| Attendance unfiltered | 4 | 6 | 7 | 321 KB | **811 -> 4 ms** |
| Schedule (bounded) | 0 | 0 | 1 | 0.0 KB | was unbounded `select *` |
| Overview | 9 | 13 | 13 | 0.1 KB | 9 -> 9 ms (unchanged) |
| Findings trends | 21 | 26 | 34 | 2.2 KB | 22 -> 21 ms |
| Student trends | 1 | 1 | 1 | 1.9 KB | - |
| POST attendance/batch (200) | 2 | 4 | 4 | 0.3 KB | 141 -> 2 ms |
| POST students/import (200) | 1 | 3 | 4 | 0.0 KB | was "not a hot path" |

Two harness lessons, both of which produced a **phantom regression** before being
caught, so they are recorded rather than quietly fixed:

- **`isLocalRedis()` returns `redis://localhost:6379` and ignores the port the
  container is actually on.** Pointing `UPSTASH_REDIS_REST_URL` at a local Redis
  published on 56380 therefore left ioredis retrying a dead port, and **every**
  Redis-touching request took a flat **5.01 s** - identical at 1 entry and at
  500, which is the tell. Set `UPSTASH_REDIS_IOREDIS_URL` as well. A latency
  number that does not move when you change N is not measuring your code.
- The first harness also read "present"/"absent" where the route validates
  `status`, so a 400 was being timed instead of the write.

Round-trip counts behind the table are in the `AGENTS.md` ledger entry on
one-round-trip-per-table: `persistFindings` 201 -> 1 at 200 rows,
`persistPlayerEvents` 201 -> 1, `compareStudents` 30 -> 1 at the route's cap of 10
ids, and the wellness export read 122 -> 1 for 120 students.

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
- ~~Import bulk rewrite: not a hot path; import region owned by parallel
  work.~~ **WRONG on both counts, and now done (2026-10-03).** `importStudents`
  did 1-2 sequential INSERTs per row inside one request, so a 500-row CSV held a
  transaction across ~1000 serial round trips. It is now one
  `insert ... select ... from jsonb_to_recordset` per 100 rows via
  `lib/batchRows.ts`: **1001 -> 11 round trips** at the 500-row cap, and
  end-to-end **~1 ms p50** for a 200-row import. Measured, not estimated. The
  per-row error isolation the route contract requires is preserved by falling
  back to the original row-at-a-time path when a batched statement raises, and
  deliberately NO transaction was added - an aborted transaction poisons every
  later statement, so the fallback could not run.
- Pool tuning (`max: 5`, statement_timeout): no pooler in this deploy; revisit
  with one.
- Unfiltered attendance cap: UI always filters; export path has own caps.
- Web bundle/Lighthouse: deps uninstallable in this worktree (blocked).
- Per-org monthly budget, spend alerts, queue aging: need prod traffic to
  tune; current controls are the daily quota, video-hash cache + dedup keys,
  and tier-weighted priority.
