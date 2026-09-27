// POST /api/org/:auth0Id/reports/ai is role-guarded where it is *mounted*
// (index.ts wraps it in an orgRoleGuard), which is a floor and not a scope. The
// route then fed `student_id` straight into buildReportContent — the unscoped
// aggregator — and embedded the result in `report_context`. So a team coach
// could have an AI report written about another team's player, carrying that
// player's attendance, series and analyses with it. The file-level audit missed
// it precisely because the mount-time guard made the file look covered.
//
// The route factory takes injected deps, so these are hermetic: no DB, no Redis,
// and nothing enqueued unless the assertions allow it.

import { describe, expect, mock, test } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

const ORG = 'auth0|org-owner'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a1'
const STUDENT_B = '00000000-0000-0000-0000-0000000000b1'
const TEAM_A = '00000000-0000-0000-0000-0000000000f1'

let currentRole: OrgMemberRole | null = null
let observed: (string | undefined)[] | null = null
let enqueued = 0

const teamsFor = (role: OrgMemberRole | null): string[] =>
  role === 'coach' || role === 'head_coach' || role === 'assistant_coach' ? [TEAM_A] : []

// Identity + the scope seam's one query, stubbed the way the other probes do.
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_org: string, member: string) =>
    member === (currentRole ? `auth0|${currentRole}-member` : 'auth0|outsider')
      ? currentRole
      : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_org: string, id: string) => ({ id }),
  listMemberTeamIds: async () => teamsFor(currentRole),
}))

// The scope seam's one query, answered by stubbing the store module. Swapping
// the *connection* instead does not work here: `runWithHistoryStore` awaits
// `ensureInitialized()` first, so a fake connection has to survive a full DDL
// replay. Player A is on team A — the only student a team-A coach may aggregate.
const storeDb = () => Promise.resolve([{ id: STUDENT_A }])
mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(storeDb),
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(storeDb),
  orDisabledDefault: (_v: unknown, f: unknown) => f,
  // Imported by the queue module this route pulls in transitively.
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
}))

mock.module('../src/lib/ratelimit', () => ({
  checkAiReportLimit: async () => ({ allowed: true }),
  rateLimited: () => new Response('rate limited', { status: 429 }),
  checkEmailLimit: async () => ({ allowed: true, remaining: 9 }),
}))

// Imported dynamically, after the mocks: a static import is evaluated before
// `mock.module` runs, so the route would bind the real orgMembers and the
// capability check would fail for every role.
//
// The app-level service guard is made inert here: Bun autoloads server/.env, so
// SERVICE_TOKEN would otherwise be set and the handler-level capability check
// would never be reached. The stubbed membership is the only decision under test.
process.env.SERVICE_TOKEN = ''
const { aiReportsRoute } = await import('../src/routes/aiReports')

type Attempt = {
  role: OrgMemberRole | null
  status: number
  /** Set only when the handler got as far as aggregating. */
  contextStudentIds: (string | undefined)[] | null
  enqueued: number
}

const attempt = async (
  role: OrgMemberRole | null,
  body: Record<string, unknown>,
): Promise<Attempt> => {
  currentRole = role
  observed = null
  enqueued = 0
  const route = aiReportsRoute({
    buildContext: (async (_org: string, opts: { student_id?: string }) => {
      observed = [opts.student_id]
      return {
        student: { full_name: 'Player A', sport: 'soccer' },
        attendance: [],
        series: [],
        analyses: [],
      }
    }) as never,
    enqueue: (async () => {
      enqueued += 1
      return 'job-1'
    }) as never,
  })
  const res = await route.handle(
    new Request(`http://localhost/api/org/${encodeURIComponent(ORG)}/reports/ai`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': `auth0|${role ?? 'outsider'}-member`,
      },
      body: JSON.stringify(body),
    }),
  )
  const parsed = await res.json().catch(() => null)
  return { role, status: res.status, contextStudentIds: observed, enqueued }
}

const TEAM_STAFF: OrgMemberRole[] = ['coach', 'head_coach', 'assistant_coach']

describe('generating an AI report for another team is refused', () => {
  test('a team coach cannot name a student off-team, and nothing is aggregated', async () => {
    for (const role of TEAM_STAFF) {
      const r = await attempt(role, { student_id: STUDENT_B, report_type: 'progress' })
      expect(r.status, `role ${role}`).toBe(403)
      // The refusal happens before buildReportContent, so no off-team data was
      // ever pulled into the report context.
      expect(r.contextStudentIds, `role ${role} must not aggregate`).toBeNull()
      expect(r.enqueued, `role ${role} must not enqueue`).toBe(0)
    }
  })

  test('a team coach can still generate one for their own student', async () => {
    for (const role of TEAM_STAFF) {
      const r = await attempt(role, { student_id: STUDENT_A, report_type: 'progress' })
      expect(r.status, `role ${role}`).toBe(201)
      expect(r.contextStudentIds).toEqual([STUDENT_A])
      expect(r.enqueued).toBe(1)
    }
  })

  test('a team coach cannot ask for an org-wide AI report', async () => {
    for (const role of TEAM_STAFF) {
      const r = await attempt(role, { report_type: 'progress' })
      expect(r.status, `role ${role}`).toBe(403)
      expect(r.contextStudentIds, `role ${role} must not aggregate`).toBeNull()
      expect(r.enqueued).toBe(0)
    }
  })

  test('an owner is org-wide and may generate for any student, or none', async () => {
    const forStudent = await attempt('owner', { student_id: STUDENT_B, report_type: 'progress' })
    expect(forStudent.status).toBe(201)
    expect(forStudent.enqueued).toBe(1)

    const orgWide = await attempt('owner', { report_type: 'progress' })
    expect(orgWide.status).toBe(201)
    expect(orgWide.enqueued).toBe(1)
  })
})

describe('the capability check is a second layer, not the role floor', () => {
  test('medical is refused: they hold no report.create', async () => {
    const r = await attempt('medical', { student_id: STUDENT_A, report_type: 'progress' })
    expect(r.status).toBe(403)
    expect(r.enqueued).toBe(0)
  })

  test('a non-member is refused', async () => {
    const r = await attempt(null, { student_id: STUDENT_A, report_type: 'progress' })
    expect(r.status).toBe(403)
    expect(r.enqueued).toBe(0)
  })

  test('an analyst passes report.create here; the mount-time list is what excludes them', async () => {
    // index.ts mounts this route behind orgRoleGuard([owner, admin,
    // head_coach, assistant_coach, coach]), so an analyst never reaches the
    // handler in the real app — excluding them from AI report generation is a
    // pre-existing product decision, not something the capability check should
    // quietly change. These tests build the route through the factory, without
    // that mount, which is why the distinction is visible.
    const r = await attempt('analyst', { student_id: STUDENT_A, report_type: 'progress' })
    expect(r.status).toBe(201)
  })
})
