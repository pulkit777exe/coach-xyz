import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests, withHistoryStoreOrThrow } from '../src/lib/historyStore'
import {
  defaultUserSettings,
  upsertUserSettings,
  userSettings,
  validateUserSettingsPatch,
} from '../src/lib/userSettings'

type StoredSettings = {
  auth0_id: string
  theme: string
  reduce_motion: boolean
  week_starts_monday: boolean
  updated_at: string
}

type InsertCall = {
  auth0Id: string
  theme: unknown
  reduceMotion: unknown
  weekStartsMonday: unknown
}

type StubState = {
  settings: Map<string, StoredSettings>
  inserts: InsertCall[]
}

const makeStubConnection = (state: StubState): SQL => {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()

    if (query.includes('from user_settings')) {
      const row = state.settings.get(values[0] as string)
      return row
        ? [
            {
              theme: row.theme,
              reduce_motion: row.reduce_motion,
              week_starts_monday: row.week_starts_monday,
              updated_at: row.updated_at,
            },
          ]
        : []
    }

    if (query.includes('insert into user_settings')) {
      const auth0Id = values[0] as string
      state.inserts.push({
        auth0Id,
        theme: values[1],
        reduceMotion: values[2],
        weekStartsMonday: values[3],
      })
      const row: StoredSettings = {
        auth0_id: auth0Id,
        theme: values[1] as string,
        reduce_motion: values[2] as boolean,
        week_starts_monday: values[3] as boolean,
        updated_at: new Date().toISOString(),
      }
      state.settings.set(auth0Id, row)
      return [
        {
          theme: row.theme,
          reduce_motion: row.reduce_motion,
          week_starts_monday: row.week_starts_monday,
          updated_at: row.updated_at,
        },
      ]
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
  const state: StubState = { settings: new Map(), inserts: [] }
  restoreConnection = setHistoryStoreConnectionForTests(makeStubConnection(state))
  return state
}

afterEach(() => {
  restoreConnection?.()
  restoreConnection = null
})

describe('user settings', () => {
  test('returns app defaults when no row exists', async () => {
    useStub()

    expect(await userSettings('auth0|new-player')).toEqual({
      theme: 'system',
      reduceMotion: false,
      weekStartsMonday: false,
      updatedAt: null,
    })
    expect(defaultUserSettings().updatedAt).toBeNull()
  })

  test('returns app defaults when the history store is disabled', async () => {
    restoreConnection = setHistoryStoreConnectionForTests(null)

    expect(await userSettings('auth0|no-db')).toEqual({
      theme: 'system',
      reduceMotion: false,
      weekStartsMonday: false,
      updatedAt: null,
    })
  })

  test('upserts a patch and reads back the full response shape', async () => {
    useStub()
    const auth0Id = 'auth0|settings-player'

    const saved = await upsertUserSettings(auth0Id, {
      theme: 'dark',
      reduceMotion: true,
      weekStartsMonday: true,
    })
    if (!saved) throw new Error('expected the upsert to return the stored row')
    expect(saved).toEqual({
      theme: 'dark',
      reduceMotion: true,
      weekStartsMonday: true,
      updatedAt: expect.any(String),
    })

    const readBack = await userSettings(auth0Id)
    expect(readBack.theme).toBe('dark')
    expect(readBack.reduceMotion).toBe(true)
    expect(readBack.weekStartsMonday).toBe(true)
    expect(readBack.updatedAt).toBe(saved.updatedAt)
  })

  test('a partial patch preserves every omitted field', async () => {
    useStub()
    const auth0Id = 'auth0|partial-patch'

    await upsertUserSettings(auth0Id, {
      theme: 'dark',
      reduceMotion: true,
      weekStartsMonday: true,
    })

    const afterThemeOnly = await upsertUserSettings(auth0Id, { theme: 'light' })
    expect(afterThemeOnly).toEqual({
      theme: 'light',
      reduceMotion: true,
      weekStartsMonday: true,
      updatedAt: expect.any(String),
    })

    const afterMotionOnly = await upsertUserSettings(auth0Id, { reduceMotion: false })
    expect(afterMotionOnly?.theme).toBe('light')
    expect(afterMotionOnly?.reduceMotion).toBe(false)
    expect(afterMotionOnly?.weekStartsMonday).toBe(true)
  })

  test('an empty patch still writes the full row and preserves stored values', async () => {
    const state = useStub()
    const auth0Id = 'auth0|empty-patch'

    await upsertUserSettings(auth0Id, { theme: 'light', weekStartsMonday: true })
    const afterEmpty = await upsertUserSettings(auth0Id, {})

    expect(afterEmpty?.theme).toBe('light')
    expect(afterEmpty?.weekStartsMonday).toBe(true)
    expect(afterEmpty?.reduceMotion).toBe(false)
    // The upsert binds every column explicitly — no JSONB merge to fall back on.
    expect(state.inserts[1]).toEqual({
      auth0Id,
      theme: 'light',
      reduceMotion: false,
      weekStartsMonday: true,
    })
  })

  test('falls back to defaults for an out-of-range stored theme', async () => {
    const state = useStub()
    const auth0Id = 'auth0|stale-theme'
    await upsertUserSettings(auth0Id, { theme: 'dark' })
    state.settings.get(auth0Id)!.theme = 'sepia'

    expect((await userSettings(auth0Id)).theme).toBe('system')
  })
})

describe('validateUserSettingsPatch', () => {
  test('accepts a full patch and an empty patch', () => {
    expect(
      validateUserSettingsPatch({
        theme: 'dark',
        reduceMotion: true,
        weekStartsMonday: false,
      }),
    ).toEqual({ ok: true, value: { theme: 'dark', reduceMotion: true, weekStartsMonday: false } })

    expect(validateUserSettingsPatch({})).toEqual({ ok: true, value: {} })
    expect(validateUserSettingsPatch({ theme: 'system' })).toEqual({
      ok: true,
      value: { theme: 'system' },
    })
  })

  test('rejects an unknown field', () => {
    expect(validateUserSettingsPatch({ accent: 'blue' })).toEqual({
      ok: false,
      message: 'Unknown field: accent',
    })
  })

  test('rejects a theme outside system/light/dark', () => {
    expect(validateUserSettingsPatch({ theme: 'midnight' })).toEqual({
      ok: false,
      message: 'theme must be one of system, light, dark',
    })
    expect(validateUserSettingsPatch({ theme: 1 })).toEqual({
      ok: false,
      message: 'theme must be one of system, light, dark',
    })
  })

  test('rejects non-boolean motion and week-start flags', () => {
    expect(validateUserSettingsPatch({ reduceMotion: 'yes' })).toEqual({
      ok: false,
      message: 'reduceMotion must be a boolean',
    })
    expect(validateUserSettingsPatch({ weekStartsMonday: 'no' })).toEqual({
      ok: false,
      message: 'weekStartsMonday must be a boolean',
    })
  })

  test('rejects a non-object body', () => {
    expect(validateUserSettingsPatch(null)).toEqual({
      ok: false,
      message: 'Body must be a JSON object',
    })
    expect(validateUserSettingsPatch(['dark'])).toEqual({
      ok: false,
      message: 'Body must be a JSON object',
    })
  })
})

const hasDb = Boolean(process.env.DATABASE_URL)

const newSettingsTestId = (): string => `auth0|user-settings-${crypto.randomUUID()}@test`

const deleteSettingsRow = async (auth0Id: string): Promise<void> => {
  await withHistoryStoreOrThrow(async (db) => {
    await db`delete from user_settings where auth0_id = ${auth0Id};`
  })
}

;(hasDb ? describe : describe.skip)('user settings DB integration', () => {
  test(
    'persists a patch and preserves omitted fields on the next write',
    async () => {
      const auth0Id = newSettingsTestId()

      try {
        await upsertUserSettings(auth0Id, {
          theme: 'dark',
          reduceMotion: true,
          weekStartsMonday: true,
        })

        const afterThemeOnly = await upsertUserSettings(auth0Id, { theme: 'light' })
        expect(afterThemeOnly?.theme).toBe('light')
        expect(afterThemeOnly?.reduceMotion).toBe(true)
        expect(afterThemeOnly?.weekStartsMonday).toBe(true)

        const readBack = await userSettings(auth0Id)
        expect(readBack.theme).toBe('light')
        expect(readBack.reduceMotion).toBe(true)
        expect(readBack.weekStartsMonday).toBe(true)
        expect(readBack.updatedAt).not.toBeNull()
      } finally {
        await deleteSettingsRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )

  test(
    'returns defaults for an account with no stored row',
    async () => {
      const auth0Id = newSettingsTestId()

      try {
        expect(await userSettings(auth0Id)).toEqual({
          theme: 'system',
          reduceMotion: false,
          weekStartsMonday: false,
          updatedAt: null,
        })

        // The upsert creates the row; defaults are unchanged until a field is set.
        await upsertUserSettings(auth0Id, { reduceMotion: true })
        const readBack = await userSettings(auth0Id)
        expect(readBack.theme).toBe('system')
        expect(readBack.weekStartsMonday).toBe(false)
        expect(readBack.reduceMotion).toBe(true)
      } finally {
        await deleteSettingsRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )

  test(
    'stores scalar columns as scalars, not jsonb strings',
    async () => {
      const auth0Id = newSettingsTestId()

      try {
        await upsertUserSettings(auth0Id, { theme: 'dark' })

        const typeofs = await withHistoryStoreOrThrow(async (db) => {
          const rows = await db<{ theme_typeof: string; motion_typeof: string }[]>`
            select
              pg_typeof(theme)::text as theme_typeof,
              pg_typeof(reduce_motion)::text as motion_typeof
            from user_settings
            where auth0_id = ${auth0Id};
          `
          return rows?.[0] ?? null
        })

        expect(typeofs?.theme_typeof).toBe('text')
        expect(typeofs?.motion_typeof).toBe('boolean')
      } finally {
        await deleteSettingsRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )

  test(
    'rejects an invalid theme at the database constraint',
    async () => {
      const auth0Id = newSettingsTestId()

      try {
        await withHistoryStoreOrThrow(async (db) => {
          await db`
            insert into user_settings (auth0_id, theme, updated_at)
            values (${auth0Id}, 'sepia', now());
          `
        })

        throw new Error('expected the theme check constraint to reject the row')
      } catch (error) {
        expect(String((error as Error).message)).toContain('user_settings_theme_check')
      } finally {
        await deleteSettingsRow(auth0Id)
      }
    },
    { timeout: 60000 },
  )
})
