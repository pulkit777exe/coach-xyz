// ── Share token store ────────────────────────────────────────────────────────
// Time-limited tokens that let coaches share an analysis with players via a
// public, unauthenticated GET /api/share/:token route. Tokens live in Postgres
// (`share_tokens`), not Redis — the app already requires the history store,
// and a durable row survives restarts with no eviction surprises.
//
// The store is a factory (`createShareTokenStore`) so tests can inject an
// in-memory Redis-like client; the default client is Postgres-backed.

import { randomBytes } from 'crypto'

import { withHistoryStore } from './historyStore'

export type KeyValueLike = {
  get(key: string): Promise<unknown>
  set(
    key: string,
    value: string | number | Record<string, unknown>,
    opts?: { ex?: number },
  ): Promise<void>
  del(key: string): Promise<number>
}

export type ShareTokenRecord = {
  auth0_id: string
  server_job_id: string
  created_at: string
  expires_at: string
}

export type ShareTokenIssue = ShareTokenRecord & { token: string }

export type ShareTokenStore = {
  createShareToken(input: {
    auth0_id: string
    server_job_id: string
    expiresInHours?: number
  }): Promise<ShareTokenIssue>
  /** Raw read — returns the record even if it has expired (for 410 vs 404). */
  getShareToken(token: string): Promise<ShareTokenRecord | null>
  /** Honours expiry — expired tokens resolve to null. */
  resolveShareToken(token: string): Promise<ShareTokenRecord | null>
  /** Revoke (delete) a token by its value — used by the revocation endpoint. */
  deleteShareToken(token: string): Promise<void>
}

const KEY_PREFIX = 'coachai:share:'
export const DEFAULT_EXPIRES_HOURS = 72

export function generateShareToken(): string {
  return randomBytes(24).toString('hex')
}

type ShareRow = {
  token: string
  auth0_id: string
  server_job_id: string
  created_at: Date | string
  expires_at: Date | string
}

const stripPrefix = (key: string): string =>
  key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key

const rowToRecord = (row: ShareRow): ShareTokenRecord => ({
  auth0_id: row.auth0_id,
  server_job_id: row.server_job_id,
  created_at: new Date(row.created_at).toISOString(),
  expires_at: new Date(row.expires_at).toISOString(),
})

const recordFromValue = (raw: unknown): ShareTokenRecord | null => {
  const obj =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw)
          } catch {
            return null
          }
        })()
      : raw
  if (!obj || typeof obj !== 'object') return null
  const record = obj as Record<string, unknown>
  if (typeof record.auth0_id !== 'string' || typeof record.server_job_id !== 'string') {
    return null
  }
  return {
    auth0_id: record.auth0_id,
    server_job_id: record.server_job_id,
    created_at:
      typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    expires_at:
      typeof record.expires_at === 'string' ? record.expires_at : new Date().toISOString(),
  }
}

/** Postgres-backed client with the same shape the store factory expects. */
const pgShareClient: KeyValueLike = {
  async get(key) {
    const token = stripPrefix(key)
    const rows = await withHistoryStore(
      (db) =>
        db<ShareRow[]>`
          select token, auth0_id, server_job_id, created_at, expires_at
          from share_tokens where token = ${token} limit 1;
        `,
    )
    return rows?.[0] ? rowToRecord(rows[0]) : null
  },
  async set(key, value) {
    const token = stripPrefix(key)
    const record = recordFromValue(value)
    if (!record) return
    const createdMs = Date.parse(record.created_at)
    const expiresMs = Date.parse(record.expires_at)
    await withHistoryStore(async (db) => {
      // Expired rows are dead weight; prune them on every write.
      await db`delete from share_tokens where expires_at <= now();`
      await db`
        insert into share_tokens (token, auth0_id, server_job_id, created_at, expires_at)
        values (
          ${token}, ${record.auth0_id}, ${record.server_job_id},
          ${Number.isFinite(createdMs) ? new Date(createdMs) : new Date()}::timestamptz,
          ${Number.isFinite(expiresMs) ? new Date(expiresMs) : new Date(Date.now() + 72 * 3600e3)}::timestamptz
        )
        on conflict (token) do update set
          auth0_id = excluded.auth0_id,
          server_job_id = excluded.server_job_id,
          expires_at = excluded.expires_at;
      `
    })
  },
  async del(key) {
    const token = stripPrefix(key)
    const rows = await withHistoryStore(
      (db) => db<{ token: string }[]>`delete from share_tokens where token = ${token} returning token;`,
    )
    return rows?.length ?? 0
  },
}

export function createShareTokenStore(client: KeyValueLike = pgShareClient): ShareTokenStore {
  const keyFor = (token: string) => `${KEY_PREFIX}${token}`

  const asRecord = (raw: unknown): ShareTokenRecord | null => {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.auth0_id === 'string' && typeof obj.server_job_id === 'string') {
        return {
          auth0_id: obj.auth0_id,
          server_job_id: obj.server_job_id,
          created_at:
            typeof obj.created_at === 'string' ? obj.created_at : new Date().toISOString(),
          expires_at:
            typeof obj.expires_at === 'string' ? obj.expires_at : new Date().toISOString(),
        }
      }
    }
    return null
  }

  return {
    async createShareToken({ auth0_id, server_job_id, expiresInHours = DEFAULT_EXPIRES_HOURS }) {
      const token = generateShareToken()
      const now = Date.now()
      const created_at = new Date(now).toISOString()
      const expires_at = new Date(now + expiresInHours * 60 * 60 * 1000).toISOString()
      const record: ShareTokenRecord = {
        auth0_id,
        server_job_id,
        created_at,
        expires_at,
      }
      await client.set(keyFor(token), record, { ex: expiresInHours * 60 * 60 })
      return { ...record, token }
    },

    async getShareToken(token) {
      if (!token) return null
      return asRecord(await client.get(keyFor(token)))
    },

    async resolveShareToken(token) {
      const record = await this.getShareToken(token)
      if (!record) return null
      if (Date.parse(record.expires_at) <= Date.now()) return null
      return record
    },

    async deleteShareToken(token) {
      await client.del(keyFor(token))
    },
  }
}

export default createShareTokenStore()
