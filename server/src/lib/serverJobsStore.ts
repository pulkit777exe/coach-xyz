// ── Durable job queue (Postgres) ─────────────────────────────────────────────
// Postgres carries all durable state in this app; Redis was only ever used
// because BullMQ expects it. A `server_jobs` table with `FOR UPDATE SKIP
// LOCKED` claims gives the same at-least-once semantics with fewer moving
// parts, transactional enqueue, and crash recovery for free.
//
// Kinds: 'analysis' (engine submissions) and 'ai_report' (engine report calls).
// Terminal rows are kept for auditability; completed rows are eligible for
// pruning by the retention sweep.

import { withHistoryStore } from './historyStore'

export type DurableJobKind = 'analysis' | 'ai_report'
export type DurableJobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface DurableJob<T = Record<string, unknown>> {
  kind: DurableJobKind
  key: string
  payload: T
  priority: number
  status: DurableJobStatus
  attempts: number
  max_attempts: number
  next_attempt_at: Date | string
  last_error: string | null
  started_at: Date | string | null
  finished_at: Date | string | null
}

export const DEFAULT_MAX_ATTEMPTS = 3
export const RETRY_BACKOFF_MS = 5_000
export const RETRY_BACKOFF_CAP_MS = 5 * 60_000

export const retryDelayMs = (attempts: number): number =>
  Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))

export interface EnqueueOptions {
  priority?: number
  maxAttempts?: number
}

/** Idempotent enqueue: re-enqueuing a (kind, key) that is not yet completed
 * resets it to queued rather than duplicating the work. */
export const enqueueDurableJob = async <T extends Record<string, unknown>>(
  kind: DurableJobKind,
  key: string,
  payload: T,
  opts: EnqueueOptions = {},
): Promise<void> => {
  const maxAttempts =
    opts.maxAttempts && opts.maxAttempts > 0 ? Math.floor(opts.maxAttempts) : DEFAULT_MAX_ATTEMPTS
  await withHistoryStore(async (db) => {
    await db`
      insert into server_jobs (kind, key, payload, priority, status, max_attempts, next_attempt_at, created_at, updated_at)
      values (${kind}, ${key}, ${JSON.stringify(payload)}::jsonb, ${opts.priority ?? 0},
              'queued', ${maxAttempts}, now(), now(), now())
      on conflict (kind, key) do update set
        payload = excluded.payload,
        priority = excluded.priority,
        max_attempts = excluded.max_attempts,
        status = case when server_jobs.status = 'completed' then server_jobs.status else 'queued' end,
        next_attempt_at = case when server_jobs.status = 'completed' then server_jobs.next_attempt_at else now() end,
        last_error = case when server_jobs.status = 'completed' then server_jobs.last_error else null end,
        updated_at = now();
    `
  })
}

/** Claim up to `limit` due jobs atomically. Jobs claimed stay `processing`
 * until a worker completes/fails/releases them. */
export const claimDueJobs = async <T = Record<string, unknown>>(
  kind: DurableJobKind,
  limit: number,
): Promise<DurableJob<T>[]> => {
  const claimed = await withHistoryStore(
    (db) =>
      db<DurableJob<T>[]>`
        update server_jobs set
          status = 'processing',
          attempts = attempts + 1,
          started_at = now(),
          updated_at = now()
        where (kind, key) in (
          select kind, key from server_jobs
          where kind = ${kind} and status = 'queued' and next_attempt_at <= now()
          order by priority desc, next_attempt_at asc
          limit ${Math.max(1, Math.floor(limit))}
          for update skip locked
        )
        returning kind, key, payload, priority, status, attempts, max_attempts,
                  next_attempt_at, last_error, started_at, finished_at;
      `,
  )
  return claimed ?? []
}

export const completeJob = async (
  kind: DurableJobKind,
  key: string,
): Promise<void> => {
  await withHistoryStore(async (db) => {
    await db`
      update server_jobs
      set status = 'completed', finished_at = now(), updated_at = now(), last_error = null
      where kind = ${kind} and key = ${key};
    `
  })
}

export interface JobFailure {
  message: string
  /** When true the job goes straight to failed; otherwise it sleeps and retries. */
  permanent?: boolean
}

/** Record a failure; returns the new status so the caller can mirror it.
 * Retry backoff is computed in SQL from the attempts counter (exponential,
 * capped at RETRY_BACKOFF_CAP_MS) — one statement, no read-modify-write. */
export const failJob = async (
  kind: DurableJobKind,
  key: string,
  failure: JobFailure,
): Promise<DurableJobStatus> => {
  const permanent = failure.permanent ?? false
  const rows = await withHistoryStore(
    (db) =>
      db<{ status: string }[]>`
        update server_jobs set
          status = case when ${permanent} or attempts >= max_attempts then 'failed' else 'queued' end,
          next_attempt_at = case when ${permanent} or attempts >= max_attempts then next_attempt_at
                                  else greatest(
                                    next_attempt_at,
                                    now() + (
                                      least(${RETRY_BACKOFF_CAP_MS}::bigint,
                                            ${RETRY_BACKOFF_MS}::bigint *
                                            power(2, greatest(attempts - 1, 0)))::bigint
                                      || ' milliseconds')::interval
                                  ) end,
          last_error = ${failure.message.slice(0, 2000)},
          updated_at = now()
        where kind = ${kind} and key = ${key}
        returning status;
      `,
  )
  return (rows?.[0]?.status ?? 'failed') as DurableJobStatus
}

/** Requeue jobs stuck in `processing` past the timeout (worker died mid-job). */
export const reclaimStuckJobs = async (
  kind: DurableJobKind,
  olderThanMs: number,
  limit = 50,
): Promise<DurableJob<Record<string, unknown>>[]> => {
  const rows = await withHistoryStore(
    (db) =>
      db<DurableJob<Record<string, unknown>>[]>`
        update server_jobs set
          status = 'queued',
          next_attempt_at = now(),
          last_error = coalesce(last_error, '') || '; requeued by stuck-job sweep',
          updated_at = now()
        where (kind, key) in (
          select kind, key from server_jobs
          where kind = ${kind} and status = 'processing'
            and started_at is not null
            and started_at < now() - (${Math.max(1, olderThanMs)} || ' milliseconds')::interval
          limit ${Math.max(1, Math.floor(limit))}
          for update skip locked
        )
        returning kind, key, payload, priority, status, attempts, max_attempts,
                  next_attempt_at, last_error, started_at, finished_at;
      `,
  )
  return rows ?? []
}

/** Fail jobs that exhausted attempts in `processing` (sweep target). */
export const failStuckJobs = async (
  kind: DurableJobKind,
  olderThanMs: number,
  limit = 50,
): Promise<DurableJob<Record<string, unknown>>[]> => {
  const rows = await withHistoryStore(
    (db) =>
      db<DurableJob<Record<string, unknown>>[]>`
        update server_jobs set
          status = 'failed',
          finished_at = now(),
          last_error = coalesce(last_error, '') || '; failed by stuck-job sweep',
          updated_at = now()
        where (kind, key) in (
          select kind, key from server_jobs
          where kind = ${kind} and status = 'processing'
            and started_at is not null
            and started_at < now() - (${Math.max(1, olderThanMs)} || ' milliseconds')::interval
            and attempts >= max_attempts
          limit ${Math.max(1, Math.floor(limit))}
          for update skip locked
        )
        returning kind, key, payload, priority, status, attempts, max_attempts,
                  next_attempt_at, last_error, started_at, finished_at;
      `,
  )
  return rows ?? []
}

export const queueCounts = async (
  kind: DurableJobKind,
): Promise<{ waiting: number; failed: number }> => {
  const rows = await withHistoryStore(
    (db) =>
      db<{ waiting: string | number; failed: string | number }[]>`
        select
          count(*) filter (where status = 'queued') as waiting,
          count(*) filter (where status = 'failed') as failed
        from server_jobs where kind = ${kind};
      `,
  )
  const row = rows?.[0]
  return {
    waiting: Number(row?.waiting ?? 0),
    failed: Number(row?.failed ?? 0),
  }
}

/** Terminal rows past retention are pruned by the daily sweep. */
export const pruneTerminalJobs = async (retentionMs: number): Promise<number> => {
  const rows = await withHistoryStore(
    (db) =>
      db<{ count: string | number }[]>`
        select count(*) as count from (
          delete from server_jobs
          where status in ('completed', 'failed')
            and finished_at is not null
            and finished_at < now() - (${Math.max(1, retentionMs)} || ' milliseconds')::interval
          returning 1
        ) t;
      `,
  )
  return Number(rows?.[0]?.count ?? 0)
}
