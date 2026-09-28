// Member removal + self-leave route cases in a fresh process, so no other
// file's `mock.module` stubs can interfere. The real routes + real offboard
// logic run against an in-memory fixture stub; only notifications are
// recorded. Prints { results, notifications, audits } as the last line.
//
// Env: MEMBER_ROUTES_CASE=remove|remove-invalid|leave|leave-own|leave-player

import { mock } from 'bun:test'

const ORG = 'auth0|leave-org'
const COACH = 'auth0|leave-coach'
const SUCCESSOR = 'auth0|leave-successor'
const PLAYER = 'auth0|leave-player'
const T1 = '00000000-0000-4000-8000-0000000000e1'
const T2 = '00000000-0000-4000-8000-0000000000e2'
const COACH_ROW = '00000000-0000-4000-8000-0000000000f1'
const SUCCESSOR_ROW = '00000000-0000-4000-8000-0000000000f2'
const PLAYER_ROW = '00000000-0000-4000-8000-0000000000f3'
const OWNER_ROW = '00000000-0000-4000-8000-0000000000f4'

const probeCase = process.env.MEMBER_ROUTES_CASE ?? ''
if (!probeCase) {
  console.error('MEMBER_ROUTES_CASE must be set')
  process.exit(1)
}

type Member = { id: string; sub: string | null; email: string; role: string }

const members = new Map<string, Member>([
  [COACH_ROW, { id: COACH_ROW, sub: COACH, email: 'coach@example.com', role: 'coach' }],
  [SUCCESSOR_ROW, { id: SUCCESSOR_ROW, sub: SUCCESSOR, email: 'succ@example.com', role: 'head_coach' }],
  [PLAYER_ROW, { id: PLAYER_ROW, sub: PLAYER, email: 'player@example.com', role: 'player' }],
  [OWNER_ROW, { id: OWNER_ROW, sub: ORG, email: 'owner@example.com', role: 'owner' }],
])

let teamLinks: Array<{ team: string; sub: string }> = [
  { team: T1, sub: COACH },
  { team: T2, sub: COACH },
]

const notifications: Array<Record<string, unknown>> = []
const audits: Array<{ sql: string; values: unknown[] }> = []

// `lib/redis.ts` connects on import (`export const redis =
// createRedisClient()`), reached via me.ts → queue → jobs. The shared
// serverless quota is exhausted, so importing it here would burn quota and
// hang the probe in a reconnect loop. Nothing under test touches Redis, so
// the connector module is stubbed inert (every name the graph imports must
// exist — a partial mock fails the process).
mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

mock.module('../src/lib/notificationEvents', () => {  const record = (args: Record<string, unknown>) => {
    notifications.push(args)
    return Promise.resolve({ id: 'n1' })
  }
  return {
    notifyMembershipChanged: record,
    // Every other value export the route graph reaches for must exist.
    notifyAnalysisResult: record,
    notifyReportReady: record,
    notifyAttendanceRecorded: record,
    notifyAiReportFinished: record,
    analysisResultHref: () => '/player',
    NOTIFICATION_EVENT: {},
  }
})

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (/insert into audit_logs/.test(sql)) {
        audits.push({ sql, values })
        return []
      }
      if (/from users/.test(sql)) {
        const sub = values.find((v) => typeof v === 'string') as string
        return [COACH, SUCCESSOR, PLAYER, ORG].includes(sub) ? [{ auth0_id: sub }] : []
      }
      if (/for update/.test(sql)) {
        // Claim by row id: values are [org, id].
        const id = values[values.length - 1] as string
        const m = members.get(id)
        if (!m || !values.includes(ORG)) return []
        return [
          { member_auth0_id: m.sub, member_email: m.email, role: m.role, status: 'active' },
        ]
      }
      if (/from team_memberships/.test(sql) && /^select/i.test(sql.trim())) {
        const sub = values[0] as string
        return teamLinks
          .filter((l) => l.sub === sub && values.includes(ORG))
          .map((l) => ({ team_id: l.team }))
      }
      if (/delete from team_memberships/.test(sql)) {
        const sub = values[0] as string
        teamLinks = teamLinks.filter((l) => l.sub !== sub)
        return []
      }
      if (/insert into team_memberships/.test(sql)) {
        teamLinks.push({ team: values[0] as string, sub: values[1] as string })
        return [{ id: 'tm-new' }]
      }
      if (/delete from org_members/.test(sql)) {
        const id = values[values.length - 1] as string
        return members.delete(id) ? [{ id }] : []
      }
      if (/from org_members/.test(sql)) {
        if (/select role/.test(sql)) {
          const sub = values.find((v) => v === COACH || v === SUCCESSOR || v === PLAYER)
          const m = [...members.values()].find((x) => x.sub === sub)
          return m ? [{ role: m.role }] : []
        }
        if (/select id/.test(sql)) {
          const sub = values.find((v) => typeof v === 'string' && v !== ORG) as string
          const m = [...members.values()].find((x) => x.sub === sub)
          return m ? [{ id: m.id }] : []
        }
        // listOrgMembers (owner seed + full select).
        return [...members.values()].map((m) => ({
          id: m.id,
          member_auth0_id: m.sub,
          member_email: m.email,
          role: m.role,
          status: 'active',
        }))
      }
      return []
    }
    const db = Object.assign(tag, {
      begin: (fn2: (tx: unknown) => unknown) => fn2(tag),
      // `db.unsafe(fragment)` interpolates raw SQL (column lists); with values
      // it runs a real query. Only the fragment form occurs on these paths.
      unsafe: (sql: string | TemplateStringsArray, ...values: unknown[]) => {
        if (typeof sql !== 'string') return sql
        if (values.length === 0) return sql
        mutations.push({ sql, values })
        return []
      },
    })
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(() => []),
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { default: membersRoutes } = await import('../src/routes/members')
const { default: meRoutes } = await import('../src/routes/me')

const authed = (verified: string): Record<string, string> => ({
  'x-verified-auth0-id': verified,
})

const call = async (
  app: { handle: (req: Request) => Promise<Response> },
  method: string,
  path: string,
  verified: string,
): Promise<{ status: number; body: string }> => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, { method, headers: authed(verified) }),
  )
  const body = await res.text().catch(() => '')
  if (res.status >= 500) console.error(`PROBE-500 ${method} ${path}: ${body}`)
  return { status: res.status, body }
}

const results: Array<{ name: string; status: number }> = []

switch (probeCase) {
  case 'remove': {
    // Owner removes the coach with a successor, then repeats (now 404).
    const first = await call(
      membersRoutes,
      'DELETE',
      `/api/org/${ORG}/members/${COACH_ROW}?successor=${SUCCESSOR_ROW}`,
      ORG,
    )
    results.push({ name: 'remove', status: first.status })
    const repeat = await call(membersRoutes, 'DELETE', `/api/org/${ORG}/members/${COACH_ROW}`, ORG)
    results.push({ name: 'remove-repeat', status: repeat.status })
    break
  }
  case 'remove-invalid': {
    // Unknown successor and the owner row itself are both refused.
    const badSucc = await call(
      membersRoutes,
      'DELETE',
      `/api/org/${ORG}/members/${COACH_ROW}?successor=00000000-0000-4000-8000-0000000000ff`,
      ORG,
    )
    results.push({ name: 'bad-successor', status: badSucc.status })
    const owner = await call(membersRoutes, 'DELETE', `/api/org/${ORG}/members/${OWNER_ROW}`, ORG)
    results.push({ name: 'owner', status: owner.status })
    break
  }
  case 'leave': {
    // Coach leaves (custodian), then repeats (now 404).
    const first = await call(meRoutes, 'POST', `/api/me/orgs/${ORG}/leave`, COACH)
    results.push({ name: 'leave', status: first.status })
    const repeat = await call(meRoutes, 'POST', `/api/me/orgs/${ORG}/leave`, COACH)
    results.push({ name: 'leave-repeat', status: repeat.status })
    break
  }
  case 'leave-own': {
    const res = await call(meRoutes, 'POST', `/api/me/orgs/${ORG}/leave`, ORG)
    results.push({ name: 'leave-own', status: res.status })
    break
  }
  case 'leave-player': {
    const res = await call(meRoutes, 'POST', `/api/me/orgs/${ORG}/leave`, PLAYER)
    results.push({ name: 'leave-player', status: res.status })
    break
  }
  default:
    console.error(`unknown case ${probeCase}`)
    process.exit(1)
}

console.log(JSON.stringify({ results, notifications, audits }))
