// ── Share token store ────────────────────────────────────────────────────────
// Time-limited tokens that let coaches share an analysis with players via a
// public, unauthenticated GET /api/share/:token route. Tokens + metadata live
// in Redis under coachai:share:<token> with a matching TTL (72h default).
//
// The store is a factory (`createShareTokenStore`) so tests can inject an
// in-memory Redis-like client; the default export uses the real client.

import { randomBytes } from 'crypto'
import { redis } from './redis'

export type RedisLike = {
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

export function createShareTokenStore(client: RedisLike = redis): ShareTokenStore {
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
      const created_at = new Date().toISOString()
      const expires_at = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
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
