// Download audit probe: the video.exported audit must name the owning org
// on BOTH paths — live Redis mapping (resolved via lookup) and expired
// mapping (persisted row). Prints captured audit orgs as the last line.
// Mocks: jobs, analyses, audit, ratelimit, logger. Engine fetch stubbed.

import { mock } from 'bun:test'

const MODE = process.env.DOWNLOAD_AUDIT_CASE ?? 'live'

mock.module('../src/lib/jobs', () => ({
  getJob: async () =>
    MODE === 'live'
      ? {
          server_job_id: 'srv-1',
          engine_job_id: 'eng-1',
          session_token: null,
          player_index: null,
          model: 'm',
          created_at: Date.now(),
          owner_ids: [],
        }
      : null,
}))

mock.module('../src/lib/analyses', () => ({
  markAnalysisDownloaded: async () => undefined,
  getAnalysisByServerJobId: async () => ({
    server_job_id: 'srv-1',
    auth0_id: 'auth-coach-1',
    requested_by: null,
    engine_job_id: 'eng-1',
    summary_json: {},
    display_name: null,
    requested_at: new Date().toISOString(),
    model: 'm',
    video_ready: true,
  }),
}))

const audited: Array<{ org: string }> = []
mock.module('../src/lib/audit', () => ({
  auditRoute: (
    _request: unknown,
    orgAuth0Id: string,
    _action: string,
    _resource: string,
    _id: string | null,
    _meta?: unknown,
    _actor?: unknown,
  ) => {
    audited.push({ org: orgAuth0Id })
  },
}))

mock.module('../src/lib/ratelimit', () => ({
  checkDownloadLimit: async () => ({ allowed: true, reset: Date.now() + 60_000, remaining: 59 }),
  getIP: () => '127.0.0.1',
  rateLimited: (set: { status?: number | string }, message: string) => {
    set.status = 429
    return { error: message }
  },
}))

mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

process.env.SERVICE_TOKEN = 'audit-token'
process.env.DATABASE_URL = ''
process.env.ENGINE_URL = ''

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('fake-video-bytes'))
    controller.close()
  },
})
const realFetch = globalThis.fetch
globalThis.fetch = (async () =>
  new Response(stream, {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': '17' },
  })) as typeof fetch

const { downloadRoute } = await import('../src/routes/download')
const res = await downloadRoute().handle(
  new Request('http://localhost/api/download/srv-1', {
    headers: {
      'x-service-token': 'audit-token',
      'x-verified-auth0-id': 'auth-coach-1',
    },
  }),
)
await res.text().catch(() => null)
globalThis.fetch = realFetch

console.log(JSON.stringify({ status: res.status, audited }))
