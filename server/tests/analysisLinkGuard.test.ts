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
}

const runProbe = (
  role: OrgMemberRole | null,
  studentId: string | null = STUDENT_ID,
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

const expectedAnalysis = {
  server_job_id: JOB_ID,
  student_id: STUDENT_ID,
}

const expectedUnlinkedAnalysis = {
  server_job_id: JOB_ID,
  student_id: null,
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
