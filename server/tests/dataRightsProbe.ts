// Data-rights route cases in a fresh process, isolated from other files'
// `mock.module` stubs. The real dataRights routes run against a fixture stub
// store; only Redis (import-time connector, quota-exhausted) is stubbed.
// Prints { results, audits } as the last line.
//
// Env: DATARIGHTS_CASE=floor|export|csv|queue|transitions|execute-guards

import { mock } from 'bun:test'

const ORG = 'auth0|dr-org'
const COACH = 'auth0|dr-coach'
const PLAYER = 'auth0|dr-player'
const STRANGER = 'auth0|dr-stranger'
const STUDENT = '00000000-0000-4000-8000-0000000000d1'
const REQ_DELETE = '00000000-0000-4000-8000-0000000000e1'
const REQ_EXPORT = '00000000-0000-4000-8000-0000000000e2'
const REQ_FOREIGN = '00000000-0000-4000-8000-0000000000e3'

const probeCase = process.env.DATARIGHTS_CASE ?? ''
if (!probeCase) {
  console.error('DATARIGHTS_CASE must be set')
  process.exit(1)
}

const audits: Array<{ sql: string; values: unknown[] }> = []

const requestRows = [
  {
    id: REQ_DELETE,
    auth0_id: PLAYER,
    request_type: 'delete',
    status: 'received',
    created_at: new Date().toISOString(),
    resolved_at: null,
  },
  {
    id: REQ_EXPORT,
    auth0_id: PLAYER,
    request_type: 'export',
    status: 'in_progress',
    created_at: new Date().toISOString(),
    resolved_at: null,
  },
  {
    id: REQ_FOREIGN,
    auth0_id: STRANGER,
    request_type: 'delete',
    status: 'received',
    created_at: new Date().toISOString(),
    resolved_at: null,
  },
]

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (/insert into audit_logs/.test(sql)) {
        audits.push({ sql, values })
        return []
      }
      if (/from privacy_requests/.test(sql)) {
        // The org queue (subselects over students/org_members) vs by-id read.
        if (/where id =/.test(sql)) {
          return requestRows.filter((r) => values.includes(r.id))
        }
        return requestRows.filter((r) => r.auth0_id === PLAYER)
      }
      if (/update privacy_requests/.test(sql)) {
        const id = values[values.length - 1] as string
        const row = requestRows.find((r) => r.id === id)
        if (!row) return []
        const next = values[0] as string
        row.status = next
        return [{ ...row }]
      }
      if (/from org_members/.test(sql)) {
        return values.includes(COACH) ? [{ role: 'coach' }] : []
      }
      if (/account_auth0_id/.test(sql)) {
        return [{ id: STUDENT, auth0_id: ORG, account_auth0_id: PLAYER }]
      }
      return []
    }
    const db = Object.assign(tag, {
      begin: (fn2: (tx: unknown) => unknown) => fn2(tag),
      unsafe: (sql: unknown) => sql,
    })
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => {
    const db = Object.assign(() => [], { begin: (fn2: (tx: unknown) => unknown) => fn2(() => []) as never, unsafe: (sql: unknown) => sql })
    return fn(db)
  },
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { default: dataRights } = await import('../src/routes/org/dataRights')

const call = async (
  method: string,
  path: string,
  verified: string,
  body?: unknown,
): Promise<{ status: number; body: string; contentType: string | null }> => {
  const res = await dataRights.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': verified },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return {
    status: res.status,
    body: await res.text().catch(() => ''),
    contentType: res.headers.get('content-type'),
  }
}

const results: Array<{ name: string; status: number; extra?: unknown }> = []

switch (probeCase) {
  case 'floor': {
    // A team coach is neither owner nor admin: every data-rights route refuses.
    for (const [name, method, path, body] of [
      ['export', 'GET', `/api/org/${ORG}/export`, undefined],
      ['queue', 'GET', `/api/org/${ORG}/privacy-requests`, undefined],
      ['patch', 'PATCH', `/api/org/${ORG}/privacy-requests/${REQ_DELETE}`, { status: 'in_progress' }],
      ['execute', 'POST', `/api/org/${ORG}/privacy-requests/${REQ_DELETE}/execute-delete`, undefined],
    ] as const) {
      const res = await call(method, path, COACH, body)
      results.push({ name, status: res.status })
    }
    break
  }
  case 'export': {
    const json = await call('GET', `/api/org/${ORG}/export`, ORG)
    const parsed = JSON.parse(json.body) as { formatVersion: number; roster: unknown[] }
    results.push({
      name: 'json',
      status: json.status,
      extra: { formatVersion: parsed.formatVersion, roster: parsed.roster },
    })
    const badFormat = await call('GET', `/api/org/${ORG}/export?format=xml`, ORG)
    results.push({ name: 'bad-format', status: badFormat.status })
    const badSection = await call('GET', `/api/org/${ORG}/export?format=csv`, ORG)
    results.push({ name: 'bad-section', status: badSection.status })
    const csv = await call(
      'GET',
      `/api/org/${ORG}/export?format=csv&section=roster`,
      ORG,
    )
    results.push({
      name: 'csv',
      status: csv.status,
      extra: { contentType: csv.contentType, head: csv.body.slice(0, 60) },
    })
    break
  }
  case 'queue': {
    // A stranger's request is not in this org's queue: 404, not 403.
    const patch = await call(
      'PATCH',
      `/api/org/${ORG}/privacy-requests/${REQ_FOREIGN}`,
      ORG,
      { status: 'in_progress' },
    )
    results.push({ name: 'foreign-patch', status: patch.status })
    const list = await call('GET', `/api/org/${ORG}/privacy-requests`, ORG)
    const parsed = JSON.parse(list.body) as { requests: Array<{ id: string }> }
    results.push({
      name: 'list',
      status: list.status,
      extra: parsed.requests.map((r) => r.id).sort(),
    })
    break
  }
  case 'transitions': {
    // received → completed skips in_progress: illegal.
    const skip = await call('PATCH', `/api/org/${ORG}/privacy-requests/${REQ_DELETE}`, ORG, {
      status: 'completed',
    })
    results.push({ name: 'skip', status: skip.status })
    const start = await call('PATCH', `/api/org/${ORG}/privacy-requests/${REQ_DELETE}`, ORG, {
      status: 'in_progress',
    })
    results.push({ name: 'start', status: start.status })
    const badValue = await call('PATCH', `/api/org/${ORG}/privacy-requests/${REQ_DELETE}`, ORG, {
      status: 'archived',
    })
    results.push({ name: 'bad-value', status: badValue.status })
    break
  }
  case 'execute-guards': {
    // An export-type request cannot be executed…
    const wrongType = await call(
      'POST',
      `/api/org/${ORG}/privacy-requests/${REQ_EXPORT}/execute-delete`,
      ORG,
    )
    results.push({ name: 'wrong-type', status: wrongType.status })
    // …and a delete still in `received` needs the human review step first.
    const tooEarly = await call(
      'POST',
      `/api/org/${ORG}/privacy-requests/${REQ_DELETE}/execute-delete`,
      ORG,
    )
    results.push({ name: 'too-early', status: tooEarly.status })
    break
  }
  default:
    console.error(`unknown case ${probeCase}`)
    process.exit(1)
}

console.log(JSON.stringify({ results, audits: audits.map((a) => a.values[2]) }))
