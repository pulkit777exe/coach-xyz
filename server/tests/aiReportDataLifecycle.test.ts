import { describe, expect, mock, test } from 'bun:test'
import type { SQL } from 'bun'

// ── aiReportData.ts: the report-job lifecycle and the engine adapter ─────────
//
// This module is the seam between Redis (the job record an SSE route polls) and
// Postgres (the durable report row), plus the engine adapter that produces the
// report text. Nothing in the suite touched it, so all of it was unproven:
// `initAiReportJob` / `updateAiReportJob` / `getAiReportJob`,
// `publishAiReportJob`'s failure handler, and every branch of `generateAiReport`.
//
// `generateAiReport` is where the pass-through posture is decided, and the
// branches are easy to get wrong in a way that only shows up during an outage:
//
//   • a 2xx body is returned AS-IS — the caller parses the report, so an engine
//     that answers `{report, raw}` must not be re-wrapped,
//   • a non-2xx passes the ENGINE's code/message/retryable through and only
//     SYNTHESIZES them when the body has none (a proxy stripped it) — and a 429
//     synthesizes GEMINI_QUOTA_EXCEEDED, which is a different product message
//     from UNKNOWN,
//   • `retryable` synthesizes to `status >= 500`, so a 4xx is not retried and a
//     5xx is,
//   • "the engine never answered" (a connectivity failure) becomes a STATUSLESS
//     ENGINE_UNAVAILABLE, which is how a route tells "engine said no" from
//     "engine is gone",
//   • anything else propagates unchanged rather than being flattened into a
//     connectivity error.
//
// `lib/redis` and `lib/logger` are stubbed, and `lib/serverEvents` is stubbed on
// top of its REAL exports (spread, then overridden) so a partial mock cannot fail
// the whole module graph with "Export named … not found". All three are
// registered BEFORE the dynamic import: a static import binds the real modules
// first and the mocks then apply to nothing.

type LogLine = { level: string; event: string; meta: Record<string, unknown> }
const logs: LogLine[] = []
const loggerStub = {
  debug: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'debug', event, meta: meta ?? {} }),
  info: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'info', event, meta: meta ?? {} }),
  warn: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'warn', event, meta: meta ?? {} }),
  error: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'error', event, meta: meta ?? {} }),
}
mock.module('../src/lib/logger', () => ({ logger: loggerStub, createLogger: () => loggerStub }))

// ── Redis stub: a recording fake, because the KEY and the TTL are the contract ─
type Store = { get: Map<string, unknown>; set: [string, unknown, { ex?: number } | undefined][] }
let store: Store = { get: new Map(), set: [] }
let publishImpl: (job: unknown) => Promise<boolean> = async () => true
let subscribeImpl: (id: string, handler: (job: unknown) => void) => () => void = () => () => {}

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: {
    async get(key: string) {
      return store.get.get(key) ?? null
    },
    async set(key: string, value: unknown, opts?: { ex?: number }) {
      store.set.push([key, value, opts])
      store.get.set(key, value)
    },
    async del(key: string) {
      return store.get.delete(key) ? 1 : 0
    },
    async ping() {
      return 'PONG'
    },
    async rateLimitIncrement() {
      return { allowed: true, current: 0, reset: Date.now() }
    },
    async eval() {
      return 0
    },
  },
}))

const realEvents = await import('../src/lib/serverEvents')
const published: unknown[] = []
mock.module('../src/lib/serverEvents', () => ({
  ...realEvents,
  publishReportJob: (job: unknown) => {
    published.push(job)
    return publishImpl(job)
  },
  subscribeReportJob: (id: string, handler: (job: unknown) => void) => subscribeImpl(id, handler),
}))

const ai = await import('../src/lib/aiReportData')

const resetStubs = () => {
  logs.length = 0
  published.length = 0
  store = { get: new Map(), set: [] }
  publishImpl = async () => true
  subscribeImpl = () => () => {}
}

const JOB = 'rj-1'

describe('report job record: the Redis lifecycle', () => {
  test('the key is namespaced under coachai:reportjob:', () => {
    expect(ai.reportJobKey(JOB)).toBe('coachai:reportjob:rj-1')
  })

  test('initAiReportJob writes a QUEUED record with the 2h TTL and publishes it', async () => {
    resetStubs()
    const record = await ai.initAiReportJob({ report_job_id: JOB, auth0_id: 'auth0|org' })
    expect(record).toEqual({
      report_job_id: JOB,
      auth0_id: 'auth0|org',
      status: 'queued',
      report_id: null,
      error: null,
      progress: 0,
      created_at: record.created_at,
      updated_at: record.created_at, // created and updated are the same stamp
    })
    // The TTL is what keeps the record from outliving the SSE stream; and it is
    // aligned with the server job TTL (7200) on purpose.
    expect(store.set[0]![0]).toBe('coachai:reportjob:rj-1')
    expect(store.set[0]![2]).toEqual({ ex: 7200 })
    // A state write must wake connected SSE routes, including when the worker
    // and the route live on different replicas.
    expect(published).toEqual([record])
  })

  test('getAiReportJob reads the record, and an unknown id reads as null', async () => {
    resetStubs()
    expect(await ai.getAiReportJob('never-seen')).toBeNull()
    await ai.initAiReportJob({ report_job_id: JOB, auth0_id: 'auth0|org' })
    const read = await ai.getAiReportJob(JOB)
    expect(read!.status).toBe('queued')
    expect(read!.auth0_id).toBe('auth0|org')
  })

  test('updateAiReportJob MERGES a patch and bumps updated_at', async () => {
    resetStubs()
    const created = await ai.initAiReportJob({ report_job_id: JOB, auth0_id: 'auth0|org' })
    const running = await ai.updateAiReportJob(JOB, { status: 'running', progress: 40 })
    expect(running!.status).toBe('running')
    expect(running!.progress).toBe(40)
    // A merge, not a replace: auth0_id and the created stamp survive, and the
    // untouched fields keep their values.
    expect(running!.auth0_id).toBe('auth0|org')
    expect(running!.created_at).toBe(created.created_at)
    expect(running!.updated_at).toBeGreaterThanOrEqual(created.updated_at)
    expect(running!.report_id).toBeNull()

    const done = await ai.updateAiReportJob(JOB, { status: 'done', report_id: 'rep-9', progress: 100 })
    expect(done!.report_id).toBe('rep-9')
    expect((await ai.getAiReportJob(JOB))!.report_id).toBe('rep-9')
    // Every state write re-arms the TTL and republishes, so a long report does
    // not expire mid-flight and subscribers see each transition.
    expect(store.set.length).toBe(3)
    expect(published.length).toBe(3)
  })

  test('updateAiReportJob on an unknown id is null and writes nothing', async () => {
    resetStubs()
    expect(await ai.updateAiReportJob('never-seen', { status: 'done' })).toBeNull()
    expect(store.set).toEqual([])
    expect(published).toEqual([])
  })

  test('a failure patch records the engine error alongside the status', async () => {
    resetStubs()
    await ai.initAiReportJob({ report_job_id: JOB, auth0_id: 'auth0|org' })
    const failed = await ai.updateAiReportJob(JOB, {
      status: 'failed',
      error: 'AI engine is temporarily unavailable.',
    })
    expect(failed!.status).toBe('failed')
    expect(failed!.error).toBe('AI engine is temporarily unavailable.')
    expect(failed!.report_id).toBeNull()
  })

  test('a publish failure is LOGGED, not swallowed and not thrown', async () => {
    // `publishAiReportJob` is `void …catch(…)`: the Redis record is already
    // durable, so a failed wake-up must not fail the write. But it must be
    // visible — otherwise a route's SSE stream silently stops updating while
    // polling says everything is fine.
    resetStubs()
    publishImpl = async () => {
      throw new Error('redis publish failed')
    }
    const record = await ai.initAiReportJob({ report_job_id: JOB, auth0_id: 'auth0|org' })
    expect(record.status).toBe('queued') // the write still succeeded
    // The log is emitted on a later microtask (the catch is async).
    await Promise.resolve()
    await Promise.resolve()
    const err = logs.find((l) => l.event === 'report_event_publish_error')
    expect(err).toBeDefined()
    expect(err!.level).toBe('error')
    expect(err!.meta.type).toBe('report_event_publish_error')
    expect(err!.meta.report_job_id).toBe(JOB)
    expect(String(err!.meta.error)).toContain('redis publish failed')
  })

  test('a non-Error publish rejection is stringified', async () => {
    resetStubs()
    publishImpl = async () => {
      // A non-Error rejection is the point: the catch does `String(error)`.
      // eslint-disable-next-line no-throw-literal
      throw 'plain failure'
    }
    await ai.initAiReportJob({ report_job_id: JOB, auth0_id: 'auth0|org' })
    await Promise.resolve()
    await Promise.resolve()
    expect(logs.find((l) => l.event === 'report_event_publish_error')!.meta.error).toBe('plain failure')
  })

  test('subscribeAiReportJob delegates to the report-event channel and returns an unsubscriber', async () => {
    resetStubs()
    // Held in an object, not a bare `let`: TypeScript cannot see that the stub
    // ran, so `expect(seen).toBe('rj-7')` on a `let x: string | null` narrows to
    // `expected: null` and the comparison is a compile error rather than a test.
    const seen: { id?: string } = {}
    let released = 0
    subscribeImpl = (id) => {
      seen.id = id
      return () => {
        released++
      }
    }
    const off = ai.subscribeAiReportJob('rj-7', () => {})
    expect(seen.id).toBe('rj-7')
    off()
    expect(released).toBe(1)
  })
})

describe('generateAiReport: the engine adapter', () => {
  const realFetch = globalThis.fetch
  type Call = { url: string; init: RequestInit | undefined }
  let calls: Call[] = []
  let respond: (url: string) => Response | Promise<Response>

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const call = async (over: Partial<Parameters<typeof ai.generateAiReport>[0]> = {}) => {
    const run = async () =>
      ai.generateAiReport({
        report_context: { student: 'Riley' },
        report_type: 'progress',
        sport: 'basketball',
        student_name: 'Riley',
        ...over,
      })
    let thrown: unknown = null
    let result: unknown = null
    try {
      result = await run()
    } catch (error) {
      thrown = error
    }
    return { thrown, result, call: calls[0]! }
  }

  // Install/remove the stub around each test rather than in hooks, so the rest
  // of the file (and any other module in the same registry) is unaffected.
  const stubbed = async (
    responder: (url: string) => Response | Promise<Response>,
    body: () => Promise<{ thrown: unknown; result: unknown; call: Call }>,
  ) => {
    // Reset inside the helper, not at each call site: the recorded calls are the
    // subject of these assertions, and a leftover entry from an earlier case
    // makes `calls[0]` the wrong request (this file runs them in one process).
    calls = []
    respond = responder
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init })
      return respond(url)
    }) as typeof fetch
    try {
      return await body()
    } finally {
      globalThis.fetch = realFetch
    }
  }

  test('a 2xx body is returned AS-IS — no re-wrapping of the engine\'s report', async () => {
    const payload = { report: { summary: 'solid' }, raw: '{"summary":"solid"}' }
    const out = await stubbed(() => json(payload), () => call())
    expect(out.thrown).toBeNull()
    expect(out.result).toEqual(payload)
  })

  test('the engine is POSTed to /report with the payload verbatim and the service token', async () => {
    const previousToken = process.env.SERVICE_TOKEN
    process.env.SERVICE_TOKEN = 'svc-token'
    try {
      const out = await stubbed(() => json({ report: {}, raw: '' }), () => call({ report_type: 'monthly' }))
      expect(out.call.url).toEndWith('/report')
      expect(out.call.init!.method).toBe('POST')
      const headers = out.call.init!.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['x-service-token']).toBe('svc-token')
      // No request id supplied ⇒ none sent (the engine adapter forwards, it
      // does not invent).
      expect(headers['x-request-id']).toBeUndefined()
      expect(JSON.parse(out.call.init!.body as string)).toEqual({
        report_context: { student: 'Riley' },
        report_type: 'monthly',
        sport: 'basketball',
        student_name: 'Riley',
      })
    } finally {
      if (previousToken === undefined) delete process.env.SERVICE_TOKEN
      else process.env.SERVICE_TOKEN = previousToken
    }
  })

  test('a supplied request id is forwarded to the engine', async () => {
    const out = await stubbed(() => json({ report: {}, raw: '' }), async () => {
      let thrown: unknown = null
      try {
        await ai.generateAiReport({ report_context: {}, report_type: 'progress' }, 'req-42')
      } catch (error) {
        thrown = error
      }
      return { thrown, result: null, call: calls[0]! }
    })
    expect((out.call.init!.headers as Record<string, string>)['x-request-id']).toBe('req-42')
  })

  test("the engine's own code/message/retryable pass through with the HTTP status stamped", async () => {
    // The pass-through posture: the engine owns code → status, so the route
    // never re-derives it. A synthesized code here would point the UI at the
    // wrong message.
    const out = await stubbed(
      () => json({ code: 'GEMINI_QUOTA_EXCEEDED', message: 'AI quota reached.', retryable: true }, 429),
      () => call(),
    )
    const err = out.thrown as { code: string; message: string; retryable: boolean; status: number; layer: string }
    expect(err.code).toBe('GEMINI_QUOTA_EXCEEDED')
    expect(err.message).toBe('AI quota reached.')
    expect(err.retryable).toBe(true)
    expect(err.status).toBe(429)
    expect(err.layer).toBe('engine')
  })

  test('retryable: false from the engine is honoured, never widened to the default', async () => {
    const out = await stubbed(
      () => json({ code: 'VIDEO_EXPIRED', message: 'gone', retryable: false }, 404),
      () => call(),
    )
    expect((out.thrown as { retryable: boolean }).retryable).toBe(false)
    expect((out.thrown as { status: number }).status).toBe(404)
  })

  test('a body-less 429 synthesizes GEMINI_QUOTA_EXCEEDED, not UNKNOWN', async () => {
    // A proxy stripped the body. The 429 still means the quota, and the product
    // message for that is "try again in a few minutes", not "something broke".
    const out = await stubbed(() => new Response('', { status: 429 }), () => call())
    const err = out.thrown as { code: string; message: string; retryable: boolean; status: number }
    expect(err.code).toBe('GEMINI_QUOTA_EXCEEDED')
    expect(err.message).toBe('AI report generation failed.')
    expect(err.retryable).toBe(false) // 4xx: not retried
    expect(err.status).toBe(429)
  })

  test('a body-less 5xx synthesizes UNKNOWN and IS retried', async () => {
    const out = await stubbed(() => new Response('', { status: 500 }), () => call())
    const err = out.thrown as { code: string; message: string; retryable: boolean; status: number }
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('AI report generation failed.')
    expect(err.retryable).toBe(true) // status >= 500
    expect(err.status).toBe(500)
  })

  test('an unparsable error body degrades to the synthesized shape, not a crash', async () => {
    const out = await stubbed(() => new Response('<html>502</html>', { status: 502 }), () => call())
    const err = out.thrown as { code: string; status: number; retryable: boolean }
    expect(err.code).toBe('UNKNOWN')
    expect(err.status).toBe(502)
    expect(err.retryable).toBe(true)
  })

  test('non-string code/message fields are ignored rather than stringified through', async () => {
    // `typeof body.code === 'string'` is the guard: an object or a number from a
    // broken proxy must not become the literal "[object Object]" a UI would show.
    const out = await stubbed(
      () => json({ code: { nested: true }, message: 42, retryable: 'yes' }, 400),
      () => call(),
    )
    const err = out.thrown as { code: string; message: string; retryable: boolean; status: number }
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('AI report generation failed.')
    expect(err.retryable).toBe(false) // status < 500, since the wire flag was not a boolean
    expect(err.status).toBe(400)
  })

  test('an unreachable engine becomes a STATUSLESS ENGINE_UNAVAILABLE', async () => {
    // The whole point of the statusless shape: a route can tell "the engine
    // answered no" (a stamped status) from "the engine never answered".
    const out = await stubbed(() => {
      throw new TypeError('fetch failed')
    }, () => call())
    const err = out.thrown as { code: string; message: string; layer: string; status?: number }
    expect(err.code).toBe('ENGINE_UNAVAILABLE')
    expect(err.message).toBe('AI engine is temporarily unavailable.')
    expect(err.layer).toBe('engine')
    expect(err.status).toBeUndefined()
  })

  test('an aborted request (the 120s timeout firing) is connectivity, not a crash', async () => {
    const out = await stubbed(() => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }, () => call())
    expect((out.thrown as { code: string }).code).toBe('ENGINE_UNAVAILABLE')
  })

  test('an ECONNREFUSED-shaped failure is connectivity too', async () => {
    const out = await stubbed(() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8001'), { code: 'ECONNREFUSED' })
    }, () => call())
    expect((out.thrown as { code: string }).code).toBe('ENGINE_UNAVAILABLE')
  })

  test('any OTHER error propagates unchanged rather than being flattened', async () => {
    // Flattening a bug in this process into "the engine is unavailable" would
    // send an operator hunting the wrong service.
    const boom = new RangeError('a real bug in this file')
    const out = await stubbed(() => {
      throw boom
    }, () => call())
    expect(out.thrown).toBe(boom)
  })

  test('a non-JSON 2xx body surfaces a parse error rather than a silent empty report', async () => {
    // Unreachable in practice (the engine always answers JSON) — pinned so the
    // honest behaviour is on record: the caller must never receive `{}` and
    // render it as "no findings".
    const out = await stubbed(() => new Response('not json', { status: 200 }), () => call())
    expect(out.thrown).not.toBeNull()
    expect(out.result).toBeNull()
  })
})

// ── Postgres half ────────────────────────────────────────────────────────────
import { describeLiveDb, useLiveTestDb } from './liveDb'

const ORG = 'auth0|aireport-org'
const STUDENT = 'ae1b0001-0000-4000-8000-0000000000a1'
const MISSING = 'ae1b0001-0000-4000-8000-0000000000ee'

let db: SQL | null = null

const resetRows = async (conn: SQL) => {
  await conn`delete from reports where auth0_id = ${ORG}`
  await conn`delete from attendance where auth0_id = ${ORG}`
  await conn`delete from performance_metrics where auth0_id = ${ORG}`
  await conn`delete from analysis_history where auth0_id = ${ORG}`
  await conn`delete from students where id = ${STUDENT}::uuid`
  await conn`
    insert into students (id, auth0_id, full_name, sport, "position", status)
    values (${STUDENT}::uuid, ${ORG}, 'Riley Chen', 'basketball', 'guard', 'active')
  `
  await conn`
    insert into attendance (auth0_id, student_id, session_date, status)
    values
      (${ORG}, ${STUDENT}::uuid, '2026-03-01', 'present'),
      (${ORG}, ${STUDENT}::uuid, '2026-03-02', 'present'),
      (${ORG}, ${STUDENT}::uuid, '2026-03-03', 'absent')
  `
  // One MANUAL metric that is NOT a form score, so `total_sessions` proves it
  // filters by metric_key rather than counting every point in the series.
  await conn`
    insert into performance_metrics (auth0_id, student_id, metric_key, metric_value, measured_at)
    values (${ORG}, ${STUDENT}::uuid, 'elbow_angle', 165, '2026-03-02T10:00:00Z')
  `
  // requested_at is set EXPLICITLY: the column defaults to now(), which would put
  // every fixture outside the March window and quietly empty the series.
  //
  // The jsonb columns bind the OBJECT, never `${JSON.stringify(o)}::jsonb` — on
  // Bun's prepared path the string form stores a jsonb STRING, and
  // `summary_json ->> 'form_score'` on a scalar is NULL, so every form score
  // would silently vanish from the series this fixture exists to populate.
  await conn`
    insert into analysis_history (server_job_id, engine_job_id, auth0_id, model, student_id, complete, summary_json, display_name, requested_at)
    values
      ('aireport-job-1', 'eng-1', ${ORG}, 'gemini', ${STUDENT}::uuid, true, ${{ form_score: 7 }}::jsonb, 'Dunk', '2026-03-01T10:00:00Z'),
      ('aireport-job-2', 'eng-2', ${ORG}, 'gemini', ${STUDENT}::uuid, true, ${{ form_score: 8 }}::jsonb, 'Layup', '2026-03-02T10:00:00Z'),
      ('aireport-job-3', 'eng-3', ${ORG}, 'gemini', ${STUDENT}::uuid, true, ${{ top_tips: ['a'] }}::jsonb, null, '2026-03-02T11:00:00Z')
  `
}

describeLiveDb('aiReportData: persisting the report, and the report context it feeds the engine', () => {
  useLiveTestDb({
    seed: async (conn) => {
      db = conn
      await resetRows(conn)
    },
    cleanup: async (conn) => {
      await conn`delete from reports where auth0_id = ${ORG}`
      await conn`delete from attendance where auth0_id = ${ORG}`
      await conn`delete from performance_metrics where auth0_id = ${ORG}`
      await conn`delete from analysis_history where auth0_id = ${ORG}`
      await conn`delete from students where id = ${STUDENT}::uuid`
    },
  })

  test('persistAiReportRecord keeps the raw Gemini output beside the parsed report', async () => {
    await resetRows(db!)
    const { id } = await ai.persistAiReportRecord({
      auth0_id: ORG,
      report_type: 'progress',
      title: 'Riley — March',
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      student_id: STUDENT,
      report: { summary: 'solid', bullets: ['keep the elbow down'] },
      raw: '{"summary":"solid"}',
    })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const [row] = await db!`
      select auth0_id, student_id, report_type, title, content_json
      from reports where id = ${id}::uuid
    `
    expect(row!.auth0_id).toBe(ORG)
    expect(row!.student_id).toBe(STUDENT)
    expect(row!.title).toBe('Riley — March')
    // The raw text rides along so a re-generation never has to pay for Gemini
    // again — and it must be a real jsonb OBJECT, not a jsonb string (the
    // `JSON.stringify(v)::jsonb` trap: every reader would see a non-object).
    expect(typeof row!.content_json).toBe('object')
    const [kind] = await db!`select jsonb_typeof(content_json) as t from reports where id = ${id}::uuid`
    expect(kind!.t).toBe('object')
    const content = row!.content_json as Record<string, unknown>
    expect(content.summary).toBe('solid')
    expect(content.bullets).toEqual(['keep the elbow down'])
    expect(content.raw_report).toBe('{"summary":"solid"}')
  })

  test('persistAiReportRecord writes NULL period bounds when they are absent', async () => {
    const { id } = await ai.persistAiReportRecord({
      auth0_id: ORG,
      report_type: 'attendance',
      title: 'No period',
      report: {},
      raw: '{}',
    })
    const [row] = await db!`select student_id, period_start, period_end from reports where id = ${id}::uuid`
    expect(row!.student_id).toBeNull()
    expect(row!.period_start).toBeNull()
    expect(row!.period_end).toBeNull()
  })

  test('buildReportContent for a STUDENT: the roster block is dropped and the profile kept', async () => {
    await resetRows(db!)
    const content = (await ai.buildReportContent(ORG, {
      student_id: STUDENT,
      from: '2026-03-01',
      to: '2026-03-31',
      report_type: 'progress',
    })) as Record<string, never>
    const c = content as unknown as {
      student: { id: string; full_name: string; sport: string; position: string; status: string } | null
      org: unknown
      attendance: { total_records: number; attendance_rate: number | null }
      performance: { form_score_avg: number | null; form_score_latest: number | null; total_sessions: number }
      analyses: { display_name: string | null; form_score: number | null }[]
      summary: string
      period: { label: string }
    }
    expect(c.student).toEqual({
      id: STUDENT,
      full_name: 'Riley Chen',
      sport: 'basketball',
      position: 'guard',
      status: 'active',
    })
    // A student report has no org block — the two are mutually exclusive, and
    // handing the engine an org roster inside a player's report is how one
    // player's report ends up describing the whole club.
    expect(c.org).toBeNull()
    expect(c.attendance.total_records).toBe(3)
    expect(c.attendance.attendance_rate).toBeCloseTo(66.7, 1)
    // (7 + 8) / 2 = 7.5, rounded to one decimal. `total_sessions` counts only
    // form_score points, so the third analysis (no score) and the manual
    // elbow_angle row both stay out of it.
    expect(c.performance.form_score_avg).toBe(7.5)
    expect(c.performance.form_score_latest).toBe(8)
    expect(c.performance.total_sessions).toBe(2)
    expect(c.analyses.length).toBe(3)
    // An analysis whose summary has no form_score must report null, NOT a
    // confident 0 — the `form_score` key test, one layer up.
    const scored = c.analyses.find((a) => a.display_name === 'Dunk')
    expect(scored!.form_score).toBe(7)
    const unscored = c.analyses.find((a) => a.display_name === null)
    expect(unscored!.form_score).toBeNull()
    expect(c.period.label).toBe('from Mar 1, 2026 to Mar 31, 2026')
    expect(c.summary).toContain('7.5/10')
  })

  test('buildReportContent for a student that does not exist: no crash, no student block', async () => {
    await resetRows(db!)
    // The scope seam refuses an out-of-roster id BEFORE this call, so this is the
    // residual case: an id that passed a scope check but names no student (or
    // one in another org). The aggregate must still be well formed.
    const content = (await ai.buildReportContent(ORG, { student_id: MISSING })) as {
      student: unknown
      org: unknown
      attendance: { total_records: number }
      performance: { form_score_avg: number | null }
      summary: string
    }
    expect(content.student).toBeNull()
    expect(content.org).toBeNull()
    expect(content.attendance.total_records).toBe(0)
    expect(content.performance.form_score_avg).toBeNull()
    expect(content.summary).toBe('No attendance or performance data is available for the selected period.')
  })

  test('buildReportContent ORG-WIDE carries the roster block instead of a student', async () => {
    await resetRows(db!)
    const content = (await ai.buildReportContent(ORG, {})) as {
      student: unknown
      org: { student_count: number; active_students: number } | null
      attendance: { total_records: number }
      performance: { form_score_avg: number | null; total_sessions: number }
      analyses: unknown[]
      period: { label: string }
      summary: string
    }
    expect(content.student).toBeNull()
    expect(content.org).not.toBeNull()
    expect(content.org!.student_count).toBe(1)
    expect(content.org!.active_students).toBe(1)
    // The performance series is ONLY fetched for a student report, so an
    // org-wide report has no form-score average at all — `null`, not 0 and not a
    // club-wide average. Stated because it reads like a gap otherwise.
    expect(content.performance.form_score_avg).toBeNull()
    expect(content.performance.total_sessions).toBe(0)
    expect(content.period.label).toBe('All time')
    expect(content.summary).toContain('1 student(s) on the roster')
    // With no score to quote, the summary falls back to the attendance sentence.
    expect(content.summary).toContain('Attendance rate over the period was')
  })

  test('buildReportContent honours the period label shapes the route sends', async () => {
    await resetRows(db!)
    const label = async (opts: Parameters<typeof ai.buildReportContent>[1]) =>
      ((await ai.buildReportContent(ORG, opts)) as { period: { label: string } }).period.label
    expect(await label({ report_type: 'monthly', from: '2026-03-01' })).toBe('Month of March 2026')
    expect(await label({ from: '2026-03-01' })).toBe('since Mar 1, 2026')
    expect(await label({ to: '2026-03-31' })).toBe('through Mar 31, 2026')
    expect(await label({})).toBe('All time')
  })

  test('buildReportContent falls back to the attendance sentence when no score exists', async () => {
    // Form scores come from BOTH the analyses (via safeFormScore) and manual
    // performance_metrics rows, so removing only the manual ones proves nothing —
    // this deletes every source of a score.
    await db!`delete from analysis_history where auth0_id = ${ORG}`
    await db!`delete from performance_metrics where auth0_id = ${ORG}`
    const content = (await ai.buildReportContent(ORG, { student_id: STUDENT })) as {
      performance: { form_score_avg: number | null; total_sessions: number }
      summary: string
    }
    expect(content.performance.form_score_avg).toBeNull()
    expect(content.performance.total_sessions).toBe(0)
    expect(content.summary).toContain('Attendance rate over the period was')
  })

  test('a persisted report is readable as a durable source of truth for a re-generation', async () => {
    // The reason `raw_report` is stored at all: a re-generation must not have to
    // pay for Gemini again.
    const { id } = await ai.persistAiReportRecord({
      auth0_id: ORG,
      report_type: 'progress',
      title: 'Durable',
      student_id: STUDENT,
      report: { summary: 'keep the elbow down' },
      raw: '{"summary":"keep the elbow down","model":"gemini"}',
    })
    const [row] = await db!`select content_json from reports where id = ${id}::uuid`
    const content = row!.content_json as Record<string, unknown>
    expect(content.raw_report).toContain('"model":"gemini"')
    expect(content.summary).toBe('keep the elbow down')
  })
})