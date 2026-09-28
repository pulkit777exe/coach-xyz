import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

const roleToken = process.env.ANALYSIS_LINK_TEST_ROLE
const role: OrgMemberRole | null =
  roleToken === '__non_member__' ? null : (roleToken as OrgMemberRole)
const studentToken = process.env.ANALYSIS_LINK_TEST_STUDENT_ID
const studentId = studentToken === '__null__' ? null : studentToken

// The student the *analysis* is currently attached to, which is what the
// job-scoped seam reads. Distinct from the target student in the body: the
// cross-tenant unlink is a body with no student_id at all, so the target check
// is skipped and only the job's own attachment can catch it.
const jobStudentToken = process.env.ANALYSIS_LINK_TEST_JOB_STUDENT_ID
const jobStudentId = jobStudentToken === '__null__' ? null : jobStudentToken

// 'org' makes the caller org-wide; anything else is a comma-separated list of
// the students that caller may see.
const scopeToken = process.env.ANALYSIS_LINK_TEST_SCOPE ?? 'org'
const visibleStudentIds = scopeToken === 'org' ? null : scopeToken.split(',')

let studentLookups = 0
let linkCalls = 0
let jobScopeLookups = 0

const summaryJson = {
  form_score: 7,
  shot_events: [{ timestamp: 3, result: 'made', injury_risk: 'high' }],
}

mock.module('../src/lib/caller', () => ({
  resolveCaller: async () => ({
    verified: role ? `auth0|${role}` : 'auth0|outsider',
    role,
    teamIds: [],
    studentScope: { all: visibleStudentIds === null, teamIds: visibleStudentIds ?? [] },
    can: () => false,
    canAccessTeam: () => false,
  }),
}))

// The scope seam, with the real semantics but no store: a scoped caller asks it
// for its visible students, which would otherwise reach the disabled database
// and 500 before the assertion under test. `visibleStudentIds` returns null for
// an org-wide scope (nothing to narrow) and the configured list otherwise, and
// `canSeeStudent` is the actual membership rule.
mock.module('../src/lib/org/scope', () => ({
  visibleStudentIds: async () => visibleStudentIds,
  canSeeStudent: (ids: string[] | null, studentId: string) =>
    ids === null || ids.includes(studentId),
  uuidArrayLiteral: (ids: string[]) => `'{${ids.join(',')}}'`,
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
    return { server_job_id: jobId, student_id: linkedStudentId, summary_json: summaryJson }
  },
  // The job-scoped seam resolves the analysis's current attachment through this.
  getAnalysisStudentId: async () => {
    jobScopeLookups += 1
    return { found: true, studentId: jobStudentId }
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
    body: JSON.stringify(studentToken === '__absent__' ? {} : { student_id: studentId }),
  }),
)

// Read as text and parse defensively: a refusal path that returns a bare
// CoachAIError object (rather than buildError's envelope) has no content-type,
// and json() on an empty body throws and masks the real status.
const raw = await response.text()
let body: unknown = null
if (raw) {
  try {
    body = JSON.parse(raw)
  } catch {
    body = raw
  }
}

console.log(
  JSON.stringify({
    status: response.status,
    body,
    studentLookups,
    linkCalls,
    jobScopeLookups,
  }),
)
