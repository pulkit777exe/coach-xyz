// Org-keyed analysis admission in a fresh process, isolated from other
// files' `mock.module` stubs. The real analyze route runs against a fixture
// stub store; admission + enqueue are captured, attribution is real (minted
// with the probe's SERVICE_TOKEN). Prints { results, admitted, enqueued,
// persisted } as the last line.
//
// Env: ANALYZE_ORG_CASE=club|foreign|no-permission|legacy|anonymous

import { mock } from 'bun:test'

const COACH = 'auth0|analyze-coach'
const MEDICAL = 'auth0|analyze-medical'
const CLUB = 'auth0|analyze-club'
const FOREIGN = 'auth0|analyze-foreign'

const probeCase = process.env.ANALYZE_ORG_CASE ?? ''
if (!probeCase) {
  console.error('ANALYZE_ORG_CASE must be set')
  process.exit(1)
}

const admitted: Array<{ orgAuth0Id: string; basePriority: number }> = []
const enqueued: Array<{ owner_ids: string[] }> = []
const persisted: Array<{ auth0_id: unknown; requested_by: unknown }> = []

mock.module('../src/lib/analysisAdmission', () => ({
  admitAnalysis: async (input: { orgAuth0Id: string; basePriority: number }) => {
    admitted.push({ orgAuth0Id: input.orgAuth0Id, basePriority: input.basePriority })
    return { ok: true, priority: 5 }
  },
}))

mock.module('../src/lib/queue', () => ({
  enqueueAnalysis: async (job: { owner_ids: string[] }) => {
    enqueued.push({ owner_ids: job.owner_ids })
  },
}))

// Rate limits are a separate seam (tested elsewhere); attribution still rides
// the header so the owner resolution under test is real.
mock.module('../src/lib/ratelimit', () => ({
  checkAnalysisLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  getIP: () => '127.0.0.1',
  rateLimited: (set: { status?: number | string }, message: string) => {
    set.status = 429
    return { error: message }
  },
  checkLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkScanLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkChatLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkDownloadLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkScanProgressLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkEmailLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkAiReportLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
  checkClipLimit: async () => ({ allowed: true, reset: Date.now() + 1000 }),
}))

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

mock.module('../src/lib/historyStore', () => {
  const record = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    if (/from org_members/.test(sql)) {
      // listMembershipsForUser: active rows for the caller.
      const sub = values[0] as string
      if (sub === COACH) {
        return [
          { org_auth0_id: CLUB, role: 'coach', display_name: 'Club' },
          { org_auth0_id: COACH, role: 'owner', display_name: 'Self' },
        ]
      }
      if (sub === MEDICAL) {
        return [{ org_auth0_id: CLUB, role: 'medical', display_name: 'Club' }]
      }
      return []
    }
    if (/from users/.test(sql)) {
      return [{ auth0_id: values[0] }]
    }
    if (/insert into analysis_history/.test(sql)) {
      // Values parallel the insert column list: auth0_id is index 9,
      // requested_by index 10 (server_job_id, engine_job_id, session_token,
      // player_index, model, client_ip, user_agent, project_url, pub_key…).
      persisted.push({ auth0_id: values[9], requested_by: values[10] })
      return []
    }
    return []
  }
  const dbOf = () =>
    Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => record(strings, ...values),
      {
        begin: (fn2: (tx: unknown) => unknown) =>
          fn2((s: TemplateStringsArray, ...v: unknown[]) => record(s, ...v)),
        unsafe: (sql: unknown) => sql,
      },
    )
  return {
    withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(dbOf()),
    // persistAnalysisStart uses the nullable wrapper — same recorder.
    withHistoryStore: async (fn: (db: unknown) => unknown) => fn(dbOf()),
    orDisabledDefault: <T>(_v: T | null, f: T) => f,
    shutdownHistoryStore: async () => undefined,
    setHistoryStoreConnectionForTests: () => () => undefined,
    ensureInitialized: async () => undefined,
  }
})

process.env.SERVICE_TOKEN = 'probe-service-token'
process.env.DATABASE_URL = ''

const { mintAttributionToken } = await import('../src/lib/attribution')
const { default: analyzeRoute } = await import('../src/routes/analyze')

const call = async (
  body: Record<string, unknown>,
  sub: string | null,
): Promise<{ status: number }> => {
  const minted = sub ? mintAttributionToken(sub) : null
  const res = await analyzeRoute.handle(
    new Request('http://localhost/api/analyze-video', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(minted ? { 'x-attribution': minted.token } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
  await res.text().catch(() => null)
  return { status: res.status }
}

const base = { session_token: null, player_index: null }
let result: unknown
switch (probeCase) {
  case 'club':
    result = await call({ ...base, org_auth0_id: CLUB }, COACH)
    break
  case 'foreign':
    result = await call({ ...base, org_auth0_id: FOREIGN }, COACH)
    break
  case 'no-permission':
    result = await call({ ...base, org_auth0_id: CLUB }, MEDICAL)
    break
  case 'legacy':
    result = await call({ ...base }, COACH)
    break
  case 'anonymous':
    result = await call({ ...base }, null)
    break
  default:
    console.error(`unknown case ${probeCase}`)
    process.exit(1)
}

console.log(JSON.stringify({ result, admitted, enqueued, persisted }))
