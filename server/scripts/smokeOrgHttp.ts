// HTTP-level smoke test for the coach-organization platform. Boots the real
// route handlers in-process (no port), enables the identity guard, and walks
// every org / me / email endpoint with a random identity, asserting shape +
// status codes. Cleans up its own rows at the end.
//
//   cd server && SERVICE_TOKEN=smoke bun run scripts/smokeOrgHttp.ts
//
// Requires DATABASE_URL (live history store). RESEND_API_KEY is optional — the
// email routes are exercised and are expected to return EMAIL_NOT_CONFIGURED
// when no key is present (that is the correct, reachable value).

import { Elysia } from 'elysia'

import authRoute from '../src/routes/auth'
import orgRoute from '../src/routes/org'
import membersRoute from '../src/routes/members'
import { pruneRetention } from '../src/lib/analyses'
import { deleteTeam } from '../src/lib/teams'
import teamsRoute from '../src/routes/teams'
import meRoute from '../src/routes/me'
import emailRoute from '../src/routes/email'
import shareRoute from '../src/routes/share'
import {
  ensureInitialized,
  withHistoryStore,
  withHistoryStoreOrThrow,
} from '../src/lib/historyStore'
import { globalErrorHandler } from '../src/lib/httpErrors'
import type { CoachAIError } from '../src/lib/errors'

if (!process.env.SERVICE_TOKEN) {
  console.error('SERVICE_TOKEN env not set — refusing to run with the guard disabled.')
  process.exit(1)
}

const app = new Elysia()
  .use(globalErrorHandler)
  .use(authRoute)
  .use(orgRoute)
  // teams.ts and members.ts are mounted at the top level in src/index.ts, not
  // inside routes/org. Without them the team-scope block below 404s on route
  // match rather than exercising the scope filters.
  .use(membersRoute)
  .use(teamsRoute)
  .use(meRoute)
  .use(emailRoute)
  // Share tokens are on the org tree, and the scope assertions below need the
  // route mounted to reach them.
  .use(shareRoute)

const base = 'http://smoke.test'
const token = process.env.SERVICE_TOKEN

const tag = `smokehttp-${Math.random().toString(36).slice(2, 8)}`
const coachId = `test|${tag}-coach`
const playerId = `test|${tag}-player`
const coachEmail = `${tag}+coach@example.com`
const playerEmail = `${tag}+player@example.com`
const playerName = 'Smoke Player'
let studentId = ''
let eventId = ''
let reportId = ''
let metricId = ''
let analysisId = ''

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`)
  }
}

async function call(
  method: string,
  path: string,
  opts: { identity?: string; body?: unknown; rawToken?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const pathResource = path.match(/\/api\/(?:org|email)\/([^/?]+)/)?.[1]
  const pathUser = path.match(/\/api\/auth\/user\/([^/?]+)/)?.[1]
  const bodySub =
    opts.body && typeof opts.body === 'object' && 'sub' in opts.body
      ? (opts.body as { sub: string }).sub
      : ''
  const identity = opts.identity ?? pathResource ?? pathUser ?? bodySub
  const res = await app.handle(
    new Request(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-service-token': opts.rawToken ?? token,
        'x-verified-auth0-id': identity,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  )
  let json: Record<string, unknown> | null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

const expectError = (json: unknown): json is CoachAIError =>
  Boolean(
    json &&
    typeof json === 'object' &&
    typeof (json as CoachAIError).code === 'string' &&
    typeof (json as CoachAIError).layer === 'string',
  )

async function cleanup() {
  const ids: string[] = []
  if (studentId) ids.push(studentId)
  await withHistoryStore(async (db) => {
    if (analysisId) {
      await db`delete from clips where server_job_id = ${analysisId};`.catch(() => {})
      await db`delete from player_events where server_job_id = ${analysisId};`.catch(() => {})
      await db`delete from findings where server_job_id = ${analysisId};`.catch(() => {})
      await db`delete from analysis_history where server_job_id = ${analysisId};`.catch(() => {})
    }
    if (ids.length) {
      await db`delete from students where id = any(${ids}::uuid[]);`.catch(() => {})
    }
    await db`delete from users where auth0_id in (${coachId}, ${playerId});`.catch(() => {})
    // cascade leftovers (metrics/reports/events/attendance) by coach scope
    await db`delete from performance_metrics where auth0_id = ${coachId};`.catch(() => {})
    await db`delete from reports where auth0_id = ${coachId};`.catch(() => {})
    await db`delete from schedule_events where auth0_id = ${coachId};`.catch(() => {})
    await db`delete from attendance where auth0_id = ${coachId};`.catch(() => {})
  }).catch(() => {})
  console.log('smoke_cleanup_done')
}

async function main() {
  await ensureInitialized()

  // ── Auth sync ────────────────────────────────────────────────────────────
  console.log('auth/sync')
  let r = await call('POST', '/api/auth/sync', {
    body: {
      sub: coachId,
      name: 'Smoke Coach',
      email: coachEmail,
      email_verified: true,
    },
  })
  check(
    'coach upsert returns user role=coach',
    r.status === 200 && r.json?.user?.role === 'coach',
    r.json,
  )

  // ── Students (before player sync so email link works) ────────────────────
  console.log('students')
  r = await call('GET', `/api/org/${coachId}/students`)
  check('list students (empty)', r.status === 200 && Array.isArray(r.json?.students), r.json)

  r = await call('POST', `/api/org/${coachId}/students`, {
    identity: coachId,
    body: {
      full_name: playerName,
      email: playerEmail,
      sport: 'basketball',
      position: 'PG',
      status: 'active',
      joined_on: '2026-01-15',
    },
  })
  check('create student → 201', r.status === 201 && r.json?.student?.id, r.json)
  studentId = r.json?.student?.id ?? ''

  r = await call('GET', `/api/org/${coachId}/students/${studentId}`, {
    identity: coachId,
  })
  check('get student', r.status === 200 && r.json?.student?.id === studentId, r.json)

  r = await call('PUT', `/api/org/${coachId}/students/${studentId}`, {
    identity: coachId,
    body: { jersey_number: 7, notes: 'rookie' },
  })
  check('update student', r.status === 200 && r.json?.student?.jersey_number === 7, r.json)

  r = await call('GET', `/api/org/${coachId}/students?search=Smoke&sport=basketball`)
  check('search students', r.status === 200 && r.json?.students?.length === 1, r.json)

  r = await call('GET', `/api/org/${coachId}/students/sports`)
  check('list sports', r.status === 200 && Array.isArray(r.json?.sports), r.json)

  // ── Player sync (AFTER student creation so the email link resolves) ─────
  console.log('player sync')
  r = await call('POST', '/api/auth/sync', {
    body: {
      sub: playerId,
      name: playerName,
      email: playerEmail,
      email_verified: true,
    },
  })
  check(
    'player upsert flips to role=player (email-linked)',
    r.status === 200 && r.json?.user?.role === 'player',
    r.json,
  )

  // ── Attendance ────────────────────────────────────────────────────────────
  console.log('attendance')
  r = await call('PUT', `/api/org/${coachId}/attendance`, {
    identity: coachId,
    body: {
      student_id: studentId,
      session_date: '2026-09-01',
      status: 'present',
      note: 'sharp',
    },
  })
  check('upsert attendance', r.status === 200 && r.json?.record?.status === 'present', r.json)

  r = await call('POST', `/api/org/${coachId}/attendance/batch`, {
    identity: coachId,
    body: {
      entries: [
        { student_id: studentId, session_date: '2026-09-02', status: 'late' },
        { student_id: studentId, session_date: '2026-09-03', status: 'absent' },
      ],
    },
  })
  check('batch attendance → count 2', r.status === 200 && r.json?.count === 2, r.json)

  r = await call('GET', `/api/org/${coachId}/attendance?from=2026-09-01&to=2026-09-30`)
  check('list attendance', r.status === 200 && r.json?.records?.length === 3, r.json)

  r = await call('GET', `/api/org/${coachId}/attendance/summary`)
  check(
    'attendance summary',
    r.status === 200 && typeof r.json?.summary?.attendance_rate === 'number',
    r.json,
  )

  // ── Schedule ──────────────────────────────────────────────────────────────
  console.log('schedule')
  // Dates are computed from NOW, not hardcoded. Two of these fixtures were
  // written as literal 2026-09-10 / 2026-09-11 timestamps, and they began failing
  // on 2026-10-04 for a reason that had nothing to do with the code under test:
  // `/api/me/schedule` defaults `from` to now (an all-time window would return
  // the club's ENTIRE fixture history and make the row cap truncate the OLDEST
  // page), so a past event is correctly excluded and `me schedule` answered
  // `events: []`.
  //
  // The product behaviour was right and the assertion was stale — but a fixture
  // with an expiry date is a fixture that will break again on an unrelated day,
  // and it breaks looking like a regression. Both events are now relative: one in
  // the past (to prove the past-exclusion) and one in the future (to prove the
  // default window still returns upcoming).
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

  r = await call('POST', `/api/org/${coachId}/schedule`, {
    identity: coachId,
    body: {
      title: 'Smoke Practice',
      event_type: 'practice',
      starts_at: hoursFromNow(24),
      status: 'scheduled',
    },
  })
  check('create event → 201', r.status === 201 && r.json?.event?.id, r.json)
  eventId = r.json?.event?.id ?? ''

  r = await call('PUT', `/api/org/${coachId}/schedule/${eventId}`, {
    identity: coachId,
    body: { status: 'completed' },
  })
  check('update event', r.status === 200 && r.json?.event?.status === 'completed', r.json)

  // A full edit, the body EventFormDialog always sends. The update built
  // `${k} = $n::text` for every column that was not team_id, and Postgres has
  // no assignment cast from text to timestamptz, so any edit touching a time
  // 500'd with "column starts_at is of type timestamp with time zone but
  // expression is of type text" — editing an event was impossible from the UI.
  // No fixture can catch it: they stub `db` as a plain tag function.
  const movedStartsAt = hoursFromNow(48)
  const movedEndsAt = hoursFromNow(49)
  r = await call('PUT', `/api/org/${coachId}/schedule/${eventId}`, {
    identity: coachId,
    body: {
      title: 'Smoke Practice (moved)',
      event_type: 'practice',
      starts_at: movedStartsAt,
      ends_at: movedEndsAt,
      location: 'Pitch 2',
      status: 'completed',
    },
  })
  check('edit event times → 200', r.status === 200, r.json)
  // Compared against the value that was SENT, not a literal date: the literal is
  // what made these assertions expire.
  const movedStart = new Date(movedStartsAt).getTime()
  const movedEnd = new Date(movedEndsAt).getTime()
  check(
    'edited starts_at persisted',
    r.status === 200 &&
      Math.abs(new Date(String(r.json?.event?.starts_at ?? '')).getTime() - movedStart) < 1000,
    r.json,
  )
  check(
    'edited ends_at and text persisted',
    r.status === 200 &&
      Math.abs(new Date(String(r.json?.event?.ends_at ?? '')).getTime() - movedEnd) < 1000 &&
      r.json?.event?.title === 'Smoke Practice (moved)' &&
      r.json?.event?.location === 'Pitch 2',
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/schedule`)
  check('list events', r.status === 200 && r.json?.events?.length === 1, r.json)

  // ── Performance metrics ───────────────────────────────────────────────────
  console.log('performance')
  r = await call('POST', `/api/org/${coachId}/students/${studentId}/performance`, {
    identity: coachId,
    body: {
      metric_key: 'vertical_jump',
      metric_value: 62,
      unit: 'cm',
      measured_at: '2026-09-05T10:00:00Z',
    },
  })
  check('create metric → 201', r.status === 201 && r.json?.metric?.id, r.json)
  metricId = r.json?.metric?.id ?? ''

  // No measured_at: the web's date field is optional and only adds the key when
  // non-empty. An explicit NULL does not fall back to the column default
  // (measured_at is NOT NULL DEFAULT now()), it raised 23502 and 500'd.
  r = await call('POST', `/api/org/${coachId}/students/${studentId}/performance`, {
    identity: coachId,
    body: { metric_key: 'undated_metric', metric_value: 7 },
  })
  check('log a metric with no date → 201', r.status === 201 && r.json?.metric?.id, r.json)
  const undated = await withHistoryStore(async (database) => {
    const rows = await database<{ measured_at: string }[]>`
      select measured_at from performance_metrics
      where auth0_id = ${coachId} and metric_key = 'undated_metric' limit 1;
    `
    return rows[0]?.measured_at ?? null
  })
  check('undated metric defaulted measured_at to now()', undated !== null, { measured_at: undated })

  // Two metrics now exist, which is the first time Array#sort in
  // getStudentPerformanceSeries has had two points to compare. Bun decodes a
  // timestamptz column to a Date, so the sort's `a.measured_at.localeCompare(b)`
  // threw "a.measured_at.localeCompare is not a function" — taking the series
  // and every report built from it down with it. The one-metric shape could
  // never catch it, because sort does not call its comparator for a single
  // element. Assert the order, and that measured_at is a usable string.
  r = await call('GET', `/api/org/${coachId}/students/${studentId}/performance`)
  const series = (r.json?.series ?? []) as Array<{ measured_at: string; metric_key: string }>
  check('series returns both metrics', r.status === 200 && series.length === 2, r.json)
  check(
    'series is ordered by measured_at ascending',
    series.length === 2 && String(series[0]?.measured_at) <= String(series[1]?.measured_at),
    { series: series.map((p) => p.measured_at) },
  )
  check(
    'series measured_at is an ISO string, not a Date',
    series.every(
      (p) => typeof p.measured_at === 'string' && !Number.isNaN(Date.parse(p.measured_at)),
    ),
    { series: series.map((p) => typeof p.measured_at) },
  )

  // Drop the probe: the checks below assert exact metric counts for this
  // student, and this one is about the write path and the sort, not the count.
  await withHistoryStore(async (database) => {
    await database`delete from performance_metrics where auth0_id = ${coachId} and metric_key = 'undated_metric';`
  })

  r = await call('GET', `/api/org/${coachId}/students/${studentId}/performance`)
  check('student performance series', r.status === 200 && r.json?.series?.length === 1, r.json)

  r = await call('PUT', `/api/org/${coachId}/performance/${metricId}`, {
    identity: coachId,
    body: { metric_value: 63, unit: 'cm' },
  })
  check('update metric', r.status === 200 && r.json?.metric?.metric_value === 63, r.json)

  r = await call('GET', `/api/org/${coachId}/performance?studentId=${studentId}`)
  check('cross-student list', r.status === 200 && r.json?.metrics?.length === 1, r.json)

  // ── Reports ───────────────────────────────────────────────────────────────
  console.log('reports')
  r = await call('POST', `/api/org/${coachId}/reports`, {
    identity: coachId,
    body: {
      student_id: studentId,
      report_type: 'progress',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
    },
  })
  check('create report → 201', r.status === 201 && r.json?.report?.id, r.json)
  reportId = r.json?.report?.id ?? ''

  r = await call('GET', `/api/org/${coachId}/reports/${reportId}`, {
    identity: coachId,
  })
  check('get report', r.status === 200 && r.json?.report?.id === reportId, r.json)

  // content_json is jsonb. createReportRecord/updateReportRecord bound
  // `${JSON.stringify(obj)}::jsonb`, which Postgres stores as a jsonb *string*:
  // every key read back undefined and the report rendered empty. Assert the
  // value is a real object on disk, not just that the row exists.
  const contentTypes = await withHistoryStore(async (database) => {
    const rows = await database<{ t: string }[]>`
      select jsonb_typeof(content_json) as t from reports where id = ${reportId};
    `
    return rows[0]?.t ?? null
  })
  check('report content_json stored as an object', contentTypes === 'object', {
    jsonb_typeof: contentTypes,
  })

  r = await call('GET', `/api/org/${coachId}/reports?studentId=${studentId}`)
  check('list reports', r.status === 200 && r.json?.reports?.length >= 1, r.json)

  r = await call('PUT', `/api/org/${coachId}/reports/${reportId}`, {
    identity: coachId,
    body: { report_type: 'monthly' },
  })
  check('update report', r.status === 200 && r.json?.report?.report_type === 'monthly', r.json)

  // ── Malformed ids are 400, not 500 ─────────────────────────────────────────
  console.log('id validation')
  // A malformed id used to reach a ::uuid / ::date cast, raise 22P02 or 22007,
  // and be reported as 500 INTERNAL_ERROR — for any member, including a read-only
  // one, and on routes whose own sibling answered a clean 400 for a *missing* id.
  // The sharpest instance was inside one file: attendance's batch route validated
  // its date and the single-record route 50 lines above it did not.
  const badIds: Array<[string, string, string, Record<string, unknown>?]> = [
    ['GET', `/api/org/${coachId}/students/not-a-uuid`, 'malformed student id', undefined],
    [
      'GET',
      `/api/org/${coachId}/attendance?studentId=not-a-uuid`,
      'attendance studentId',
      undefined,
    ],
    ['GET', `/api/org/${coachId}/attendance?from=yesterday`, 'attendance from date', undefined],
    [
      'GET',
      `/api/org/${coachId}/attendance/summary?studentId=not-a-uuid`,
      'attendance summary studentId',
      undefined,
    ],
    [
      'GET',
      `/api/org/${coachId}/performance?studentId=not-a-uuid`,
      'performance studentId',
      undefined,
    ],
    ['GET', `/api/org/${coachId}/students/comparison?ids=not-a-uuid`, 'comparison ids', undefined],
    ['GET', `/api/org/${coachId}/reports/not-a-uuid`, 'report id', undefined],
    [
      'PUT',
      `/api/org/${coachId}/reports/not-a-uuid`,
      'report id on write',
      { report_type: 'monthly' },
    ],
    ['DELETE', `/api/org/${coachId}/reports/not-a-uuid`, 'report id on delete', undefined],
    ['PUT', `/api/org/${coachId}/schedule/not-a-uuid`, 'event id', { status: 'completed' }],
    ['DELETE', `/api/org/${coachId}/schedule/not-a-uuid`, 'event id on delete', undefined],
    ['PUT', `/api/org/${coachId}/performance/not-a-uuid`, 'metric id', { metric_value: 1 }],
    ['DELETE', `/api/org/${coachId}/performance/not-a-uuid`, 'metric id on delete', undefined],
    [
      'PUT',
      `/api/org/${coachId}/attendance`,
      'attendance write student_id',
      { student_id: 'not-a-uuid', session_date: '2026-09-01', status: 'present' },
    ],
    [
      'PUT',
      `/api/org/${coachId}/attendance`,
      'attendance write date',
      { student_id: studentId, session_date: 'yesterday', status: 'present' },
    ],
    [
      'DELETE',
      `/api/org/${coachId}/attendance?studentId=not-a-uuid&date=2026-09-01`,
      'attendance delete id',
      undefined,
    ],
    [
      'DELETE',
      `/api/org/${coachId}/attendance?studentId=${studentId}&date=yesterday`,
      'attendance delete date',
      undefined,
    ],
    [
      'POST',
      `/api/org/${coachId}/attendance/batch`,
      'attendance batch id',
      { entries: [{ student_id: 'not-a-uuid', session_date: '2026-09-01', status: 'present' }] },
    ],
    [
      'POST',
      `/api/org/${coachId}/reports`,
      'report write student_id',
      { report_type: 'monthly', student_id: 'not-a-uuid' },
    ],
    [
      'PUT',
      // A literal job id: the student_id check runs before the job is resolved, so
      // this asserts the 400 rather than the 404 a real job would produce.
      `/api/org/${coachId}/analyses/srv-smoke-never-existed/student`,
      'analysis link student_id',
      { student_id: 'not-a-uuid' },
    ],
  ]
  for (const [method, path, label, body] of badIds) {
    const res = await call(method, path, { identity: coachId, body })
    check(`${method} ${label} → 400, not 500`, res.status === 400, {
      status: res.status,
      code: (res.json as { code?: string } | null)?.code,
    })
  }

  // A non-numeric or negative pagination value is a client typo. This one is
  // NOT pinned here: the old `Math.min(Number(x) || fallback, max)` form was
  // already safe for both (`NaN || 20` is 20, Math.max floors a negative
  // offset), so a smoke assertion would pass with or without the change. The
  // helper is unit-tested instead — see tests/uuid.test.ts.

  // ── Retention prune ────────────────────────────────────────────────────────
  console.log('retention')
  // The batch delete passed a JS array to db.unsafe, which Bun serialises as
  // comma-joined text, so `any($1)` against a text column died with
  // `malformed array literal` on the first child table. Every retention run threw
  // and nothing was ever pruned — analyses, findings, clips, player_events and
  // chat_messages grew forever — while the feature reported as healthy, because
  // retention.ts logged the error once a day and `pruned` never rose. Nothing
  // covered it: retention.test.ts only tests the retentionDays() clamp, and a
  // fixture stubs `db` as a plain tag function, so the binding never happens.
  const RETENTION_JOBS = [`smokehttp-${tag}-ret1`, `smokehttp-${tag}-ret2`]
  const AGED = '2000-01-01T00:00:00.000Z'
  await withHistoryStore(async (database) => {
    for (const job of RETENTION_JOBS) {
      await database`
        insert into analysis_history (server_job_id, engine_job_id, auth0_id, model, complete, requested_at)
        values (${job}, ${`${job}-eng`}, ${coachId}, ${'smoke-model'}, true, ${AGED})
        on conflict (server_job_id) do update set requested_at = ${AGED};
      `
      await database`
        insert into findings (id, server_job_id, category)
        values (${`${job}-f`}, ${job}, ${'technique'})
        on conflict (server_job_id, id) do nothing;
      `
      await database`
        insert into player_events (server_job_id, org_auth0_id, category)
        values (${job}, ${coachId}, ${'shot'});
      `
    }
  })
  const pruned = await pruneRetention()
  const retentionLiteral = `{${RETENTION_JOBS.join(',')}}`
  // A table name cannot be a Bun tagged-template parameter — `${table}` binds as
  // $1 and the query dies with "syntax error at or near $1". Splice the table and
  // bind the ids, the way deleteAnalysisChildren does. withHistoryStoreOrThrow
  // rather than the fail-open wrapper, so a failure surfaces instead of arriving
  // here as a null count.
  const remainingFor = (table: string): Promise<number> =>
    withHistoryStoreOrThrow(async (database) => {
      const rows = await database.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${table} where server_job_id = any($1::text[]);`,
        [retentionLiteral],
      )
      return rows[0]?.n ?? -1
    })
  check('retention pruned the aged analyses', pruned > 0, { pruned })
  const analysesLeft = await remainingFor('analysis_history')
  check('retention removed every aged analysis row', analysesLeft === 0, { analysesLeft })
  const findingsLeft = await remainingFor('findings')
  check('retention removed the child rows too', findingsLeft === 0, { findingsLeft })
  await withHistoryStore(async (database) => {
    await database`delete from findings where server_job_id like ${`smokehttp-${tag}-ret%`}`
    await database`delete from player_events where server_job_id like ${`smokehttp-${tag}-ret%`}`
    await database`delete from analysis_history where server_job_id like ${`smokehttp-${tag}-ret%`}`
  })

  // ── jsonb bind invariant ───────────────────────────────────────────────────
  console.log('jsonb')
  // On Bun's prepared-statement path `${JSON.stringify(x)}::jsonb` stores a jsonb
  // *string*. Ten columns were written that way, which quietly defeated
  // redactWellness (its `typeof summary !== 'object'` guard passes a string
  // straight through, so the medical redaction stopped working on persisted
  // analyses) and left notification.data.href undefined after a reload. The
  // repair migration in ensureInitialized unwraps them; this asserts the
  // invariant holds, which is what fails if a writer regresses to the string
  // form and new rows start landing as strings. A fixture cannot catch it —
  // they stub `db` as a plain tag function, so the binding never happens.
  const stringJsonb = await withHistoryStore(async (database) => {
    const rows = await database<{ table_name: string; column_name: string; n: number }[]>`
      select c.table_name, c.column_name, count(*)::int as n
      from information_schema.columns c
      join pg_class t on t.relname = c.table_name
      where c.table_schema = 'public' and c.data_type = 'jsonb'
      group by 1, 2;
    `
    let total = 0
    for (const col of rows) {
      const hits = await database.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${col.table_name} where ${col.column_name} is not null and jsonb_typeof(${col.column_name}) = 'string';`,
      )
      total += hits[0]?.n ?? 0
    }
    return total
  })
  check('no jsonb column holds a double-encoded string', stringJsonb === 0, { stringJsonb })

  // ── Analysis linking ──────────────────────────────────────────────────────
  console.log('analyses')
  analysisId = `srv-smoke-${tag}`
  await withHistoryStore(async (db) => {
    await db`
      insert into analysis_history (server_job_id, engine_job_id, session_token, model, complete, video_ready, auth0_id, requested_at)
      values (${analysisId}, ${`eng-smoke-${tag}`}, ${`sess-smoke-${tag}`}, 'gemini-2.5-flash', true, false, ${coachId}, now())
      on conflict (server_job_id) do update set auth0_id = excluded.auth0_id;
    `
  })

  r = await call('PUT', `/api/org/${coachId}/analyses/${analysisId}/student`, {
    identity: coachId,
    body: { student_id: studentId },
  })
  check(
    'link analysis to student',
    r.status === 200 && r.json?.analysis?.student_id === studentId,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/students/${studentId}/analyses`)
  check('student analyses', r.status === 200 && r.json?.analyses?.length === 1, r.json)

  r = await call('GET', `/api/auth/user/${coachId}/analyses?limit=20`)
  check(
    'auth analyses listing includes linked',
    r.status === 200 && r.json?.analyses?.length === 1,
    r.json,
  )

  r = await call('GET', `/api/auth/user/${coachId}/analyses?limit=100&unlinked=1`)
  check(
    'unlinked filter excludes linked analyses',
    r.status === 200 &&
      Array.isArray(r.json?.analyses) &&
      r.json.analyses.every((a) => !a.student_id),
    r.json,
  )

  // A valid limit still narrows — the pickInt change must not have made the
  // parameter inert.
  r = await call('GET', `/api/auth/user/${coachId}/analyses?limit=1`, { identity: coachId })
  check(
    'a valid limit still narrows the analyses list',
    r.status === 200 && r.json?.analyses?.length === 1,
    r.json,
  )

  // ── Clips + findings export ──────────────────────────────────────────────
  console.log('clips/export')
  r = await call('POST', `/api/auth/user/${coachId}/analyses/${analysisId}/clips`, {
    identity: coachId,
    body: { label: 'Release', start_ms: 1200, end_ms: 3400 },
  })
  check('create clip → 201', r.status === 201 && r.json?.clip?.id, r.json)
  const clipId = (r.json?.clip as { id?: string } | undefined)?.id ?? ''

  r = await call('POST', `/api/auth/user/${coachId}/analyses/${analysisId}/clips`, {
    identity: coachId,
    body: { label: 'Bad range', start_ms: 5000, end_ms: 1000 },
  })
  check('inverted clip range → 400', r.status === 400 && expectError(r.json), r.json)

  r = await call('POST', `/api/auth/user/${coachId}/analyses/${analysisId}/clips`, {
    identity: coachId,
    body: { label: 'Bad link', start_ms: 0, end_ms: 1000, finding_id: 'nope:e9' },
  })
  check('unknown finding link → 400', r.status === 400 && expectError(r.json), r.json)

  r = await call('GET', `/api/auth/user/${coachId}/analyses/${analysisId}/clips`, {
    identity: coachId,
  })
  check(
    'list clips',
    r.status === 200 && Array.isArray(r.json?.clips) && r.json.clips.length === 1,
    r.json,
  )

  r = await call(
    'GET',
    `/api/auth/user/${coachId}/findings/export?student_id=${studentId}&limit=50`,
    { identity: coachId },
  )
  check('findings export → 200', r.status === 200, r.status)

  r = await call('GET', `/api/auth/user/${coachId}/findings/export?student_id=nope`, {
    identity: coachId,
  })
  check('export bad student_id → 400', r.status === 400, r.status)

  r = await call('DELETE', `/api/auth/user/${coachId}/analyses/${analysisId}/clips/${clipId}`, {
    identity: coachId,
  })
  check('delete clip', r.status === 200 && r.json?.deleted === true, r.json)

  r = await call(
    'DELETE',
    `/api/auth/user/${coachId}/analyses/${analysisId}/clips/123e4567-e89b-12d3-a456-426614174000`,
    { identity: coachId },
  )
  check('delete unknown clip → 404', r.status === 404 && expectError(r.json), r.json)

  // ── Overview + search ─────────────────────────────────────────────────────
  console.log('overview/search')
  r = await call('GET', `/api/org/${coachId}/overview`)
  check('overview counts', r.status === 200 && r.json?.overview?.student_count === 1, r.json)

  r = await call('GET', `/api/org/${coachId}/search?q=Smoke`)
  check('search students hit', r.status === 200 && r.json?.students?.length === 1, r.json)

  // ── Player (me) routes ────────────────────────────────────────────────────
  console.log('me routes')
  r = await call('GET', '/api/me/profile', { identity: playerId })
  check('me profile linked', r.status === 200 && r.json?.student?.id === studentId, r.json)

  r = await call('PUT', '/api/me/profile', {
    identity: playerId,
    body: { name: 'Smoke Player', nickname: 'SP', picture: null },
  })
  check(
    'me profile update (null picture clears)',
    r.status === 200 && r.json?.user?.picture === null,
    r.json,
  )

  r = await call('GET', '/api/me/attendance', { identity: playerId })
  check(
    'me attendance',
    r.status === 200 && r.json?.records?.length === 3 && r.json?.linked === true,
    r.json,
  )

  r = await call('GET', '/api/me/schedule', { identity: playerId })
  check('me schedule', r.status === 200 && r.json?.events?.length === 1, r.json)

  r = await call('GET', '/api/me/performance', { identity: playerId })
  check('me performance', r.status === 200 && r.json?.points?.length >= 1, r.json)

  r = await call('GET', '/api/me/analyses', { identity: playerId })
  check('me analyses', r.status === 200 && r.json?.analyses?.length === 1, r.json)

  r = await call('GET', '/api/me/reports', { identity: playerId })
  check('me reports', r.status === 200 && r.json?.reports?.length === 1, r.json)

  r = await call('GET', `/api/me/reports/${reportId}`, { identity: playerId })
  check('me report detail', r.status === 200 && r.json?.report?.id === reportId, r.json)

  // ── Email routes (reachable; expect 501 when no RESEND key) ───────────────
  console.log('email routes')
  r = await call('POST', `/api/email/${coachId}/invite`, {
    identity: coachId,
    body: { emails: ['sibling@example.com'] },
  })
  if (r.status === 501 && expectError(r.json) && r.json.code === 'EMAIL_NOT_CONFIGURED') {
    check('invite → 501 EMAIL_NOT_CONFIGURED (no RESEND key)', true)
  } else if (
    r.status === 200 &&
    r.json?.sent &&
    Array.isArray(r.json.sent) &&
    r.json.sent.length === 1
  ) {
    check('invite sent (RESEND key present)', true)
  } else {
    // Resend test keys reject non-account domains (e.g. example.com) — the
    // route is reachable and well-formed; delivery is environmental.
    check(
      'invite reachable (provider rejected sandbox domain)',
      expectError(r.json) && r.json.code === 'EMAIL_SEND_FAILED',
      r.json,
    )
  }

  r = await call('POST', `/api/email/${coachId}/report`, {
    identity: coachId,
    body: { report_id: reportId },
  })
  if (r.status === 501 && expectError(r.json) && r.json.code === 'EMAIL_NOT_CONFIGURED') {
    check('report email → 501 EMAIL_NOT_CONFIGURED (no RESEND key)', true)
  } else if (r.status === 200 && r.json?.sent) {
    check('report email sent (RESEND key present)', true)
  } else {
    check(
      'report email reachable (provider rejected sandbox domain)',
      expectError(r.json) && r.json.code === 'EMAIL_SEND_FAILED',
      r.json,
    )
  }

  r = await call('POST', `/api/email/${coachId}/attendance`, {
    identity: coachId,
    body: { from: '2026-09-01', to: '2026-09-30' },
  })
  if (r.status === 501 && expectError(r.json) && r.json.code === 'EMAIL_NOT_CONFIGURED') {
    check('attendance email → 501 EMAIL_NOT_CONFIGURED (no RESEND key)', true)
  } else if (r.status === 200 && r.json?.records === 3) {
    check('attendance email sent (RESEND key present)', true)
  } else {
    check(
      'attendance email reachable (provider rejected sandbox domain)',
      expectError(r.json) && r.json.code === 'EMAIL_SEND_FAILED',
      r.json,
    )
  }

  // ── Account settings + data rights (self-scoped) ───────────────────────────
  console.log('account settings')
  r = await call('GET', '/api/me/preferences', { identity: playerId })
  check(
    'GET /api/me/preferences -> 200 with the synced settings',
    r.status === 200 && r.json !== null && 'theme' in r.json && 'reduceMotion' in r.json,
    r.json,
  )

  r = await call('PUT', '/api/me/preferences', {
    identity: playerId,
    body: { weekStartsMonday: true },
  })
  check('PUT /api/me/preferences -> 200', r.status === 200, r.json)

  r = await call('PUT', '/api/me/preferences', { identity: playerId, body: { theme: 'neon' } })
  check(
    'PUT /api/me/preferences with a bad theme -> 400',
    r.status === 400 && expectError(r.json),
    r.json,
  )

  r = await call('GET', '/api/me/notification-preferences', { identity: playerId })
  check(
    'GET /api/me/notification-preferences -> 200 with the digest cadence',
    r.status === 200 && r.json !== null && 'cadence' in r.json && 'lastDigestAt' in r.json,
    r.json,
  )

  r = await call('PUT', '/api/me/notification-preferences', {
    identity: playerId,
    body: { cadence: 'hourly' },
  })
  check(
    'PUT /api/me/notification-preferences with a bad cadence -> 400',
    r.status === 400 && expectError(r.json),
    r.json,
  )

  r = await call('GET', '/api/me/consent', { identity: playerId })
  check(
    'GET /api/me/consent -> 200 with the linked/unlinked shape',
    r.status === 200 && r.json !== null && 'linked' in r.json,
    r.json,
  )

  r = await call('GET', '/api/me/privacy-requests', { identity: playerId })
  check(
    'GET /api/me/privacy-requests -> 200 with the caller own list',
    r.status === 200 && r.json !== null && Array.isArray(r.json.requests),
    r.json,
  )

  r = await call('GET', '/api/me/export', { identity: playerId })
  check(
    'GET /api/me/export -> 200 carrying a portability bundle',
    r.status === 200 && r.json !== null && 'formatVersion' in r.json,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/settings`, { identity: coachId })
  check(
    'GET /api/org/:id/settings -> 200 with the org identity',
    r.status === 200 && r.json !== null && 'settings' in r.json,
    r.json,
  )

  r = await call('PATCH', `/api/org/${coachId}/settings`, {
    identity: playerId,
    body: { name: 'not allowed' },
  })
  check(
    'PATCH /api/org/:id/settings as a non-member -> 403',
    r.status === 403 && expectError(r.json),
    r.json,
  )

  // ── Team scope, exercised against a real Postgres ─────────────────────────
  // Every scoped read in the suite stubs `db` as a plain tag function, so no
  // fixture ever asks Postgres whether a bound id list is a legal `uuid[]`.
  // That class of bug (22P02 on a scoped query while the unscoped path looks
  // fine) is only visible here, so this block builds a real second team and a
  // real scoped coach and reads through it.
  console.log('team scope')
  const scopedId = `${tag}|scoped-coach`
  const scopedEmail = `${tag}+scoped@example.com`

  r = await call('POST', '/api/auth/sync', {
    body: { sub: scopedId, name: 'Scoped Coach', email: scopedEmail, email_verified: true },
  })
  check('scoped coach user exists', r.status === 200 && r.json?.user?.auth0_id === scopedId, r.json)

  r = await call('POST', `/api/org/${coachId}/teams`, {
    identity: coachId,
    body: { name: 'Smoke Squad', sport: 'basketball' },
  })
  const teamId = typeof r.json?.team?.id === 'string' ? r.json.team.id : ''
  check('create team', r.status === 201 && teamId.length > 0, { status: r.status, body: r.json })

  // deleteTeam must establish ownership before it unassigns anyone.
  // `students.team_id` is a loose link, not a foreign key, so `where team_id =
  // ?` matches any org's team; unassigning before the org check meant a caller
  // from another org who knew the uuid cleared every victim's player and then
  // received 404 — a refusal that had already mutated another tenant. The route
  // only pins the role floor, so the data layer is the only place this can be
  // caught. Driven at the data layer because the HTTP route needs a second org's
  // owner session, and a fixture cannot reach the SQL at all.
  const victimTeamId = await withHistoryStore(async (database) => {
    const made = await database<{ id: string }[]>`
      insert into teams (org_auth0_id, name, sport)
      values (${coachId}, ${'Smoke Victim Squad'}, ${'basketball'})
      returning id;
    `
    const victimTeam = made[0].id
    await database`
      update students set team_id = ${victimTeam} where auth0_id = ${coachId};
    `
    return victimTeam
  })
  const removedByOtherOrg = await deleteTeam(`smokehttp-other-org-${tag}`, victimTeamId)
  check('deleteTeam refuses a team owned by another org', removedByOtherOrg === false, {
    removedByOtherOrg,
  })
  const victimPlayers = await withHistoryStore(async (database) => {
    const rows = await database<{ n: number }[]>`
      select count(*)::int as n from students
      where auth0_id = ${coachId} and team_id = ${victimTeamId};
    `
    return rows[0]?.n ?? 0
  })
  check("the other org's players kept their team after the refused delete", victimPlayers > 0, {
    victimTeamId,
    playersStillAssigned: victimPlayers,
  })
  await withHistoryStore(async (database) => {
    await database`update students set team_id = null where auth0_id = ${coachId};`
    await database`delete from teams where id = ${victimTeamId};`
  })
  check(
    'victim-squad cleanup',
    true,
    await withHistoryStore(async (database) => {
      const rows = await database<{ n: number }[]>`
        select count(*)::int as n from teams where id = ${victimTeamId};
      `
      return { teamsRemaining: rows[0]?.n ?? -1 }
    }),
  )

  r = await call('POST', `/api/org/${coachId}/members`, {
    identity: coachId,
    body: { email: scopedEmail, role: 'coach' },
  })
  check('invite scoped coach as a member', r.status === 201, r.json)

  r = await call('POST', `/api/org/${coachId}/teams/${teamId}/members`, {
    identity: coachId,
    body: { member_auth0_id: scopedId, role: 'coach' },
  })
  check('add scoped coach to the team', r.status === 201, r.json)

  // Adding the same coach again must be idempotent. A btree unique index treats
  // NULLs as distinct, so `unique (team_id, member_auth0_id, student_id)` never
  // constrained a coach membership (student_id is NULL) — every call inserted
  // another row and addTeamMember's ON CONFLICT DO UPDATE was dead code for
  // coaches. No fixture can catch that: they stub `db` as a plain tag function.
  r = await call('POST', `/api/org/${coachId}/teams/${teamId}/members`, {
    identity: coachId,
    body: { member_auth0_id: scopedId, role: 'coach' },
  })
  check('re-adding the same coach is accepted (idempotent)', r.status === 201, r.json)
  const memberships = await withHistoryStore(async (database) => {
    const rows = await database<{ n: number }[]>`
      select count(*)::int as n
      from team_memberships
      where team_id = ${teamId} and member_auth0_id = ${scopedId};
    `
    return rows[0]?.n ?? 0
  })
  check(
    'one membership row after two adds (live NULLS NOT DISTINCT constraint)',
    memberships === 1,
    { teamId, member: scopedId, rows: memberships },
  )

  // The team holds no students, so a correctly scoped caller sees nothing while
  // the owner still sees the org. These four are the live array-bind checks.
  r = await call('GET', `/api/org/${coachId}/students`, { identity: scopedId })
  check(
    'scoped coach reads no students off-team (live uuid[] bind)',
    r.status === 200 && r.json?.students?.length === 0,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/attendance`, { identity: scopedId })
  check(
    'scoped coach reads no attendance off-team (live uuid[] bind)',
    r.status === 200 && (r.json?.records?.length ?? 0) === 0,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/matches`, { identity: scopedId })
  check(
    'scoped coach reads no matches off-team (live uuid[] bind)',
    r.status === 200 && (r.json?.matches?.length ?? 0) === 0,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/reports`, { identity: scopedId })
  check(
    'scoped coach reads no reports off-team (live uuid[] bind)',
    r.status === 200 && (r.json?.reports?.length ?? 0) === 0,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/teams`, { identity: scopedId })
  check(
    'scoped coach sees only their own team',
    r.status === 200 && r.json?.teams?.length === 1 && r.json?.teams?.[0]?.id === teamId,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/students`, { identity: coachId })
  check(
    'owner is not narrowed by the same org',
    r.status === 200 && (r.json?.students?.length ?? 0) >= 1,
    r.json,
  )

  // The account tree, `/api/auth/user/:auth0Id/analyses`, is org-scoped by path
  // but keyed to the *org* (analysis rows are owned by the org), so an unfiltered
  // read here is org-wide — the case a stubbed `db` cannot catch, because the
  // narrowing lives in the SQL. `analysisId` is org-owned and linked to a student
  // on the owner's team, so the scoped coach must not see it by list or by id.
  r = await call('GET', `/api/auth/user/${coachId}/analyses`, { identity: scopedId })
  check(
    'scoped coach list omits an off-team analysis (live uuid[] bind)',
    r.status === 200 &&
      !(r.json?.analyses ?? []).some(
        (a: { server_job_id: string }) => a.server_job_id === analysisId,
      ),
    r.json,
  )

  r = await call('GET', `/api/auth/user/${coachId}/analyses/${analysisId}`, {
    identity: scopedId,
  })
  check(
    'scoped coach reads no off-team analysis by id → 404',
    r.status === 404 && expectError(r.json),
    r.json,
  )

  r = await call('GET', `/api/auth/user/${coachId}/analyses/${analysisId}`, { identity: coachId })
  check('owner is not narrowed on the account tree', r.status === 200, r.json)

  // The stat tiles sit directly above that list, so a coach whose tile counted
  // the whole club beside a one-row list looked like a bug. `analysisId` is
  // org-owned and linked to a player on the owner's team, and the scoped coach's
  // team holds none, so their count must be zero while the owner's is not.
  r = await call('GET', `/api/auth/user/${coachId}/stats`, { identity: scopedId })
  check(
    'scoped coach counts no off-team analysis (live count filter)',
    r.status === 200 && r.json?.stats?.total_analyses === 0,
    r.json,
  )

  r = await call('GET', `/api/auth/user/${coachId}/stats`, { identity: coachId })
  check(
    'owner counts their own analysis (live count filter)',
    r.status === 200 && (r.json?.stats?.total_analyses ?? 0) >= 1,
    r.json,
  )

  // The findings half of the same tree is keyed by `student_id` instead of by
  // job, and it is the half that ships a CSV. `studentId` is on the owner's team,
  // so the scoped coach must not read it — by list, by export, or by trends.
  r = await call('GET', `/api/auth/user/${coachId}/findings?student_id=${studentId}`, {
    identity: scopedId,
  })
  check('scoped coach reads no off-team findings → 404', r.status === 404, r.json)

  r = await call('GET', `/api/auth/user/${coachId}/findings/export?student_id=${studentId}`, {
    identity: scopedId,
  })
  check('scoped coach exports no off-team findings → 404', r.status === 404, r.json)

  r = await call('GET', `/api/auth/user/${coachId}/findings/trends?student_id=${studentId}`, {
    identity: scopedId,
  })
  check('scoped coach reads no off-team findings trend → 404', r.status === 404, r.json)

  r = await call('GET', `/api/auth/user/${coachId}/findings/trends`, { identity: scopedId })
  check('scoped coach reads no org-wide findings trend → 403', r.status === 403, r.json)

  r = await call('GET', `/api/auth/user/${coachId}/findings?student_id=${studentId}`, {
    identity: coachId,
  })
  check('owner is not narrowed on the findings tree', r.status === 200, r.json)

  // A share token is unauthenticated — anyone holding the link reads the analysis
  // — so minting one is a write about the player on that video, not a read. The
  // scoped coach's team holds no students and `analysisId` is linked to one on
  // the owner's, so the mint is refused; the owner still gets one.
  r = await call('POST', `/api/org/${coachId}/analyses/${analysisId}/share-token`, {
    identity: scopedId,
  })
  check('scoped coach publishes no off-team analysis → 403', r.status === 403, r.json)

  r = await call('POST', `/api/org/${coachId}/analyses/${analysisId}/share-token`, {
    identity: coachId,
  })
  // Not "=== 201": the share-token store is Redis-backed, so a spendt quota
  // turns this into a 5xx. What this asserts is that scope did not refuse the
  // owner — the old code compared the row's owning org against the caller's own
  // sub, which refused every coach and would have failed here with 403.
  check('owner is not refused a share by scope', r.status !== 403, r.json)

  r = await call('DELETE', `/api/org/${coachId}/teams/${teamId}`, { identity: coachId })
  check('delete team', r.status === 200, r.json)

  // ── Identity-boundary negatives ───────────────────────────────────────────
  console.log('identity boundary')
  r = await call('GET', `/api/org/${coachId}/students`, { identity: playerId })
  check('cross-account read → 403', r.status === 403 && expectError(r.json), r.json)

  r = await call('GET', `/api/org/${coachId}/students`, { identity: '' })
  check('missing verified identity → 403', r.status === 403 && expectError(r.json), r.json)

  r = await call('GET', `/api/org/${coachId}/students`, {
    identity: coachId,
    rawToken: 'wrong-token',
  })
  check('bad service token → 403', r.status === 403 && expectError(r.json), r.json)

  console.log(
    JSON.stringify({
      type: 'smoke_org_http',
      tag,
      passed,
      failed,
      emailConfigured: expectedEmailConfigured(),
    }),
  )
}

function expectedEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

main()
  .catch(async (e) => {
    failed++
    console.error(JSON.stringify({ type: 'smoke_org_http_error', error: String(e) }))
    await cleanup()
    process.exit(1)
  })
  .then(async () => {
    await cleanup()
    process.exit(failed > 0 ? 1 : 0)
  })
