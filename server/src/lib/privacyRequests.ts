// ── Privacy requests ─────────────────────────────────────────────────────────
// A recorded request ("give me my data" / "delete my account") and nothing
// more. Deleting an account cascades through analyses, reports, videos, chat
// and audit rows, so it is deliberately NOT a button: this module can only
// INSERT and SELECT. Anything that mutates a request's status belongs to the
// review flow, not to the requester, and lands in a separate module.

import { withHistoryStoreOrThrow } from './historyStore'

export const PRIVACY_REQUEST_TYPES = ['export', 'delete'] as const
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number]

export const PRIVACY_REQUEST_STATUSES = [
  'received',
  'in_progress',
  'completed',
  'declined',
] as const
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number]

export type PrivacyRequest = {
  id: string
  type: PrivacyRequestType
  status: PrivacyRequestStatus
  createdAt: string
  resolvedAt: string | null
}

type PrivacyRequestRow = {
  id: string
  request_type: string
  status: string
  created_at: string | Date
  resolved_at: string | Date | null
}

/** A list is a UI, not a data dump — cap it like every other paginated read. */
const MAX_LIST = 50

const toIsoString = (value: string | Date | null): string | null => {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

const toPrivacyRequest = (row: PrivacyRequestRow): PrivacyRequest => ({
  id: row.id,
  // The column CHECK constraint owns this vocabulary: a value outside
  // PRIVACY_REQUEST_TYPES is a schema bug, not a runtime case, so it is
  // narrowed here rather than papered over with a third value.
  type: row.request_type as PrivacyRequestType,
  // Status is a movement we may not have seen yet, so an unrecognized value
  // degrades to the "nothing has happened" end: not actioned.
  status: PRIVACY_REQUEST_STATUSES.includes(row.status as PrivacyRequestStatus)
    ? (row.status as PrivacyRequestStatus)
    : 'received',
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  resolvedAt: toIsoString(row.resolved_at),
})

/**
 * Record a request against the caller's own account. Purely additive: nothing
 * in this call touches the data the request is about.
 */
export const createPrivacyRequest = async (
  auth0Id: string,
  type: PrivacyRequestType,
): Promise<PrivacyRequest | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<PrivacyRequestRow[]>`
      insert into privacy_requests (auth0_id, request_type, status, created_at)
      values (${auth0Id}, ${type}, 'received', now())
      returning id, request_type, status, created_at, resolved_at;
    `
    return rows?.[0] ? toPrivacyRequest(rows[0]) : null
  })
}

/** One account's own requests, newest first. Never another account's. */
export const listPrivacyRequests = async (
  auth0Id: string,
  opts: { limit?: number } = {},
): Promise<PrivacyRequest[]> => {
  const limit = Math.min(Math.max(opts.limit ?? MAX_LIST, 1), MAX_LIST)
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<PrivacyRequestRow[]>`
      select id, request_type, status, created_at, resolved_at
      from privacy_requests
      where auth0_id = ${auth0Id}
      order by created_at desc
      limit ${limit};
    `
    return (rows ?? []).map(toPrivacyRequest)
  })
}

export type PrivacyRequestValidation =
  { ok: true; value: { type: PrivacyRequestType } } | { ok: false; message: string }

/** Strict manual validation matching the existing server route conventions. */
export const validatePrivacyRequestBody = (body: unknown): PrivacyRequestValidation => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Body must be a JSON object' }
  }

  const value = body as Record<string, unknown>
  const unknownField = Object.keys(value).find((key) => key !== 'type')
  if (unknownField) {
    return { ok: false, message: `Unknown field: ${unknownField}` }
  }
  if (!PRIVACY_REQUEST_TYPES.includes(value.type as PrivacyRequestType)) {
    return { ok: false, message: 'type must be one of export, delete' }
  }

  return { ok: true, value: { type: value.type as PrivacyRequestType } }
}
