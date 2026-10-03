// PATCH /api/auth/user/:auth0Id/analyses/:jobId — the §5 medical boundary probe.
//
// One process, every role in a row, printing `{ cases }` as the last stdout line.
// `analysisRenameMedical.test.ts` spawns it so the `mock.module` stubs stay out of
// the suite's shared module cache (a leaked mock is one-way in Bun, and which file
// lands first is filesystem readdir order — see tests/spawnProbe.ts).
//
// WHY THIS EXISTS: a RENAME is a write, and its response is a full row. The GET
// of the same resource redacted wellness; the PATCH did not, on either branch.
// One of those branches performs no write at all — `PATCH {}` answers with the
// whole row — so the leak did not even require the capability to rename.
//
// What runs REAL: the route handler, `permissions.resolveMedicalAccess`,
// `redactWellness`, and `accountJobScope`. What is stubbed: the store (it answers
// the FULL `ANALYSES_SELECT_COLUMNS` shape, including the `returning *` row that
// `updateAnalysisDisplayName` hands back), the membership lookup the medical
// decision is made from, and `lib/redis` (which connects on import through some
// route graphs).
//
// The fixture deliberately carries the WHOLE blob rather than today's list
// projection. The projection narrows what a list ships, which would make the leak
// unobservable — and it is a perf decision that can be revisited. The route's own
// check is what has to hold either way, so the fixture is written to the shape
// that leaks.

import { mock } from 'bun:test'

const ORG = 'auth0|org-1'
const JOB_ID = '00000000-0000-4000-8000-0000000000d1'
const STUDENT_ID = '00000000-0000-4000-8000-0000000000b1'
const TEAM_ID = '00000000-0000-4000-8000-0000000000a1'
// Team staff are narrowed to their own teams; org staff are org-wide. A coach
// with an EMPTY scope would be refused by accountJobScope before the medical
// check is ever reached, which would make every assertion here vacuous.
const TEAM_ROLES = ['coach', 'head_coach']

// `injury_risk` is the wellness signal §5 puts behind the medical role;
// `biomechanics` and `weighted_scoring` are the payload that rides with it. A
// redaction must drop the first while leaving the other two alone — a test that
// only asserted "no injury_risk" would also pass on a response that dropped the
// row's entire summary, which is a different bug.
const summaryJson = {
  form_score: 7,
  shot_events: [
    {
      timestamp: 3,
      result: 'made',
      injury_risk: 'high',
      biomechanics: { elbow: 172 },
      weighted_scoring: { value: 0.8 },
    },
  ],
  top_tips: ['keep the elbow down'],
}

const row = {
  server_job_id: JOB_ID,
  auth0_id: ORG,
  student_id: STUDENT_ID,
  model: 'gemini',
  complete: true,
  display_name: 'Dunk',
  file_name: 'clip.mp4',
  requested_at: '2026-03-01T00:00:00.000Z',
  summary_json: summaryJson,
}

type Role = string | null
const roles = (process.env.RENAME_MEDICAL_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as Role)))
if (roles.length === 0) {
  console.error('RENAME_MEDICAL_ROLES must list at least one role')
  process.exit(1)
}

const memberIdFor = (role: Role): string => (role ? `auth0|${role}-member` : 'auth0|outsider')

let currentRole: Role = null
let renames = 0

// The `returning *` shape: the rename path gets a whole row back from the UPDATE,
// which is the branch that leaked without any read being involved.
mock.module('../src/lib/analyses', () => ({
  getUserAnalysisById: async (_orgAuth0Id: string, jobId: string) =>
    jobId === JOB_ID ? { ...row } : null,
  updateAnalysisDisplayName: async (_orgAuth0Id: string, jobId: string, displayName: string) => {
    if (jobId !== JOB_ID) return null
    renames += 1
    return { ...row, display_name: displayName }
  },
  getUserAnalyses: async () => [],
  getUserStats: async () => ({}),
  // The discriminating shape, NOT a bare id: `accountJobScope` reads
  // `{ found, studentId }`, because a row whose student_id is genuinely NULL is a
  // real answer and must not collapse into "not found".
  getAnalysisStudentId: async (_orgAuth0Id: string, jobId: string) =>
    jobId === JOB_ID ? { found: true, studentId: STUDENT_ID } : { found: false, studentId: null },
  getAnalysisOwner: async () => ({ auth0_id: ORG, student_id: STUDENT_ID }),
  getAnalysisByServerJobId: async () => null,
  linkAnalysisToStudent: async () => null,
  deleteAnalysis: async () => true,
  markAnalysisDownloaded: async () => null,
  persistAnalysisStatus: async () => null,
}))

// A partial mock.module fails the WHOLE probe process with "Export named 'X'
// not found" the moment anything in the graph imports a name the factory omits —
// it is not a lazily-failing call. So every export the auth route graph reaches
// for has to be here even when this probe never calls it.
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberIdFor(currentRole) ? currentRole : null,
  getOrgMember: async () => null,
  listOrgMembers: async () => [],
  listMembershipsForUser: async () => [],
  ensureOrgOwner: async () => {},
  inviteOrgMember: async () => null,
  inviteOrgMemberWithId: async () => null,
  setOrgMemberRole: async () => null,
  removeOrgMember: async () => false,
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async () => ({ id: TEAM_ID }),
  listMemberTeamIdsInOrg: async () => (TEAM_ROLES.includes(currentRole!) ? [TEAM_ID] : []),
  setStudentTeam: async () => null,
  getTeamMembership: async () => null,
  listTeams: async () => [],
  listTeamMembers: async () => [],
  createTeam: async () => null,
  renameTeam: async () => null,
  deleteTeam: async () => true,
  addTeamMember: async () => null,
  removeTeamMember: async () => true,
}))

// The scope seam, with the real rule and no store — the same shape
// studentAnalysesMedicalProbe uses. Without a non-empty team for team staff,
// accountJobScope refuses before the medical check runs and every assertion here
// would pass against an error body.
mock.module('../src/lib/org/scope', () => ({
  visibleStudentIds: async (_orgAuth0Id: string, scope: { all: boolean; teamIds: string[] }) =>
    scope.all ? null : scope.teamIds.map(() => STUDENT_ID),
  canSeeStudent: (ids: string[] | null, studentId: string) =>
    ids === null || ids.includes(studentId),
  canAccessTeam: () => true,
  uuidArrayLiteral: (ids: string[]) => `'{${ids.join(',')}}'`,
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
  audit: () => undefined,
  listAuditLogs: async () => [],
}))

// lib/redis connects on import through some route graphs; keep it inert.
mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const authRoute = (await import('../src/routes/auth')).default
const orgPath = encodeURIComponent(ORG)

type Case = { label: string; body: Record<string, unknown> }
const CASES: Record<string, Case> = {
  // The branch that performs a write and returns `returning *`.
  rename: { label: 'rename', body: { display_name: 'Renamed' } },
  // The branch that performs NO write at all and still answers with the row.
  empty: { label: 'empty', body: {} },
}

const probeCase = process.env.RENAME_MEDICAL_CASE ?? ''
const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const results: Array<{
  role: Role
  status: number
  renames: number
  hasInjuryRisk: boolean
  eventKeys: string[]
  summaryKeys: string[]
  displayName: string | null
}> = []

for (const role of roles) {
  currentRole = role
  renames = 0

  const response = await authRoute.handle(
    new Request(`http://localhost/api/auth/user/${orgPath}/analyses/${JOB_ID}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': memberIdFor(role),
      },
      body: JSON.stringify(probe.body),
    }),
  )
  const body = (await response.json().catch(() => null)) as {
    analysis?: { summary_json?: unknown; display_name?: string | null }
  } | null
  const analysis = body?.analysis
  const summary = (analysis?.summary_json ?? null) as {
    shot_events?: Array<Record<string, unknown>>
    [k: string]: unknown
  } | null
  const events = Array.isArray(summary?.shot_events) ? summary!.shot_events! : []

  results.push({
    role,
    status: response.status,
    renames,
    hasInjuryRisk: events.some((e) => 'injury_risk' in e),
    eventKeys: [...new Set(events.flatMap((e) => Object.keys(e)))].sort(),
    summaryKeys: summary ? Object.keys(summary).sort() : [],
    displayName: analysis?.display_name ?? null,
  })
}

console.log(JSON.stringify({ cases: results }))
