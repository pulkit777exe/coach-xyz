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
  listMemberTeamIdsInOrg: async (_orgAuth0Id: string) => teamsFor(currentRole),
  setStudentTeam: async () => null,
  getTeamMembership: async () => null,
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
  await res.text()
  return { role, status: res.status, contextStudentIds: observed, enqueued }
}

const TEAM_STAFF: OrgMemberRole[] = ['coach', 'head_coach', 'assistant_coach']

// The read side. `job.auth0_id === auth0Id` only says the job belongs to this
// club, so before the fix a team coach could read another team's *finished* AI
// report — which carries that player's attendance, series and analyses. The
// generated report is the whole point of the request, so the scope check has to
// sit on the way out, not only on the way in.
const JOB_ID = 'report-job-1'
const read = async (
  role: OrgMemberRole | null,
  reportStudentId: string | null,
  jobStatus: 'done' | 'running' = 'done',
): Promise<{ status: number; reportsFetched: number }> => {
  currentRole = role
  let reportsFetched = 0
  const route = aiReportsRoute({
    getJob: (async () => ({
      report_job_id: JOB_ID,
      auth0_id: ORG,
      status: jobStatus,
      report_id: jobStatus === 'done' ? 'report-1' : null,
      error: null,
      progress: 100,
      created_at: 0,
      updated_at: 0,
    })) as never,
    getReportById: (async () => {
      reportsFetched += 1
      return {
        id: 'report-1',
        student_id: reportStudentId,
        full_name: 'Player',
        content_json: {},
      } as never
    }) as never,
  })
  const res = await route.handle(
    new Request(`http://localhost/api/org/${encodeURIComponent(ORG)}/reports/ai/${JOB_ID}`, {
      headers: { 'x-verified-auth0-id': `auth0|${role ?? 'outsider'}-member` },
    }),
  )
  await res.text()
  return { status: res.status, reportsFetched }
}

describe("reading another team's finished AI report is refused", () => {
  test('a team coach gets 404 for an off-team report, and an unfiled one too', async () => {
    for (const role of TEAM_STAFF) {
      const offTeam = await read(role, STUDENT_B)
      expect(offTeam.status, `role ${role}: off-team report`).toBe(404)
      // A report with no student summarizes the whole org, which is the same
      // thing POST /reports/ai refuses to generate for a team account.
      const orgWide = await read(role, null)
      expect(orgWide.status, `role ${role}: org-wide report`).toBe(404)
    }
  })

  test('a team coach still reads their own report', async () => {
    for (const role of TEAM_STAFF) {
      const own = await read(role, STUDENT_A)
      expect(own.status, `role ${role}`).toBe(200)
      expect(own.reportsFetched, `role ${role}`).toBe(1)
    }
  })

  test('an owner is org-wide and reads both', async () => {
    expect((await read('owner', STUDENT_B)).status).toBe(200)
    expect((await read('owner', null)).status).toBe(200)
  })

  test('a non-member is refused outright', async () => {
    // No role in the matrix that can reach this route lacks report.read, so the
    // capability check is defense in depth rather than a narrower gate — the
    // non-member is the one caller it is what actually refuses.
    expect((await read(null, STUDENT_A)).status).toBe(403)
  })

  test('org staff are org-wide, so they read any report in the club', async () => {
    // `medical` holds report.read and, like every org-staff role, is never
    // assigned a team, so ADR-0002's second tier leaves it org-wide. This is the
    // policy showing through, not a gap in the check.
    expect((await read('medical', STUDENT_B)).status).toBe(200)
    expect((await read('analyst', STUDENT_B)).status).toBe(200)
  })

  test('a player holds report.read but belongs to no team', async () => {
    // Reads of a linked report are 404 rather than 403: the target is a player
    // the caller may not see, and a read must not confirm that they exist.
    expect((await read('player', STUDENT_A)).status).toBe(404)
  })

  test('a report still in flight carries no player, so it is not refused', async () => {
    // Progress is the job's lifecycle only; the content is what the check above
    // guards, and there is no report row to read a student from yet.
    const inFlight = await read('coach', null, 'running')
    expect(inFlight.status).toBe(200)
  })
})

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

// The progress stream is NOT content-free, which the comment above it claimed.
// The `done` frame attached the whole ReportRecord — attendance, series,
// analyses, raw_report — so a team-A coach holding a team-B report_job_id read
// team B's finished report in the first frame, from the very route whose comment
// said it never could. The lifecycle stays visible on purpose (a scoped caller
// who started the job must be able to watch it); only the report is gated.
const streamDoneFrame = async (
  role: OrgMemberRole | null,
  reportStudentId: string | null,
): Promise<{ status: number; frame: Record<string, unknown> | null }> => {
  currentRole = role
  const doneJob = {
    report_job_id: JOB_ID,
    auth0_id: ORG,
    status: 'done',
    report_id: 'report-1',
    error: null,
    progress: 100,
    created_at: 0,
    updated_at: 0,
  }
  const route = aiReportsRoute({
    getJob: (async () => doneJob) as never,
    getReportById: (async () => ({
      id: 'report-1',
      student_id: reportStudentId,
      full_name: 'Player',
      content_json: { summary: 'SECRET attendance+series+analyses' },
    })) as never,
    // The stream pushes its own snapshot frame on open, so the test never has to
    // drive the listener; `getJob` above is the frame under test.
    subscribeJob: (() => () => undefined) as never,
    startBus: (async () => true) as never,
    onBusDisconnect: (() => () => undefined) as never,
  })
  const res = await route.handle(
    new Request(`http://localhost/api/org/${encodeURIComponent(ORG)}/reports/ai/${JOB_ID}/events`, {
      headers: { 'x-verified-auth0-id': `auth0|${role ?? 'outsider'}-member` },
    }),
  )
  if (res.status !== 200) return { status: res.status, frame: null }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  // The snapshot frame is pushed by the stream itself on open; read until we
  // have one `data:` payload.
  while (!text.includes('data:')) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  const line = text.split('\n').find((l) => l.startsWith('data: '))
  await reader.cancel().catch(() => undefined)
  return { status: res.status, frame: line ? JSON.parse(line.slice(6)) : null }
}

describe('the AI-report progress stream withholds a report the caller may not read', () => {
  test('a team coach watching an off-team job gets the lifecycle but no report', async () => {
    for (const role of TEAM_STAFF) {
      const { status, frame } = await streamDoneFrame(role, STUDENT_B)
      expect(status, `role ${role}`).toBe(200)
      // Lifecycle is intentionally visible: the job belongs to this club.
      expect(frame?.status, `role ${role}: lifecycle`).toBe('done')
      // The content is not.
      expect(frame?.report, `role ${role}: off-team report must be withheld`).toBeNull()
    }
  })

  test('an org-wide report is withheld from a team coach for the same reason', async () => {
    // A report with no student summarizes the whole club, which is exactly what
    // the scoped GET refuses and what POST /reports/ai refuses to generate.
    const { frame } = await streamDoneFrame('coach', null)
    expect(frame?.report).toBeNull()
  })

  test('a team coach still receives their own player report on the stream', async () => {
    for (const role of TEAM_STAFF) {
      const { frame } = await streamDoneFrame(role, STUDENT_A)
      expect((frame?.report as { student_id: string } | null)?.student_id, `role ${role}`).toBe(
        STUDENT_A,
      )
    }
  })

  test('an owner is org-wide and receives the report on the stream', async () => {
    const { frame } = await streamDoneFrame('owner', STUDENT_B)
    expect((frame?.report as { student_id: string } | null)?.student_id).toBe(STUDENT_B)
  })

  test('a player holds report.read but belongs to no team, so the report is withheld', async () => {
    const { frame } = await streamDoneFrame('player', STUDENT_A)
    expect(frame?.status).toBe('done')
    expect(frame?.report).toBeNull()
  })
})
