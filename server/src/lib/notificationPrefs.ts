import { orDisabledDefault, withHistoryStore, withHistoryStoreOrThrow } from './historyStore'
import { logger } from './logger'

export const DEFAULT_EVENTS = Object.freeze({
  analysis_complete: true,
  analysis_failed: true,
  report_ready: true,
  attendance: true,
  ai_report: true,
  membership: true,
})

export type NotificationEvent = keyof typeof DEFAULT_EVENTS
export type NotificationEvents = { [Event in NotificationEvent]: boolean }
export type NotificationCadence = 'instant' | 'daily' | 'weekly'

export type NotificationPreferences = {
  inApp: boolean
  cadence: NotificationCadence
  events: NotificationEvents
  updatedAt: string | null
}

export type NotificationPreferencesPatch = {
  inApp?: boolean
  cadence?: NotificationCadence
  events?: Partial<NotificationEvents>
}

type NotificationPreferencesRow = {
  in_app: boolean
  cadence: string
  events: unknown
  updated_at: string | Date
}

const CADENCES: ReadonlySet<string> = new Set<NotificationCadence>(['instant', 'daily', 'weekly'])

const defaultEvents = (): NotificationEvents => ({
  analysis_complete: true,
  analysis_failed: true,
  report_ready: true,
  attendance: true,
  ai_report: true,
  membership: true,
})

export const defaultNotificationPreferences = (): NotificationPreferences => ({
  inApp: true,
  cadence: 'instant',
  events: defaultEvents(),
  updatedAt: null,
})

const toIsoString = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toNotificationPreferences = (row: NotificationPreferencesRow): NotificationPreferences => {
  const storedEvents =
    row.events && typeof row.events === 'object' && !Array.isArray(row.events)
      ? (row.events as Record<string, unknown>)
      : {}

  return {
    inApp: row.in_app !== false,
    cadence: CADENCES.has(row.cadence) ? (row.cadence as NotificationCadence) : 'instant',
    events: Object.fromEntries(
      (Object.keys(DEFAULT_EVENTS) as NotificationEvent[]).map((event) => [
        event,
        storedEvents[event] !== false,
      ]),
    ) as NotificationEvents,
    updatedAt: toIsoString(row.updated_at),
  }
}

/**
 * Read one account's preferences. A missing row (or an unavailable store) is the
 * enabled default: preferences must never implicitly mute an account.
 */
export const notificationPrefs = async (auth0Id: string): Promise<NotificationPreferences> => {
  const stored = await withHistoryStore(async (db) => {
    const rows = await db<NotificationPreferencesRow[]>`
      select in_app, cadence, events, updated_at
      from notification_preferences
      where auth0_id = ${auth0Id}
      limit 1;
    `
    return rows?.[0] ?? null
  })

  return orDisabledDefault(
    stored ? toNotificationPreferences(stored) : null,
    defaultNotificationPreferences(),
  )
}

/** Upsert a partial settings patch, preserving every omitted preference. */
export const upsertNotificationPrefs = async (
  auth0Id: string,
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferences | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    // Merge in JS, then write the complete object. A Postgres-side
    // `events || ${patch}::jsonb` merge does not survive Bun's parameter
    // serializer: the right-hand side arrives as a JSON scalar, the stored
    // value stops being an object, and every read then falls back to
    // all-enabled — silently discarding the user's choices. A settings write
    // is rare and the UI serializes saves, so read-merge-write is enough.
    const existing = await db<NotificationPreferencesRow[]>`
      select in_app, cadence, events, updated_at
      from notification_preferences
      where auth0_id = ${auth0Id}
      limit 1;
    `
    const current = existing?.[0]
      ? toNotificationPreferences(existing[0])
      : defaultNotificationPreferences()

    const next = {
      inApp: patch.inApp ?? current.inApp,
      cadence: patch.cadence ?? current.cadence,
      // Full key set every time: a missing key reads back as enabled, so a
      // partial write would silently re-enable events the user muted.
      events: { ...current.events, ...(patch.events ?? {}) } as NotificationEvents,
    }

    const rows = await db<NotificationPreferencesRow[]>`
      insert into notification_preferences (auth0_id, in_app, cadence, events, updated_at)
      values (
        ${auth0Id},
        ${next.inApp},
        ${next.cadence},
        -- Bind the object itself, never JSON.stringify(obj)::jsonb: Bun
        -- serializes the string form as a JSONB *string*
        -- (jsonb_typeof = 'string'), which every read then rejects as a
        -- non-object and falls back to all-enabled. Verified live.
        ${next.events}::jsonb,
        now()
      )
      on conflict (auth0_id) do update set
        in_app = excluded.in_app,
        cadence = excluded.cadence,
        events = excluded.events,
        updated_at = excluded.updated_at
      returning in_app, cadence, events, updated_at;
    `
    const row = rows?.[0]
    return row ? toNotificationPreferences(row) : null
  })
}

/**
 * Whether one in-app event is enabled. Only an explicit false suppresses an
 * event, so newly introduced event types remain enabled for existing rows.
 */
export const isEventEnabled = async (auth0Id: string, event: string): Promise<boolean> => {
  const preferences = await notificationPrefs(auth0Id)
  const isEnabled =
    preferences.inApp !== false && preferences.events[event as NotificationEvent] !== false

  if (!isEnabled) {
    logger.debug('notification_event_suppressed', {
      type: 'notification_event_suppressed',
      auth0Id,
      event,
    })
  }
  return isEnabled
}

export type NotificationPreferencesValidation =
  { ok: true; value: NotificationPreferencesPatch } | { ok: false; message: string }

/** Strict manual validation matching the existing server route conventions. */
export const validateNotificationPrefsPatch = (
  body: unknown,
): NotificationPreferencesValidation => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Body must be a JSON object' }
  }

  const value = body as Record<string, unknown>
  const unknownField = Object.keys(value).find(
    (key) => key !== 'inApp' && key !== 'cadence' && key !== 'events',
  )
  if (unknownField) {
    return { ok: false, message: `Unknown field: ${unknownField}` }
  }
  if (value.inApp !== undefined && typeof value.inApp !== 'boolean') {
    return { ok: false, message: 'inApp must be a boolean' }
  }
  if (value.cadence !== undefined && !CADENCES.has(String(value.cadence))) {
    return { ok: false, message: 'cadence must be one of instant, daily, weekly' }
  }

  let events: Partial<NotificationEvents> | undefined
  if (value.events !== undefined) {
    if (!value.events || typeof value.events !== 'object' || Array.isArray(value.events)) {
      return { ok: false, message: 'events must be a JSON object' }
    }

    const eventValues = value.events as Record<string, unknown>
    const eventKeys = Object.keys(eventValues)
    const unknownEvent = eventKeys.find(
      (event) => !Object.prototype.hasOwnProperty.call(DEFAULT_EVENTS, event),
    )
    if (unknownEvent) {
      return { ok: false, message: `Unknown event: ${unknownEvent}` }
    }
    if (eventKeys.some((event) => typeof eventValues[event] !== 'boolean')) {
      return { ok: false, message: 'Event preferences must be booleans' }
    }

    events = Object.fromEntries(
      eventKeys.map((event) => [event, eventValues[event]]),
    ) as Partial<NotificationEvents>
  }

  return {
    ok: true,
    value: {
      ...(value.inApp === undefined ? {} : { inApp: value.inApp as boolean }),
      ...(value.cadence === undefined ? {} : { cadence: value.cadence as NotificationCadence }),
      ...(events === undefined ? {} : { events }),
    },
  }
}
