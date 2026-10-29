import { withHistoryStoreOrThrow as withHistoryStore } from './orgStore'
import { STUDENT_STATUSES } from './orgEnums'

// ── Types ────────────────────────────────────────────────────────────────────

export type Student = {
  id: string
  auth0_id: string
  full_name: string
  email: string | null
  phone: string | null
  sport: string | null
  position: string | null
  jersey_number: number | null
  date_of_birth: string | null
  gender: string | null
  guardian_name: string | null
  guardian_phone: string | null
  notes: string | null
  status: (typeof STUDENT_STATUSES)[number]
  joined_on: string | null
  account_auth0_id: string | null
  team_id: string | null
  created_at: string
  updated_at: string
}

// ── Students ─────────────────────────────────────────────────────────────────

export const listStudents = async (
  auth0Id: string,
  opts: {
    search?: string
    sport?: string
    status?: string
    teamId?: string
    teamIds?: string[]
    includeArchived?: boolean
  } = {},
): Promise<Student[]> => {
  return (
    (await withHistoryStore(async (db) => {
      const search = opts.search?.trim() ?? ''
      const teamId = opts.teamId?.trim() ?? ''
      // Scope filter (coach hierarchy): when teamIds is present, only
      // students on those teams are visible — even unassigned ones hide.
      const scopeIds = (opts.teamIds ?? []).filter((t) => typeof t === 'string' && t.length > 0)
      const scoped = opts.teamIds !== undefined
      // Bun binds [] as '' which is not a valid uuid[] literal — bind NULL
      // instead. Unscoped queries short-circuit on `not ${scoped}`; scoped
      // queries with NULL match nothing (correct: no visible teams).
      const scopeParam = scopeIds.length > 0 ? scopeIds : null
      const rows = await db<Student[]>`
        select *
        from students
        where auth0_id = ${auth0Id}
          and (${search} = '' or full_name ilike ${`%${search}%`}
               or email ilike ${`%${search}%`} or sport ilike ${`%${search}%`})
          and (${opts.sport ?? ''} = '' or sport = ${opts.sport ?? null})
          and (${opts.status ?? ''} = '' or status = ${opts.status ?? null})
          and (${teamId} = '' or team_id = ${teamId === '' ? null : teamId}::uuid)
          and (not ${scoped} or team_id = any(${scopeParam}::uuid[]))
          and (${opts.includeArchived === true || opts.status === 'archived'} or status is distinct from 'archived')
        order by full_name asc;
      `
      return rows ?? []
    })) ?? []
  )
}

export const getStudent = async (auth0Id: string, id: string): Promise<Student | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<Student[]>`
      select * from students where auth0_id = ${auth0Id} and id = ${id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

export type LinkedPlayer = {
  student: Student
  coachAuth0Id: string
}

/**
 * Resolves the student a player account is linked to (via their Auth0 id).
 * Returns the student row plus the owning coach's auth0_id so the player
 * routes can scope every query to the correct org.
 */
export const getLinkedPlayer = async (accountAuth0Id: string): Promise<LinkedPlayer | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<Student[]>`
      select * from students where account_auth0_id = ${accountAuth0Id} limit 1;
    `
    if (!rows?.[0]) return null
    return { student: rows[0], coachAuth0Id: rows[0].auth0_id }
  })
}

const studentInsertCols = {
  full_name: true,
  email: true,
  phone: true,
  sport: true,
  position: true,
  jersey_number: true,
  date_of_birth: true,
  gender: true,
  guardian_name: true,
  guardian_phone: true,
  notes: true,
  status: true,
  joined_on: true,
  team_id: true,
} as const

export type StudentInput = Record<string, unknown>

export const createStudent = async (
  auth0Id: string,
  input: StudentInput,
): Promise<Student | null> => {
  return withHistoryStore(async (db) => {
    const cols = Object.keys(studentInsertCols).filter(
      (k) => k in input && input[k] !== undefined && input[k] !== null && input[k] !== '',
    )
    const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ')
    const sql = `
      insert into students (auth0_id, ${cols.join(', ')})
      values (${placeholders})
      returning *;
    `
    const values = cols.map((k) => input[k])
    const rows = await db.unsafe<Student[]>(sql, [auth0Id, ...values])
    return rows[0] ?? null
  })
}

export const updateStudent = async (
  auth0Id: string,
  id: string,
  input: StudentInput,
): Promise<Student | null> => {
  return withHistoryStore(async (db) => {
    const cols = Object.keys(studentInsertCols).filter((k) => k in input)
    const colCasts = {
      jersey_number: '::integer',
      date_of_birth: '::date',
      joined_on: '::date',
      team_id: '::uuid',
    } as Record<string, string>
    const setClause =
      cols.map((k, i) => `${k} = $${i + 1}${colCasts[k] ?? ''}`).join(', ') +
      (cols.length ? ', ' : '')
    const sql = `
      update students set
        ${setClause} updated_at = now()
      where auth0_id = $${cols.length + 1} and id = $${cols.length + 2}
      returning *;
    `
    const values = cols.map((k) => {
      const v = input[k]
      if (v === undefined || v === null) return null
      // Cast columns (::uuid/::date/::integer) reject '' — treat as unset.
      if (v === '' && colCasts[k]) return null
      return typeof v === 'number' ? v : String(v)
    })
    const rows = await db.unsafe<Student[]>(sql, [...values, auth0Id, id])
    return rows[0] ?? null
  })
}

export const deleteStudent = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    const rows = await db<{ id: string }[]>`
      delete from students where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

export const listStudentSports = async (auth0Id: string): Promise<string[]> => {
  return (
    (await withHistoryStore(async (db) => {
      const rows = await db<{ sport: string | null }[]>`
        select distinct sport from students
        where auth0_id = ${auth0Id} and sport is not null
        order by sport asc;
      `
      return (rows ?? []).map((r) => r.sport as string)
    })) ?? []
  )
}

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
      const rows = await db<{ id: string }[]>`
      delete from matches where org_auth0_id = ${auth0Id} and id = ${id} returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}

// ── Bulk import ────────────────────────────────────────────────────────────

export type ImportResult = {
  imported: number
  failed: Array<{ row_index: number; reason: string }>
  duplicates_skipped: number
}

/**
 * Insert multiple student rows in a single transactional call.
 * Duplicates are detected by email (case-insensitive) within the org.
 * Rows that fail validation are reported in the failed array.
 */
export const importStudents = async (
  auth0Id: string,
  rows: Array<{ cleaned: Record<string, unknown> }>,
): Promise<ImportResult> => {
  return withHistoryStore(async (db) => {

    const result: ImportResult = {
      imported: 0,
      failed: [],
      duplicates_skipped: 0,
    }

    if (rows.length === 0) return result

    // Fetch existing emails for duplicate detection
    const existingEmails = await db<{ email: string | null }[]>`
      select lower(email) as email from students
      where auth0_id = ${auth0Id} and email is not null;
    `
    const emailSet = new Set((existingEmails ?? []).map((r) => r.email))

    // Process each row individually (best-effort within the transaction)
    for (let i = 0; i < rows.length; i++) {
      const { cleaned } = rows[i]

      // Duplicate check by email
      const email = typeof cleaned.email === 'string' ? cleaned.email.toLowerCase() : null
      if (email && emailSet.has(email)) {
        result.duplicates_skipped++
        continue
      }

      // Build insert
      const cols = Object.keys(cleaned).filter(
        (k) => cleaned[k] !== undefined && cleaned[k] !== null && cleaned[k] !== '',
      )
      if (cols.length === 0) {
        result.failed.push({
          row_index: i,
          reason: 'No valid fields after cleaning',
        })
        continue
      }

      try {
        const placeholders = ['$1', ...cols.map((_, j) => `$${j + 2}`)].join(', ')
        const sql = `
          insert into students (auth0_id, ${cols.join(', ')})
          values (${placeholders})
          returning id;
        `
        const values = cols.map((k) => cleaned[k])
        const rowsInserted = await db.unsafe<{ id: string }[]>(sql, [auth0Id, ...values])
        if (rowsInserted?.[0]) {
          result.imported++
          if (email) emailSet.add(email)
        } else {
          result.failed.push({
            row_index: i,
            reason: 'Insert returned no rows',
          })
        }
      } catch (err) {
        result.failed.push({
          row_index: i,
          reason: err instanceof Error ? err.message : 'Database error',
        })
      }
    }

    return result
  })
}
