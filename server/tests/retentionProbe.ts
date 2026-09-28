// Retention completeness against ephemeral Postgres, in a fresh process with
// no store mocks: the engine client is the only stub (a recorder), so the
// DB assertions prove the real queries. TEST_DATABASE_URL is forwarded.
// Throws on mismatch; prints the prune report.

import { mock } from 'bun:test'
import { SQL } from 'bun'

process.env.RETENTION_DAYS = '30'

const engineDeletes: string[] = []

// Only the engine HTTP client is stubbed: everything else is real, so the
// row assertions below prove the actual SQL (and the storage-follows-rows
// wiring) rather than the stub.
mock.module('../src/lib/engine', () => ({
  deleteResultVideo: async (engineJobId: string) => {
    engineDeletes.push(engineJobId)
    return { deleted: true }
  },
}))

const { ensureInitialized, setHistoryStoreConnectionForTests } = await import(
  '../src/lib/historyStore'
)
const { deleteAnalysis, pruneRetentionReport } = await import('../src/lib/analyses')

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const ORG = 'auth0|retention-org'
const JOB_DELETE = 'job-ret-delete'
const JOB_PRUNE = 'job-ret-prune'

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

// Idempotent pre-clean.
await db`delete from analysis_history where server_job_id in (${JOB_DELETE}, ${JOB_PRUNE});`
await db`delete from org_invites where org_auth0_id = ${ORG};`
await db`delete from notifications where auth0_id = ${ORG};`
await db`delete from analysis_stages where server_job_id in (${JOB_DELETE}, ${JOB_PRUNE}, 'orphan-stage');`

// One fresh analysis (direct delete) and one backdated for the sweep.
await db`insert into analysis_history (server_job_id, engine_job_id, model, auth0_id) values (${JOB_DELETE}, 'eng-del', 'm', ${ORG}), (${JOB_PRUNE}, 'eng-prune', 'm', ${ORG});`
await db`update analysis_history set requested_at = now() - interval '31 days' where server_job_id = ${JOB_PRUNE};`
await db`insert into org_invites (org_auth0_id, email, role, token_hash, expires_at, accepted_at) values (${ORG}, 'used@example.com', 'coach', 'hash-used', now(), now());`
await db`insert into notifications (auth0_id, type, title, created_at) values (${ORG}, 'membership', 'old', now() - interval '31 days');`
await db`insert into analysis_stages (server_job_id) values ('orphan-stage'), (${JOB_DELETE});`

const done: string[] = []

// 1. Direct delete sweeps the rendered video too.
{
  check((await deleteAnalysis(ORG, JOB_DELETE)) === true, 'delete: expected true')
  check(engineDeletes.includes('eng-del'), 'delete: engine not asked')
  check(
    (await db`select server_job_id from analysis_history where server_job_id = ${JOB_DELETE};`)
      .length === 0,
    'delete: row survives',
  )
  done.push('delete')
}

// 2. The sweep prunes analyses, videos, invites, notifications, orphan stages.
{
  const report = await pruneRetentionReport()
  check(report !== null, 'prune: null report')
  check(report?.analyses === 1, `prune: analyses=${report?.analyses}`)
  check(engineDeletes.includes('eng-prune'), 'prune: stale video not swept')
  check((report?.invites ?? 0) >= 1, `prune: invites=${report?.invites}`)
  check((report?.notifications ?? 0) >= 1, `prune: notifications=${report?.notifications}`)
  check((report?.stages ?? 0) >= 1, `prune: stages=${report?.stages}`)
  check(
    (await db`select server_job_id from analysis_history where server_job_id = ${JOB_PRUNE};`)
      .length === 0,
    'prune: stale row survives',
  )
  check(
    (await db`select id from org_invites where org_auth0_id = ${ORG};`).length === 0,
    'prune: consumed invite survives',
  )
  done.push('prune')
}

await db.close()
console.log(JSON.stringify({ done, engineDeletes }))
