import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Account-tree scope probe ─────────────────────────────────────────────────
// Drives the job-keyed routes of `/api/auth/user/:auth0Id/*` for one caller role
// in a fresh process and prints what each handler actually did:
//
//   [{ role, route, status, askedScope, touched }]
//
// The caller (accountTreeScope.test.ts) spawns it per case so `mock.module`
// overrides never leak into the rest of the suite's module cache.
//
// Why this tree: `isOrgScopedPath` covers `/api/auth/user/*`, so `serviceGuard`
// admits any member of the org named in the path — membership, not
// authorization. The account id in this path is the *org's* sub and analysis
// rows are owned by the org, so an unscoped read here is org-wide: a team
// coach's History page listed every player in the club, and the job-keyed
// routes handed over the detail, clips, chat transcript, and the cancel,
// delete and rename mutations for a player on another team.
//
// The real `resolveCaller`, the real permission matrix and the real scope seam
// all run. What is stubbed is the data layer, which is what lets the probe
// answer the two questions that matter: which scope the list route *asked* for,
// and whether a refused route touched the row at all. (Whether the SQL behind
// that scope actually filters is a live question — see smokeOrgHttp.ts, since a
// stubbed `db` cannot tell a filtered query from an unfiltered one.)

const ORG = 'auth0|org-owner'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a1' // team A
const STUDENT_B = '00000000-0000-0000-0000-0000000000b1' // team B
const TEAM_A = '00000000-0000-0000-0000-0000000000f1'
const TEAM_B = '00000000-0000-0000-0000-0000000000f2'

const JOB_A = 'job-team-a'
const JOB_B = 'job-team-b'
const JOB_UNLINKED = 'job-unlinked'
const JOB_MISSING = 'job-does-not-exist'

const roleTokens = (process.env.ACCOUNT_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
if (roleTokens.length === 0) {
  console.error('ACCOUNT_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

let currentRole: OrgMemberRole | null = null
// Team staff belong to team A; org staff hold no team, by design (ADR-0002).
const teamsFor = (role: OrgMemberRole | null): string[] =>
  role === 'coach' || role === 'head_coach' || role === 'assistant_coach' ? [TEAM_A] : []

const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// ── What the handlers actually reached ───────────────────────────────────────
/** Every data-layer entry point a route can touch, so a refusal is provable. */
let touched: string[] = []
/** The scope the list route asked the data layer for; null means org-wide. */
let askedScope: string[] | null | undefined

const jobStudent: Record<string, string | null> = {
  [JOB_A]: STUDENT_A,
  [JOB_B]: STUDENT_B,
  [JOB_UNLINKED]: null,
}

const reset = () => {
  touched = []
  askedScope = undefined
}
const note = (what: string) => {
  touched.push(what)
}

const analysisRow = (job: string) => ({
  server_job_id: job,
  // Rows are owned by the org, which is the fact the share route keys on.
  auth0_id: ORG,
  engine_job_id: `eng-${job}`,
  session_token: null,
  student_id: jobStudent[job] ?? null,
  complete: true,
  progress: 100,
  model: 'soccer_v1',
  summary_json: {},
  display_name: job,
})

mock.module('../src/lib/analyses', () => ({
  getUserAnalyses: async (
    _org: string,
    _limit?: number,
    _offset?: number,
    opts?: { unlinked?: boolean; studentIds?: string[] | null },
  ) => {
    note('getUserAnalyses')
    askedScope = opts?.studentIds
    // Mirror the SQL's rule so the returned list matches what the caller asked
    // for: linked rows only when the student is in scope, unlinked rows always.
    const ids = opts?.studentIds ?? null
    return Object.entries(jobStudent)
      .filter(([, student]) => student === null || ids === null || ids.includes(student))
      .map(([job]) => analysisRow(job))
  },
  getUserAnalysisById: async (_org: string, job: string) => {
    note('getUserAnalysisById')
    return job in jobStudent ? analysisRow(job) : null
  },
  getAnalysisByServerJobId: async (job: string) => {
    note('getAnalysisByServerJobId')
    return job in jobStudent ? analysisRow(job) : null
  },
  getAnalysisStudentId: async (_org: string, job: string) => {
    note('getAnalysisStudentId')
    return job in jobStudent
      ? { found: true, studentId: jobStudent[job] }
      : { found: false, studentId: null }
  },
  getUserStats: async () => ({}),
  deleteAnalysis: async (_org: string, job: string) => {
    note('deleteAnalysis')
    return job in jobStudent
  },
  updateAnalysisDisplayName: async (_org: string, job: string) => {
    note('updateAnalysisDisplayName')
    return job in jobStudent ? analysisRow(job) : null
  },
  persistAnalysisStatus: async () => {
    note('persistAnalysisStatus')
  },
}))

mock.module('../src/lib/clips', () => ({
  MAX_CLIPS_PER_ANALYSIS: 10,
  countClips: async () => {
    note('countClips')
    return 0
  },
  createClip: async () => {
    note('createClip')
    return null
  },
  deleteClip: async () => {
    note('deleteClip')
    return false
  },
  listClips: async () => {
    note('listClips')
    return []
  },
  parseClipInput: () => ({ ok: true, cleaned: { start_ms: 0, end_ms: 1000 } }),
}))

// Findings hang off an analysis, so a finding's player comes from its job.
const FINDING_A = 'finding-on-team-a'
const FINDING_B = 'finding-on-team-b'
const findingJob: Record<string, string> = {
  [FINDING_A]: JOB_A,
  [FINDING_B]: JOB_B,
}
mock.module('../src/lib/findings', () => ({
  getStudentFindings: async (_org: string, studentId: string) => {
    note('getStudentFindings')
    return studentId === STUDENT_A ? [] : [{ id: 'off-team-finding' }]
  },
  getFindingsTrend: async () => {
    note('getFindingsTrend')
    return []
  },
  findingsToCsv: () => 'csv',
  getFindingJobId: async (_org: string, findingId: string) => {
    note('getFindingJobId')
    return findingId in findingJob
      ? { found: true, serverJobId: findingJob[findingId] }
      : { found: false, serverJobId: null }
  },
  reviewFinding: async (_org: string, findingId: string) => {
    note('reviewFinding')
    return findingId in findingJob
  },
}))

mock.module('../src/lib/jobs', () => ({
  getJob: async () => {
    note('getJob')
    return null
  },
}))

mock.module('../src/lib/engine', () => ({
  markEngineJobFailed: async () => {
    note('markEngineJobFailed')
  },
  askEngineChat: async () => {
    note('askEngineChat')
    return { reply: 'ok' }
  },
  requestIdFrom: () => 'probe',
}))

mock.module('../src/lib/ratelimit', () => ({
  checkClipLimit: async () => ({ allowed: true, reset: Date.now() + 60_000 }),
  getIP: () => '127.0.0.1',
  rateLimited: () => new Response('rate limited', { status: 429 }),
  checkAiReportLimit: async () => ({ allowed: true }),
  checkEmailLimit: async () => ({ allowed: true, remaining: 9 }),
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => {
    note('auditRoute')
  },
}))

// The scope seam's one query: which students sit on the caller's teams.
const storeDb = () => Promise.resolve([{ id: STUDENT_A }])
mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(storeDb),
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(storeDb),
  orDisabledDefault: (v: unknown, f: unknown) => v ?? f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
}))

mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_org: string, member: string) =>
    member === memberIdFor(currentRole) ? currentRole : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_org: string, id: string) => ({ id }),
  listMemberTeamIds: async () => teamsFor(currentRole),
}))

// The app-level guard is made inert: Bun autoloads server/.env, so without this
// the handler-level checks would never be reached.
process.env.SERVICE_TOKEN = ''

const authRoutes = (await import('../src/routes/auth')).default
const clipsRoute = (await import('../src/routes/clips')).default
const { findingsReadRoutes, findingsReviewRoutes } = await import('../src/routes/findings')
const { orgShareRoute } = await import('../src/routes/share')

// A share token is unauthenticated — anyone holding the link reads the analysis —
// so minting one is a write about the player on that video, not a read. The store
// is injected so the probe never touches Redis.
type TokenRecord = { auth0_id: string; server_job_id: string }
const tokens = new Map<string, TokenRecord>()
let minted = 0
const shareStore = {
  getShareToken: async (token: string) => tokens.get(token) ?? null,
  createShareToken: async (input: TokenRecord) => {
    minted += 1
    const token = `tok-${minted}`
    tokens.set(token, input)
    return { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() }
  },
  deleteShareToken: async (token: string) => tokens.delete(token),
} as never
const shareRoute = orgShareRoute({
  store: shareStore,
  // The row shape is trimmed to what the route reads; the real type has more
  // columns than any of these routes look at.
  getAnalysis: (async (job: string) => (job in jobStudent ? analysisRow(job) : null)) as never,
})
tokens.set('tok-own', { auth0_id: ORG, server_job_id: JOB_A })
tokens.set('tok-off-team', { auth0_id: ORG, server_job_id: JOB_B })
tokens.set('tok-foreign', { auth0_id: 'auth0|someone-else', server_job_id: JOB_A })
const { chatHistoryRoutes } = await import('../src/routes/chatHistory')

const transcript = {
  load: async () => {
    note('transcript.load')
    return []
  },
  append: async () => {
    note('transcript.append')
  },
}
const chat = chatHistoryRoutes({
  transcript,
  getAnalysis: async (_org, job) => (job in jobStudent ? analysisRow(job) : null),
})

const headers = (role: OrgMemberRole | null) => ({
  'content-type': 'application/json',
  'x-verified-auth0-id': memberIdFor(role),
})

const p = (suffix: string) => `/api/auth/user/${encodeURIComponent(ORG)}${suffix}`
// Share tokens live on the org tree, not the account tree.
const op = (suffix: string) => `/api/org/${encodeURIComponent(ORG)}${suffix}`

type Row = {
  role: OrgMemberRole | null
  route: string
  job: string
  status: number
  /** The scope the list route asked for; undefined for job-keyed routes. */
  askedScope: string[] | null | undefined
  /** Data-layer entry points the handler reached. */
  touched: string[]
}

const rows: Row[] = []

type ElysiaApp = { handle: (req: Request) => Promise<Response> }

const attempt = async (
  role: OrgMemberRole | null,
  route: string,
  job: string,
  build: (h: Record<string, string>) => Request,
  app: ElysiaApp,
) => {
  reset()
  const res = await app.handle(build(headers(role)))
  await res.json().catch(() => null)
  rows.push({ role, route, job, status: res.status, askedScope, touched })
}

for (const role of roleTokens) {
  currentRole = role

  // The list route: what scope did it ask the data layer for, and which jobs
  // came back?
  reset()
  const listRes = await authRoutes.handle(
    new Request(`http://localhost${p('/analyses')}`, { headers: headers(role) }),
  )
  const listJson = (await listRes.json().catch(() => null)) as {
    analyses?: { server_job_id: string }[]
  } | null
  rows.push({
    role,
    route: 'GET list',
    job: '-',
    status: listRes.status,
    askedScope,
    touched: [
      ...touched,
      `returned:${(listJson?.analyses ?? []).map((a) => a.server_job_id).join('+')}`,
    ],
  })

  for (const job of [JOB_B, JOB_A, JOB_UNLINKED, JOB_MISSING]) {
    await attempt(
      role,
      'GET detail',
      job,
      (h) => new Request(`http://localhost${p(`/analyses/${job}`)}`, { headers: h }),
      authRoutes,
    )
    await attempt(
      role,
      'GET clips',
      job,
      (h) => new Request(`http://localhost${p(`/analyses/${job}/clips`)}`, { headers: h }),
      clipsRoute,
    )
    await attempt(
      role,
      'GET chat',
      job,
      (h) => new Request(`http://localhost${p(`/analyses/${job}/chat`)}`, { headers: h }),
      chat,
    )
  }

  for (const job of [JOB_B, JOB_A, JOB_MISSING]) {
    await attempt(
      role,
      'PATCH display_name',
      job,
      (h) =>
        new Request(`http://localhost${p(`/analyses/${job}`)}`, {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({ display_name: 'renamed' }),
        }),
      authRoutes,
    )
    await attempt(
      role,
      'POST cancel',
      job,
      (h) =>
        new Request(`http://localhost${p(`/analyses/${job}/cancel`)}`, {
          method: 'POST',
          headers: h,
          body: '{}',
        }),
      authRoutes,
    )
    await attempt(
      role,
      'POST chat',
      job,
      (h) =>
        new Request(`http://localhost${p(`/analyses/${job}/chat`)}`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ message: 'what did you see?' }),
        }),
      chat,
    )
    await attempt(
      role,
      'POST clips',
      job,
      (h) =>
        new Request(`http://localhost${p(`/analyses/${job}/clips`)}`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ start_ms: 0, end_ms: 1000 }),
        }),
      clipsRoute,
    )
    await attempt(
      role,
      'DELETE analysis',
      job,
      (h) =>
        new Request(`http://localhost${p(`/analyses/${job}`)}`, { method: 'DELETE', headers: h }),
      authRoutes,
    )
  }

  // ── The findings half of the tree: keyed by student, not by job ───────────
  const fq = (query: string) => `${p(`/findings${query}`)}`
  const findingAttempts: { route: string; job: string; path: string; app: ElysiaApp }[] = [
    {
      route: 'GET findings',
      job: STUDENT_B,
      path: fq(`?student_id=${STUDENT_B}`),
      app: findingsReadRoutes,
    },
    {
      route: 'GET findings export',
      job: STUDENT_B,
      path: fq(`/export?student_id=${STUDENT_B}`),
      app: findingsReadRoutes,
    },
    {
      route: 'GET findings trends (student)',
      job: STUDENT_B,
      path: fq(`/trends?student_id=${STUDENT_B}`),
      app: findingsReadRoutes,
    },
    {
      route: 'GET findings trends (team)',
      job: 'team-b',
      path: fq(`/trends?team_id=${TEAM_B}`),
      app: findingsReadRoutes,
    },
    {
      route: 'GET findings trends (org)',
      job: 'org',
      path: fq('/trends'),
      app: findingsReadRoutes,
    },
    {
      route: 'PATCH finding review',
      job: 'job-team-b',
      path: `${p(`/findings/${FINDING_B}`)}`,
      app: findingsReviewRoutes,
    },
  ]
  for (const f of findingAttempts) {
    const method = f.route.startsWith('PATCH') ? 'PATCH' : 'GET'
    const body = method === 'PATCH' ? JSON.stringify({ review_state: 'approved' }) : undefined
    await attempt(
      role,
      f.route,
      f.job,
      (h) => new Request(`http://localhost${f.path}`, { method, headers: h, body }),
      f.app,
    )
  }

  // ── Share tokens: publishing, not reading ─────────────────────────────────
  // Only the cross-org half is exercised here. Share gates its identity and
  // scope checks on the service guard being *on*, and the guard captures
  // SERVICE_TOKEN at import, so a probe process cannot have it both ways: this
  // one runs inert to isolate the scope seam, exactly as the account tree above.
  // The team-scope half needs a real team-scoped member, so smokeOrgHttp.ts
  // asserts it live against a real org.
  const shareAttempts: { route: string; job: string; path: string; method: string }[] = [
    {
      route: 'POST share token',
      job: JOB_B,
      path: `/analyses/${JOB_B}/share-token`,
      method: 'POST',
    },
    {
      route: 'DELETE share token',
      job: 'foreign',
      path: '/share-tokens/tok-foreign',
      method: 'DELETE',
    },
  ]
  for (const s of shareAttempts) {
    await attempt(
      role,
      s.route,
      s.job,
      (h) => new Request(`http://localhost${op(s.path)}`, { method: s.method, headers: h }),
      shareRoute,
    )
  }

  // The allowed counterparts, so a refusal cannot be confused with a route that
  // is simply broken.
  await attempt(
    role,
    'GET findings',
    STUDENT_A,
    (h) => new Request(`http://localhost${fq(`?student_id=${STUDENT_A}`)}`, { headers: h }),
    findingsReadRoutes,
  )
  await attempt(
    role,
    'PATCH finding review',
    'job-team-a',
    (h) =>
      new Request(`http://localhost${p(`/findings/${FINDING_A}`)}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ review_state: 'approved' }),
      }),
    findingsReviewRoutes,
  )
}

console.log(JSON.stringify({ roles: roleTokens, rows }))
// Importing the route tree pulls in a live transcript/pool handle, so the
// loop would never drain on its own; the caller reads stdout and this exit.
process.exit(0)
