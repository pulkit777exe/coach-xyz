// Drives the real `acceptInvite` with a stubbed membership write, so the ordering
// fix and the result check are both exercised without a database.
//
// `membershipSucceeds` is read from the environment rather than a module-level
// variable because this runs in its own Bun process — see inviteAcceptance.test.ts
// for why the probe pattern is used at all.

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
const CALLER = 'auth0|invitee'

/** One in-memory invite row, so "consume" is observable across two accepts. */
const inviteRow = {
  org_auth0_id: ORG,
  email: 'invitee@example.com',
  role: 'coach',
  created_by: null,
  accepted_at: null as string | null,
}

mock.module('../src/lib/orgMembers', () => ({
  inviteOrgMember: async (orgAuth0Id: string, _inviter: string, input: { email: string }) => {
    memberCalls += 1
    if (!membershipSucceeds()) return null
    return { id: 'member-1', org_auth0_id: orgAuth0Id, email: input.email }
  },
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
        return inviteRow.accepted_at === null ? [{ ...inviteRow, token_hash: TOKEN_HASH }] : []
      }
      // The consuming update.
      inviteRow.accepted_at = new Date().toISOString()
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

const first = await acceptInvite(TOKEN, CALLER)
// Did the token survive the first attempt? Read the row the probe still owns.
const secondSawToken = inviteRow.accepted_at === null
const second = await acceptInvite(TOKEN, CALLER)

console.log(
  JSON.stringify({
    first,
    second,
    memberCalls,
    secondSawToken,
  }),
)
