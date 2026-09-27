import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Org email-route guard probe ──────────────────────────────────────────────
// Drives POST /api/email/:auth0Id/{invite,report,attendance} for one caller role
// in a fresh process and prints what the handler actually did:
//
//   [{ role, status, attendanceOpts, sentTo, sentHtml, reportId, createdLinks }]
//
// The caller (emailRouteGuards.test.ts) spawns it per case so `mock.module`
// overrides never leak into the rest of the suite's module cache.
//
// Only the identity layer, the store, the data layer and the transport are
// stubbed. The real `resolveCaller`, the real permission matrix and the real
// scope seam run, so a 200 means the route's own checks agreed with the policy.

const ORG = 'auth0|org-owner'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a1'
const STUDENT_B = '00000000-0000-0000-0000-0000000000b1'
const REPORT_A = '00000000-0000-0000-0000-0000000000c1'
const REPORT_ORG = '00000000-0000-0000-0000-0000000000c2'
const TEAM_A = '00000000-0000-0000-0000-0000000000f1'

const roleTokens = (process.env.EMAIL_GUARD_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
const probeCase = process.env.EMAIL_GUARD_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('EMAIL_GUARD_ROLES must list at least one role')
  process.exit(1)
}

const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

let currentRole: OrgMemberRole | null = null
// Team staff belong to team A; org staff hold no team.
const teamsFor = (role: OrgMemberRole | null): string[] =>
  role === 'coach' || role === 'head_coach' || role === 'assistant_coach' ? [TEAM_A] : []

// ── Observations ─────────────────────────────────────────────────────────────
type Observation = {
  status: number
  /** Exactly what listAttendance was asked for, so the scope is visible. */
  attendanceOpts: Record<string, unknown> | null
  sentTo: string | null
  sentHtml: string | null
  reportId: string | null
  inviteAddresses: string[]
  studentLookupCount: number
}

let obs: Observation = {
  status: 0,
  attendanceOpts: null,
  sentTo: null,
  sentHtml: null,
  reportId: null,
  inviteAddresses: [],
  studentLookupCount: 0,
}

const reset = () => {
  obs = {
    status: 0,
    attendanceOpts: null,
    sentTo: null,
    sentHtml: null,
    reportId: null,
    inviteAddresses: [],
    studentLookupCount: 0,
  }
}

// ── Identity ─────────────────────────────────────────────────────────────────
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberIdFor(currentRole) ? currentRole : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_orgAuth0Id: string, teamId: string) => ({ id: teamId }),
  listMemberTeamIds: async () => teamsFor(currentRole),
  listTeams: async () => [],
  listTeamMembers: async () => [],
}))

// ── Store: answers the scope seam's one query ────────────────────────────────
// Player A is on team A, so a team-A coach resolves to exactly that student.
const storeDb = () => Promise.resolve([{ id: STUDENT_A }])
mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(storeDb),
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(storeDb),
  orDisabledDefault: (_value: unknown, fallback: unknown) => fallback,
}))

mock.module('../src/lib/audit', () => ({ auditRoute: () => undefined }))
mock.module('../src/lib/ratelimit', () => ({
  checkEmailLimit: async () => ({ allowed: true, remaining: 9 }),
  rateLimited: () => new Response('rate limited', { status: 429 }),
}))

// ── Transport: capture instead of sending ────────────────────────────────────
mock.module('../src/lib/mailer', () => ({
  emailConfigured: () => true,
  isDeliverableAddress: (v: unknown) => typeof v === 'string' && v.includes('@'),
  escapeHtml: (v: unknown) => String(v ?? ''),
  inviteEmail: () => ({ subject: 'invite', html: '<p>invite</p>', text: 'invite' }),
  reportEmail: (_t: string, _s: string, content: string) => ({
    subject: 'report',
    html: `<div>${content}</div>`,
    text: content,
  }),
  attendanceEmail: (_t: string, _p: string, rows: string) => ({
    subject: 'attendance',
    html: `<table>${rows}</table>`,
    text: 'attendance',
  }),
  sendEmail: async ({ to, html }: { to: string; html: string }) => {
    obs.sentTo = to
    obs.sentHtml = html
    return { id: 'stub' }
  },
}))

mock.module('../src/lib/users', () => ({
  getUserByAuth0Id: async () => ({
    name: 'Owner Coach',
    nickname: 'Owner',
    email: 'owner@example.com',
  }),
}))

// ── Data layer ───────────────────────────────────────────────────────────────
const student = (id: string, teamId: string | null) => ({
  id,
  full_name: id === STUDENT_A ? 'Player A' : 'Player B',
  email: `${id === STUDENT_A ? 'a' : 'b'}@example.com`,
  team_id: teamId,
  status: 'active',
})

mock.module('../src/lib/orgData', () => ({
  listStudents: async () => [student(STUDENT_A, TEAM_A), student(STUDENT_B, null)],
  getStudent: async (_orgAuth0Id: string, id: string) => {
    obs.studentLookupCount += 1
    return student(id, id === STUDENT_A ? TEAM_A : null)
  },
  getReport: async (_orgAuth0Id: string, id: string) => ({
    id,
    auth0_id: ORG,
    student_id: id === REPORT_ORG ? null : STUDENT_A,
    report_type: 'progress',
    title: id === REPORT_ORG ? 'Org rollup' : 'Player A report',
    content_json: {},
  }),
  listAttendance: async (_orgAuth0Id: string, opts: Record<string, unknown>) => {
    obs.attendanceOpts = opts
    // Honour the scope the route passed, the way the real query would.
    const ids = opts.studentIds as string[] | null | undefined
    const rows = [
      {
        student_id: STUDENT_A,
        full_name: 'Player A',
        status: 'present',
        session_date: '2026-09-20',
      },
      {
        student_id: STUDENT_B,
        full_name: 'Player B',
        status: 'absent',
        session_date: '2026-09-20',
      },
    ]
    return ids === null || ids === undefined ? rows : rows.filter((r) => ids.includes(r.student_id))
  },
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const orgPath = 'auth0%7Corg-owner'
const emailRoute = (await import('../src/routes/email')).default

type Case = { path: string; body: Record<string, unknown> }

const CASES: Record<string, Case> = {
  // No student_id: without a scope this returns every team's attendance.
  'attendance.org': {
    path: `/api/email/${orgPath}/attendance`,
    body: { from: '2026-01-01', to: '2026-12-31', recipient: 'sheet@example.com' },
  },
  'attendance.oneStudent': {
    path: `/api/email/${orgPath}/attendance`,
    body: { student_id: STUDENT_A, recipient: 'sheet@example.com' },
  },
  'attendance.otherStudent': {
    path: `/api/email/${orgPath}/attendance`,
    body: { student_id: STUDENT_B, recipient: 'sheet@example.com' },
  },
  'report.student': {
    path: `/api/email/${orgPath}/report`,
    body: { report_id: REPORT_A, to: 'someone@example.com' },
  },
  'report.orgLevel': {
    path: `/api/email/${orgPath}/report`,
    body: { report_id: REPORT_ORG, to: 'someone@example.com' },
  },
  'invite.any': {
    path: `/api/email/${orgPath}/invite`,
    body: { emails: ['new@example.com'], student_ids: [STUDENT_A] },
  },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const results: Array<{ role: OrgMemberRole | null } & Observation> = []
for (const role of roleTokens) {
  currentRole = role
  reset()
  const response = await emailRoute.handle(
    new Request(`http://localhost${probe.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': memberIdFor(role) },
      body: JSON.stringify(probe.body),
    }),
  )
  await response.json().catch(() => null)
  results.push({ role, ...obs, status: response.status })
}

console.log(JSON.stringify(results))
