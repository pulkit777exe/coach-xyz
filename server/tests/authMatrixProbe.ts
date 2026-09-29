// Authorization matrix runner: real composed app, fixture store, policy
// expectations. Prints { failures, uncovered, total } as the last line.
// Mocks: redis (import-time connector), mailer/ratelimit (no real sends).

import { mock } from 'bun:test'
import { Elysia } from 'elysia'

import { MATRIX, MATRIX_EXCLUDED, type MatrixRole } from './authMatrixPolicy'

export const ORG = 'auth0|matrix-org'
export const OTHER_ORG = 'auth0|matrix-other'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'
const STU_A = '00000000-0000-4000-8000-0000000000c1'
const STU_B = '00000000-0000-4000-8000-0000000000c2'
const STU_LINKED = '00000000-0000-4000-8000-0000000000c3'

const SUB: Record<Exclude<MatrixRole, 'anonymous'>, string> = {
  owner: ORG,
  admin: 'auth0|matrix-admin',
  head_coach: 'auth0|matrix-head',
  coach: 'auth0|matrix-coach',
  assistant_coach: 'auth0|matrix-assist',
  analyst: 'auth0|matrix-analyst',
  medical: 'auth0|matrix-medical',
  player: 'auth0|matrix-player',
  outsider: 'auth0|matrix-outsider',
  other: 'auth0|matrix-other-member',
}

const ROLE_OF: Record<string, string> = {
  [SUB.admin]: 'admin',
  [SUB.head_coach]: 'head_coach',
  [SUB.coach]: 'coach',
  [SUB.assistant_coach]: 'assistant_coach',
  [SUB.analyst]: 'analyst',
  [SUB.medical]: 'medical',
  [SUB.player]: 'player',
}

// Membership rows with stable uuids (role changes and offboarding address
// rows by id). MEMBER_BY_SUB / MEMBER_BY_ID back filtered lookups.
const MEMBERS = (
  Object.entries(ROLE_OF).filter(([sub]) => sub !== SUB.other) as Array<[string, string]>
).map(([sub, role], i) => ({
  id: `00000000-0000-4000-8000-0000000000f${i + 1}`,
  member_auth0_id: sub,
  member_email: `${sub}@matrix.test`,
  role,
  status: 'active',
}))
const MEMBER_BY_SUB: Record<string, (typeof MEMBERS)[number]> = Object.fromEntries(
  MEMBERS.map((m) => [m.member_auth0_id, m]),
)
const MEMBER_BY_ID: Record<string, (typeof MEMBERS)[number]> = Object.fromEntries(
  MEMBERS.map((m) => [m.id, m]),
)

const TEAM_OF: Record<string, string[]> = {
  [SUB.head_coach]: [TEAM_A],
  [SUB.coach]: [TEAM_A],
  [SUB.assistant_coach]: [TEAM_A],
}

const STUDENTS = [
  { id: STU_A, team_id: TEAM_A, full_name: 'A' },
  { id: STU_B, team_id: TEAM_B, full_name: 'B' },
  { id: STU_LINKED, team_id: TEAM_A, full_name: 'Linked' },
]

const JOB = 'job-matrix'
const TEAMS = [
  { id: TEAM_A, org_auth0_id: ORG, name: 'A' },
  { id: TEAM_B, org_auth0_id: ORG, name: 'B' },
]

// Generic row answered for any single-row table lookup by id.
const ROW_BY_TABLE: Record<string, Record<string, unknown>> = {
  training_objectives: { id: '00000000-0000-4000-8000-0000000000e1', org_auth0_id: ORG, student_id: STU_A, team_id: TEAM_A },
  training_plans: { id: '00000000-0000-4000-8000-0000000000e1', org_auth0_id: ORG, student_id: STU_A, team_id: TEAM_A },
  reports: { id: '00000000-0000-4000-8000-0000000000e1', auth0_id: ORG, student_id: STU_A },
  schedule_events: { id: '00000000-0000-4000-8000-0000000000e1', auth0_id: ORG, team_id: TEAM_A },
  seasons: { id: '00000000-0000-4000-8000-0000000000e1', org_auth0_id: ORG },
  matches: { id: '00000000-0000-4000-8000-0000000000e1', org_auth0_id: ORG },
  performance_metrics: { id: '00000000-0000-4000-8000-0000000000e1', auth0_id: ORG, student_id: STU_A },
  wellness_checkins: { id: '00000000-0000-4000-8000-0000000000e1', org_auth0_id: ORG, student_id: STU_A },
  findings: { id: 'job-matrix:e1', server_job_id: JOB },
  clips: { id: 'clip', server_job_id: JOB },
  notifications: { id: 'notif', auth0_id: ORG },
  privacy_requests: {
    id: '00000000-0000-4000-8000-0000000000e1',
    auth0_id: SUB.player,
    request_type: 'export',
    status: 'received',
    created_at: new Date().toISOString(),
    resolved_at: null,
  },
  users: { auth0_id: ORG, email: 'owner@matrix.test', email_verified: true },
}

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  // Map-backed fake, not null: job delete resolves getJob (absent → null,
  // skipping the engine call) without a real connection. Same inertness
  // rationale as the null stub, but these routes dereference `redis`.
  redis: {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
  },
}))

// Queue + limits + mail never run for real here: the matrix asserts routing
// (who reaches admission/enqueue/send), while dedicated suites own those
// seams (analysisAdmission, analyzeOrg, emailRouteGuards probes).
mock.module('../src/lib/queue', () => ({
  enqueueAnalysis: async () => undefined,
  enqueueAiReport: async () => 'ai-job-1',
  analysisQueue: null,
  aiReportQueue: null,
  worker: null,
  aiReportWorker: null,
  queueEvents: null,
  notificationDigestQueue: null,
  notificationDigestWorker: null,
  onQueueInfrastructureReady: () => undefined,
  classifyFailure: () => ({ retryable: false }) as never,
  buildFailedAnalysisStatus: () => ({}) as never,
  isFatalRedisError: () => false,
  startQueueInfrastructure: () => undefined,
  stopQueueInfrastructure: async () => undefined,
}))

mock.module('../src/lib/ratelimit', () => {
  const allow = async () => ({ allowed: true, reset: Date.now() + 1000, remaining: 9 })
  return {
    checkLimit: allow,
    checkScanLimit: allow,
    checkAnalysisLimit: allow,
    checkChatLimit: allow,
    checkDownloadLimit: allow,
    checkScanProgressLimit: allow,
    checkEmailLimit: allow,
    checkAiReportLimit: allow,
    checkClipLimit: allow,
    checkOrgWriteLimit: allow,
    // Inert: the matrix asserts per-route gates, not the limiter (which has
    // its own probe). A new ratelimit export without this line fails the
    // whole probe with "Export named ... not found".
    orgWriteRateLimit: new Elysia({ name: 'orgWriteRateLimit-stub' }),
    getIP: () => '127.0.0.1',
    rateLimited: (set: { status?: number | string }, message: string) => {
      set.status = 429
      return { error: message }
    },
  }
})

mock.module('../src/lib/analysisAdmission', () => ({
  admitAnalysis: async () => ({ ok: true, priority: 5 }),
}))

// Share tokens live in Redis: the stub store answers a fixed org-scoped
// token (valid) and nothing else (invalid → 404).
mock.module('../src/lib/shareTokens', () => ({
  createShareTokenStore: () => ({
    createShareToken: async (input: { auth0_id: string; server_job_id: string }) => ({
      auth0_id: input.auth0_id,
      server_job_id: input.server_job_id,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      token: 'matrix-token-1',
    }),
    getShareToken: async (token: string) =>
      token === 'matrix-token-1'
        ? {
            auth0_id: 'auth0|matrix-org',
            server_job_id: 'job-matrix',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          }
        : null,
    deleteShareToken: async () => undefined,
  }),
  generateShareToken: () => 'matrix-token-1',
  DEFAULT_EXPIRES_HOURS: 72,
}))

mock.module('../src/lib/mailer', () => ({  emailConfigured: () => true,
  isDeliverableAddress: (v: unknown) => typeof v === 'string' && v.includes('@'),
  escapeHtml: (v: unknown) => String(v ?? ''),
  inviteEmail: () => ({ subject: 'invite', html: '<p>invite</p>', text: 'invite' }),
  reportEmail: () => ({ subject: 'report', html: '<div>r</div>', text: 'r' }),
  attendanceEmail: () => ({ subject: 'attendance', html: '<table></table>', text: 'a' }),
  digestEmail: () => ({ subject: 'digest', html: '<div>d</div>', text: 'd' }),
  sendEmail: async () => ({ id: 'stub' }),
}))

// Silence access/error logs: 1300 requests would bury the result line.
mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (/insert into audit_logs/.test(sql)) return []
      // Privacy queue before org_members: its subselects name both tables.
      if (/from privacy_requests/.test(sql)) {
        return [{ ...ROW_BY_TABLE.privacy_requests }]
      }
      // Membership + identity.
      if (/from org_members/.test(sql)) {
        // getMemberRole (role by sub), setOrgMemberRole pre-read (by row
        // id), and listOrgMembers (full list).
        if (/select role/.test(sql)) {
          const byId = values.find(
            (v) => typeof v === 'string' && MEMBER_BY_ID[v],
          ) as string | undefined
          if (byId) return [{ role: MEMBER_BY_ID[byId].role }]
          const sub = values.find((v) => typeof v === 'string' && v !== ORG)
          const role = typeof sub === 'string' ? ROLE_OF[sub] : undefined
          // Other-org member holds no role here.
          return role && sub !== SUB.other ? [{ role }] : []
        }
        // Filtered lookups (findActiveMemberRowId, getOrgMember, the
        // offboard claim) name the member in values; the list reads all.
        const wanted = values.find(
          (v) => typeof v === 'string' && (MEMBER_BY_SUB[v] ?? MEMBER_BY_ID[v]),
        ) as string | undefined
        if (wanted) {
          const hit = MEMBER_BY_SUB[wanted] ?? MEMBER_BY_ID[wanted]
          return [{ ...hit }]
        }
        // A member-sub-shaped value that matches nobody is a stranger, not
        // the whole roster (findActiveMemberRowId for outsiders).
        const stranger = values.find(
          (v) => typeof v === 'string' && v.includes('auth0|') && v !== ORG && !MEMBER_BY_SUB[v],
        )
        if (stranger && values.length > 1) return []
        return MEMBERS.map((m) => ({ ...m }))
      }
      if (/from users/.test(sql)) {
        const sub = values.find((v) => typeof v === 'string')
        const known = [ORG, SUB.coach, SUB.player, SUB.other].includes(sub as string)
        return known
          ? [{ auth0_id: sub, email: `${sub}@matrix.test`, email_verified: true }]
          : []
      }
      if (/insert into users/.test(sql)) {
        return [{ auth0_id: values[0] ?? ORG, email: 'new@matrix.test', email_verified: true }]
      }
      // Teams.
      if (/from teams/.test(sql)) {
        const id = values.find((v) => typeof v === 'string' && v.startsWith('00000000'))
        const rows = TEAMS.filter((t) => t.org_auth0_id === ORG)
        return (id ? rows.filter((t) => t.id === id) : rows).map((t) => ({ ...t }))
      }
      if (/team_memberships/.test(sql)) {
        if (/^delete/i.test(sql.trim())) return [{ id: 'matrix-row' }]
        if (/^insert/i.test(sql.trim())) {
          const teamId = values.find(
            (v) => typeof v === 'string' && v.startsWith('00000000'),
          )
          return [
            {
              id: '00000000-0000-4000-8000-0000000000d9',
              team_id: teamId ?? TEAM_A,
              student_id: null,
              member_auth0_id: SUB.coach,
              role: 'coach',
              created_at: new Date().toISOString(),
            },
          ]
        }
        const uuids = values.filter(
          (v) => typeof v === 'string' && v.startsWith('00000000'),
        ) as string[]
        // getTeamMembership carries [teamId, membershipId].
        if (uuids.length >= 2) {
          return [
            {
              id: uuids[1],
              team_id: uuids[0],
              student_id: null,
              member_auth0_id: SUB.coach,
              role: 'coach',
              created_at: new Date().toISOString(),
            },
          ]
        }
        const sub = values[0] as string
        return (TEAM_OF[sub] ?? []).map((team_id) => ({ team_id }))
      }
      // Scope seam.
      if (/team_id = any/.test(sql)) {
        // Org-wide callers bind NULL (the `not scoped` half admits them);
        // scoped callers bind a `{a,b}` literal to filter by.
        const literal = values.find((v) => typeof v === 'string' && v.startsWith('{')) as
          | string
          | undefined
        if (!literal) return []
        const ids = literal.slice(1, -1).split(',').filter(Boolean)
        return STUDENTS.filter((s) => ids.includes(s.team_id)).map((s) => ({ id: s.id }))
      }
      // Player link.
      if (/account_auth0_id/.test(sql)) {
        return values.includes(SUB.player)
          ? [{ id: STU_LINKED, auth0_id: ORG, account_auth0_id: SUB.player }]
          : []
      }
      // Jobs (account tree): one unfiled club analysis, fully shaped —      // downstream mappers call new Date() on its timestamps.
      if (/from analysis_history/.test(sql)) {
        const id = values.find((v) => v === JOB)
        const rows = [
          {
            server_job_id: JOB,
            engine_job_id: 'eng-1',
            auth0_id: ORG,
            student_id: '00000000-0000-4000-8000-0000000000c1',
            session_token: null,
            player_index: null,
            model: 'm',
            stage: 5,
            stage_name: 'done',
            progress: 100,
            complete: true,
            video_ready: false,
            summary_json: {},
            error_code: null,
            error_message: null,
            requested_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            download_count: 0,
            display_name: null,
            requested_by: null,
          },
        ]
        return id ? rows : rows
      }
      // Org settings row, fully shaped (mappers call new Date on it).
      if (/organizations/.test(sql)) {
        return [
          {
            name: 'Matrix Club',
            timezone: 'UTC',
            created_at: new Date().toISOString(),
          },
        ]
      }
      // Students: by-id filters by id, the list reads everything. Selects
      // only: updates carry a `(select ... from students)` subselect whose
      // values must not be read as the lookup id.
      if (/from students/.test(sql) && /^\s*select/i.test(sql)) {
        const id = values.find(
          (v) => typeof v === 'string' && v !== ORG && !String(v).startsWith('{'),
        ) as string | undefined
        const rows = STUDENTS.map((s) => ({ ...s, auth0_id: ORG }))
        return id ? rows.filter((r) => r.id === id) : rows
      }
      // Report reads scope in SQL. Placeholders run [auth0Id, id, scoped,
      // scopeParam] (same order as values — never locate by type), so a
      // scoped caller whose list lacks the report's student reads 404.
      if (/from reports/.test(sql) && /student_id = any/.test(sql)) {
        const row = ROW_BY_TABLE.reports
        if (values[2] === true) {
          const literal = values[3]
          if (typeof literal !== 'string' || !literal.includes(row.student_id as string)) {
            return []
          }
        }
        const id = values.find((v) => typeof v === 'string' && v.startsWith('00000000'))
        return [{ ...row, id: (id as string) ?? (row.id as string) }]
      }
      // Settings upserts: selects find nothing (defaults), inserts echo a
      // shaped row (mappers call new Date on updated_at).
      if (/notification_preferences/.test(sql)) {
        if (/^select/i.test(sql.trim())) return []
        return [
          {
            in_app: values[1] ?? true,
            cadence: values[2] ?? 'instant',
            events: values[3] ?? {},
            updated_at: new Date().toISOString(),
            last_digest_at: null,
          },
        ]
      }
      if (/user_settings/.test(sql)) {
        if (/^select/i.test(sql.trim())) return []
        return [
          {
            theme: values[1] ?? 'system',
            reduce_motion: values[2] ?? false,
            week_starts_monday: values[3] ?? false,
            updated_at: new Date().toISOString(),
          },
        ]
      }
      if (/insert into privacy_requests/.test(sql)) {
        return [
          {
            id: '00000000-0000-4000-8000-0000000000e9',
            auth0_id: values[0],
            request_type: values[1],
            status: 'received',
            created_at: new Date().toISOString(),
            resolved_at: null,
          },
        ]
      }
      // Every other table: selects answer the fixture row, writes succeed.
      // Table name is the first `from <table>` / `into <table>` / `update <table>`.
      const table =
        /from (\w+)/.exec(sql)?.[1] ??
        /insert into (\w+)/.exec(sql)?.[1] ??
        /update (\w+)/.exec(sql)?.[1] ??
        /delete from (\w+)/.exec(sql)?.[1]
      if (table && ROW_BY_TABLE[table]) {
        const row = ROW_BY_TABLE[table]
        // Reads filter by id (unknown id → nothing); writes carry foreign
        // keys in values (team_id, student_id), which must NOT be compared
        // against the row id — echo the requested id instead.
        if (/^select/i.test(sql.trim())) {
          const id = values.find((v) => typeof v === 'string' && v.startsWith('00000000'))
          if (id && row.id !== id && table !== 'analysis_history') return []
          return [{ ...row, id: (id as string) ?? row.id }]
        }
        return [{ ...row }]
      }
      // Consent upsert: the select finds nothing (all-denied default), the
      // insert echoes a shaped row — toConsent calls new Date() on
      // updated_at, so the generic {id} mutation row would throw Invalid Date.
      if (/player_consents/.test(sql)) {
        if (/^select/i.test(sql.trim())) return []
        return [
          {
            student_id: values[0],
            training_data: values[1] ?? false,
            medical_data: values[2] ?? false,
            marketing: values[3] ?? false,
            policy_version: values[4] ?? 'v1',
            updated_at: new Date().toISOString(),
          },
        ]
      }
      if (/^(delete|update|insert)/i.test(sql.trim())) return [{ id: 'matrix-row' }]
      return []
    }
    const db = Object.assign(tag, {
      begin: (fn2: (tx: unknown) => unknown) => fn2(tag),
      // Fragment interpolation (single string) vs real queries (with values).
      unsafe: (sql: unknown, ...values: unknown[]) =>
        values.length > 0 ? [{ id: 'matrix-row' }] : sql,
    })
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => {
    // Reads AND writes flow through the nullable wrapper too
    // (linkAnalysisToStudent, consentForStudent): it needs the same recorder.
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (/from analysis_history/.test(sql)) {
        return [
          {
            server_job_id: JOB,
            engine_job_id: 'eng-1',
            auth0_id: ORG,
            student_id: '00000000-0000-4000-8000-0000000000c1',
            session_token: null,
            player_index: null,
            model: 'm',
            stage: 5,
            stage_name: 'done',
            progress: 100,
            complete: true,
            video_ready: false,
            summary_json: {},
            error_code: null,
            error_message: null,
            requested_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            download_count: 0,
            display_name: null,
            requested_by: null,
          },
        ]
      }
      if (/update analysis_history/.test(sql)) {
        return [
          {
            server_job_id: JOB,
            auth0_id: ORG,
            student_id: STU_A,
            summary_json: {},
            requested_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        ]
      }
      if (/from player_consents/.test(sql)) return []
      // Identity: echo the requested id so account-tree reads resolve.
      // Selects and the profile update both answer the same shape.
      if (/users/.test(sql)) {
        const sub =
          (values.find((v) => typeof v === 'string' && v.includes('auth0|')) as string | undefined) ??
          (values.find((v) => typeof v === 'string') as string | undefined)
        if (!sub) return []
        return [
          {
            auth0_id: sub,
            email: `${sub}@matrix.test`,
            email_verified: true,
            linked_auth0_ids: [],
            name: 'Matrix',
            nickname: null,
            picture: null,
          },
        ]
      }
      // Clip writes: echo a shaped row (createClip maps the insert return).
      if (/insert into clips/.test(sql)) {
        return [
          {
            id: 'clip-1',
            server_job_id: values[0],
            finding_id: values[1] ?? null,
            label: values[2],
            start_ms: values[3],
            end_ms: values[4],
            created_by: values[5] ?? null,
            created_at: new Date().toISOString(),
          },
        ]
      }
      // Notification reads echo the requested id; clip deletes drop the clip.
      if (/notifications/.test(sql)) {
        const id =
          (values.find((v) => typeof v === 'string' && v.startsWith('00000000')) as
            | string
            | undefined) ?? 'notif'
        return [{ id, auth0_id: ORG, read_at: new Date().toISOString() }]
      }
      if (/delete from clips/.test(sql)) return [{ id: 'clip-1' }]
      return []
    }
    const db = Object.assign(tag, {
      begin: (fn2: (tx: unknown) => unknown) => fn2(tag),
      unsafe: (sql: unknown, ...vals: unknown[]) => (vals.length > 0 ? [{ id: 'matrix-row' }] : sql),
    })
    return fn(db)
  },
  orDisabledDefault: <T>(v: T | null, f: T) => (v ?? f),
  historyStoreEnabled: () => true,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

process.env.SERVICE_TOKEN = 'matrix-token'
process.env.DATABASE_URL = ''

const { buildApp } = await import('../src/app')
const app = buildApp()

type AppRoute = { method: string; path: string }
const routes = (app as unknown as { routes: AppRoute[] }).routes.filter(
  (r) => !MATRIX_EXCLUDED.some((x) => x.pattern.test(`${r.method} ${r.path}`)),
)

const IDS: Record<string, string> = {
  auth0Id: ORG,
  orgAuth0Id: ORG,
  id: STU_A,
  jobId: 'job-matrix',
  teamId: TEAM_A,
  membershipId: '00000000-0000-4000-8000-0000000000d1',
  clipId: '00000000-0000-4000-8000-0000000000d2',
  findingId: 'job-matrix:e1',
  reportJobId: 'report-matrix',
  token: 'matrix-token-1',
  sessionToken: '00000000-0000-4000-8000-0000000000d3',
  sport: 'basketball',
}

const fillPath = (template: string, params?: Record<string, string>): string => {
  const merged = { ...IDS, ...params }
  return template.replace(/:([A-Za-z0-9]+)/g, (_m, name: string) => {
    const value = merged[name]
    if (value === undefined) throw new Error(`no fixture id for :${name} in ${template}`)
    return encodeURIComponent(value)
  })
}

const headersFor = (role: MatrixRole): Record<string, string> => {
  if (role === 'anonymous') return {}
  return {
    'x-service-token': 'matrix-token',
    'x-verified-auth0-id': SUB[role as keyof typeof SUB],
  }
}

const failures: Array<{ route: string; role: MatrixRole; variant?: string; expected: number; got: number | string }> = []
const uncovered: string[] = []
let total = 0

const runCase = async (
  method: string,
  path: string,
  role: MatrixRole,
  expected: number,
  body?: unknown,
  variant?: string,
): Promise<void> => {
  total += 1
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...headersFor(role),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      }),
    )
    const text = await res.text().catch(() => null)
    if (res.status !== expected) {
      failures.push({
        route: `${method} ${path}`,
        role,
        variant,
        expected,
        got: `${res.status} ${(text ?? '').slice(0, 160)}`,
      })
    }
  } catch (error) {
    failures.push({
      route: `${method} ${path}`,
      role,
      variant,
      expected,
      got: error instanceof Error ? `THREW ${error.message}` : 'THREW',
    })
  } finally {
    clearTimeout(timer)
  }
}

for (const route of routes) {
  const key = `${route.method} ${route.path}`
  if (process.env.MATRIX_ONLY && !key.includes(process.env.MATRIX_ONLY)) continue
  const entry = MATRIX.find((e) => e.method === route.method && e.path === route.path)
  if (!entry) {
    uncovered.push(key)
    continue
  }
  for (const role of Object.keys(entry.expect) as MatrixRole[]) {
    await runCase(
      entry.method,
      fillPath(entry.path, entry.params) + (entry.query ?? ''),
      role,
      entry.expect[role],
      entry.body,
    )
  }
  for (const variant of entry.variants ?? []) {
    for (const role of Object.keys(variant.expect) as MatrixRole[]) {
      await runCase(
        entry.method,
        fillPath(entry.path, { ...entry.params, ...variant.params }) + (variant.query ?? ''),
        role,
        variant.expect[role],
        variant.body ?? entry.body,
        variant.name,
      )
    }
  }
}

console.log(JSON.stringify({ failures: failures.slice(0, 60), failureCount: failures.length, uncovered, total }))
