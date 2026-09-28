// Drives the real `acceptInvite` with a stubbed store and membership write, so
// ordering, result checks, and caller-identity binding are all exercised
// without a database.
//
// Env knobs (see inviteAcceptance.test.ts for why the probe pattern is used):
// - INVITE_PROBE_MEMBER_OK: '0' always fails, '1' always succeeds, 'recover'
//   fails the first write and succeeds on the retry.
// - INVITE_PROBE_USER: 'match' (verified, email equals invite), 'mismatch'
//   (verified, different email), 'unverified' (email matches, not verified),
//   'missing' (no users row).
// - INVITE_PROBE_CALLER: the sub passed as the caller (default auth0|invitee).
// - INVITE_PROBE_STATE: 'valid' | 'consumed' | 'revoked' | 'expired'. Non-valid
//   states make the invite select return nothing, as the WHERE clause would.
// - INVITE_PROBE_CONCURRENT: '1' runs two accepts in parallel instead of sequence.

import { mock } from 'bun:test'

// '0' always fails, '1' always succeeds, 'recover' fails the first write and
// succeeds on the retry — the transient case, which is the one the ordering fix
// exists for.
const mode = process.env.INVITE_PROBE_MEMBER_OK ?? '1'
let memberCalls = 0
const membershipSucceeds = () => mode === '1' || (mode === 'recover' && memberCalls > 1)

const TOKEN = 'probe-token'
const TOKEN_HASH = 'probe-token-hash'
const ORG = 'auth0|org-owner'
const CALLER = process.env.INVITE_PROBE_CALLER ?? 'auth0|invitee'
const INVITE_EMAIL = 'invitee@example.com'

const userMode = process.env.INVITE_PROBE_USER ?? 'match'
const inviteState = process.env.INVITE_PROBE_STATE ?? 'valid'

const userRow = (() => {
  switch (userMode) {
    case 'mismatch':
      return { auth0_id: CALLER, email: 'someone-else@example.com', email_verified: true }
    case 'unverified':
      return { auth0_id: CALLER, email: INVITE_EMAIL, email_verified: false }
    case 'missing':
      return null
    default:
      return { auth0_id: CALLER, email: INVITE_EMAIL, email_verified: true }
  }
})()

/** One in-memory invite row, so "consume" is observable across two accepts. */
const inviteRow = {
  org_auth0_id: ORG,
  email: INVITE_EMAIL,
  role: 'coach',
  created_by: null,
  accepted_at: inviteState === 'consumed' ? new Date().toISOString() : (null as string | null),
}
let consumeCount = 0
let boundMemberAuth0Id: string | null | undefined

mock.module('../src/lib/users', () => ({
  resolveAuth0Id: async (sub: string) => sub,
  getUserByAuth0Id: async () => (userRow ? { ...userRow } : null),
}))

mock.module('../src/lib/orgMembers', () => ({
  inviteOrgMemberWithId: async (
    orgAuth0Id: string,
    _inviter: string,
    input: { email: string; memberAuth0Id: string | null },
  ) => {
    memberCalls += 1
    boundMemberAuth0Id = input.memberAuth0Id
    if (!membershipSucceeds()) return null
    return { id: 'member-1', org_auth0_id: orgAuth0Id, email: input.email }
  },
  inviteOrgMember: async () => null,
  getMemberRole: async () => null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

// `hashToken` is module-private, so the probe stubs the store instead and matches
// on the token the caller passes rather than on its hash.
mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const db = (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      // Bun's SQL resolves to the row array itself, not to an envelope, so the
      // stub must too — returning { rows } makes `rows?.[0]` undefined and the
      // handler bails as though the invite were absent.
      const selectInvite = /from org_invites/.test(sql) && /^select/i.test(sql.trim())
      if (selectInvite) {
        if (inviteState !== 'valid' || inviteRow.accepted_at !== null) return []
        return [{ ...inviteRow, token_hash: TOKEN_HASH }]
      }
      // The consuming update: conditional on accepted_at is null, like the real
      // query, so a concurrent loser matches nothing.
      if (inviteRow.accepted_at !== null) return []
      inviteRow.accepted_at = new Date().toISOString()
      consumeCount += 1
      return [{ token_hash: TOKEN_HASH }]
    }
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(() => []),
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { acceptInvite } = await import('../src/lib/invites')

let first: unknown
let second: unknown
if (process.env.INVITE_PROBE_CONCURRENT === '1') {
  ;[first, second] = await Promise.all([acceptInvite(TOKEN, CALLER), acceptInvite(TOKEN, CALLER)])
} else {
  first = await acceptInvite(TOKEN, CALLER)
  // Did the token survive the first attempt? Read the row the probe still owns.
  second = await (async () => {
    const saw = inviteRow.accepted_at === null
    const result = await acceptInvite(TOKEN, CALLER)
    return { result, saw }
  })()
  const wrapped = second as { result: unknown; saw: boolean }
  console.log(
    JSON.stringify({
      first,
      second: wrapped.result,
      memberCalls,
      secondSawToken: wrapped.saw,
      boundMemberAuth0Id,
      consumeCount,
    }),
  )
  process.exit(0)
}
// Did the token survive the first attempt? Read the row the probe still owns.
console.log(
  JSON.stringify({
    first,
    second,
    memberCalls,
    secondSawToken: false,
    boundMemberAuth0Id,
    consumeCount,
  }),
)
