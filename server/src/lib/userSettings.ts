import { orDisabledDefault, withHistoryStore, withHistoryStoreOrThrow } from './historyStore'

export type Theme = 'system' | 'light' | 'dark'
export type UserSettings = {
  theme: Theme
  reduceMotion: boolean
  weekStartsMonday: boolean
  updatedAt: string | null
}

export type UserSettingsPatch = {
  theme?: Theme
  reduceMotion?: boolean
  weekStartsMonday?: boolean
}

type UserSettingsRow = {
  theme: string
  reduce_motion: boolean
  week_starts_monday: boolean
  updated_at: string | Date
}

const THEME_SET: ReadonlySet<string> = new Set<Theme>(['system', 'light', 'dark'])

export const defaultUserSettings = (): UserSettings => ({
  theme: 'system',
  reduceMotion: false,
  weekStartsMonday: false,
  updatedAt: null,
})

const toIsoString = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toUserSettings = (row: UserSettingsRow): UserSettings => ({
  theme: THEME_SET.has(row.theme) ? (row.theme as Theme) : 'system',
  reduceMotion: row.reduce_motion === true,
  weekStartsMonday: row.week_starts_monday === true,
  updatedAt: toIsoString(row.updated_at),
})

/**
 * Read one account's display settings. A missing row (or an unavailable store)
 * is the app default, so a disabled store never blocks a sign-in.
 */
export const userSettings = async (auth0Id: string): Promise<UserSettings> => {
  const stored = await withHistoryStore(async (db) => {
    const rows = await db<UserSettingsRow[]>`
      select theme, reduce_motion, week_starts_monday, updated_at
      from user_settings
      where auth0_id = ${auth0Id}
      limit 1;
    `
    return rows?.[0] ?? null
  })

  return orDisabledDefault(stored ? toUserSettings(stored) : null, defaultUserSettings())
}

/** Upsert a partial settings patch, preserving every omitted preference. */
export const upsertUserSettings = async (
  auth0Id: string,
  patch: UserSettingsPatch,
): Promise<UserSettings | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    // Merge in JS, then write the complete row: every column is a scalar, so
    // there is no JSONB merge to perform and a single insert-on-conflict with
    // explicit values is the whole write. A read-merge is still needed for
    // omitted columns to survive.
    const existing = await db<UserSettingsRow[]>`
      select theme, reduce_motion, week_starts_monday, updated_at
      from user_settings
      where auth0_id = ${auth0Id}
      limit 1;
    `
    const current = existing?.[0] ? toUserSettings(existing[0]) : defaultUserSettings()

    const next = {
      theme: patch.theme ?? current.theme,
      reduceMotion: patch.reduceMotion ?? current.reduceMotion,
      weekStartsMonday: patch.weekStartsMonday ?? current.weekStartsMonday,
    }

    const rows = await db<UserSettingsRow[]>`
      insert into user_settings (
        auth0_id, theme, reduce_motion, week_starts_monday, updated_at
      )
      values (
        ${auth0Id},
        ${next.theme},
        ${next.reduceMotion},
        ${next.weekStartsMonday},
        now()
      )
      on conflict (auth0_id) do update set
        theme = excluded.theme,
        reduce_motion = excluded.reduce_motion,
        week_starts_monday = excluded.week_starts_monday,
        updated_at = excluded.updated_at
      returning theme, reduce_motion, week_starts_monday, updated_at;
    `
    const row = rows?.[0]
    return row ? toUserSettings(row) : null
  })
}

export type UserSettingsValidation =
  { ok: true; value: UserSettingsPatch } | { ok: false; message: string }

/** Strict manual validation matching the existing server route conventions. */
export const validateUserSettingsPatch = (body: unknown): UserSettingsValidation => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Body must be a JSON object' }
  }

  const value = body as Record<string, unknown>
  const unknownField = Object.keys(value).find(
    (key) => key !== 'theme' && key !== 'reduceMotion' && key !== 'weekStartsMonday',
  )
  if (unknownField) {
    return { ok: false, message: `Unknown field: ${unknownField}` }
  }
  if (value.theme !== undefined && !THEME_SET.has(String(value.theme))) {
    return { ok: false, message: 'theme must be one of system, light, dark' }
  }
  if (value.reduceMotion !== undefined && typeof value.reduceMotion !== 'boolean') {
    return { ok: false, message: 'reduceMotion must be a boolean' }
  }
  if (value.weekStartsMonday !== undefined && typeof value.weekStartsMonday !== 'boolean') {
    return { ok: false, message: 'weekStartsMonday must be a boolean' }
  }

  return {
    ok: true,
    value: {
      ...(value.theme === undefined ? {} : { theme: value.theme as Theme }),
      ...(value.reduceMotion === undefined ? {} : { reduceMotion: value.reduceMotion as boolean }),
      ...(value.weekStartsMonday === undefined
        ? {}
        : { weekStartsMonday: value.weekStartsMonday as boolean }),
    },
  }
}
