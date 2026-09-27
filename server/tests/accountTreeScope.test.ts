import { describe, expect, test } from 'bun:test'

// `/api/auth/user/:auth0Id/*` is an org-scoped path, so `serviceGuard` admits any
// member of the org named in the path — membership, not authorization. Nothing
// in the tree then asked which *players* the caller may see, and the account id
// in this path is the org's own sub while analysis rows are owned by the org, so
// every read here was org-wide. A team coach's History page listed every player
// in the club, and the job-keyed routes handed over the detail, the clips, the
// chat transcript, and the rename / cancel / delete mutations for a player on
// another team.
//
// Each case spawns a probe process so its `mock.module` stubs stay out of the
// suite's shared module cache. The probe keeps the real `resolveCaller`, the
// real matrix and the real scope seam, and reports both the status and the
// data-layer entry points each handler reached — so a refusal can be shown to
// have happened before the row was read, the transcript appended to, the engine
// called, or the row deleted.

type Row = {
  role: string | null
  route: string
  job: string
  status: number
  /** The scope the list route asked the data layer for; null means org-wide. */
  askedScope: string[] | null | undefined
  touched: string[]
}

const run = async (roles: string[]): Promise<Row[]> => {
  const proc = Bun.spawn(['bun', 'run', 'tests/accountTreeScopeProbe.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ACCOUNT_SCOPE_ROLES: roles.join(',') },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  await proc.exited
  const last = out.trim().split('\n').at(-1) ?? ''
  if (!last.startsWith('{')) throw new Error(`probe produced no result: ${err}`)
  return (JSON.parse(last) as { rows: Row[] }).rows
}

const STUDENT_A = '00000000-0000-0000-0000-0000000000a1'
/** Team staff, narrowed to team A by the scope seam. */
const TEAM_STAFF = ['coach', 'head_coach', 'assistant_coach']
/** Org staff hold no team, so they are org-wide by design (ADR-0002). */
const ORG_WIDE = ['owner', 'analyst', 'medical']
/** Roles the matrix gives `finding.review`, the gate on writing a clip. */
const HOLDS_FINDING_REVIEW = ['owner', 'analyst', ...TEAM_STAFF]

const JOB_A = 'job-team-a'
const JOB_B = 'job-team-b'
const JOB_UNLINKED = 'job-unlinked'
const JOB_MISSING = 'job-does-not-exist'

/** Every job-keyed route, by operation: reads answer 404, writes answer 403. */
const READ_ROUTES = ['GET detail', 'GET clips', 'GET chat']
const WRITE_ROUTES = [
  'PATCH display_name',
  'POST cancel',
  'POST chat',
  'DELETE analysis',
  'POST clips',
]
/**
 * The one route in the set that also carries a capability gate of its own:
 * writing a clip needs `finding.review`, which `medical` does not hold. So a 403
 * there is the matrix answering, not the scope seam, and the two have to be kept
 * apart rather than asserted as one "not refused" bucket.
 */
const CAPABILITY_GATED = ['POST clips']

/** The data-layer call each route makes once it has cleared the scope gate. */
const ROW_TOUCH: Record<string, string> = {
  'GET detail': 'getUserAnalysisById',
  'GET clips': 'listClips',
  'GET chat': 'transcript.load',
  'PATCH display_name': 'updateAnalysisDisplayName',
  'POST cancel': 'getUserAnalysisById',
  'POST chat': 'transcript.append',
  'POST clips': 'countClips',
  'DELETE analysis': 'deleteAnalysis',
}

const find = (rows: Row[], route: string, job: string): Row => {
  const row = rows.find((r) => r.route === route && r.job === job)
  if (!row) throw new Error(`no row for ${route} ${job}`)
  return row
}

describe("another team's analysis is out of reach through the account tree", () => {
  test('a team coach is refused, and the refusal precedes every touch', async () => {
    for (const role of TEAM_STAFF) {
      const rows = await run([role])

      for (const route of READ_ROUTES) {
        const row = find(rows, route, JOB_B)
        // 404, not 403: a read must be indistinguishable from a job that does
        // not exist, or the status itself becomes an oracle.
        expect(row.status, `${role} ${route} ${JOB_B}`).toBe(404)
        // Only the scope lookup ran — the row, the clips, the transcript, the
        // engine and the audit trail were never reached.
        expect(row.touched, `${role} ${route} must not read`).toEqual(['getAnalysisStudentId'])
      }

      for (const route of WRITE_ROUTES) {
        const row = find(rows, route, JOB_B)
        expect(row.status, `${role} ${route} ${JOB_B}`).toBe(403)
        expect(row.touched, `${role} ${route} must not write`).toEqual(['getAnalysisStudentId'])
        expect(row.touched, `${role} ${route} must not delete`).not.toContain('deleteAnalysis')
        expect(row.touched, `${role} ${route} must not append`).not.toContain('transcript.append')
        expect(row.touched, `${role} ${route} must not audit`).not.toContain('auditRoute')
      }
    }
  })

  test('a read of a missing job is refused exactly like another team’s', async () => {
    for (const role of TEAM_STAFF) {
      const rows = await run([role])
      for (const route of READ_ROUTES) {
        const offTeam = find(rows, route, JOB_B)
        const missing = find(rows, route, JOB_MISSING)
        expect(missing.status, `${role} ${route}: off-team must match missing`).toBe(offTeam.status)
        expect(missing.touched, `${role} ${route}: off-team must match missing`).toEqual(
          offTeam.touched,
        )
      }
    }
  })

  test('a write distinguishes off-team from missing, which is the policy', async () => {
    // Reads must be indistinguishable so the status cannot be used as an
    // existence oracle. Writes deliberately do not: a scope refusal answers 403
    // beside the capability gate it follows, while a row that is simply not
    // there answers 404. Asserting the distinction here keeps a future change
    // from quietly re-adding the oracle to reads, and from quietly collapsing
    // the write rule while doing it.
    const rows = await run(['coach'])
    expect(find(rows, 'DELETE analysis', JOB_B).status).toBe(403)
    expect(find(rows, 'DELETE analysis', JOB_MISSING).status).toBe(404)
  })

  test('the list asks for the caller scope, not the whole org', async () => {
    for (const role of TEAM_STAFF) {
      const rows = await run([role])
      const list = find(rows, 'GET list', '-')
      expect(list.status, role).toBe(200)
      expect(list.askedScope, `${role} must narrow to their own students`).toEqual([STUDENT_A])
      const returned = list.touched.find((t) => t.startsWith('returned:')) ?? ''
      expect(returned, `${role} list`).toContain(JOB_A)
      expect(returned, `${role} list must hide the other team`).not.toContain(JOB_B)
    }
  })
})

describe('legitimate access is unchanged', () => {
  test('a team coach still reaches their own player and their own unfiled upload', async () => {
    for (const role of TEAM_STAFF) {
      const rows = await run([role])
      // An analysis with no student belongs to whoever uploaded it, so dropping
      // those would hide a coach's own unfiled uploads from their History page.
      for (const job of [JOB_A, JOB_UNLINKED]) {
        for (const route of READ_ROUTES) {
          expect(find(rows, route, job).status, `${role} ${route} ${job}`).toBe(200)
        }
      }
      expect(find(rows, 'PATCH display_name', JOB_A).status, role).toBe(200)
      expect(find(rows, 'DELETE analysis', JOB_A).status, role).toBe(200)
    }
  })

  test('org-wide callers are not narrowed at all', async () => {
    for (const role of ORG_WIDE) {
      const rows = await run([role])
      const list = find(rows, 'GET list', '-')
      // null means org-wide: no filter is added, so the query stays as cheap as
      // it was before scoping.
      expect(list.askedScope, `${role} must stay org-wide`).toBeNull()
      for (const route of [...READ_ROUTES, ...WRITE_ROUTES]) {
        if (CAPABILITY_GATED.includes(route) && !HOLDS_FINDING_REVIEW.includes(role)) continue
        const { status, touched } = find(rows, route, JOB_B)
        // What matters is that scope never refused them. The exact 2xx depends on
        // the stubbed data layer — cancelling an already-complete analysis is a
        // 400, and the stub's createClip declines — so assert the absence of a
        // refusal rather than a specific success code.
        expect(status, `${role} ${route} ${JOB_B} must not be refused`).not.toBe(403)
        expect(status, `${role} ${route} ${JOB_B} must not be refused`).not.toBe(404)
        // And that the handler went on to the row itself. An org-wide caller
        // skips the scope lookup entirely, so the seam's own call is absent here
        // by design; what must be present is the route's own data-layer call.
        expect(touched, `${role} ${route} must reach the row`).toContain(ROW_TOUCH[route])
      }
    }
  })

  test('medical is still refused a clip write, by the matrix and not by scope', async () => {
    // A 403 from a capability gate and a 403 from the scope seam look identical
    // to a client. Pin which one this is, so a future change to either the
    // matrix or the seam cannot quietly move the boundary.
    const rows = await run(['medical'])
    const row = find(rows, 'POST clips', JOB_B)
    expect(row.status).toBe(403)
    // The seam's lookup is absent: the capability gate answered first.
    expect(row.touched).not.toContain('getAnalysisStudentId')
  })
})
