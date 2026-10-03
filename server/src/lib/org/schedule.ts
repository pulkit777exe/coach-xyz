// Schedule (events) data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { uuidArrayLiteral } from './scope'
import { EVENT_STATUSES, EVENT_TYPES } from '../orgEnums'

export type ScheduleEvent = {
  id: string
  auth0_id: string
  title: string
  event_type: (typeof EVENT_TYPES)[number]
  starts_at: string
  ends_at: string | null
  location: string | null
  description: string | null
  status: (typeof EVENT_STATUSES)[number]
  /** Null = a club-level fixture, visible to every caller (see `listSchedule`). */
  team_id: string | null
  created_at: string
  updated_at: string
}

/**
 * Bind pair for the team-scope filter, the rule `listMatches` already uses for
 * fixtures: `undefined` means the org is visible (every pre-existing caller —
 * `/api/me/schedule`, the data export — passes nothing), a list narrows to
 * those teams, and `[]` is a coach who manages no team.
 *
 * The binding is the one proven in `org/students.ts`: a non-empty list goes
 * through `uuidArrayLiteral`, because Bun sends a raw JS array as comma-joined
 * text and the `::uuid[]` cast then fails (22P02); an empty list binds NULL,
 * which is not what `[]` would send. `null` and `[]` stay distinct, so an
 * unassigned coach keeps the club calendar and loses every team row.
 */
const teamScopeFilter = (teamIds: string[] | undefined) => {
  const ids = (teamIds ?? []).filter((t) => typeof t === 'string' && t.length > 0)
  return { scoped: teamIds !== undefined, param: ids.length > 0 ? uuidArrayLiteral(ids) : null }
}

// ── Schedule ─────────────────────────────────────────────────────────────────

/**
 * The columns a list read returns, spelled out instead of `select *`.
 *
 * `select *` had one real cost here: `team_id` arrived by accident, through the
 * ADR-0002 §5 `add column`, not by decision — and this is the query that reads
 * it, so nothing documented that a list response carries a team key. Spelling
 * the list out makes that a contract instead of a side effect, and the next
 * `add column` has to be added deliberately.
 *
 * `auth0_id` stays even though no screen renders it: it is the owner key the
 * account export hands back, and `ScheduleEvent` declares it. Nothing is dropped
 * from what `select *` returned, so no consumer can lose a field — the win here
 * is the contract, not the bytes (a fixture row is a few hundred of them).
 */
const SCHEDULE_LIST_COLUMNS = `
  id,
  auth0_id,
  title,
  event_type,
  starts_at,
  ends_at,
  location,
  description,
  status,
  team_id,
  created_at,
  updated_at
`

/**
 * The org calendar, oldest fixture first.
 *
 * `limit` follows the sibling convention (`listAttendance`, `listObjectives`,
 * `listReports`): absent binds NULL, which Postgres reads as *unlimited*, and a
 * present one is clamped. The routes are therefore the place the bound has to
 * live — `readListLimit` there resolves an absent parameter to
 * `MAX_ORG_LIST_ROWS`, which is what makes "defaults to null" safe in production
 * rather than a promise nobody kept.
 */
export const listSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string; teamIds?: string[]; limit?: number } = {},
): Promise<ScheduleEvent[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const scope = teamScopeFilter(opts.teamIds)
      const rows = await db<ScheduleEvent[]>`
        select ${db.unsafe(SCHEDULE_LIST_COLUMNS)} from schedule_events
        where auth0_id = ${auth0Id}
          and (${opts.from ?? null}::timestamptz is null or starts_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or starts_at <= ${opts.to ?? null}::timestamptz)
          and (not ${scope.scoped} or team_id is null or team_id = any(${scope.param}::uuid[]))
        order by starts_at asc
        limit ${(opts.limit === undefined ? null : Math.min(Math.max(opts.limit, 1), 10000)) as number | null};
      `
      return rows ?? []
    })) ?? []
  )
}

/**
 * One event by id, unscoped — the by-id door the schedule writes load before
 * asking whether the caller may touch it. Unscoped on purpose, like `getMatch`:
 * the refusal is the route's decision (403 beside its capability gate), and
 * "missing" has to stay distinguishable from "not yours" (404).
 */
export const getScheduleEvent = async (
  auth0Id: string,
  id: string,
): Promise<ScheduleEvent | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<ScheduleEvent[]>`
      select * from schedule_events where auth0_id = ${auth0Id} and id = ${id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

const scheduleInsertCols = {
  title: true,
  event_type: true,
  starts_at: true,
  ends_at: true,
  location: true,
  description: true,
  status: true,
  team_id: true,
} as const

export type ScheduleInput = Record<string, unknown>

export const createScheduleEvent = async (
  auth0Id: string,
  input: ScheduleInput,
): Promise<ScheduleEvent | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const cols = Object.keys(scheduleInsertCols).filter(
      (k) => k in input && input[k] !== undefined && input[k] !== null && input[k] !== '',
    )
    const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ')
    const sql = `
      insert into schedule_events (auth0_id, ${cols.join(', ')})
      values (${placeholders})
      returning *;
    `
    const rows = await db.unsafe<ScheduleEvent[]>(sql, [auth0Id, ...cols.map((k) => input[k])])
    return rows[0] ?? null
  })
}

export const updateScheduleEvent = async (
  auth0Id: string,
  id: string,
  input: ScheduleInput,
): Promise<ScheduleEvent | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const cols = Object.keys(scheduleInsertCols).filter((k) => k in input)
    // Every non-text column takes an explicit cast, exactly as `updateStudent`
    // does for its own. This must stay in sync with the DDL: the timestamps
    // used to fall through to a `::text` default, and Postgres has no
    // assignment cast from text to timestamptz, so any edit that touched a time
    // 500'd with "column starts_at is of type timestamp with time zone but
    // expression is of type text" — the web always sends starts_at/ends_at, so
    // editing any event failed outright.
    const colCasts = {
      team_id: '::uuid',
      starts_at: '::timestamptz',
      ends_at: '::timestamptz',
    } as Record<string, string>
    const setClause =
      cols.map((k, i) => `${k} = $${i + 1}${colCasts[k] ?? ''}`).join(', ') +
      (cols.length ? ', ' : '')
    const sql = `
      update schedule_events set
        ${setClause} updated_at = now()
      where auth0_id = $${cols.length + 1} and id = $${cols.length + 2}
      returning *;
    `
    const values = cols.map((k) => {
      const v = input[k]
      if (v === undefined || v === null) return null
      // A cast column rejects '' — treat it as "no team".
      if (v === '' && colCasts[k]) return null
      return String(v)
    })
    const rows = await db.unsafe<ScheduleEvent[]>(sql, [...values, auth0Id, id])
    return rows[0] ?? null
  })
}

export const deleteScheduleEvent = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStoreOrThrow(async (db) => {
    const rows = await db<{ id: string }[]>`
      delete from schedule_events where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}
