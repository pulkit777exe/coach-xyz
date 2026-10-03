// GET /api/org/:auth0Id/students/:id/analyses — the §5 medical boundary probe.
//
// One process, every role in a row, printing `{ cases }` as the last stdout line.
// `studentAnalysesMedical.test.ts` spawns it so the `mock.module` stubs stay out of
// the suite's shared module cache (a leaked mock is one-way in Bun, and which file
// lands first is filesystem readdir order — see tests/spawnProbe.ts).
//
// What runs REAL: the route handler, `permissions.resolveMedicalAccess`,
// `redactWellness`, and the scope seam's own rule. What is stubbed: the SQL
// connection (the store answers one row carrying the FULL summary blob, which is
// the thing the route must not hand over), the membership lookup the medical
// decision is made from, and `lib/redis` (which connects on import through some
// route graphs).
//
// The store fixture deliberately returns the WHOLE blob rather than today's
// `ANALYSES_LIST_COLUMNS` projection. The projection narrows what a list ships
// today, which would make the leak unobservable — and it is a perf decision that
// can be revisited. The route's own check is what has to hold either way, so the
// fixture is written to the shape that leaks.

import { mock } from 'bun:test'

const ORG = 'auth0|org-1'
const STUDENT_ID = '00000000-0000-0000-0000-0000000000b1'
const TEAM_ID = '00000000-0000-4000-8000-0000000000a1'

// One player, one analysed session. `injury_risk` is the wellness signal §5 puts
// behind the medical role; `biomechanics` and `weighted_scoring` are the payload
// that rides with it.
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
}

type Role = 'owner' | 'admin' | 'head_coach' | 'assistant_coach' | 'analyst' | 'medical' | 'player'

// Membership, keyed by the verified sub. `auth0|role-owner` is deliberately NOT
// the org owner, so it exercises the ROLE branch of `resolveMedicalAccess` rather
// than its `callerSub === ownerAuth0Id` fast path.
const ROLE_BY_SUB: Record<string, Role> = {
  'auth0|role-owner': 'owner',
  'auth0|role-admin': 'admin',
  'auth0|role-head': 'head_coach',
  'auth0|role-analyst': 'analyst',
  'auth0|role-medical': 'medical',
  'auth0|role-player': 'player',
}

// Org-wide scope per resolveStudentScope: owner/admin/analyst/medical, plus the
// coach's own team (the roster mirror the scope seam filters).
const isOrgWide = (role: Role | null): boolean =>
  role === 'owner' || role === 'admin' || role === 'analyst' || role === 'medical'

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))
mock.module('../src/lib/audit', () => ({ auditRoute: () => undefined }))

// The membership lookup `resolveMedicalAccess` (and `resolveCaller`, were it real)
// is made from.
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    ROLE_BY_SUB[memberAuth0Id] ?? null,
  listOrgMembers: async () => [],
}))

mock.module('../src/lib/caller', () => ({
  resolveCaller: async (_orgAuth0Id: string, request: Request) => {
    const verified = request.headers.get('x-verified-auth0-id')
    // The org owner, by the real resolver's own fast path.
    const role: Role | null = verified === ORG ? 'owner' : (ROLE_BY_SUB[verified ?? ''] ?? null)
    const orgWide = isOrgWide(role)
    // A player and a stranger get no team memberships, which is what makes their
    // scope empty (ADR-0002's "unassigned coach sees nothing").
    const teamIds = role === 'head_coach' ? [TEAM_ID] : []
    return {
      verified,
      role,
      teamIds,
      studentScope: orgWide ? { all: true } : { all: false, teamIds },
      can: () => true,
      canAccessTeam: () => true,
    }
  },
}))

// The scope seam, with the real rule and no store: `resolveStudentScope` gives an
// org-wide scope to owner/admin/analyst/medical, narrows team staff to their own
// teams, and leaves everyone else — a player, a stranger — with an EMPTY scope.
mock.module('../src/lib/org/scope', () => ({
  visibleStudentIds: async (_orgAuth0Id: string, scope: { all: boolean; teamIds: string[] }) =>
    scope.all ? null : scope.teamIds.map(() => STUDENT_ID),
  canSeeStudent: (ids: string[] | null, studentId: string) =>
    ids === null || ids.includes(studentId),
  uuidArrayLiteral: (ids: string[]) => `'{${ids.join(',')}}'`,
}))

// The students data barrel. Every name `routes/org/students.ts` imports has to be
// here: a partial module mock fails the whole probe with "Export named …".
mock.module('../src/lib/orgData', () => ({
  createPerformanceMetric: async () => null,
  createStudent: async () => null,
  deleteStudent: async () => false,
  getStudent: async (_auth0Id: string, id: string) => ({ id }),
  getStudentAnalyses: async () => [
    {
      server_job_id: 'job-1',
      student_id: STUDENT_ID,
      summary_json: summaryJson,
    },
  ],
  getStudentPerformanceSeries: async () => [],
  importStudents: async () => ({ imported: 0, failed: [], duplicates_skipped: 0 }),
  listStudentSports: async () => [],
  listStudents: async () => [],
  updateStudent: async () => null,
}))

// The app-level identity guard is inert in this handler-level test; the mocked
// membership supplies the role the medical decision is made from.
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const studentsRoute = (await import('../src/routes/org/students')).default

const CASES: Array<{ name: string; sub: string }> = [
  { name: 'orgOwner', sub: ORG },
  { name: 'ownerRole', sub: 'auth0|role-owner' },
  { name: 'medical', sub: 'auth0|role-medical' },
  { name: 'admin', sub: 'auth0|role-admin' },
  { name: 'headCoach', sub: 'auth0|role-head' },
  { name: 'analyst', sub: 'auth0|role-analyst' },
  { name: 'player', sub: 'auth0|role-player' },
  { name: 'outsider', sub: 'auth0|stranger' },
]

const results: Array<Record<string, unknown>> = []

for (const probeCase of CASES) {
  const response = await studentsRoute.handle(
    new Request(
      `http://localhost/api/org/${encodeURIComponent(ORG)}/students/${STUDENT_ID}/analyses`,
      { headers: { 'x-verified-auth0-id': probeCase.sub } },
    ),
  )
  const raw = await response.text()
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  const rows = (body?.analyses ?? null) as Array<{
    summary_json: { form_score?: number; shot_events?: Array<Record<string, unknown>> }
  }> | null
  const summary = rows?.[0]?.summary_json ?? null
  results.push({
    name: probeCase.name,
    status: response.status,
    form_score: summary?.form_score ?? null,
    event_keys: summary?.shot_events?.[0] ? Object.keys(summary.shot_events[0]).sort() : null,
    has_injury_risk: JSON.stringify(summary ?? null).includes('injury_risk'),
  })
}

console.log(JSON.stringify({ cases: results }))
