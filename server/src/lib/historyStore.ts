// ── History store ────────────────────────────────────────────────────────────
// One lazily-initialized Postgres handle shared by every persistence module.
// The schema itself lives in ./dbSchema; this file only owns the connection,
// reconnect-once retry, and the two error postures callers choose between:
//
//   withHistoryStore         → null when disabled or a query fails
//   withHistoryStoreOrThrow  → throws, for callers that must not lose writes
//
// Both retry exactly once after a dropped connection ("Connection closed"),
// re-running the idempotent schema init before the second attempt.
import { SQL } from 'bun'
import { logEvent } from './log'
import { SCHEMA_LEVELS } from './dbSchema'

const databaseUrl = (process.env.DATABASE_URL ?? '').trim()

const sql = databaseUrl
  ? new SQL(databaseUrl, {
      idleTimeout: 300,
      max: 5,
    })
  : null

let initPromise: Promise<void> | null = null
let warnedDisabled = false

const isEnabled = (): boolean => sql !== null

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown database error'

const warnDisabled = (): void => {
  if (warnedDisabled) return
  warnedDisabled = true
  logEvent('warn', 'history_store_disabled', { message: 'DATABASE_URL not set' })
}

/** Retry once after the server closed an idle connection. */
const execute = async <T>(fn: (db: SQL) => Promise<T>): Promise<T> => {
  try {
    return await fn(sql!)
  } catch (error) {
    if (!messageOf(error).includes('Connection closed')) throw error

    logEvent('warn', 'history_store_reconnecting')
    initPromise = null
    try {
      return await fn(sql!)
    } catch (retryError) {
      logEvent('error', 'history_store_retry_failed', { error: messageOf(retryError) })
      throw retryError
    }
  }
}

export const withHistoryStore = async <T>(fn: (db: SQL) => Promise<T>): Promise<T | null> => {
  if (!sql) {
    warnDisabled()
    return null
  }

  try {
    return await execute(fn)
  } catch (error) {
    logEvent('error', 'history_store_operation_failed', { error: messageOf(error) })
    return null
  }
}

export const withHistoryStoreOrThrow = async <T>(fn: (db: SQL) => Promise<T>): Promise<T> => {
  if (!sql) {
    warnDisabled()
    throw new Error('History store is not configured (DATABASE_URL not set)')
  }

  try {
    return await execute(fn)
  } catch (error) {
    logEvent('error', 'history_store_operation_failed', { error: messageOf(error) })
    throw error
  }
}

export const ensureInitialized = async (): Promise<void> => {
  if (!sql) return

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await sql.connect()
        for (const level of SCHEMA_LEVELS) {
          await Promise.all(level.map((statement) => sql.unsafe(statement)))
        }
      } catch (error) {
        // Reset so the next call retries initialization.
        initPromise = null
        throw error
      }
    })()
  }

  await initPromise
}

export const initializeHistoryStore = async (): Promise<void> => {
  await withHistoryStore(async () => {
  })
}

export const historyStoreEnabled = isEnabled

export const shutdownHistoryStore = async (): Promise<void> => {
  if (sql) await sql.close()
}
