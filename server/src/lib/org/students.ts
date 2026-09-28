// Students (roster) data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { STUDENT_STATUSES } from '../orgEnums'
import { logger } from '../logger'
import { canSeeStudent, uuidArrayLiteral, visibleStudentIds, type StudentScope } from './scope'

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
  } = {},
): Promise<Student[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const search = opts.search?.trim() ?? ''
      const teamId = opts.teamId?.trim() ?? ''
      // Scope filter (coach hierarchy): when teamIds is present, only
      // students on those teams are visible — even unassigned ones hide.
      const scopeIds = (opts.teamIds ?? []).filter((t) => typeof t === 'string' && t.length > 0)
      const scoped = opts.teamIds !== undefined
      // Bun binds [] as '' which is not a valid uuid[] literal — bind NULL
      // instead. Unscoped queries short-circuit on `not ${scoped}`; scoped
      // queries with NULL match nothing (correct: no visible teams). Non-empty
      // lists go through `uuidArrayLiteral`: a raw JS array is sent as
      // comma-joined text and the cast fails (see scope.ts).
      const scopeParam = scopeIds.length > 0 ? uuidArrayLiteral(scopeIds) : null
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
        order by full_name asc;
      `
      return rows ?? []
    })) ?? []
  )
}

/**
 * One student by id, optionally narrowed to the caller's scope.
 *
 * `scope` follows the same convention as `listStudents`: omitted means the org
 * is visible, `{ all: false, teamIds }` means those teams' students only. The
 * scope is resolved BEFORE the by-id query, so a student outside the caller's
 * teams answers `null` and its id is never used as a probe against the store —
 * `getStudent` is the by-id door into the roster, and every write keyed to a
 * student (wellness, plans, objectives, reports, performance) routes through
 * here, so the narrowing has to live below the route as well as above it.
 */
export const getStudent = async (
  auth0Id: string,
  id: string,
  scope?: StudentScope,
): Promise<Student | null> => {
  if (scope) {
    const visible = await visibleStudentIds(auth0Id, scope)
    if (!canSeeStudent(visible, id)) return null
  }
  return withHistoryStoreOrThrow(async (db) => {
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
  return withHistoryStoreOrThrow(async (db) => {
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
  return withHistoryStoreOrThrow(async (db) => {
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
  return withHistoryStoreOrThrow(async (db) => {
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

/**
 * Delete a student and their private rows, atomically. Dependent tables have
 * no foreign keys, so each is handled explicitly:
 *
 * - Private rows go: `wellness_checkins`, `training_objectives`,
 *   `training_plans`, `team_memberships` (student side).
 * - Club history stays: `analysis_history` and `player_events` are unlinked
 *   (`student_id = null`) so owner/coach dashboards keep the analyses.
 * - `attendance`, `performance_metrics`, `player_consents` cascade via FK;
 *   `reports.student_id` is `on delete set null`.
 *
 * The student row is claimed (`for update`, org-scoped) before anything it
 * points at is touched — the same claim-then-write order as `deleteTeam` —
 * so a foreign id deletes nothing instead of orphaning another org's data.
 */
export const deleteStudent = async (auth0Id: string, id: string): Promise<boolean> =>
  (await withHistoryStoreOrThrow((db) =>
    db.begin(async (tx) => {
      const owned = await tx<{ id: string }[]>`
        select id from students where auth0_id = ${auth0Id} and id = ${id} for update;`
      if (!owned[0]) return false
      await tx`delete from wellness_checkins where student_id = ${id};`
      await tx`delete from training_objectives where student_id = ${id};`
      await tx`delete from training_plans where student_id = ${id};`
      await tx`delete from team_memberships where student_id = ${id};`
      await tx`update analysis_history set student_id = null where student_id = ${id};`
      await tx`update player_events set student_id = null where student_id = ${id};`
      await tx`delete from students where auth0_id = ${auth0Id} and id = ${id};`
      return true
    }),
  )) ?? false

export const listStudentSports = async (auth0Id: string): Promise<string[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ sport: string | null }[]>`
        select distinct sport from students
        where auth0_id = ${auth0Id} and sport is not null
        order by sport asc;
      `
      return (rows ?? []).map((r) => r.sport as string)
    })) ?? []
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
  return withHistoryStoreOrThrow(async (db) => {
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
          // Mirror the team assignment: `students.team_id` alone leaves the
          // player off the team roster (`team_memberships` side). Conflict-safe
          // — a retry of the same row must not fail the batch. A mirror failure
          // (e.g. the team vanished mid-import) is logged, not row-failing: the
          // player is still visible through `team_id`, the scope source.
          const assignedTeam = cleaned.team_id
          if (typeof assignedTeam === 'string' && assignedTeam) {
            try {
              await db`
                insert into team_memberships (team_id, member_auth0_id, student_id, role)
                values (${assignedTeam}::uuid, null, ${rowsInserted[0].id}::uuid, 'player')
                on conflict (team_id, member_auth0_id, student_id) do nothing;
              `
            } catch (err) {
              logger.warn('import_team_mirror_failed', {
                type: 'import_team_mirror_failed',
                studentId: rowsInserted[0].id,
                error: err instanceof Error ? err.message : 'unknown',
              })
            }
          }
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
