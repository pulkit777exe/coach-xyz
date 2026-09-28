// Drives the real DELETE /students/:id route with a fixture-backed stub
// store, in a fresh process so no other test file's `mock.module` stubs can
// leak in (or out). Prints one JSON object per case as the last stdout line.
//
// Env: STUDENT_DELETE_CASE=malformed|out-of-scope|in-scope|foreign-org

import { mock } from 'bun:test'

const ORG = 'auth0|delete-org'
const COACH = 'auth0|delete-coach'
const TEAM = '00000000-0000-4000-8000-0000000000d1'
const STUDENT = '00000000-0000-4000-8000-0000000000d2'
const OUTSIDER = '00000000-0000-4000-8000-0000000000d3'

const probeCase = process.env.STUDENT_DELETE_CASE ?? ''
if (!probeCase) {
  console.error('STUDENT_DELETE_CASE must be set')
  process.exit(1)
}

// Only the identity layer is stubbed. The real resolveCaller, scope seam,
// getStudent/deleteStudent, and route run; the store answers from fixtures.
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === COACH ? 'coach' : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

type Mutation = { sql: string; values: unknown[] }
const mutations: Mutation[] = []
const audits: Mutation[] = []

// Which student the fixture owns under ORG (null in the foreign-org case,
// where the id belongs to another org and the org-scoped claim finds nothing).
const ownedStudent = probeCase === 'foreign-org' ? null : STUDENT

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (/insert into audit_logs/.test(sql)) {
        audits.push({ sql, values })
        return []
      }
      if (/^(delete|update|insert)/i.test(sql.trim())) {
        mutations.push({ sql, values })
        return []
      }
      if (/for update/.test(sql)) {
        const ok =
          ownedStudent !== null && values.includes(ORG) && values.includes(ownedStudent)
        return ok ? [{ id: ownedStudent }] : []
      }
      if (/team_id = any/.test(sql)) {
        // In-scope coach sees STUDENT; the out-of-scope case sees only OUTSIDER.
        return probeCase === 'out-of-scope' ? [{ id: OUTSIDER }] : [{ id: STUDENT }]
      }
      if (/from team_memberships/.test(sql)) {
        return [{ team_id: TEAM }]
      }
      if (/from students/.test(sql)) {
        return ownedStudent !== null && values.includes(ownedStudent)
          ? [{ id: ownedStudent, auth0_id: ORG, full_name: 'Dele Temme' }]
          : []
      }
      return []
    }
    const db = Object.assign(tag, { begin: (fn2: (tx: unknown) => unknown) => fn2(tag) })
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(() => []),
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: (
    _req: unknown,
    _org: string,
    action: string,
    _type: string,
    id: string,
    meta?: Record<string, unknown>,
  ) => {
    audits.push({ sql: `audit:${action}`, values: [id, meta?.full_name ?? null] })
  },
  // Every value export the route graph reaches for must be present — a partial
  // mock fails the whole probe process with "Export named ... not found".
  audit: async () => undefined,
  AUDIT_ACTIONS: [],
  listAuditLogs: async () => [],
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { default: studentsRoutes } = await import('../src/routes/org/students')

const run = async (org: string, id: string, verified: string) => {
  const res = await studentsRoutes.handle(
    new Request(`http://localhost/api/org/${org}/students/${id}`, {
      method: 'DELETE',
      headers: { 'x-verified-auth0-id': verified },
    }),
  )
  return { status: res.status, body: await res.json().catch(() => null) }
}

let result: unknown
switch (probeCase) {
  case 'malformed':
    result = await run(ORG, 'not-a-uuid', ORG)
    break
  case 'out-of-scope':
    result = await run(ORG, STUDENT, COACH)
    break
  case 'in-scope':
    result = await run(ORG, STUDENT, COACH)
    break
  case 'foreign-org':
    // Same student id shape, but the fixture owns another org's row: the
    // claim (org-scoped) finds nothing.
    result = await run(ORG, OUTSIDER, ORG)
    break
  default:
    console.error(`unknown case ${probeCase}`)
    process.exit(1)
}

console.log(JSON.stringify({ result, mutations, audits }))
