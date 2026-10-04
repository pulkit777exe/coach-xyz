// Students (roster) data layer — split from lib/orgData.ts.

import type { SQL } from 'bun'

import { batchRows } from '../batchRows'
import { withHistoryStoreOrThrow } from '../historyStore'
import { STUDENT_STATUSES } from '../orgEnums'
import { toDateOnly } from '../orgValidate'
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

/**
 * Every function below returns rows straight out of the store, and Bun decodes
 * Postgres `date` columns to `Date`. Left raw, `date_of_birth` and `joined_on`
 * serialise as `"2008-04-01T00:00:00.000Z"`, which an `<input type="date">`
 * refuses (blank field) and which the server's own `isDate` then rejects on the
 * round-trip save. Normalise once, here, at the boundary — rather than teaching
 * each consumer to slice, which is what `org/reports.ts` had already started.
 *
 * Applied per read/write function rather than inside one shared query builder
 * because the row shapes differ (a bare row, a `{ student }` wrapper) and a
 * missed site is exactly the bug being fixed.
 */
const withDates = <
  T extends { date_of_birth?: Date | string | null; joined_on?: Date | string | null },
>(
  row: T,
): T => ({
  ...row,
  date_of_birth: toDateOnly(row.date_of_birth),
  joined_on: toDateOnly(row.joined_on),
})

const withDatesAll = <
  T extends { date_of_birth?: Date | string | null; joined_on?: Date | string | null },
>(
  rows: readonly T[] | null,
): T[] => (rows ?? []).map(withDates)

export const listStudents = async (
  auth0Id: string,
  opts: {
    search?: string
    sport?: string
    status?: string
    teamId?: string
    teamIds?: string[]
    /** Include archived students. Default excludes them; an explicit `status` filter wins. */
    includeArchived?: boolean
    /** Max rows (exports bound themselves; the roster leaves it unbounded). */
    limit?: number
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
      // Archive is a status, not a scope: the default roster hides archived
      // students, an explicit status filter wins over the default, and scope
      // + by-id reads still resolve archived rows (history keeps working).
      const hideArchived = !opts.status && !opts.includeArchived
      const cap = opts.limit === undefined ? null : Math.min(Math.max(opts.limit, 1), 10000)
      const rows = await db<Student[]>`
        select *
        from students
        where auth0_id = ${auth0Id}
          and (${search} = '' or full_name ilike ${`%${search}%`}
               or email ilike ${`%${search}%`} or sport ilike ${`%${search}%`})
          and (${opts.sport ?? ''} = '' or sport = ${opts.sport ?? null})
          and (${opts.status ?? ''} = '' or status = ${opts.status ?? null})
          and (not ${hideArchived} or status <> 'archived')
          and (${teamId} = '' or team_id = ${teamId === '' ? null : teamId}::uuid)
          and (not ${scoped} or team_id = any(${scopeParam}::uuid[]))
        order by full_name asc
        limit ${cap};
      `
      return withDatesAll(rows)
    })) ?? []
  )
}

/**
 * Many students by id, one round trip (batch verification). Duplicates in
 * `ids` collapse: callers match entries back by id.
 */
export const getStudentsByIds = async (
  auth0Id: string,
  ids: readonly string[],
): Promise<Student[]> => {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))]
  if (unique.length === 0) return []
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<Student[]>`
      select * from students
      where auth0_id = ${auth0Id} and id = any(${uuidArrayLiteral(unique)}::uuid[]);
    `
      return withDatesAll(rows)
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
    return rows?.[0] ? withDates(rows[0]) : null
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
    return { student: withDates(rows[0]), coachAuth0Id: rows[0].auth0_id }
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
    const student = rows[0]
    if (!student) return null

    // The roster mirror, in the SAME transaction as the insert. `setStudentTeam`
    // states the invariant — `students.team_id` is the scope source of truth and
    // the `team_memberships` row is the roster mirror, both halves written
    // together — and this insert is a third way to assign a team, so it owes the
    // same second half. Without it the player is visible to the team's coaches
    // (scope reads `team_id`) while `listTeamMembers` omits them: the scope layer
    // and the team page disagree about the same person, and only one of them
    // says so.
    const teamId = input.team_id
    if (typeof teamId === 'string' && teamId !== '') {
      await writeTeamMirrors(db, [{ team_id: teamId, student_id: student.id }])
    }
    return withDates(student)
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
    return rows[0] ? withDates(rows[0]) : null
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

/**
 * Distinct sports in use across the roster — the `sport` filter's value list.
 *
 * SCOPED, with the same `teamIds` option and the same binding as `listStudents`
 * (see its note for why an empty list binds NULL rather than `[]`). It is an
 * aggregate over the roster, so it answers the same question the roster list
 * does: a coach must not learn which sports a team they are not assigned to
 * fields. Org-wide callers (`scope.all` → `teamIds` absent) are unnarrowed.
 */
export const listStudentSports = async (
  auth0Id: string,
  opts: { teamIds?: string[] } = {},
): Promise<string[]> => {
  const scopeIds = (opts.teamIds ?? []).filter((t) => typeof t === 'string' && t.length > 0)
  const scoped = opts.teamIds !== undefined
  const scopeParam = scopeIds.length > 0 ? uuidArrayLiteral(scopeIds) : null
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ sport: string | null }[]>`
        select distinct sport from students
        where auth0_id = ${auth0Id} and sport is not null
          and (not ${scoped} or team_id = any(${scopeParam}::uuid[]))
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
 * Rows per batched INSERT. 100 keeps the jsonb parameter small (a full CSV row is
 * a few hundred bytes) while collapsing the 500-row cap from 500 statements to 5.
 */
const IMPORT_INSERT_BATCH = 100

/**
 * One batched statement: `insert … select … from jsonb_to_recordset(…)`.
 *
 * Two things make this more than a transcription of the per-row `values` list,
 * and both are the reason it is written as a `select` from a recordset rather
 * than a `values` list of parenthesised tuples:
 *
 *  1. Every row needs its own column list (the cleaner drops absent fields), and
 *     a multi-row `values` list cannot vary its columns per row. `jsonb_to_recordset`
 *     types each value from the column-type list below, and a MISSING key reads as
 *     NULL, so one statement carries rows with different shapes. Grouping by
 *     identical column sets (above) rather than unioning them is deliberate: a
 *     union would write an explicit NULL where the old code omitted the column,
 *     and `students.status` is `not null default 'active'` — omitting it lets the
 *     default fire, writing NULL raises. The groups are therefore exact, and a
 *     homogeneous import is one group.
 *  2. `id` is generated here rather than by the column's `gen_random_uuid()`
 *     default, because `RETURNING` cannot see the recordset alias on this
 *     connection (`returning r.idx, t.id` → "missing FROM-clause entry for table r",
 *     verified against PG 16) and the team mirror below needs to know WHICH row
 *     got WHICH id. Both are v4 random uuids; supplying the value is what makes
 *     the row-to-id mapping knowable in the same round trip.
 */
const studentInsertTypes: Record<string, string> = {
  full_name: 'text',
  email: 'text',
  phone: 'text',
  sport: 'text',
  position: 'text',
  jersey_number: 'integer',
  date_of_birth: 'date',
  gender: 'text',
  guardian_name: 'text',
  guardian_phone: 'text',
  notes: 'text',
  status: 'text',
  joined_on: 'date',
  team_id: 'uuid',
}

/** A row accepted for insertion, with the id it will be written under. */
type PlannedRow = {
  rowIndex: number
  id: string
  email: string | null
  cols: string[]
  cleaned: Record<string, unknown>
}

/**
 * Insert multiple student rows in a single transactional call.
 * Duplicates are detected by email (case-insensitive) within the org.
 * Rows that fail validation are reported in the failed array.
 *
 * SCOPE, unchanged. What changed is the SHAPE: one statement per group of rows
 * sharing a column set (see `studentInsertTypes`) rather than one per row.
 * Measured against a real Postgres at the 500-row cap, this function's own
 * statements go from 501 to 6 teamless, and from 1001 to 11 with a `team_id` on
 * every row (1 duplicate-detection read + 5 inserts + 5 team mirrors).
 * `tests/studentImportBatch.test.ts` pins both bounds.
 *
 * NOT IN A TRANSACTION, deliberately, and that is a correction rather than an
 * inheritance. There is no `db.begin` here and there never was — the per-row
 * version relied on each INSERT autocommitting, which is what lets a bad row be
 * reported in `failed` while every other row lands. Wrapping the batches in one
 * would trade that for nothing: a single aborted transaction poisons every
 * statement after it, so the per-row retry below could not run at all and one
 * malformed cell would roll back the whole import. Batch size therefore buys
 * round trips, and the existing partial-success contract is untouched.
 *
 * PER-ROW ERROR ISOLATION, the reason there is a fallback. A batched statement is
 * atomic, so one malformed cell would fail all 100 rows with it — and the
 * contract this function has always had is that a bad row is reported in
 * `failed` and the rest still import (`tests/studentImportTeamProbe.ts` case 3
 * pins exactly that: a `team_id` of "not-a-uuid" fails ONE row). So a batch that
 * raises is retried row by row through the original per-row path, which restores
 * the old outcome precisely. The happy path never pays for this.
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

    // ── Plan ─────────────────────────────────────────────────────────────────
    // The duplicate check is inherently sequential — each accepted row claims
    // its email for the rows after it — so this stays a serial pass. It is
    // in-memory, so it costs nothing against the database; what it removes is
    // the per-row round trip, which is the whole cost.
    const planned: PlannedRow[] = []
    for (let i = 0; i < rows.length; i++) {
      const { cleaned } = rows[i]

      // Duplicate check by email
      const email = typeof cleaned.email === 'string' ? cleaned.email.toLowerCase() : null
      if (email && emailSet.has(email)) {
        result.duplicates_skipped++
        continue
      }

      // Build insert. The column list is the cleaned row's own keys, and it is
      // spliced into SQL as identifiers, so it is intersected with
      // `studentInsertCols` — the same allowlist `createStudent` and
      // `updateStudent` both filter through. The per-row `values` list spliced
      // those keys the same way, so this closes an injection surface rather than
      // adding one. Every real caller is unaffected: `validateStudentRow` is a
      // closed shape over exactly these columns.
      const unknown = Object.keys(cleaned).filter((k) => !(k in studentInsertCols))
      const cols = Object.keys(cleaned).filter(
        (k) =>
          k in studentInsertCols &&
          cleaned[k] !== undefined &&
          cleaned[k] !== null &&
          cleaned[k] !== '',
      )
      if (cols.length === 0) {
        result.failed.push({
          row_index: i,
          reason: 'No valid fields after cleaning',
        })
        continue
      }
      // Reported rather than dropped. The old code let Postgres raise "column
      // does not exist" for this row and caught it, so a row carrying a field the
      // roster has no column for has always been a `failed` entry — naming the
      // field is a better reason than a driver error, and silently ignoring a
      // caller's data would not be.
      if (unknown.length > 0) {
        result.failed.push({
          row_index: i,
          reason: `Unknown student field(s): ${unknown.join(', ')}`,
        })
        continue
      }

      // `status` carries the check constraint; a value outside the vocabulary
      // fails in the statement below exactly as it would have per-row.
      planned.push({ rowIndex: i, id: crypto.randomUUID(), email, cols, cleaned })
      // Claim the email NOW, synchronously, rather than after the insert returns.
      // The batch is one command, so there is no per-row insert to add it from;
      // claiming during planning is what keeps two rows sharing an email in the
      // same batch from both landing. Claimed only for rows that will be
      // attempted, so a row rejected above does not block its twin.
      if (email) emailSet.add(email)
    }

    if (planned.length === 0) return result

    // ── Group by column set, then batch within each group ────────────────────
    // See `studentInsertTypes`: identical column sets only, so an omitted column
    // still reaches its DEFAULT rather than an explicit NULL.
    const groups = new Map<string, PlannedRow[]>()
    for (const row of planned) {
      const key = row.cols.join(',')
      const bucket = groups.get(key)
      if (bucket) bucket.push(row)
      else groups.set(key, [row])
    }

    for (const group of groups.values()) {
      for (let start = 0; start < group.length; start += IMPORT_INSERT_BATCH) {
        const batch = group.slice(start, start + IMPORT_INSERT_BATCH)
        const inserted = await insertStudentBatch(db, auth0Id, batch)
        if (inserted) {
          // The statement is atomic and every row carries an id we generated, so
          // "it did not raise" IS "every row in this batch landed" — there is no
          // per-row outcome to inspect, and no `insert returned no rows` case to
          // reproduce. That check survives only on the per-row path below.
          result.imported += batch.length
          await mirrorTeamAssignments(db, batch)
        } else {
          // The batch raised. Re-run its rows one at a time so the failure is
          // attributed to the row that caused it and the rest still import.
          // Safe precisely because nothing here is inside a transaction: the
          // failed statement rolled itself back and left the connection usable.
          for (const row of batch) {
            try {
              const placeholders = ['$1', '$2', ...row.cols.map((_, j) => `$${j + 3}`)].join(', ')
              const sql = `
                insert into students (id, auth0_id, ${row.cols.join(', ')})
                values (${placeholders})
                returning id;
              `
              const rowsInserted = await db.unsafe<{ id: string }[]>(sql, [
                row.id,
                auth0Id,
                ...row.cols.map((k) => row.cleaned[k]),
              ])
              if (rowsInserted?.[0]) {
                result.imported++
                await mirrorTeamAssignments(db, [row])
              } else {
                result.failed.push({
                  row_index: row.rowIndex,
                  reason: 'Insert returned no rows',
                })
              }
            } catch (err) {
              result.failed.push({
                row_index: row.rowIndex,
                reason: err instanceof Error ? err.message : 'Database error',
              })
            }
          }
        }
      }
    }

    return result
  })
}

/**
 * One statement for a group of rows. `false` if the statement raised.
 *
 * `false` is a real answer here and not a missing store: it means "this batch is
 * atomic and at least one row in it is bad", which is what selects the per-row
 * retry. Swallowing the error into a default the caller cannot tell from
 * "nothing to do" is the `orDisabledDefault` trap; this shape cannot be confused
 * with absence, and the reason is logged before it returns.
 */
const insertStudentBatch = async (
  db: SQL,
  auth0Id: string,
  batch: PlannedRow[],
): Promise<boolean> => {
  const cols = batch[0].cols
  const recordset = batch.map((row) => {
    const record: Record<string, unknown> = { id: row.id }
    for (const c of cols) record[c] = row.cleaned[c]
    return record
  })
  const colList = cols.map((c) => `${c} ${studentInsertTypes[c] ?? 'text'}`).join(', ')
  // `db.unsafe`, not the tagged template: the column list is an IDENTIFIER and a
  // tagged template binds `${…}` as `$1`, so splicing it there is a syntax error
  // ("syntax error at or near $1"). Identifiers travel as text, values stay
  // positional parameters. `cols` comes from the cleaned row's own keys, which is
  // why `importStudents` intersects it with `studentInsertCols` before calling.
  try {
    await db.unsafe(
      `insert into students (id, auth0_id, ${cols.join(', ')})
       select r.id, $1, ${cols.map((c) => `r.${c}`).join(', ')}
       from jsonb_to_recordset($2::jsonb) as r(id uuid, ${colList});`,
      [auth0Id, batchRows(recordset)],
    )
    return true
  } catch (err) {
    logger.warn('import_batch_insert_failed', {
      type: 'import_batch_insert_failed',
      rows: batch.length,
      error: err instanceof Error ? err.message : 'unknown',
    })
    return false
  }
}

/**
 * Mirror each row's `team_id` onto `team_memberships`, one statement per batch.
 *
 * `students.team_id` alone leaves the player off the team roster (the
 * `team_memberships` side), so this is not optional bookkeeping. `on conflict …
 * do nothing` makes it safe: a retry of the same row must not fail the batch, and
 * a repeated key inside one batch is fine with `do nothing` (the first
 * occurrence survives — see `batchRows`).
 *
 * A mirror failure (a team that vanished mid-import violates the FK) is logged,
 * never row-failing: the player is still visible through `team_id`, the scope
 * source. That is why the batch falls back to one statement per row rather than
 * reporting anything — with one bad team in the batch, the fallback restores the
 * per-row log-and-continue that the old code had.
 */
/**
 * Write `team_memberships` rows for `(team_id, student_id)` pairs. One
 * `jsonb_to_recordset` statement, falling back to one statement per row so a
 * single vanished team (an FK violation) costs one skipped mirror rather than
 * all of them.
 *
 * EXTRACTED from `mirrorTeamAssignments` so `createStudent` uses the same
 * statement and the same failure policy. `setStudentTeam` documents the
 * invariant — `students.team_id` is the scope source of truth and the
 * membership row is the roster mirror, "both halves written here, never
 * separately" — and this is that second half for the two paths that do not go
 * through `setStudentTeam`. Duplicating the SQL would be a third owner of the
 * invariant, which is how the two halves drifted apart in the first place.
 */
const writeTeamMirrors = async (
  db: SQL,
  pairs: { team_id: string; student_id: string }[],
): Promise<void> => {
  if (pairs.length === 0) return

  const insertMirror = async (teamId: string, studentId: string): Promise<void> => {
    await db`
      insert into team_memberships (team_id, member_auth0_id, student_id, role)
      values (${teamId}::uuid, null, ${studentId}::uuid, 'player')
      on conflict (team_id, member_auth0_id, student_id) do nothing;
    `
  }

  try {
    await db`
      insert into team_memberships (team_id, member_auth0_id, student_id, role)
      select r.team_id, null, r.student_id, 'player'
      from jsonb_to_recordset(
        ${batchRows(pairs)}::jsonb
      ) as r(team_id uuid, student_id uuid)
      on conflict (team_id, member_auth0_id, student_id) do nothing;
    `
    return
  } catch (err) {
    logger.warn('team_mirror_failed', {
      type: 'team_mirror_failed',
      rows: pairs.length,
      error: err instanceof Error ? err.message : 'unknown',
    })
  }

  for (const { team_id, student_id } of pairs) {
    try {
      await insertMirror(team_id, student_id)
    } catch (err) {
      logger.warn('team_mirror_failed', {
        type: 'team_mirror_failed',
        studentId: student_id,
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }
}

const mirrorTeamAssignments = async (db: SQL, batch: PlannedRow[]): Promise<void> => {
  const mirrors = batch
    .map((row) => {
      const teamId = row.cleaned.team_id
      return typeof teamId === 'string' && teamId ? { team_id: teamId, student_id: row.id } : null
    })
    .filter((m): m is { team_id: string; student_id: string } => m !== null)
  await writeTeamMirrors(db, mirrors)
}
