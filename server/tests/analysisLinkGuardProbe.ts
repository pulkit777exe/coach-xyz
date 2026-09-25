import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

const roleToken = process.env.ANALYSIS_LINK_TEST_ROLE
const role: OrgMemberRole | null =
  roleToken === '__non_member__' ? null : (roleToken as OrgMemberRole)
const studentToken = process.env.ANALYSIS_LINK_TEST_STUDENT_ID
const studentId = studentToken === '__null__' ? null : studentToken
let studentLookups = 0
let linkCalls = 0

mock.module('../src/lib/caller', () => ({
  resolveCaller: async () => ({
    verified: role ? `auth0|${role}` : 'auth0|outsider',
    role,
    teamIds: [],
    studentScope: { all: true, teamIds: [] },
    can: () => false,
    canAccessTeam: () => false,
  }),
}))

mock.module('../src/lib/orgData', () => ({
  createPerformanceMetric: async () => null,
  createStudent: async () => null,
  deleteStudent: async () => false,
  getStudent: async (_auth0Id: string, id: string) => {
    studentLookups += 1
    return { id }
  },
  getStudentAnalyses: async () => [],
  getStudentPerformanceSeries: async () => [],
  importStudents: async () => ({ imported: 0, failed: [], duplicates_skipped: 0 }),
  listStudentSports: async () => [],
  listStudents: async () => [],
  updateStudent: async () => null,
}))

mock.module('../src/lib/analyses', () => ({
  linkAnalysisToStudent: async (
    _auth0Id: string,
    jobId: string,
    linkedStudentId: string | null,
  ) => {
    linkCalls += 1
    return { server_job_id: jobId, student_id: linkedStudentId }
  },
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
}))

// Keep the app-level service guard out of this handler-level test. The mocked
// caller still supplies the verified member role, so the route's permission
// guard is the only authorization decision under test.
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { default: studentsRoute } = await import('../src/routes/org/students')
const response = await studentsRoute.handle(
  new Request('http://localhost/api/org/auth0%7Corg-1/analyses/job-1/student', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-verified-auth0-id': role ? `auth0|${role}` : 'auth0|outsider',
    },
    body: JSON.stringify({ student_id: studentId }),
  }),
)

console.log(
  JSON.stringify({
    status: response.status,
    body: await response.json(),
    studentLookups,
    linkCalls,
  }),
)
