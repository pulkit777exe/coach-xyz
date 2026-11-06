# Durable state and the Redis-free architecture

The server uses one durable dependency: **Postgres** (Neon / Supabase proxy, `DATABASE_URL`).
There is no Redis, BullMQ or Upstash in the application. Every previously Redis-backed
concern now lives in Postgres or in bounded in-memory state.

| Concern | Before | Now |
|---|---|---|
| Job registry (server_job_id → engine_job_id) | Redis, 2 h TTL | `analysis_history` (written at admission; the registry read is a thin view over it) |
| Analysis + AI report worker | BullMQ queues | `server_jobs` table, claimed with `FOR UPDATE SKIP LOCKED` by a bounded drain loop in `bootWorkers()` |
| Share tokens | Redis, 72 h TTL | Postgres `share_tokens` (pruned on write; filtered on read) |
| AI report job records | Redis, 2 h TTL | Postgres `ai_report_jobs` |
| Rate limiting | Redis `INCR` + in-memory fallback | Bounded in-memory limiter (per instance, 10k entries with eviction); multi-instance deployments should raise `*_RATE_LIMIT` or reintroduce a shared store behind the `RateLimitBackend` seam |
| Notifications fan-out | BullMQ QueueEvents → SSE | Direct `notifyAnalysisOutcome()` call from the worker + in-process EventEmitter for SSE |
| Stuck/crashed jobs | BullMQ stuck sweep | `reclaimStuckJobs` (requeue with attempts left) + `failStuckJobs` (mark exhausted jobs failed, engine + persist + notify) |
| Ephemeral queue stats | BullMQ counts | `queueCounts()` SQL over `server_jobs` |

## Notes for operators

- Queue drain: `bootWorkers()` starts a `ANALYSIS_POLL_MS` (default 1000 ms) timer that
  claims up to `ANALYSIS_DRAIN_BATCH` (default 4) due analysis jobs and
  `REPORT_DRAIN_BATCH` (default 2) due report jobs per tick, in priority order.
- Retry semantics: `attempts: 3`, exponential backoff from 5 s, capped at 5 minutes;
  `next_attempt_at` is computed in SQL from the attempts counter — no read-modify-write.
- Idempotent enqueue: `enqueueDurableJob` upserts by `(kind, key)`; completed rows are not
  resurrected. Terminal rows are kept for audit; the daily sweep prunes rows finished
  more than 30 days ago via `pruneTerminalJobs`.
- Crash recovery: a job claimed `processing` for more than 13 minutes is either requeued
  (attempts left) or failed permanently (attempts exhausted) with the engine job marked
  failed and the owning coach notified.
- `docker-compose.prod.yml`, `render.yaml`, CI workflows and `AGENTS.md` are
  Redis-free as of the same pass; `.env.prod.example` and the app `.env.example`
  files no longer document Upstash variables.
