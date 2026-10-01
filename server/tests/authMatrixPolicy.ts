// ── Authorization matrix policy ─────────────────────────────────────────────
// Declarative expected status per route × role. The probe (authMatrixProbe)
// drives the real composed app against a fixture store and fails on any
// mismatch; routes without an entry (and not in EXCLUDED) fail CI.
//
// Roles: anonymous (no headers), owner (org key), admin, head_coach, coach,
// assistant_coach, analyst, medical (org members), player (linked account,
// no teams), outsider (verified, no membership), other (member of another org).
//
// Status conventions asserted here (the repo's contract):
// - reads of hidden students → 404; writes → 403 beside the capability gate.
// - missing capability → 403; non-member/anonymous on guarded trees → 403.
// - malformed ids → 400 (never a 500 from a ::uuid/::date cast).

export type MatrixRole =
  | 'anonymous'
  | 'owner'
  | 'admin'
  | 'head_coach'
  | 'coach'
  | 'assistant_coach'
  | 'analyst'
  | 'medical'
  | 'player'
  | 'outsider'
  | 'other'

export type MatrixEntry = {
  method: string
  /** Path template; :params filled from FIXTURE_IDS (overridable per entry). */
  path: string
  params?: Record<string, string>
  query?: string
  body?: unknown
  /** Expected status per role. */
  expect: Record<MatrixRole, number>
  /** Extra runs of the same route with different params/expectations. */
  variants?: Array<{
    name: string
    params?: Record<string, string>
    query?: string
    body?: unknown
    expect: Record<MatrixRole, number>
  }>
  note?: string
}

/** Routes deliberately outside the matrix, with reasons. */
export const MATRIX_EXCLUDED: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^OPTIONS /, reason: 'CORS preflight, no authorization' },
  { pattern: /^GET \/swagger/, reason: 'dev-only docs' },
  { pattern: /^GET \/health/, reason: 'infra health, unauthenticated by design' },
  // Capability-token routes (signed x-attribution, owner_ids binding): covered
  // by jobAccess/attribution/analyzeOrg probes, not by membership roles.
  { pattern: /^\S+ \/api\/scan-video$/, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/scan-intent$/, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/scan-from-key$/, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/scan-progress\//, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/analyze-video$/, reason: 'capability route (analyzeOrg probe)' },
  { pattern: /^\S+ \/api\/job-status\//, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/job-events\//, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/download\//, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/chat\/stream$/, reason: 'capability route (own tests)' },
  { pattern: /^\S+ \/api\/conversation\//, reason: 'capability route (own tests)' },
  // Open-ended streams: the probe's 8s abort would record a THREW, not a
  // status. Authorization on these paths is covered by their gates' unit
  // suites (notifications, aiReports probes).
  { pattern: /^GET \/api\/me\/notifications\/sse$/, reason: 'SSE stream (own tests)' },
  { pattern: /\/reports\/ai\/[^/]+\/events$/, reason: 'SSE stream (own tests)' },
]

const ALL_200: Record<MatrixRole, number> = {
  anonymous: 403,
  owner: 200,
  admin: 200,
  head_coach: 200,
  coach: 200,
  assistant_coach: 200,
  analyst: 200,
  medical: 200,
  player: 403,
  outsider: 403,
  other: 403,
}

/**
 * Org reads every member role reaches (mount floor), player excluded.
 *
 * REALITY (verified live 2026-09-29): the app-level
 * `orgRoute.use(orgRoleGuard(...))` wrap does NOT fire on barrel routes —
 * no listOrgMembers query runs for them — while file-level guards (teams,
 * members) do. Org reads therefore rely on handler-level scope, not the
 * mount floor: players reach read handlers and get scoped answers (list →
 * 200, by-id → 404). The floor that actually holds is serviceGuard
 * (membership) + handler capability/scope. Do NOT "fix" the policy to 403
 * here without also fixing the handlers to refuse first.
 */
const orgRead = (method: string, path: string, extra?: Partial<MatrixEntry>): MatrixEntry => ({
  method,
  path,
  expect: { ...ALL_200 },
  ...extra,
})

export const MATRIX: MatrixEntry[] = [
  // ── Roster ──
  // Lists: players reach the handler (see orgRead note) and get their
  // (empty) scope as 200 — not 403.
  {
    ...orgRead('GET', '/api/org/:auth0Id/students'),
    expect: { ...ALL_200, player: 200 },
  },
  orgRead('GET', '/api/org/:auth0Id/students/sports', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    ...orgRead('GET', '/api/org/:auth0Id/students/:id'),
    expect: { ...ALL_200, player: 404 },
    variants: [
      {
        name: 'out-of-team',
        params: { id: '00000000-0000-4000-8000-0000000000c2' },
        expect: {
          ...ALL_200,
          coach: 404,
          assistant_coach: 404,
          head_coach: 404,
          player: 404,
          outsider: 403,
          other: 403,
          anonymous: 403,
        },
      },
    ],
    note: 'out-of-team read is 404 (indistinguishable from missing)',
  },
  // ── Roster writes (player.manage + team scope) ──
  {
    method: 'POST',
    path: '/api/org/:auth0Id/students',
    body: { full_name: 'Matrix Rookie' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  {
    method: 'PUT',
    path: '/api/org/:auth0Id/students/:id',
    body: { notes: 'matrix' },
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 200,
      coach: 200,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
    variants: [
      {
        name: 'out-of-team',
        params: { id: '00000000-0000-4000-8000-0000000000c2' },
        body: { notes: 'matrix' },
        expect: {
          anonymous: 403,
          owner: 200,
          admin: 200,
          head_coach: 403,
          coach: 403,
          assistant_coach: 403,
          analyst: 403,
          medical: 403,
          player: 403,
          outsider: 403,
          other: 403,
        },
      },
    ],
    note: 'writes refuse out-of-scope with 403 (reads would 404)',
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/students/:id',
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 200,
      coach: 200,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/students/import',
    body: { rows: [{ full_name: 'Matrix Import' }] },
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 200,
      coach: 200,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  // ── Attendance ──
  orgRead('GET', '/api/org/:auth0Id/attendance', {
    expect: { ...ALL_200, player: 200 },
  }),
  orgRead('GET', '/api/org/:auth0Id/attendance/summary', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'PUT',
    path: '/api/org/:auth0Id/attendance',
    body: {
      student_id: '00000000-0000-4000-8000-0000000000c1',
      session_date: '2026-09-01',
      status: 'present',
    },
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 200,
      coach: 200,
      assistant_coach: 200,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
    variants: [
      {
        name: 'out-of-team',
        body: {
          student_id: '00000000-0000-4000-8000-0000000000c2',
          session_date: '2026-09-01',
          status: 'present',
        },
        expect: {
          anonymous: 403,
          owner: 200,
          admin: 200,
          head_coach: 403,
          coach: 403,
          assistant_coach: 403,
          analyst: 403,
          medical: 403,
          player: 403,
          outsider: 403,
          other: 403,
        },
      },
    ],
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/attendance/batch',
    body: {
      entries: [
        {
          student_id: '00000000-0000-4000-8000-0000000000c1',
          session_date: '2026-09-02',
          status: 'present',
        },
      ],
    },
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 200,
      coach: 200,
      assistant_coach: 200,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/attendance',
    query: '?studentId=00000000-0000-4000-8000-0000000000c1&date=2026-09-01',
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 200,
      coach: 200,
      assistant_coach: 200,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  // ── Schedule (attendance.write + team scope) ──
  orgRead('GET', '/api/org/:auth0Id/schedule', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'POST',
    path: '/api/org/:auth0Id/schedule',
    body: { title: 'Session', starts_at: '2026-10-01T10:00:00.000Z', team_id: '00000000-0000-4000-8000-0000000000a1' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 201,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
    variants: [
      {
        name: 'club-wide',
        body: { title: 'Session', starts_at: '2026-10-01T10:00:00.000Z' },
        expect: {
          anonymous: 403,
          owner: 201,
          admin: 201,
          head_coach: 403,
          coach: 403,
          assistant_coach: 403,
          analyst: 403,
          medical: 403,
          player: 403,
          outsider: 403,
          other: 403,
        },
      },
    ],
    note: 'scoped callers may write only their own teams, never club-wide',
  },
  // ── Seasons & matches (team.manage) ──
  orgRead('GET', '/api/org/:auth0Id/seasons', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'POST',
    path: '/api/org/:auth0Id/seasons',
    body: { name: 'Season' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  orgRead('GET', '/api/org/:auth0Id/matches', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'POST',
    path: '/api/org/:auth0Id/matches',
    body: { opponent: 'Rivals', team_id: '00000000-0000-4000-8000-0000000000a1' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  // ── Objectives & plans (player.manage) ──
  orgRead('GET', '/api/org/:auth0Id/objectives', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'POST',
    path: '/api/org/:auth0Id/objectives',
    body: { title: 'Objective', student_id: '00000000-0000-4000-8000-0000000000c1' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  orgRead('GET', '/api/org/:auth0Id/plans', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'POST',
    path: '/api/org/:auth0Id/plans',
    body: { title: 'Plan', student_id: '00000000-0000-4000-8000-0000000000c1' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  // ── Performance ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/performance', {
      query: '?studentId=00000000-0000-4000-8000-0000000000c1',
      expect: { ...ALL_200, player: 200 },
    }),
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/performance',
    body: {
      student_id: '00000000-0000-4000-8000-0000000000c1',
      metric_key: 'form_score',
      metric_value: 7,
    },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
  },
  // ── Reports ──
  orgRead('GET', '/api/org/:auth0Id/reports', {
    expect: { ...ALL_200, player: 200 },
  }),
  {
    method: 'POST',
    path: '/api/org/:auth0Id/reports',
    body: { title: 'Report', report_type: 'progress', student_id: '00000000-0000-4000-8000-0000000000c1' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 201,
      analyst: 201,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
    note: 'report.create holders include assistant coaches and analysts',
  },
  // ── Wellness (medical boundary) ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/students/:id/wellness'),
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 403,
      head_coach: 403,
      coach: 403,
      assistant_coach: 403,
      analyst: 403,
      medical: 200,
      player: 403,
      outsider: 403,
      other: 403,
    },
    note: 'admin excludes medical.read by design; reads need the permission, not just scope',
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/students/:id/wellness',
    body: { availability: 'fit' },
    expect: {
      anonymous: 403,
      owner: 201,
      admin: 201,
      head_coach: 201,
      coach: 201,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
    note: 'writes need player.manage; consent gate warns by default and proceeds',
  },
  // ── Trends, comparison, overview, search ──
  orgRead('GET', '/api/org/:auth0Id/students/:id/trends', {
    expect: { ...ALL_200, player: 200 },
    note: 'out-of-scope yields an empty series, still 200 (data-level narrowing)',
  }),
  orgRead('GET', '/api/org/:auth0Id/students/comparison', {
    query: '?ids=00000000-0000-4000-8000-0000000000c1',
    expect: { ...ALL_200, player: 200 },
  }),
  orgRead('GET', '/api/org/:auth0Id/overview', {
    expect: { ...ALL_200, player: 200 },
  }),
  orgRead('GET', '/api/org/:auth0Id/search', {
    expect: { ...ALL_200, player: 200 },
  }),
  // ── Settings & billing (owner/admin) ──
  orgRead('GET', '/api/org/:auth0Id/settings', {
    expect: { ...ALL_200, player: 200 },
    note: 'settings reads are open; only writes narrow to owner/admin',
  }),
  {
    ...orgRead('GET', '/api/org/:auth0Id/subscription'),
    expect: {
      anonymous: 403,
      owner: 200,
      admin: 200,
      head_coach: 403,
      coach: 403,
      assistant_coach: 403,
      analyst: 403,
      medical: 403,
      player: 403,
      outsider: 403,
      other: 403,
    },
    note: 'subscription is owner/admin only',
  },
  // ── By-id writes ──
  {
    method: 'PATCH',
    path: '/api/org/:auth0Id/objectives/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: { status: 'active' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/objectives/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
     assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PATCH',
    path: '/api/org/:auth0Id/plans/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: { status: 'active' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/plans/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PUT',
    path: '/api/org/:auth0Id/reports/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: { title: 'R2', report_type: 'progress' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/reports/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PUT',
    path: '/api/org/:auth0Id/schedule/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: { title: 'S2' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/schedule/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/seasons/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/matches/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  // ── Analysis link ──
  {
    method: 'PUT',
    path: '/api/org/:auth0Id/analyses/:jobId/student',
    body: { student_id: '00000000-0000-4000-8000-0000000000c1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'consent gate warns by default and proceeds',
  },
  // ── Settings write, export, privacy queue ──
  {
    method: 'PATCH',
    path: '/api/org/:auth0Id/settings',
    body: { timezone: 'UTC' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'GET',
    path: '/api/org/:auth0Id/export',
    query: '?format=json',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'GET',
    path: '/api/org/:auth0Id/privacy-requests',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PATCH',
    path: '/api/org/:auth0Id/privacy-requests/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: { status: 'in_progress' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  // ── Members (owner/admin floor, owner-only role/remove) ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/members'),
    expect: { ...ALL_200, player: 200 },
    note: 'mount floor is membership-wide; the handler reports the caller role',
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/members',
    body: { email: 'new@matrix.test', role: 'coach' },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/invites',
    body: { email: 'inv@matrix.test', role: 'coach' },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/members/:id',
    params: { id: '00000000-0000-4000-8000-0000000000f3' },
    expect: {
      anonymous: 403, owner: 200, admin: 403, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'removal is owner-only and runs the offboard transaction',
  },
  // ── Teams ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/teams'),
    expect: { ...ALL_200, player: 403 },
    note: 'team.read is not in the player set',
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/teams',
    body: { name: 'Matrix XI' },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'team.create is owner/admin-only (coaches rename/manage, not create)',
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/teams/:teamId',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'deletion stays owner/admin even though coaches may rename',
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/teams/:teamId/members',
    body: { member_auth0_id: 'auth0|matrix-newcoach', role: 'coach' },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 201, coach: 201,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  // ── Share (write about the player on the video) ──
  {
    method: 'POST',
    path: '/api/org/:auth0Id/analyses/:jobId/share-token',
    body: {},
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 201, coach: 201,
      assistant_coach: 201, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'mount floor is coach-track; scope follows the analysis student',
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/share-tokens/:token',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'GET',
    path: '/api/share/:token',
    expect: {
      anonymous: 200, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
    note: 'unauthenticated by design; the token is the credential (serviceGuard exempts it)',
    variants: [
      {
        name: 'unknown-token',
        params: { token: 'no-such-token' },
        expect: {
          anonymous: 404, owner: 404, admin: 404, head_coach: 404, coach: 404,
          assistant_coach: 404, analyst: 404, medical: 404, player: 404,
          outsider: 404, other: 404,
        },
      },
    ],
  },
  // ── Account tree (coach-owned rows; scoped readers) ──
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'AUTH_USER_ALLOWED roles; medical/player use /api/me',
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/analyses'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/analyses/:jobId'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/stats'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PATCH',
    path: '/api/auth/user/:auth0Id/analyses/:jobId',
    body: { display_name: 'Matrix Run' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/auth/user/:auth0Id/analyses/:jobId',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/auth/user/:auth0Id/analyses/:jobId/clips',
    body: { label: 'Clip', start_ms: 0, end_ms: 1000 },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 201, coach: 201,
      assistant_coach: 201, analyst: 201, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  // ── Player hub (self-scoped; 200 with linked:false when unlinked) ──
  orgRead('GET', '/api/me/orgs', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
    note: 'any verified account lists its own memberships',
  }),
  orgRead('GET', '/api/me/profile', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/analyses', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
    note: 'unlinked accounts answer linked:false, still 200',
  }),
  {
    method: 'PUT',
    path: '/api/me/consent',
    body: { trainingData: true },
    expect: {
      anonymous: 403, owner: 403, admin: 403, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 200,
      outsider: 403, other: 403,
    },
    note: 'consent writes need a linked player',
  },
  {
    method: 'POST',
    path: '/api/me/analyze',
    body: {},
    expect: {
      anonymous: 403, owner: 403, admin: 403, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 200,
      outsider: 403, other: 403,
    },
    note: 'player-hub analysis needs a linked player',
  },
  // ── Notifications ──
  orgRead('GET', '/api/me/notifications', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  // ── Email (capability + scope; mail captured, never sent) ──
  {
    method: 'POST',
    path: '/api/email/:auth0Id/invite',
    body: { emails: ['new@matrix.test'] },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'org.invite is owner/admin-only',
  },
  // ── AI reports ──
  {
    method: 'POST',
    path: '/api/org/:auth0Id/reports/ai',
    body: { report_type: 'progress', student_id: '00000000-0000-4000-8000-0000000000c1' },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 201, coach: 201,
      assistant_coach: 201, analyst: 201, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  // ── Findings (account tree; AUTH_USER roles, medical/player excluded) ──
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/findings/trends'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'unfiltered trends are org-wide: team accounts get 403, not narrowed data',
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/findings', {
      query: '?student_id=00000000-0000-4000-8000-0000000000c1',
    }),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    variants: [
      {
        name: 'out-of-team',
        query: '?student_id=00000000-0000-4000-8000-0000000000c2',
        expect: {
          anonymous: 403, owner: 200, admin: 200, head_coach: 404, coach: 404,
          assistant_coach: 404, analyst: 200, medical: 403, player: 403,
          outsider: 403, other: 403,
        },
      },
    ],
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/findings/export', {
      query: '?student_id=00000000-0000-4000-8000-0000000000c1',
    }),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'CSV twin of the list: same gate, higher exfiltration value',
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/analyses/:jobId/clips'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/auth/user/:auth0Id/analyses/:jobId/clips/:clipId',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PATCH',
    path: '/api/auth/user/:auth0Id/findings/:findingId',
    body: { review_state: 'approved' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'finding.review holders include assistant coaches and analysts',
  },
  {
    method: 'POST',
    path: '/api/auth/user/:auth0Id/analyses/:jobId/cancel',
    body: {},
    expect: {
      anonymous: 403, owner: 400, admin: 400, head_coach: 400, coach: 400,
      assistant_coach: 400, analyst: 400, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'fixture analysis is complete: authorized callers reach the state refusal',
  },
  {
    ...orgRead('GET', '/api/auth/user/:auth0Id/analyses/:jobId/chat'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/auth/user/:auth0Id/analyses/:jobId/chat',
    body: { message: 'How was the form?' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'engine unreachable in probe: asserts the local-fallback 200',
  },
  // ── Per-student org reads/writes ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/students/:id/performance'),
    expect: { ...ALL_200, player: 404 },
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/students/:id/performance',
    body: { metric_key: 'form_score', metric_value: 7 },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 201, coach: 201,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    ...orgRead('GET', '/api/org/:auth0Id/students/:id/analyses'),
    expect: { ...ALL_200, player: 404 },
  },
  {
    ...orgRead('GET', '/api/org/:auth0Id/reports/:id', {
      params: { id: '00000000-0000-4000-8000-0000000000e1' },
    }),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 404,
      outsider: 403, other: 403,
    },
    note: 'no capability gate on this read: medical is org-wide (200), the player scope is empty (404)',
  },
  {
    method: 'PUT',
    path: '/api/org/:auth0Id/performance/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: { metric_value: 8 },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/performance/:id',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/privacy-requests/:id/execute-delete',
    params: { id: '00000000-0000-4000-8000-0000000000e1' },
    body: {},
    expect: {
      anonymous: 403, owner: 400, admin: 400, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'fixture request is export/received: owner reaches the type refusal',
  },
  // ── Invites, audit, role, teams ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/invites'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/org/:auth0Id/invites/:id/revoke',
    body: {},
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    ...orgRead('GET', '/api/org/:auth0Id/audit'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'PATCH',
    path: '/api/org/:auth0Id/members/:id/role',
    params: { id: '00000000-0000-4000-8000-0000000000f1' },
    body: { role: 'coach' },
    expect: {
      anonymous: 403, owner: 200, admin: 403, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'role changes are owner-only (mount guard, not just handler)',
  },
  {
    method: 'PATCH',
    path: '/api/org/:auth0Id/teams/:teamId',
    body: { name: 'Matrix Renamed' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'team.manage is coach-track; rename still scope-checked per team',
  },
  {
    ...orgRead('GET', '/api/org/:auth0Id/teams/:teamId/members'),
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'DELETE',
    path: '/api/org/:auth0Id/teams/:teamId/members/:membershipId',
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  // ── Player hub: self-scoped reads answer for every verified account ──
  {
    method: 'PUT',
    path: '/api/me/profile',
    body: { name: 'Matrix' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  },
  orgRead('GET', '/api/me/notification-preferences', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  {
    method: 'PUT',
    path: '/api/me/notification-preferences',
    body: { inApp: false },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  },
  orgRead('GET', '/api/me/preferences', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  {
    method: 'PUT',
    path: '/api/me/preferences',
    body: { theme: 'dark' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  },
  orgRead('GET', '/api/me/consent', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/export', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/privacy-requests', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  {
    method: 'POST',
    path: '/api/me/privacy-requests',
    body: { type: 'export' },
    expect: {
      anonymous: 403, owner: 201, admin: 201, head_coach: 201, coach: 201,
      assistant_coach: 201, analyst: 201, medical: 201, player: 201,
      outsider: 201, other: 201,
    },
  },
  orgRead('GET', '/api/me/attendance', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
    note: 'unlinked accounts answer linked:false, still 200',
  }),
  orgRead('GET', '/api/me/schedule', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/performance', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/objectives', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/reports', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  orgRead('GET', '/api/me/reports/:id', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 404,
      outsider: 200, other: 200,
    },
    note: 'fixture report is about another player: the linked player 404s',
  }),
  {
    method: 'POST',
    path: '/api/me/invites/accept',
    body: { token: 'nope' },
    expect: {
      anonymous: 403, owner: 400, admin: 400, head_coach: 400, coach: 400,
      assistant_coach: 400, analyst: 400, medical: 400, player: 400,
      outsider: 400, other: 400,
    },
    note: 'unknown token: every verified caller reaches the uniform refusal',
  },
  {
    method: 'POST',
    path: '/api/me/orgs/:orgAuth0Id/leave',
    body: {},
    expect: {
      anonymous: 403, owner: 400, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 400,
      outsider: 404, other: 404,
    },
    note: 'own org and player self-removal refuse; strangers 404',
  },
  orgRead('GET', '/api/me/attribution/mint', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  // ── Notifications ──
  orgRead('GET', '/api/me/notifications', {
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  }),
  {
    method: 'POST',
    path: '/api/me/notifications/:id/read',
    body: {},
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  },
  {
    method: 'POST',
    path: '/api/me/notifications/read-all',
    body: {},
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
  },
  // ── Email ──
  {
    method: 'POST',
    path: '/api/email/:auth0Id/report',
    body: { report_id: '00000000-0000-4000-8000-0000000000e1', to: 'a@matrix.test' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
  },
  {
    method: 'POST',
    path: '/api/email/:auth0Id/attendance',
    body: { student_id: '00000000-0000-4000-8000-0000000000c1', recipient: 'a@matrix.test' },
    expect: {
      anonymous: 403, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    variants: [
      {
        name: 'out-of-team',
        body: { student_id: '00000000-0000-4000-8000-0000000000c2', recipient: 'a@matrix.test' },
        expect: {
          anonymous: 403, owner: 200, admin: 200, head_coach: 403, coach: 403,
          assistant_coach: 403, analyst: 403, medical: 403, player: 403,
          outsider: 403, other: 403,
        },
      },
    ],
  },
  // ── Onboarding sync (owner named in body.sub) ──
  {
    method: 'POST',
    path: '/api/auth/sync',
    body: { sub: 'auth0|matrix-org', email: 'owner@matrix.test' },
    expect: {
      anonymous: 403, owner: 200, admin: 403, head_coach: 403, coach: 403,
      assistant_coach: 403, analyst: 403, medical: 403, player: 403,
      outsider: 403, other: 403,
    },
    note: 'only the verified owner passes; the check lives in the handler',
  },
  // ── Guard-exempt static config ──
  {
    method: 'GET',
    path: '/api/sports/:sport/positions',
    expect: {
      anonymous: 200, owner: 200, admin: 200, head_coach: 200, coach: 200,
      assistant_coach: 200, analyst: 200, medical: 200, player: 200,
      outsider: 200, other: 200,
    },
    note: 'static vocabulary degrades to [] when the engine is unreachable',
  },
  // ── AI report fetch (unknown job) ──
  {
    ...orgRead('GET', '/api/org/:auth0Id/reports/ai/:reportJobId'),
    expect: {
      anonymous: 403, owner: 404, admin: 404, head_coach: 404, coach: 404,
      assistant_coach: 404, analyst: 404, medical: 404, player: 404,
      outsider: 403, other: 403,
    },
    note: 'mount floor is an inert barrel-wrap (same as orgRoute): the handler 404 answers for every member',
  },
]
