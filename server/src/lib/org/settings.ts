// Organization settings data layer — split from lib/orgData.ts.
//
// `organizations.name` predates the settings panel: it is seeded by ensureOrg()
// on auth sync, was never editable, and the org switcher derives a display name
// from the owner's `users` row instead. `timezone` anchors scheduling/reporting
// to the club's own calendar. Both are org-wide, so only owners/admins write
// them — the role floor lives on the route (orgRoleGuard), not here.

import { toIsoString } from '../isoTime'
import { orDisabledDefault, withHistoryStore, withHistoryStoreOrThrow } from '../historyStore'

/** Longest accepted organization name. Matches ensureOrg()'s seed truncation. */
export const ORG_NAME_MAX_LENGTH = 120

export type OrgSettings = {
  name: string | null
  timezone: string | null
  createdAt: string | null
}

export type OrgSettingsPatch = {
  name?: string
  timezone?: string | null
}

type OrgSettingsRow = {
  name: string | null
  timezone: string | null
  created_at: string | Date
}

const toOrgSettings = (row: OrgSettingsRow): OrgSettings => ({
  name: row.name,
  timezone: row.timezone,
  createdAt: toIsoString(row.created_at),
})

/** An org that has never been named, or a store that is unavailable. */
export const emptyOrgSettings = (): OrgSettings => ({
  name: null,
  timezone: null,
  createdAt: null,
})

/**
 * A real IANA zone, resolved by the runtime itself — `Intl` throws a RangeError
 * for anything it cannot turn into an offset, which is exactly the vocabulary
 * `Intl.DateTimeFormat` accepts everywhere else. No dependency, no tz table to
 * keep in sync, and an invalid zone can never reach the database.
 */
export const isIanaTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * Read one organization's settings. A missing row — or a store that is disabled,
 * or a pre-migration database without `organizations.timezone` — degrades to the
 * empty settings rather than failing a page render.
 */
export const orgSettings = async (auth0Id: string): Promise<OrgSettings> => {
  if (!auth0Id) return emptyOrgSettings()
  const stored = await withHistoryStore(async (db) => {
    const rows = await db<OrgSettingsRow[]>`
      select name, timezone, created_at
      from organizations
      where auth0_id = ${auth0Id}
      limit 1;
    `
    return rows?.[0] ?? null
  })

  return orDisabledDefault(stored ? toOrgSettings(stored) : null, emptyOrgSettings())
}

/**
 * Apply a partial settings patch. Omitted fields keep their stored value (read
 * -merge in JS, then one explicit insert-on-conflict: both columns are scalars,
 * so there is no JSONB merge to perform). The upsert also creates the row for an
 * org that has never been synced through ensureOrg().
 */
export const updateOrgSettings = async (
  auth0Id: string,
  patch: OrgSettingsPatch,
): Promise<OrgSettings | null> => {
  if (!auth0Id) return null
  return withHistoryStoreOrThrow(async (db) => {
    const existing = await db<OrgSettingsRow[]>`
      select name, timezone, created_at
      from organizations
      where auth0_id = ${auth0Id}
      limit 1;
    `
    const current = existing?.[0] ? toOrgSettings(existing[0]) : emptyOrgSettings()

    const next = {
      name: patch.name ?? current.name,
      // `null` is a real value here — it clears the zone, which is why the
      // nullish coalesce above cannot express it.
      timezone: patch.timezone === undefined ? current.timezone : patch.timezone,
    }

    const rows = await db<OrgSettingsRow[]>`
      insert into organizations (auth0_id, name, timezone, created_by, updated_at)
      values (${auth0Id}, ${next.name}, ${next.timezone}, ${null}, now())
      on conflict (auth0_id) do update set
        name = excluded.name,
        timezone = excluded.timezone,
        updated_at = now()
      returning name, timezone, created_at;
    `
    const row = rows?.[0]
    return row ? toOrgSettings(row) : null
  })
}

export type OrgSettingsValidation =
  { ok: true; value: OrgSettingsPatch } | { ok: false; message: string }

/** Strict manual validation matching the existing server route conventions. */
export const validateOrgSettingsPatch = (body: unknown): OrgSettingsValidation => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Body must be a JSON object' }
  }

  const raw = body as Record<string, unknown>
  const unknownField = Object.keys(raw).find((key) => key !== 'name' && key !== 'timezone')
  if (unknownField) {
    return { ok: false, message: `Unknown field: ${unknownField}` }
  }
  if (Object.keys(raw).length === 0) {
    return { ok: false, message: 'Provide at least one of name or timezone' }
  }

  const value: OrgSettingsPatch = {}

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') {
      return { ok: false, message: 'name must be a string' }
    }
    const name = raw.name.trim()
    if (!name) {
      return { ok: false, message: 'name must not be empty' }
    }
    if (name.length > ORG_NAME_MAX_LENGTH) {
      return { ok: false, message: `name must be at most ${ORG_NAME_MAX_LENGTH} characters` }
    }
    value.name = name
  }

  if (raw.timezone !== undefined) {
    if (raw.timezone === null) {
      value.timezone = null
    } else if (typeof raw.timezone === 'string' && isIanaTimezone(raw.timezone)) {
      value.timezone = raw.timezone
    } else {
      return { ok: false, message: 'timezone must be a valid IANA time zone or null' }
    }
  }

  return { ok: true, value }
}
