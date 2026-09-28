import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// The route imports a wide org data barrel and the shared caller resolver. Run
// the route probe in a fresh Bun process so module mocks cannot leak into the
// rest of the suite's shared module cache.
const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'analysisLinkGuardProbe.ts')
const JOB_ID = 'job-1'
const STUDENT_ID = '00000000-0000-0000-0000-000000000001'

const FORBIDDEN_BODY = {
  code: 'FORBIDDEN',
  message: 'Linking analyses to students requires player.manage',
  layer: 'server',
  retryable: false,
} as const

type ProbeResult = {
  status: number
  body: unknown
  linkCalls: number
  studentLookups: number
  jobScopeLookups: number
}

const runProbe = (
  role: OrgMemberRole | null,
  studentId: string | null = STUDENT_ID,
  opts: { scope?: 'org' | readonly string[]; jobStudentId?: string | null } = {},
): ProbeResult => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ANALYSIS_LINK_TEST_ROLE = role ?? '__non_member__'
  env.ANALYSIS_LINK_TEST_STUDENT_ID = studentId ?? '__null__'
  env.ANALYSIS_LINK_TEST_SCOPE =
    typeof opts.scope === 'string' ? opts.scope : (opts.scope ?? ['org']).join(',')
  env.ANALYSIS_LINK_TEST_JOB_STUDENT_ID =
    opts.jobStudentId === undefined || opts.jobStudentId === null ? '__null__' : opts.jobStudentId

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `probe failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult
}

const allowedRoles: readonly OrgMemberRole[] = ['owner', 'admin', 'head_coach', 'coach']
const deniedRoles: readonly OrgMemberRole[] = ['assistant_coach', 'analyst', 'medical', 'player']

// The route now redacts wellness signals for a caller without medical access,
// exactly as its account-tree twin in routes/auth.ts does. A head coach holds
// player.manage but is not medical, so the probe's response is redacted.
const REDACTED_SUMMARY = {
  form_score: 7,
  shot_events: [{ timestamp: 3, result: 'made' }],
}

const expectedAnalysis = {
  server_job_id: JOB_ID,
  student_id: STUDENT_ID,
  summary_json: REDACTED_SUMMARY,
}

const expectedUnlinkedAnalysis = {
  server_job_id: JOB_ID,
  student_id: null,
  summary_json: REDACTED_SUMMARY,
}

describe('PUT /api/org/:auth0Id/analyses/:jobId/student permission guard', () => {
  for (const role of allowedRoles) {
    test(`${role} may link an analysis to a student`, () => {
      const result = runProbe(role)
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ analysis: expectedAnalysis })
      expect(result.studentLookups).toBe(1)
      expect(result.linkCalls).toBe(1)
    })
  }

  for (const role of deniedRoles) {
    test(`${role} is denied with the player.manage FORBIDDEN body`, () => {
      const result = runProbe(role)
      expect(result.status).toBe(403)
      expect(result.body).toEqual(FORBIDDEN_BODY)
      expect(result.studentLookups).toBe(0)
      expect(result.linkCalls).toBe(0)
    })
  }

  test('a non-member caller is denied with the player.manage FORBIDDEN body', () => {
    const result = runProbe(null)
    expect(result.status).toBe(403)
    expect(result.body).toEqual(FORBIDDEN_BODY)
    expect(result.studentLookups).toBe(0)
    expect(result.linkCalls).toBe(0)
  })

  test('coach may unlink an analysis with student_id null', () => {
    const result = runProbe('coach', null)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ analysis: expectedUnlinkedAnalysis })
    expect(result.studentLookups).toBe(0)
    expect(result.linkCalls).toBe(1)
  })
})

// The capability check above is on the *target* student, so it is skipped
// entirely when the body omits student_id — the unlink case. linkAnalysisToStudent
// filters on server_job_id + auth0_id, i.e. org-scoped but not roster-scoped, so
// before the job-scoped seam a team-A coach could unlink team B's player from
// their own analysis by sending {}. The existing "coach may unlink" case only
// pinned the capability layer, and never asked whose analysis was unlinked.
describe('PUT /api/org/:auth0Id/analyses/:jobId/student job scope', () => {
  const OFF_TEAM = '00000000-0000-0000-0000-0000000000b2'
  // A scoped coach whose only visible student is STUDENT_ID (their own team).
  const scope = [STUDENT_ID]

  test("a scoped coach cannot unlink another team's player (body omits student_id)", () => {
    const result = runProbe('head_coach', null, { scope, jobStudentId: OFF_TEAM })
    // A write, so 403 beside the capability gate — not 404.
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'FORBIDDEN' })
    // The refusal happens before the store is touched.
    expect(result.linkCalls, 'must not reach linkAnalysisToStudent').toBe(0)
    expect(result.jobScopeLookups, 'must consult the job seam').toBe(1)
  })

  test('a scoped coach can still unlink their own player', () => {
    const result = runProbe('head_coach', null, { scope, jobStudentId: STUDENT_ID })
    expect(result.status).toBe(200)
    expect(result.linkCalls).toBe(1)
  })

  test('a scoped coach can still link their own analysis to their own player', () => {
    const result = runProbe('head_coach', STUDENT_ID, { scope, jobStudentId: STUDENT_ID })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ analysis: expectedAnalysis })
    expect(result.linkCalls).toBe(1)
  })

  test('an org-wide caller is unaffected and pays no job lookup', () => {
    // owners/admins/analyst/medical are org-wide per ADR-0002's second tier, so
    // accountJobScope short-circuits without resolving the analysis.
    const result = runProbe('owner', STUDENT_ID, { scope: 'org', jobStudentId: OFF_TEAM })
    expect(result.status).toBe(200)
    expect(result.jobScopeLookups).toBe(0)
  })

  test('an unfiled analysis stays linkable for a scoped coach', () => {
    // An analysis with no player belongs to whoever uploaded it, so there is no
    // student to scope by — the documented residual in ADR-0003.
    const result = runProbe('head_coach', STUDENT_ID, { scope, jobStudentId: null })
    expect(result.status).toBe(200)
    expect(result.linkCalls).toBe(1)
  })

  test('the response never carries injury_risk to a non-medical caller', () => {
    const result = runProbe('head_coach', STUDENT_ID, { scope, jobStudentId: STUDENT_ID })
    const summary = (
      result.body as {
        analysis: {
          summary_json: { form_score: number; shot_events: Array<Record<string, unknown>> }
        }
      }
    ).analysis.summary_json
    expect(summary.shot_events[0]).not.toHaveProperty('injury_risk')
    // The rest of the payload survives, so this is a redaction and not a drop.
    expect(summary.form_score).toBe(7)
  })
})
