import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests, withHistoryStoreOrThrow } from '../src/lib/historyStore'
import {
  DEFAULT_EVENTS,
  isEventEnabled,
  notificationPrefs,
  upsertNotificationPrefs,
  validateNotificationPrefsPatch,
} from '../src/lib/notificationPrefs'
import {
  analysisNotificationRecipients,
  createNotification,
  type CreateNotificationInput,
} from '../src/lib/notifications'
import { fanOutAttendanceNotifications } from '../src/routes/org/attendance'
import type { AttendanceRecord, Student } from '../src/lib/orgData'

type StoredPreferences = {
  auth0_id: string
  in_app: boolean
  cadence: string
  events: Record<string, boolean>
  updated_at: string
}

type StubState = {
  preferences: Map<string, StoredPreferences>
  notificationInserts: CreateNotificationInput[]
  auditInserts: number
}

const cloneEvents = (events: Record<string, boolean>): Record<string, boolean> => ({ ...events })

const makeStubConnection = (state: StubState): SQL => {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()

    if (query.includes('from notification_preferences')) {
      const row = state.preferences.get(values[0] as string)
      return row
        ? [
            {
              in_app: row.in_app,
              cadence: row.cadence,
              events: cloneEvents(row.events),
              updated_at: row.updated_at,
            },
          ]
        : []
    }

    if (query.includes('insert into notification_preferences')) {
      const auth0Id = values[0] as string
      const existing = state.preferences.get(auth0Id)
      const nextEvents = (
        typeof values[3] === 'string' ? JSON.parse(values[3]) : values[3]
      ) as Record<string, boolean>
      const row: StoredPreferences = {
        auth0_id: auth0Id,
        in_app: values[1] as boolean,
        cadence: values[2] as string,
        events: {
          ...(existing?.events ?? {}),
          ...nextEvents,
        },
        updated_at: new Date().toISOString(),
      }
      state.preferences.set(auth0Id, row)
      return [
        {
          in_app: row.in_app,
          cadence: row.cadence,
          events: cloneEvents(row.events),
          updated_at: row.updated_at,
        },
      ]
    }

    if (query.includes('insert into notifications')) {
      const input: CreateNotificationInput = {
        auth0Id: values[0] as string,
        type: values[1] as string,
        title: values[2] as string,
        body: values[3] as string | null,
        data: JSON.parse(values[4] as string) as Record<string, unknown>,
      }
      state.notificationInserts.push(input)
      return [
        {
          id: `notification-${state.notificationInserts.length}`,
          auth0_id: input.auth0Id,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: input.data ?? {},
          read: false,
          created_at: new Date().toISOString(),
        },
      ]
    }

    if (query.includes('insert into audit_logs')) {
      state.auditInserts += 1
    }
    return []
  }) as unknown as SQL

  return Object.assign(tag, {
    connect: async () => {},
    unsafe: () => '',
    close: async () => {},
  }) as SQL
}

let restoreConnection: (() => void) | null = null

const useStub = (): StubState => {
  const state: StubState = {
    preferences: new Map(),
    notificationInserts: [],
    auditInserts: 0,
  }
  restoreConnection = setHistoryStoreConnectionForTests(makeStubConnection(state))
  return state
}

const putPreferences = (state: StubState, auth0Id: string): void => {
  state.preferences.set(auth0Id, {
    auth0_id: auth0Id,
    in_app: true,
    cadence: 'instant',
    events: Object.fromEntries(
      Object.entries(DEFAULT_EVENTS).map(([event, enabled]) => [event, enabled]),
    ),
    updated_at: '2026-09-25T00:00:00.000Z',
  })
}

afterEach(() => {
  restoreConnection?.()
  restoreConnection = null
})

describe('notification preferences', () => {
  test('returns enabled defaults when no row exists', async () => {
    useStub()

    expect(await notificationPrefs('auth0|new-player')).toEqual({
      inApp: true,
      cadence: 'instant',
      events: {
        analysis_complete: true,
        analysis_failed: true,
        report_ready: true,
        attendance: true,
        ai_report: true,
        membership: true,
      },
      updatedAt: null,
    })
  })

  test('upserts a partial patch and reads back the full response shape', async () => {
    useStub()
    const auth0Id = 'auth0|settings-player'

    const first = await upsertNotificationPrefs(auth0Id, {
      inApp: false,
      cadence: 'weekly',
      events: { attendance: false },
    })
    expect(first).toEqual({
      inApp: false,
      cadence: 'weekly',
      events: {
        analysis_complete: true,
        analysis_failed: true,
        report_ready: true,
        attendance: false,
        ai_report: true,
        membership: true,
      },
      updatedAt: expect.any(String),
    })

    const second = await upsertNotificationPrefs(auth0Id, {
      events: { report_ready: false },
    })
    expect(second?.inApp).toBe(false)
    expect(second?.cadence).toBe('weekly')
    expect(second?.events).toEqual({
      analysis_complete: true,
      analysis_failed: true,
      report_ready: false,
      attendance: false,
      ai_report: true,
      membership: true,
    })
  })

  test('rejects invalid cadence, unknown event keys, and non-boolean event values', () => {
    expect(validateNotificationPrefsPatch({ cadence: 'hourly' })).toEqual({
      ok: false,
      message: 'cadence must be one of instant, daily, weekly',
    })
    expect(validateNotificationPrefsPatch({ events: { unknown_event: true } })).toEqual({
      ok: false,
      message: 'Unknown event: unknown_event',
    })
    expect(validateNotificationPrefsPatch({ events: { attendance: 'yes' } })).toEqual({
      ok: false,
      message: 'Event preferences must be booleans',
    })
  })

  test('only an explicit false disables an event; unknown event types stay enabled', async () => {
    const state = useStub()
    const auth0Id = 'auth0|event-preferences'
    putPreferences(state, auth0Id)
    const row = state.preferences.get(auth0Id)!
    row.events.analysis_complete = false

    expect(await isEventEnabled(auth0Id, 'analysis_complete')).toBe(false)
    expect(await isEventEnabled(auth0Id, 'future_event_type')).toBe(true)
  })

  test('suppressed events return null without inserting a notification', async () => {
    const state = useStub()
    const auth0Id = 'auth0|muted-player'
    putPreferences(state, auth0Id)
    state.preferences.get(auth0Id)!.events.analysis_failed = false

    const result = await createNotification({
      auth0Id,
      type: 'analysis_failed',
      title: 'Should not insert',
    })

    expect(result).toBeNull()
    expect(state.notificationInserts).toHaveLength(0)
  })
})

describe('notification fan-out recipients', () => {
  test('player-requested analysis notifies owner and requester, deduplicating equal ids', () => {
    expect(analysisNotificationRecipients('auth0|coach', 'auth0|player')).toEqual([
      'auth0|coach',
      'auth0|player',
    ])
    expect(analysisNotificationRecipients('auth0|coach', 'auth0|coach')).toEqual(['auth0|coach'])
  })

  test('attendance batch notifies each linked player once and skips unlinked students', async () => {
    const students: Pick<Student, 'id' | 'full_name' | 'account_auth0_id'>[] = [
      { id: 'student-1', full_name: 'Avery', account_auth0_id: 'auth0|player-1' },
      { id: 'student-1', full_name: 'Avery', account_auth0_id: 'auth0|player-1' },
      { id: 'student-2', full_name: 'Jordan', account_auth0_id: 'auth0|player-2' },
      { id: 'student-3', full_name: 'Morgan', account_auth0_id: null },
    ]
    const records: AttendanceRecord[] = [
      {
        id: 'attendance-1',
        auth0_id: 'auth0|coach',
        student_id: 'student-1',
        session_date: '2026-09-25',
        status: 'present',
        note: null,
        created_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
      },
      {
        id: 'attendance-2',
        auth0_id: 'auth0|coach',
        student_id: 'student-1',
        session_date: '2026-09-26',
        status: 'late',
        note: null,
        created_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
      },
      {
        id: 'attendance-3',
        auth0_id: 'auth0|coach',
        student_id: 'student-2',
        session_date: '2026-09-25',
        status: 'present',
        note: null,
        created_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
      },
      {
        id: 'attendance-4',
        auth0_id: 'auth0|coach',
        student_id: 'student-3',
        session_date: '2026-09-25',
        status: 'absent',
        note: null,
        created_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
      },
    ]
    const sent: CreateNotificationInput[] = []

    await fanOutAttendanceNotifications(students, records, async (input) => {
      sent.push(input)
      return null
    })

    expect(sent.map((input) => input.auth0Id)).toEqual(['auth0|player-1', 'auth0|player-2'])
    expect(sent.map((input) => input.type)).toEqual(['attendance', 'attendance'])
  })
})

const hasDb = Boolean(process.env.DATABASE_URL)

const newPreferenceRegressionId = (): string => `auth0|pref-regression-${crypto.randomUUID()}@test`

const deletePreferenceRegressionRow = async (auth0Id: string): Promise<void> => {
  await withHistoryStoreOrThrow(async (db) => {
    await db`delete from notification_preferences where auth0_id = ${auth0Id};`
  })
}

;(hasDb ? describe : describe.skip)('notification preferences DB integration', () => {
  test(
    'persists a false event from a partial event patch',
    async () => {
      const auth0Id = newPreferenceRegressionId()

      try {
        await upsertNotificationPrefs(auth0Id, {
          events: { analysis_complete: false },
        })

        const readBack = await notificationPrefs(auth0Id)
        expect(readBack.events.analysis_complete).toBe(false)
      } finally {
        await deletePreferenceRegressionRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )

  test(
    'preserves previously-muted events when a later event patch is partial',
    async () => {
      const auth0Id = newPreferenceRegressionId()

      try {
        await upsertNotificationPrefs(auth0Id, {
          events: { analysis_complete: false },
        })
        await upsertNotificationPrefs(auth0Id, {
          events: { report_ready: false },
        })

        const readBack = await notificationPrefs(auth0Id)
        expect(readBack.events.analysis_complete).toBe(false)
        expect(readBack.events.report_ready).toBe(false)
      } finally {
        await deletePreferenceRegressionRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )

  test(
    'preserves event keys when updating only inApp and cadence',
    async () => {
      const auth0Id = newPreferenceRegressionId()

      try {
        await upsertNotificationPrefs(auth0Id, {
          events: { analysis_complete: false, report_ready: false },
        })

        await upsertNotificationPrefs(auth0Id, { inApp: false })
        const afterInApp = await notificationPrefs(auth0Id)
        expect(afterInApp.events.analysis_complete).toBe(false)
        expect(afterInApp.events.report_ready).toBe(false)

        await upsertNotificationPrefs(auth0Id, { cadence: 'daily' })
        const afterCadence = await notificationPrefs(auth0Id)
        expect(afterCadence.inApp).toBe(false)
        expect(afterCadence.cadence).toBe('daily')
        expect(afterCadence.events.analysis_complete).toBe(false)
        expect(afterCadence.events.report_ready).toBe(false)
      } finally {
        await deletePreferenceRegressionRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )

  test(
    'treats an omitted stored event key as enabled',
    async () => {
      const auth0Id = newPreferenceRegressionId()

      try {
        await withHistoryStoreOrThrow(async (db) => {
          await db`
            insert into notification_preferences (auth0_id, in_app, cadence, events, updated_at)
            values (
              ${auth0Id},
              true,
              'instant',
              ${{ analysis_failed: false }}::jsonb,
              now()
            );
          `
        })

        const readBack = await notificationPrefs(auth0Id)
        expect(readBack.updatedAt).not.toBeNull()
        expect(readBack.events.analysis_complete).toBe(true)
      } finally {
        await deletePreferenceRegressionRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )
})
