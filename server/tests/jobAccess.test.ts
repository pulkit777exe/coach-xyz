import { afterEach, describe, expect, test } from 'bun:test'

import { mintAttributionToken } from '../src/lib/attribution'
import { resolveJobCaller, verifyJobAccess } from '../src/lib/jobAccess'

const SECRET = 'test-service-token'
const OWNER = 'auth0|owner-1'
const PLAYER = 'auth0|player-2'
const STRANGER = 'auth0|stranger-3'

function setToken(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

afterEach(() => {
  setToken(undefined)
})

const ownedJob = (ownerIds: string[]) => ({
  server_job_id: 'srv-1',
  engine_job_id: 'eng-1',
  session_token: null,
  player_index: null,
  model: 'gemini-2.5-flash',
  created_at: Date.now(),
  owner_ids: ownerIds,
})

function requestWith(token: string | null): Request {
  return new Request('http://localhost/api/job-status/srv-1', {
    headers: token ? { 'x-attribution': token } : {},
  })
}

describe('verifyJobAccess', () => {
  test('anonymous job (no owners) is readable without identity', () => {
    setToken(SECRET)
    expect(verifyJobAccess(requestWith(null), ownedJob([])).ok).toBe(true)
    expect(verifyJobAccess(requestWith(null), null, null).ok).toBe(true)
  })

  test('owned job without identity → 403', () => {
    setToken(SECRET)
    const outcome = verifyJobAccess(requestWith(null), ownedJob([OWNER]))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(403)
    expect(outcome.body.code).toBe('FORBIDDEN')
  })

  test("owned job with the owner's attribution token → ok", () => {
    setToken(SECRET)
    const minted = mintAttributionToken(OWNER, SECRET)!
    const outcome = verifyJobAccess(requestWith(minted.token), ownedJob([OWNER]))
    expect(outcome).toEqual({ ok: true, callerSub: OWNER })
  })

  test("owned job with another sub's token → 403", () => {
    setToken(SECRET)
    const minted = mintAttributionToken(STRANGER, SECRET)!
    const outcome = verifyJobAccess(requestWith(minted.token), ownedJob([OWNER]))
    expect(outcome.ok).toBe(false)
  })

  test('dual-principal job (coach + requesting player) admits both', () => {
    setToken(SECRET)
    const job = ownedJob([OWNER, PLAYER])
    const coachToken = mintAttributionToken(OWNER, SECRET)!
    const playerToken = mintAttributionToken(PLAYER, SECRET)!
    expect(verifyJobAccess(requestWith(coachToken.token), job)).toEqual({
      ok: true,
      callerSub: OWNER,
    })
    expect(verifyJobAccess(requestWith(playerToken.token), job)).toEqual({
      ok: true,
      callerSub: PLAYER,
    })
  })

  test('persisted fallback owners authorize after Redis expiry', () => {
    setToken(SECRET)
    const minted = mintAttributionToken(OWNER, SECRET)!
    const outcome = verifyJobAccess(requestWith(minted.token), null, {
      auth0_id: OWNER,
      requested_by: PLAYER,
    })
    expect(outcome.ok).toBe(true)
  })

  test('persisted row owned by someone else → 403', () => {
    setToken(SECRET)
    const minted = mintAttributionToken(STRANGER, SECRET)!
    const outcome = verifyJobAccess(requestWith(minted.token), null, {
      auth0_id: OWNER,
      requested_by: PLAYER,
    })
    expect(outcome.ok).toBe(false)
  })
})

describe('resolveJobCaller', () => {
  test('returns null with no identity headers', () => {
    setToken(SECRET)
    expect(resolveJobCaller(requestWith(null))).toBeNull()
  })

  test('prefers the signed attribution sub', () => {
    setToken(SECRET)
    const minted = mintAttributionToken(OWNER, SECRET)!
    expect(resolveJobCaller(requestWith(minted.token))).toBe(OWNER)
  })

  test('accepts the token as an ?attribution= query param (headerless download)', () => {
    setToken(SECRET)
    const minted = mintAttributionToken(OWNER, SECRET)!
    const req = new Request(
      `http://localhost/api/download/srv-1?attribution=${encodeURIComponent(minted.token)}`,
    )
    expect(resolveJobCaller(req)).toBe(OWNER)
    expect(verifyJobAccess(req, ownedJob([OWNER])).ok).toBe(true)
  })
})
