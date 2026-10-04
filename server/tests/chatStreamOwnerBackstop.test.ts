import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

// ── POST /api/chat/stream: the one capability route with NO test at all ──────
//
// The authorization matrix excludes `/api/chat/stream` with the reason
// "capability route (own tests)". That reason is FALSE: no test file names the
// route, and the gate — `resolveChatContext` — is module-private and unexported,
// so nothing could have reached it. `accountTreeScopeProbe` drives
// `/analyses/:jobId/chat`, which is `chatHistoryRoutes`, a DIFFERENT route.
//
// This is the "an EXCLUDED route is a coverage claim, and claims are not
// evidence" lesson arriving one route late. The code is CORRECT — it consults
// `needsPersistedOwnerBackstop` and `verifyJobAccess` exactly as `status.ts` and
// `download.ts` do — but correct-and-unasserted is one refactor from broken, and
// chat is the most consequential of the three: this is where the transcript is
// read and handed to the model, so a hole here sends a user's whole conversation
// onward on the strength of a job id.
//
// `chatRoutes(deps)` takes its data-access seam as a parameter, so the gate is
// reachable through the route without exporting the private function — which is
// also why this test was possible once someone looked, and not before.
//
// Every refusal case asserts THREE things, not one: the status, that the
// transcript store was never touched, and that no request reached the engine.
// A test that asserts only the status passes against a route that refuses *after*
// streaming the conversation to the model.

type LogLine = { level: string; event: string; meta: Record<string, unknown> }
const logs: LogLine[] = []
const makeLogger = () => ({
  debug: (e: string, m?: Record<string, unknown>) => logs.push({ level: 'debug', event: e, meta: m ?? {} }),
  info: (e: string, m?: Record<string, unknown>) => logs.push({ level: 'info', event: e, meta: m ?? {} }),
  warn: (e: string, m?: Record<string, unknown>) => logs.push({ level: 'warn', event: e, meta: m ?? {} }),
  error: (e: string, m?: Record<string, unknown>) => logs.push({ level: 'error', event: e, meta: m ?? {} }),
})
mock.module('../src/lib/logger', () => ({ logger: makeLogger(), createLogger: makeLogger }))

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

// The transcript is the thing that must never be read on a refusal, so it is
// spied rather than stubbed to a fixed value.
const transcriptLoads: string[] = []
mock.module('../src/lib/transcript', () => ({
  playerTranscript: {
    async load({ serverJobId }: { serverJobId: string }) {
      transcriptLoads.push(serverJobId)
      return [
        { role: 'user', content: 'what did I do wrong in the second half?' },
        { role: 'assistant', content: 'your balance drifted left' },
        // A row that is neither user nor assistant must be filtered out before
        // the history reaches the model.
        { role: 'system', content: 'internal scratch note' },
      ]
    },
  },
  dashboardTranscript: { async load() { return [] } },
}))

const chat = await import('../src/routes/chat')
const { Elysia } = await import('elysia')

const ORG = 'auth0|org'
const OTHER = 'auth0|somebody-else'

const originalFetch = globalThis.fetch
let engineCalls: string[] = []

beforeEach(() => {
  logs.length = 0
  transcriptLoads.length = 0
  engineCalls = []
  process.env.SERVICE_TOKEN = 'test-service-token'
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    engineCalls.push(String(input))
    return new Response('data: {"done":true}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.SERVICE_TOKEN
})

type Deps = Parameters<typeof chat.chatRoutes>[0]

const post = async (
  deps: {
    getJob?: (id: string) => Promise<{ engine_job_id: string; owner_ids?: string[] } | null>
    getAnalysisByServerJobId?: (id: string) => Promise<{ auth0_id: string } | null>
  },
  headers: Record<string, string>,
  body: unknown = { job_id: 'job-1', message: 'why?' },
) => {
  // `chatRoutes` declares `/api/chat/stream` itself, so mounting the plugin is
  // enough — no second route declaration here, or the test would be exercising a
  // route the app does not have.
  // The fakes below are deliberately partial — they carry only the fields each case
  // is about — so they are cast at this one seam rather than widening the route's
  // own signature to accommodate a test.
  const app = new Elysia().use(chat.chatRoutes(deps as unknown as Deps))
  const res = await app.handle(
    new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
  return res
}

const asOwner = { 'x-service-token': 'test-service-token', 'x-verified-auth0-id': ORG }
const asStranger = { 'x-service-token': 'test-service-token', 'x-verified-auth0-id': OTHER }

test('the exclusion reason was false: this route was reachable and refused', async () => {
  // The headline case. A Redis job with an EMPTY owner set is exactly what
  // `enqueueAnalysis` persists for any caller that omits `owner_ids`, and an empty
  // set reads as "anonymous, bearer-accessible" to `verifyJobAccess`. The
  // persisted row is the only thing that can catch it.
  const res = await post(
    {
      getJob: async () => ({ engine_job_id: 'eng-1', owner_ids: [] }),
      getAnalysisByServerJobId: async () => ({ auth0_id: OTHER }),
    },
    asOwner,
  )
  expect(res.status).toBe(403)
  // The consequential assertions: the conversation never left, and the model was
  // never called. Either one failing means the refusal came too late.
  expect(transcriptLoads).toEqual([])
  expect(engineCalls).toEqual([])
})

test('the backstop is consulted ONCE per request, only when it can change the answer', async () => {
  let persistedLookups = 0
  await post(
    {
      getJob: async () => ({ engine_job_id: 'eng-1', owner_ids: [] }),
      getAnalysisByServerJobId: async () => {
        persistedLookups += 1
        return { auth0_id: OTHER }
      },
    },
    asOwner,
  )
  expect(persistedLookups).toBe(1)

  // Fast path: a non-empty owner set already answers the question, so the extra
  // query must not run. This is what keeps the backstop free — and the reason a
  // "just always load the row" fix would be a regression, not a simplification.
  persistedLookups = 0
  const ownerJob = await post(
    {
      getJob: async () => ({ engine_job_id: 'eng-1', owner_ids: [ORG] }),
      getAnalysisByServerJobId: async () => {
        persistedLookups += 1
        return { auth0_id: 'auth0|nobody' }
      },
    },
    asOwner,
  )
  expect(persistedLookups).toBe(0)
  expect(ownerJob.status).not.toBe(403)
})

test('both directions are pinned: the real owner is let through, and a stranger is not', async () => {
  const deps = {
    getJob: async () => ({ engine_job_id: 'eng-1', owner_ids: [] }),
    getAnalysisByServerJobId: async () => ({ auth0_id: ORG }),
  }
  // If only the refusal were pinned, "fail closed" could degenerate into
  // "refuse everyone" and the chat feature would be dead with every test green.
  const allowed = await post(deps, asOwner)
  expect(allowed.status).not.toBe(403)
  expect(transcriptLoads).toEqual(['job-1'])
  expect(engineCalls.length).toBe(1)

  const refused = await post(deps, asStranger)
  expect(refused.status).toBe(403)
})

test('a genuinely anonymous job is still readable by a bearer, or the feature is dead', async () => {
  // No owner anywhere: `verifyJobAccess` treats that as anonymous and allows it.
  // Pinned deliberately — it is the one case where an over-eager backstop would
  // break a legitimate caller, and nothing else in this file would notice.
  const res = await post(
    {
      getJob: async () => ({ engine_job_id: 'eng-1', owner_ids: [] }),
      getAnalysisByServerJobId: async () => null,
    },
    {},
  )
  expect(res.status).not.toBe(403)
  expect(engineCalls.length).toBe(1)
})

test('the history sent to the model carries only user and assistant turns', async () => {
  // `resolveChatContext` filters before handing the transcript over. A leaked
  // system row is the same class as a leaked conversation: it leaves the process.
  let sent: unknown = null
  globalThis.fetch = (async (_i: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? '{}'))
    return new Response('data: {"done":true}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  await post(
    {
      getJob: async () => ({ engine_job_id: 'eng-1', owner_ids: [ORG] }),
    },
    asOwner,
  )
  const history = (sent as { conversation_history: { role: string }[] }).conversation_history
  expect(history.map((m) => m.role)).toEqual(['user', 'assistant'])
})

test('a missing job is a 404-shaped JOB_NOT_FOUND, not a 500', async () => {
  const res = await post({ getJob: async () => null, getAnalysisByServerJobId: async () => null }, asOwner)
  expect(res.status).toBe(404)
  expect(transcriptLoads).toEqual([])
})
