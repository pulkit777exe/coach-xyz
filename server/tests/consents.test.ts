import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import meRoutes from '../src/routes/me'
import {
  CONSENT_POLICY_VERSION,
  consentForStudent,
  unlinkedConsent,
  upsertConsent,
  validateConsentPatch,
} from '../src/lib/consents'
import {
  buildAccountExport,
  exportFilename,
  EXPORT_FORMAT_VERSION,
  type AccountExport,
  type AccountExportSources,
} from '../src/lib/dataExport'
import {
  createPrivacyRequest,
  listPrivacyRequests,
  validatePrivacyRequestBody,
  type PrivacyRequest,
} from '../src/lib/privacyRequests'
import type { Student } from '../src/lib/orgData'

// ── Player consent + data portability ────────────────────────────────────────
// Hermetic: one stub connection answers every table from an in-memory fixture
// holding TWO accounts — the caller and a bystander. That is what makes the
// self-scoping assertions real: a statement bound to the wrong id returns the
// BYSTANDER's rows, and the bundle would carry them.

const CALLER = 'auth0|consent-player'
const CALLER_COACH = 'auth0|consent-coach'
const STUDENT = '11111111-1111-4111-8111-111111111111'

const BYSTANDER = 'auth0|bystander'
const BYSTANDER_COACH = 'auth0|bystander-coach'
const BYSTANDER_STUDENT = '22222222-2222-4222-8222-222222222222'

const ISO = '2026-09-26T00:00:00.000Z'

type StoredConsent = {
  student_id: string
  training_data: boolean
  medical_data: boolean
  marketing: boolean
  policy_version: string
  updated_at: string
}

type Row = Record<string, unknown>

type StubState = {
  users: Map<string, Row>
  students: Map<string, Student>
  consents: Map<string, StoredConsent>
  attendance: Row[]
  notifications: Row[]
  schedule: Row[]
  analyses: Row[]
  metrics: Row[]
  reports: Row[]
  objectives: Row[]
  privacyRequests: Map<string, PrivacyRequest[]>
  /** Monotonic clock for recorded requests (distinct created_at). */
  seq: number
  /** Every statement issued, normalized, with its bindings. */
  queries: Array<{ sql: string; values: unknown[] }>
}

const userRow = (auth0Id: string, name: string): Row => ({
  id: `user-${auth0Id}`,
  auth0_id: auth0Id,
  email: `${name.split(' ')[0]?.toLowerCase()}@example.com`,
  name,
  nickname: null,
  picture: null,
  email_verified: true,
  linked_auth0_ids: [],
  role: 'player',
  created_at: ISO,
  updated_at: ISO,
})

const studentRow = (
  id: string,
  coachAuth0Id: string,
  accountAuth0Id: string,
  fullName: string,
): Student => ({
  id,
  auth0_id: coachAuth0Id,
  full_name: fullName,
  email: null,
  phone: null,
  sport: 'basketball',
  position: 'guard',
  jersey_number: 7,
  date_of_birth: null,
  gender: null,
  guardian_name: null,
  guardian_phone: null,
  notes: null,
  status: 'active',
  joined_on: null,
  account_auth0_id: accountAuth0Id,
  team_id: null,
  created_at: ISO,
  updated_at: ISO,
})

const normalize = (strings: TemplateStringsArray): string =>
  strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()

/** The bound auth0 id of a statement, if it has one. */
const boundAuth0Id = (values: unknown[]): string | undefined =>
  values.find((v): v is string => typeof v === 'string' && v.startsWith('auth0|'))

/** The bound uuid (student id) of a statement, if it has one. */
const boundUuid = (values: unknown[]): string | undefined =>
  values.find((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v))

/** The bound row limit of a statement, if it has one. */
const boundLimit = (values: unknown[]): number | undefined =>
  values.find((v): v is number => typeof v === 'number')

/** Whether a fixture row belongs to an owner column (`auth0_id`/`org_auth0_id`). */
const ownedBy = (row: Row, auth0Id: string): boolean =>
  (row.auth0_id ?? row.org_auth0_id) === auth0Id

const consentRow = (row: StoredConsent): Row => ({
  student_id: row.student_id,
  training_data: row.training_data,
  medical_data: row.medical_data,
  marketing: row.marketing,
  policy_version: row.policy_version,
  updated_at: row.updated_at,
})

const privacyRow = (request: PrivacyRequest): Row => ({
  id: request.id,
  request_type: request.type,
  status: request.status,
  created_at: request.createdAt,
  resolved_at: request.resolvedAt,
})

const makeStubConnection = (state: StubState): SQL => {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = normalize(strings)
    state.queries.push({ sql: query, values })
    const auth0Id = boundAuth0Id(values) ?? ''
    const studentId = boundUuid(values)

    // ── consent ────────────────────────────────────────────────────────────
    if (query.includes('from player_consents')) {
      const row = state.consents.get(studentId ?? '')
      return row ? [consentRow(row)] : []
    }
    if (query.includes('insert into player_consents')) {
      const stored = studentId ? state.consents.get(studentId) : undefined
      const row: StoredConsent = {
        student_id: studentId ?? '',
        training_data: values[1] as boolean,
        medical_data: values[2] as boolean,
        marketing: values[3] as boolean,
        // A partial patch never re-stamps an existing row's policy version:
        // consent to a new version is a separate, explicit act.
        policy_version: stored?.policy_version ?? (values[4] as string),
        updated_at: new Date().toISOString(),
      }
      state.consents.set(row.student_id, row)
      return [consentRow(row)]
    }

    // ── privacy requests ────────────────────────────────────────────────────
    if (query.includes('from privacy_requests')) {
      const limit = boundLimit(values) ?? 50
      return [...(state.privacyRequests.get(auth0Id) ?? [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(privacyRow)
    }
    if (query.includes('insert into privacy_requests')) {
      state.seq += 1
      const request: PrivacyRequest = {
        id: crypto.randomUUID(),
        type: values[1] as PrivacyRequest['type'],
        status: 'received',
        // A monotonic stamp per stub: the ordering assertion needs distinct
        // created_at values, which two requests in one millisecond would not have.
        createdAt: new Date(Date.UTC(2026, 8, 26) + state.seq * 1000).toISOString(),
        resolvedAt: null,
      }
      state.privacyRequests.set(auth0Id, [...(state.privacyRequests.get(auth0Id) ?? []), request])
      return [privacyRow(request)]
    }

    // ── identity + roster ───────────────────────────────────────────────────
    if (query.includes('from users')) {
      const row = state.users.get(auth0Id)
      if (query.includes('select auth0_id')) return row ? [{ auth0_id: auth0Id }] : []
      return row ? [row] : []
    }
    if (query.includes('account_auth0_id')) {
      const student = state.students.get(auth0Id)
      return student ? [student] : []
    }

    // ── account-scoped settings ────────────────────────────────────────────
    if (query.includes('from notification_preferences')) {
      return [
        {
          in_app: true,
          cadence: 'instant',
          events: { analysis_complete: true, attendance: true },
          updated_at: ISO,
        },
      ]
    }
    if (query.includes('from user_settings')) {
      return [{ theme: 'system', reduce_motion: false, week_starts_monday: false, updated_at: ISO }]
    }
    if (query.includes('from notifications')) {
      return state.notifications.filter((row) => row.auth0_id === auth0Id)
    }

    // ── coaching data, filtered by the bindings exactly like Postgres ───────
    if (query.includes('from attendance')) {
      const mine = state.attendance.filter(
        (row) => ownedBy(row, auth0Id) && (studentId === undefined || row.student_id === studentId),
      )
      if (query.includes('count(*)')) {
        const present = mine.filter((row) => row.status === 'present').length
        return [
          {
            total_records: mine.length,
            present,
            absent: mine.length - present,
            late: 0,
            excused: 0,
            attendance_rate: mine.length ? (present / mine.length) * 100 : null,
          },
        ]
      }
      return mine.map((row) => ({ ...row, full_name: 'Avery Stone', sport: 'basketball' }))
    }
    if (query.includes('from schedule_events')) {
      return state.schedule.filter((row) => ownedBy(row, auth0Id))
    }
    if (query.includes('from analysis_history')) {
      const mine = state.analyses.filter(
        (row) => ownedBy(row, auth0Id) && row.student_id === studentId,
      )
      // The performance series reads only (requested_at, form_score).
      if (query.includes('form_score')) {
        return mine.map((row) => ({
          requested_at: ISO,
          form_score: 7.5,
          server_job_id: row.server_job_id,
        }))
      }
      return mine.map((row) => ({
        ...row,
        engine_job_id: 'engine-1',
        model: 'gemini-2.5-flash',
        stage: null,
        stage_name: null,
        progress: 100,
        complete: true,
        video_ready: true,
        summary_json: { form_score: 7.5, shot_events: [{ label: 'rebound', injury_risk: 'high' }] },
        error_code: null,
        error_message: null,
        download_count: 0,
        requested_by: null,
        completed_at: ISO,
        file_name: 'clip.mp4',
        file_size_bytes: 1024,
        player_count: 1,
      }))
    }
    if (query.includes('from performance_metrics')) {
      return state.metrics.filter((row) => ownedBy(row, auth0Id) && row.student_id === studentId)
    }
    if (query.includes('from reports')) {
      return state.reports.filter((row) => ownedBy(row, auth0Id) && row.student_id === studentId)
    }
    if (query.includes('from training_objectives')) {
      return state.objectives.filter((row) => ownedBy(row, auth0Id) && row.student_id === studentId)
    }

    // DDL (ensureInitialized) + audit inserts: recorded, never served.
    return []
  }) as unknown as SQL

  return Object.assign(tag, {
    connect: async () => {},
    unsafe: (sql: string) => sql,
    close: async () => {},
  }) as SQL
}

let restoreConnection: (() => void) | null = null

const useStub = (): StubState => {
  const state: StubState = {
    users: new Map([
      [CALLER, userRow(CALLER, 'Avery Stone')],
      [BYSTANDER, userRow(BYSTANDER, 'Blair Other')],
    ]),
    students: new Map([
      [CALLER, studentRow(STUDENT, CALLER_COACH, CALLER, 'Avery Stone')],
      [BYSTANDER, studentRow(BYSTANDER_STUDENT, BYSTANDER_COACH, BYSTANDER, 'Blair Other')],
    ]),
    consents: new Map(),
    attendance: [
      {
        id: 'att-1',
        auth0_id: CALLER_COACH,
        student_id: STUDENT,
        session_date: '2026-09-25',
        status: 'present',
        note: null,
        created_at: ISO,
        updated_at: ISO,
      },
      {
        id: 'att-2',
        auth0_id: BYSTANDER_COACH,
        student_id: BYSTANDER_STUDENT,
        session_date: '2026-09-25',
        status: 'absent',
        note: null,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    notifications: [
      { id: 'note-1', auth0_id: CALLER, type: 'report_ready', title: 'Report ready', read: false },
      {
        id: 'note-2',
        auth0_id: BYSTANDER,
        type: 'report_ready',
        title: 'Bystander only',
        read: false,
      },
    ],
    schedule: [
      {
        id: 'event-1',
        auth0_id: CALLER_COACH,
        title: 'Team practice',
        event_type: 'practice',
        starts_at: ISO,
        ends_at: null,
        location: null,
        description: null,
        status: 'scheduled',
        created_at: ISO,
        updated_at: ISO,
      },
      {
        id: 'event-2',
        auth0_id: BYSTANDER_COACH,
        title: 'Other team practice',
        event_type: 'practice',
        starts_at: ISO,
        ends_at: null,
        location: null,
        description: null,
        status: 'scheduled',
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    analyses: [
      {
        server_job_id: 'job-caller',
        auth0_id: CALLER_COACH,
        student_id: STUDENT,
        session_token: 'session-caller',
        player_index: 1,
        display_name: 'Caller clip',
        requested_at: ISO,
      },
      {
        server_job_id: 'job-bystander',
        auth0_id: BYSTANDER_COACH,
        student_id: BYSTANDER_STUDENT,
        session_token: 'session-bystander',
        player_index: 1,
        display_name: 'Bystander clip',
        requested_at: ISO,
      },
    ],
    metrics: [
      {
        id: 'metric-1',
        auth0_id: CALLER_COACH,
        student_id: STUDENT,
        metric_key: 'sprint_time',
        metric_value: 4.2,
        unit: 's',
        source_analysis_id: null,
        measured_at: ISO,
        created_at: ISO,
      },
    ],
    reports: [
      {
        id: 'report-1',
        auth0_id: CALLER_COACH,
        student_id: STUDENT,
        report_type: 'monthly',
        title: 'August report',
        period_start: null,
        period_end: null,
        content_json: {},
        full_name: 'Avery Stone',
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    objectives: [
      {
        id: 'obj-1',
        org_auth0_id: CALLER_COACH,
        student_id: STUDENT,
        team_id: null,
        finding_id: null,
        analysis_job_id: null,
        title: 'Rebounding',
        description: null,
        status: 'active',
        due_on: null,
        created_by: null,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    privacyRequests: new Map(),
    seq: 0,
    queries: [],
  }
  restoreConnection = setHistoryStoreConnectionForTests(makeStubConnection(state))
  return state
}

const putConsent = (
  state: StubState,
  studentId: string,
  overrides: Partial<StoredConsent> = {},
) => {
  state.consents.set(studentId, {
    student_id: studentId,
    training_data: false,
    medical_data: false,
    marketing: false,
    policy_version: CONSENT_POLICY_VERSION,
    updated_at: ISO,
    ...overrides,
  })
}

const requestHeaders = (auth0Id: string): Record<string, string> => ({
  'x-verified-auth0-id': auth0Id,
  ...(process.env.SERVICE_TOKEN ? { 'x-service-token': process.env.SERVICE_TOKEN } : {}),
})

const call = (method: 'GET' | 'PUT' | 'POST', path: string, auth0Id: string, body?: unknown) =>
  meRoutes.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...requestHeaders(auth0Id),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )

const get = (path: string, auth0Id: string) => call('GET', path, auth0Id)

/** The fire-and-forget audit write lands a tick after the response. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

/** Data reads only — the DDL ensureInitialized runs first is not one. */
const dataQueries = (state: StubState) =>
  state.queries.filter((entry) => entry.sql.startsWith('select'))

const writes = (state: StubState) =>
  state.queries.filter((entry) => /^(insert|update|delete)/.test(entry.sql))

const auditInserts = (state: StubState) =>
  state.queries.filter((entry) => entry.sql.includes('insert into audit_logs'))

afterEach(() => {
  restoreConnection?.()
  restoreConnection = null
})

describe('player consent', () => {
  test('a linked player with no row reads the all-denied default', async () => {
    useStub()

    expect(await consentForStudent(STUDENT)).toEqual({
      linked: true,
      studentId: STUDENT,
      policyVersion: CONSENT_POLICY_VERSION,
      trainingData: false,
      medicalData: false,
      marketing: false,
      updatedAt: null,
    })
  })

  test('a caller with no linked player gets a clear unlinked shape, not an error', () => {
    expect(unlinkedConsent()).toEqual({
      linked: false,
      policyVersion: CONSENT_POLICY_VERSION,
      trainingData: false,
      medicalData: false,
      marketing: false,
      updatedAt: null,
    })
    expect(unlinkedConsent()).not.toHaveProperty('studentId')
  })

  test('a stored row reads back under the policy version it was written with', async () => {
    const state = useStub()
    putConsent(state, STUDENT, { training_data: true, policy_version: '2026-01-15' })

    expect(await consentForStudent(STUDENT)).toEqual({
      linked: true,
      studentId: STUDENT,
      policyVersion: '2026-01-15',
      trainingData: true,
      medicalData: false,
      marketing: false,
      updatedAt: ISO,
    })
  })

  test('upsert round-trip: one purpose at a time, the others preserved', async () => {
    const state = useStub()
    putConsent(state, STUDENT, { training_data: true, medical_data: true })

    const first = await upsertConsent(STUDENT, { marketing: true })
    expect(first).toMatchObject({
      linked: true,
      studentId: STUDENT,
      trainingData: true,
      medicalData: true,
      marketing: true,
      updatedAt: expect.any(String),
    })

    // A second write must not reset the first, and must not re-stamp the policy.
    const second = await upsertConsent(STUDENT, { marketing: false })
    expect(second).toMatchObject({
      trainingData: true,
      medicalData: true,
      marketing: false,
      policyVersion: CONSENT_POLICY_VERSION,
    })
    expect(state.consents.get(STUDENT)?.training_data).toBe(true)
  })

  test('a first write on a new row stamps the current policy version', async () => {
    const state = useStub()

    expect(await upsertConsent(STUDENT, { trainingData: true })).toMatchObject({
      policyVersion: CONSENT_POLICY_VERSION,
      trainingData: true,
      medicalData: false,
      marketing: false,
    })
    expect(state.consents.get(STUDENT)?.policy_version).toBe(CONSENT_POLICY_VERSION)
  })

  test('validation rejects unknown fields, non-booleans and non-objects', () => {
    expect(validateConsentPatch({ trainingData: 'yes' })).toEqual({
      ok: false,
      message: 'trainingData must be a boolean',
    })
    expect(validateConsentPatch({ medical_data: true })).toEqual({
      ok: false,
      message: 'Unknown field: medical_data',
    })
    expect(validateConsentPatch([true])).toEqual({
      ok: false,
      message: 'Body must be a JSON object',
    })
    expect(validateConsentPatch({})).toEqual({ ok: true, value: {} })
    expect(validateConsentPatch({ trainingData: false, marketing: true })).toEqual({
      ok: true,
      value: { trainingData: false, marketing: true },
    })
  })
})

describe('GET/PUT /api/me/consent', () => {
  test('GET returns the linked player consent', async () => {
    const state = useStub()
    putConsent(state, STUDENT, { training_data: true })

    const res = await get('/api/me/consent', CALLER)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      linked: true,
      studentId: STUDENT,
      policyVersion: CONSENT_POLICY_VERSION,
      trainingData: true,
      medicalData: false,
      marketing: false,
      updatedAt: ISO,
    })
  })

  test('GET for an account with no linked player answers 200 linked:false', async () => {
    const state = useStub()
    state.students.delete(CALLER)

    const res = await get('/api/me/consent', CALLER)

    expect(res.status).toBe(200)
    const body = (await res.json()) as Row
    expect(body.linked).toBe(false)
    expect(body.studentId).toBeUndefined()
    expect(body.policyVersion).toBe(CONSENT_POLICY_VERSION)
  })

  test('GET without a verified identity is the canonical 403', async () => {
    useStub()

    const res = await get('/api/me/consent', '')

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Missing verified identity',
    })
  })

  test('PUT persists a partial patch and audits the change', async () => {
    const state = useStub()

    const res = await call('PUT', '/api/me/consent', CALLER, { medicalData: true })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ linked: true, medicalData: true, marketing: false })
    expect(state.consents.get(STUDENT)?.medical_data).toBe(true)
    // No bystander row is touched — the write is keyed by the caller's student.
    expect(state.consents.has(BYSTANDER_STUDENT)).toBe(false)

    await flush()
    const audits = auditInserts(state)
    expect(audits).toHaveLength(1)
    expect(audits[0].values).toContain('player_consent')
    expect(audits[0].values).toContain(STUDENT)
    expect(audits[0].values).toContain(CALLER)
  })

  test('PUT with an invalid body is 400 and writes nothing', async () => {
    const state = useStub()

    const res = await call('PUT', '/api/me/consent', CALLER, { trainingData: 'yes' })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST', retryable: false })
    expect(state.consents.size).toBe(0)
  })

  test('PUT with no linked player is the shared 403 No linked player account', async () => {
    const state = useStub()
    state.students.delete(CALLER)

    const res = await call('PUT', '/api/me/consent', CALLER, { trainingData: true })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'No linked player account',
      layer: 'server',
      retryable: false,
    })
    expect(state.consents.size).toBe(0)
  })
})

describe('GET /api/me/export', () => {
  test('the bundle carries every key the data-portability claim promises', async () => {
    const state = useStub()
    putConsent(state, STUDENT, { training_data: true })

    const res = await get('/api/me/export', CALLER)
    const bundle = (await res.json()) as AccountExport

    expect(Object.keys(bundle).sort()).toEqual(
      [
        'account',
        'analyses',
        'attendance',
        'attendanceSummary',
        'coachAuth0Id',
        'consent',
        'displaySettings',
        'exportedAt',
        'formatVersion',
        'notificationPreferences',
        'notifications',
        'objectives',
        'performance',
        'privacyRequests',
        'reports',
        'schedule',
        'student',
        'user',
      ].sort(),
    )
    expect(bundle.formatVersion).toBe(EXPORT_FORMAT_VERSION)
    expect(bundle.account).toEqual({ auth0Id: CALLER })
    expect(bundle.user?.auth0_id).toBe(CALLER)
    expect(bundle.student?.id).toBe(STUDENT)
    expect(bundle.coachAuth0Id).toBe(CALLER_COACH)
    expect(bundle.attendance.map((row) => row.id)).toEqual(['att-1'])
    expect(bundle.attendanceSummary?.total_records).toBe(1)
    expect(bundle.schedule.map((row) => row.id)).toEqual(['event-1'])
    expect(bundle.performance).toHaveLength(2)
    expect(bundle.analyses.map((row) => row.server_job_id)).toEqual(['job-caller'])
    expect(bundle.reports.map((row) => row.id)).toEqual(['report-1'])
    expect(bundle.objectives.map((row) => row.id)).toEqual(['obj-1'])
    expect(bundle.notifications.map((row) => row.id)).toEqual(['note-1'])
    expect(bundle.notificationPreferences.inApp).toBe(true)
    expect(bundle.displaySettings.theme).toBe('system')
    expect(bundle.consent).toMatchObject({ linked: true, trainingData: true })
    expect(bundle.privacyRequests).toEqual([])
  })

  test('every statement is bound to the caller, the linked coach or the linked student', async () => {
    const state = useStub()

    await get('/api/me/export', CALLER)

    // The fixture answers by binding: a statement bound to a bystander id would
    // return THEIR rows. So this proves the bystander's ids were never bound —
    // not even as an unused parameter.
    const forbidden = [BYSTANDER, BYSTANDER_COACH, BYSTANDER_STUDENT]
    for (const entry of dataQueries(state)) {
      for (const value of entry.values) {
        expect(forbidden).not.toContain(value)
      }
    }
    const bound = dataQueries(state).flatMap((entry) => entry.values)
    expect(bound).toContain(CALLER)
    expect(bound).toContain(CALLER_COACH)
    expect(bound).toContain(STUDENT)
  })

  test('no bystander row appears anywhere in the serialized bundle', async () => {
    useStub()

    const res = await get('/api/me/export', CALLER)
    const text = JSON.stringify(await res.json())

    expect(text).not.toContain(BYSTANDER)
    expect(text).not.toContain(BYSTANDER_COACH)
    expect(text).not.toContain(BYSTANDER_STUDENT)
    expect(text).not.toContain('Bystander')
    expect(text).not.toContain('Blair')
  })

  test('an unlinked account exports its own data and no coaching data', async () => {
    const state = useStub()
    state.students.delete(CALLER)

    const bundle = (await (await get('/api/me/export', CALLER)).json()) as AccountExport

    expect(bundle.student).toBeNull()
    expect(bundle.coachAuth0Id).toBeNull()
    expect(bundle.attendance).toEqual([])
    expect(bundle.attendanceSummary).toBeNull()
    expect(bundle.schedule).toEqual([])
    expect(bundle.performance).toEqual([])
    expect(bundle.analyses).toEqual([])
    expect(bundle.reports).toEqual([])
    expect(bundle.objectives).toEqual([])
    // The account's OWN records are still there.
    expect(bundle.user?.auth0_id).toBe(CALLER)
    expect(bundle.notifications.map((row) => row.id)).toEqual(['note-1'])
    expect(bundle.consent).toEqual(unlinkedConsent())
  })

  test('wellness keys are stripped from every exported analysis', async () => {
    useStub()

    const bundle = (await (await get('/api/me/export', CALLER)).json()) as AccountExport

    expect(bundle.analyses).toHaveLength(1)
    expect(JSON.stringify(bundle.analyses)).not.toContain('injury_risk')
  })

  test('the response is a JSON attachment named for the day', async () => {
    useStub()

    const res = await get('/api/me/export', CALLER)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${exportFilename()}"`,
    )
    expect(exportFilename(new Date('2026-09-26T12:00:00.000Z'))).toBe(
      'coachxyz-export-2026-09-26.json',
    )
  })

  test('buildAccountExport takes only the verified sub — there is no id to aim it with', async () => {
    useStub()
    const seen: string[] = []
    const sources: Partial<AccountExportSources> = {
      getLinkedPlayer: async (auth0Id) => {
        seen.push(auth0Id)
        return null
      },
    }

    const bundle = await buildAccountExport(CALLER, sources)

    expect(seen).toEqual([CALLER])
    expect(bundle.account.auth0Id).toBe(CALLER)
    expect(bundle.student).toBeNull()
  })
})

describe('privacy requests', () => {
  test('creating one records status received and returns the row', async () => {
    const state = useStub()

    const res = await call('POST', '/api/me/privacy-requests', CALLER, { type: 'export' })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { request: PrivacyRequest }
    expect(body.request).toMatchObject({ type: 'export', status: 'received', resolvedAt: null })
    expect(body.request.id).toEqual(expect.any(String))
    expect(state.privacyRequests.get(CALLER)).toHaveLength(1)

    await flush()
    const audits = auditInserts(state)
    expect(audits).toHaveLength(1)
    expect(audits[0].values).toContain('privacy_request')
    expect(audits[0].values).toContain(body.request.id)
  })

  test('the list is the caller own, newest first, and never the bystander', async () => {
    useStub()
    await call('POST', '/api/me/privacy-requests', CALLER, { type: 'export' })
    await call('POST', '/api/me/privacy-requests', CALLER, { type: 'delete' })
    await call('POST', '/api/me/privacy-requests', BYSTANDER, { type: 'delete' })

    const res = await get('/api/me/privacy-requests', CALLER)
    const body = (await res.json()) as { requests: PrivacyRequest[] }

    expect(res.status).toBe(200)
    expect(body.requests.map((request) => request.type)).toEqual(['delete', 'export'])
    expect(await listPrivacyRequests(BYSTANDER)).toHaveLength(1)
  })

  test('a missing or unknown type is 400 and records nothing', async () => {
    const state = useStub()

    const unknown = await call('POST', '/api/me/privacy-requests', CALLER, {
      type: 'wipe_everything',
    })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'type must be one of export, delete',
    })

    const extra = await call('POST', '/api/me/privacy-requests', CALLER, { note: 'please' })
    expect(extra.status).toBe(400)
    expect(state.privacyRequests.size).toBe(0)
  })

  test('validation accepts only export|delete', () => {
    expect(validatePrivacyRequestBody({ type: 'export' })).toEqual({
      ok: true,
      value: { type: 'export' },
    })
    expect(validatePrivacyRequestBody({ type: 'delete' })).toEqual({
      ok: true,
      value: { type: 'delete' },
    })
    expect(validatePrivacyRequestBody({ type: 'purge' })).toEqual({
      ok: false,
      message: 'type must be one of export, delete',
    })
    expect(validatePrivacyRequestBody({ type: 'export', force: true })).toEqual({
      ok: false,
      message: 'Unknown field: force',
    })
    expect(validatePrivacyRequestBody(null)).toEqual({
      ok: false,
      message: 'Body must be a JSON object',
    })
  })

  test('a delete request is RECORDED ONLY: it deletes nothing and cascades to nothing', async () => {
    const state = useStub()
    putConsent(state, STUDENT, { training_data: true })

    const res = await call('POST', '/api/me/privacy-requests', CALLER, { type: 'delete' })
    expect(res.status).toBe(201)

    // The only statement this request performs is its own INSERT (plus the
    // fire-and-forget audit insert). Nothing is updated, nothing is deleted.
    const statements = writes(state).filter(
      (entry) => !entry.sql.includes('insert into audit_logs'),
    )
    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toContain('insert into privacy_requests')
    expect(state.queries.filter((entry) => entry.sql.startsWith('delete'))).toEqual([])

    // Every record the request is about is still exactly where it was.
    expect(state.students.get(CALLER)?.id).toBe(STUDENT)
    expect(state.consents.get(STUDENT)?.training_data).toBe(true)
    expect(state.attendance).toHaveLength(2)
    expect(state.analyses).toHaveLength(2)

    // …and the account can still read its own data afterwards.
    const bundle = (await (await get('/api/me/export', CALLER)).json()) as AccountExport
    expect(bundle.student?.id).toBe(STUDENT)
    expect(bundle.attendance).toHaveLength(1)
    expect(bundle.privacyRequests.map((request) => request.status)).toEqual(['received'])
  })

  test('createPrivacyRequest is additive and the list is capped', async () => {
    const state = useStub()

    for (let i = 0; i < 3; i += 1) await createPrivacyRequest(CALLER, 'export')

    expect(state.privacyRequests.get(CALLER)).toHaveLength(3)
    expect(await listPrivacyRequests(CALLER)).toHaveLength(3)
    expect(await listPrivacyRequests(CALLER, { limit: 1 })).toHaveLength(1)
    expect(await listPrivacyRequests(CALLER, { limit: 9999 })).toHaveLength(3)
  })
})
