// Schedule (events) data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
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
  created_at: string
  updated_at: string
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export const listSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string } = {},
): Promise<ScheduleEvent[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<ScheduleEvent[]>`
        select * from schedule_events
        where auth0_id = ${auth0Id}
          and (${opts.from ?? null}::timestamptz is null or starts_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or starts_at <= ${opts.to ?? null}::timestamptz)
        order by starts_at asc;
      `
      return rows ?? []
    })) ?? []
  )
}

const scheduleInsertCols = {
  title: true,
  event_type: true,
  starts_at: true,
  ends_at: true,
  location: true,
  description: true,
  status: true,
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
    const setClause =
      cols.map((k, i) => `${k} = $${i + 1}::text`).join(', ') + (cols.length ? ', ' : '')
    const sql = `
      update schedule_events set
        ${setClause} updated_at = now()
      where auth0_id = $${cols.length + 1} and id = $${cols.length + 2}
      returning *;
    `
    const values = cols.map((k) => {
      const v = input[k]
      if (v === undefined || v === null) return null
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
