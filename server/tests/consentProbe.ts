// Consent enforcement gates in a fresh process, isolated from other files'
// `mock.module` stubs. The real wellness + analysis-link routes run against a
// fixture stub store; only Redis (import-time connector) is stubbed. The gate
// mode comes from CONSENT_ENFORCEMENT per run; the fixture consent row from
// CONSENT_GRANTED=0|1. Prints { results, audits } as the last line.
//
// Env: CONSENT_CASE=wellness|link

import { mock } from 'bun:test'

const ORG = 'auth0|consent-org'
const STUDENT = '00000000-0000-4000-8000-0000000000d1'
const JOB = 'job-consent-probe'

const probeCase = process.env.CONSENT_CASE ?? ''
if (!probeCase) {
  console.error('CONSENT_CASE must be set')
  process.exit(1)
}
const granted = process.env.CONSENT_GRANTED === '1'

const audits: Array<{ sql: string; values: unknown[] }> = []

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

mock.module('../src/lib/historyStore', () => {
  // One recorder for both wrappers: consentForStudent and
  // linkAnalysisToStudent read through the nullable withHistoryStore, so a
  // hollow stub there answers every read as empty.
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    if (/insert into audit_logs/.test(sql)) {
      audits.push({ sql, values })
      return []
    }
    if (/from player_consents/.test(sql)) {
      return granted
        ? [
            {
              student_id: STUDENT,
              training_data: true,
              medical_data: true,
              marketing: false,
              policy_version: '2026-09-26',
              updated_at: new Date().toISOString(),
            },
          ]
        : []
    }
    if (/from analysis_history/.test(sql)) {
      return [{ server_job_id: JOB, auth0_id: ORG, student_id: null }]
    }
    if (/update analysis_history/.test(sql)) {
      return [{ server_job_id: JOB, auth0_id: ORG, student_id: STUDENT }]
    }
    if (/from students/.test(sql)) {
      return [{ id: STUDENT, auth0_id: ORG, full_name: 'Consent Test' }]
    }
    if (/insert into wellness_checkins/.test(sql)) {
      return [{ id: 'w1' }]
    }
    return []
  }
  const dbOf = () =>
    Object.assign(tag, {
      begin: (fn2: (tx: unknown) => unknown) => fn2(tag),
      unsafe: (sql: unknown) => sql,
    })
  return {
    withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(dbOf()),
    withHistoryStore: async (fn: (db: unknown) => unknown) => fn(dbOf()),
    orDisabledDefault: <T>(v: T | null, f: T) => (v ?? f),
    shutdownHistoryStore: async () => undefined,
    setHistoryStoreConnectionForTests: () => () => undefined,
    ensureInitialized: async () => undefined,
  }
})

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { default: wellnessRoutes } = await import('../src/routes/org/wellness')
const { default: studentsRoutes } = await import('../src/routes/org/students')

const results: Array<{ name: string; status: number }> = []

if (probeCase === 'wellness') {
  const res = await wellnessRoutes.handle(
    new Request(`http://localhost/api/org/${ORG}/students/${STUDENT}/wellness`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': ORG },
      body: JSON.stringify({ availability: 'fit' }),
    }),
  )
  await res.text().catch(() => null)
  results.push({ name: 'wellness', status: res.status })
} else if (probeCase === 'link') {
  const res = await studentsRoutes.handle(
    new Request(`http://localhost/api/org/${ORG}/analyses/${JOB}/student`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': ORG },
      body: JSON.stringify({ student_id: STUDENT }),
    }),
  )
  await res.text().catch(() => null)
  results.push({ name: 'link', status: res.status })
} else {
  console.error(`unknown case ${probeCase}`)
  process.exit(1)
}

console.log(
  JSON.stringify({
    results,
    consentAudits: audits.filter((a) => a.values.includes('player_consent')).length,
  }),
)
