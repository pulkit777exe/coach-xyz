import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Share-token scope probe ──────────────────────────────────────────────────
// A share token is unauthenticated: whoever holds the link reads that analysis
// with no login. So minting or revoking one is a write about the player on the
// video, not a read of it, and the question is "may you publish this" rather
// than "may you see this".
//
// The route gated the token on `analysis.auth0_id !== verifiedAuth0Id`. Analysis
// rows are owned by the *org*, so that comparison could only ever pass for the
// org owner: every coach, who is the one caller the feature exists for, was
// refused, and the same bug blocked every revoke. It now compares against the
// org named in the path and asks the scope seam about the player.
//
// Unlike the account-tree probes this one runs with the identity boundary ON,
// because share only resolves a caller when `serviceGuardEnabled()` — and the
// guard captures SERVICE_TOKEN at import, so a process cannot have it both ways.
// The caller (shareTokenScope.test.ts) spawns it per case so `mock.module`
// overrides stay out of the suite's shared module cache.

const SERVICE_TOKEN = 'probe-service-token'
process.env.SERVICE_TOKEN = SERVICE_TOKEN

const ORG = 'auth0|org-owner'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a1' // team A
const STUDENT_B = '00000000-0000-0000-0000-0000000000b1' // team B
const TEAM_A = '00000000-0000-0000-0000-0000000000f1'
const JOB_A = 'job-team-a'
const JOB_B = 'job-team-b'

const roleTokens = (process.env.SHARE_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
if (roleTokens.length === 0) {
  console.error('SHARE_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

let currentRole: OrgMemberRole | null = null
const teamsFor = (role: OrgMemberRole | null): string[] =>
  role === 'coach' || role === 'head_coach' || role === 'assistant_coach' ? [TEAM_A] : []
const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

let touched: string[] = []
const reset = () => {
  touched = []
}
const note = (what: string) => {
  touched.push(what)
}

mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_org: string, member: string) =>
    member === memberIdFor(currentRole) ? currentRole : null,
  // orgRoleGuard reads the member list rather than resolving one role, so the
  // stub has to answer both or the role floor refuses before the handler.
  listOrgMembers: async (_org: string) =>
    currentRole
      ? [
          {
            member_auth0_id: memberIdFor(currentRole),
            member_email: `${currentRole}@example.com`,
            role: currentRole,
            status: 'active',
          },
        ]
      : [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_org: string, id: string) => ({ id }),
  listMemberTeamIdsInOrg: async (_orgAuth0Id: string) => teamsFor(currentRole),
  setStudentTeam: async () => null,
  getTeamMembership: async () => null,
}))

const storeDb = () => Promise.resolve([{ id: STUDENT_A }])
mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(storeDb),
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(storeDb),
  orDisabledDefault: (v: unknown, f: unknown) => v ?? f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
}))

const jobStudent: Record<string, string> = { [JOB_A]: STUDENT_A, [JOB_B]: STUDENT_B }

const { orgShareRoute } = await import('../src/routes/share')

// Tokens are keyed by an arbitrary string; the seeded ones cover the three
// cases: the caller's own team, another team's video, and another org's video.
const tokens = new Map<string, { auth0_id: string; server_job_id: string }>([
  ['tok-own', { auth0_id: ORG, server_job_id: JOB_A }],
  ['tok-off-team', { auth0_id: ORG, server_job_id: JOB_B }],
  ['tok-foreign', { auth0_id: 'auth0|someone-else', server_job_id: JOB_A }],
  ['tok-orphan', { auth0_id: ORG, server_job_id: 'job-vanished' }],
])
let minted = 0
const store = {
  getShareToken: async (token: string) => tokens.get(token) ?? null,
  createShareToken: async (input: { auth0_id: string; server_job_id: string }) => {
    note('createShareToken')
    const token = `fresh-${++minted}`
    tokens.set(token, input)
    return { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() }
  },
  deleteShareToken: async (token: string) => {
    note('deleteShareToken')
    return tokens.delete(token)
  },
}

const route = orgShareRoute({
  store: store as never,
  getAnalysis: (async (job: string) =>
    job in jobStudent
      ? ({ server_job_id: job, auth0_id: ORG, student_id: jobStudent[job] } as never)
      : null) as never,
})

const headers = (role: OrgMemberRole | null) => ({
  'content-type': 'application/json',
  'x-service-token': SERVICE_TOKEN,
  'x-verified-auth0-id': memberIdFor(role),
})
const op = (suffix: string) => `/api/org/${encodeURIComponent(ORG)}${suffix}`

type Row = {
  role: OrgMemberRole | null
  route: string
  subject: string
  status: number
  touched: string[]
}
const rows: Row[] = []

const attempt = async (
  role: OrgMemberRole | null,
  label: string,
  subject: string,
  method: string,
  path: string,
) => {
  reset()
  const res = await route.handle(
    new Request(`http://localhost${op(path)}`, { method, headers: headers(role) }),
  )
  await res.text()
  rows.push({ role, route: label, subject, status: res.status, touched })
}

for (const role of roleTokens) {
  currentRole = role
  await attempt(role, 'mint own', JOB_A, 'POST', `/analyses/${JOB_A}/share-token`)
  await attempt(role, 'mint off-team', JOB_B, 'POST', `/analyses/${JOB_B}/share-token`)
  await attempt(role, 'revoke own', 'tok-own', 'DELETE', '/share-tokens/tok-own')
  await attempt(role, 'revoke off-team', 'tok-off-team', 'DELETE', '/share-tokens/tok-off-team')
  await attempt(role, 'revoke foreign', 'tok-foreign', 'DELETE', '/share-tokens/tok-foreign')
  await attempt(
    role,
    'revoke vanished analysis',
    'tok-orphan',
    'DELETE',
    '/share-tokens/tok-orphan',
  )
}

console.log(JSON.stringify({ roles: roleTokens, rows }))
// The share-token module constructs a Redis client at import; exit rather than
// wait for the handle to drain.
process.exit(0)
