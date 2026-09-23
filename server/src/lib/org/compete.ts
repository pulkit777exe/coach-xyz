// Seasons & matches (compete) data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from '../historyStore'

// ── Seasons & matches ────────────────────────────────────────────────────────

export type Season = {
  id: string
  org_auth0_id: string
  name: string
  starts_on: string | null
  ends_on: string | null
  created_at: string
}

export type Match = {
  id: string
  org_auth0_id: string
  team_id: string | null
  season_id: string | null
  opponent: string | null
  match_on: string | null
  location: string | null
  result: string | null
  created_at: string
}

export const listSeasons = async (auth0Id: string): Promise<Season[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<Season[]>`
      select * from seasons where org_auth0_id = ${auth0Id} order by created_at desc;
    `
      return rows ?? []
    })) ?? []
  )
}

export const createSeason = async (
  auth0Id: string,
  input: { name: string; starts_on?: string | null; ends_on?: string | null },
): Promise<Season | null> => {
  const name = input.name.trim().slice(0, 120)
  if (!name) return null
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<Season[]>`
      insert into seasons (org_auth0_id, name, starts_on, ends_on)
      values (${auth0Id}, ${name}, ${input.starts_on ?? null}::date, ${input.ends_on ?? null}::date)
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const deleteSeason = async (auth0Id: string, id: string): Promise<boolean> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ id: string }[]>`
      delete from seasons where org_auth0_id = ${auth0Id} and id = ${id} returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}

export const listMatches = async (
  auth0Id: string,
  opts: { teamId?: string | null; seasonId?: string | null } = {},
): Promise<Match[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<Match[]>`
      select * from matches
      where org_auth0_id = ${auth0Id}
        and (${opts.teamId ?? null}::uuid is null or team_id = ${opts.teamId ?? null}::uuid)
        and (${opts.seasonId ?? null}::uuid is null or season_id = ${opts.seasonId ?? null}::uuid)
      order by match_on desc nulls last, created_at desc;
    `
      return rows ?? []
    })) ?? []
  )
}

export const createMatch = async (
  auth0Id: string,
  input: {
    team_id?: string | null
    season_id?: string | null
    opponent?: string | null
    match_on?: string | null
    location?: string | null
    result?: string | null
  },
): Promise<Match | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<Match[]>`
      insert into matches (org_auth0_id, team_id, season_id, opponent, match_on, location, result)
      values (
        ${auth0Id},
        ${input.team_id ?? null}::uuid,
        ${input.season_id ?? null}::uuid,
        ${input.opponent?.trim().slice(0, 120) || null},
        ${input.match_on ?? null}::date,
        ${input.location?.trim().slice(0, 200) || null},
        ${input.result?.trim().slice(0, 60) || null}
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const deleteMatch = async (auth0Id: string, id: string): Promise<boolean> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ id: string }[]>`
      delete from matches where org_auth0_id = ${auth0Id} and id = ${id} returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
