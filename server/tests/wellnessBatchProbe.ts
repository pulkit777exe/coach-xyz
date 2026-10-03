// `listWellnessForStudents` against ephemeral Postgres, in a fresh process.
//
// WHY A SUBPROCESS: `tests/aiReportScope.test.ts` installs a process-global
// `mock.module('../src/lib/historyStore')` and Bun's module registry is shared
// across test files in one run, so any file sorting after it silently receives
// the MOCK — `withHistoryStore` returns null, the seed no-ops, and the
// assertions fail in ~0.2ms with no database error anywhere.
//
// WHAT ONLY A LIVE POSTGRES CAN SETTLE, and is the reason this is not a fixture:
//
//  - `= any($1::uuid[])` needs `uuidArrayLiteral`, because Bun sends a raw JS
//    array as comma-joined TEXT and the cast dies with 22P02. A stubbed `db`
//    never casts anything, so it cannot catch a missing literal — and a probe
//    that "works" without one proves nothing.
//  - The per-student cap is `row_number() over (partition by student_id …)`, not
//    a `limit`: a `limit` on the outer query caps the ROSTER's rows, not each
//    student's, and a `distinct on` would return all of a student's history.
//    Only real rows show which one it is.
//  - The equivalence that matters: the batched read must return exactly what N
//    `listWellness` calls returned, in the same order. That is asserted here by
//    running both and comparing, not by reading the SQL.

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import {
  groupWellnessByStudent,
  listWellness,
  listWellnessForStudents,
  type WellnessCheckin,
} from '../src/lib/org/wellness'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
// Empty so `historyStore`'s import-time `new SQL(...)` builds nothing and this
// file's connection is the only one. Nothing here can reach live Neon.
process.env.DATABASE_URL = ''

const ORG = 'auth0|wellness-batch-probe'
const OTHER_ORG = 'auth0|wellness-other-probe'
const N_STUDENTS = 120
const PER = 50

const failures: string[] = []
const check = (cond: boolean, message: string): void => {
  if (!cond) failures.push(message)
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

// Count only the wellness reads. Armed by hand, so `ensureInitialized`'s DDL is
// excluded by construction rather than by a keyword filter.
let armed = false
let reads = 0
const counting = new Proxy(db as unknown as (...a: unknown[]) => unknown, {
  apply(target, _this, a: unknown[]) {
    const text = Array.isArray(a[0])
      ? ((a[0] as unknown as TemplateStringsArray).join('?') ?? '')
      : String(a[0] ?? '')
    if (armed && /wellness_checkins/.test(text)) reads++
    return (target as (...x: unknown[]) => unknown)(...a)
  },
  get(_t, prop) {
    const v = (db as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof v !== 'function') return v
    return (...a: unknown[]) => {
      const text = String(a[0] ?? '')
      if (armed && /wellness_checkins/.test(text)) reads++
      return (v as (...x: unknown[]) => unknown).apply(db, a)
    }
  },
}) as unknown as SQL

// ── Seed ─────────────────────────────────────────────────────────────────────
// Uneven, and deliberately past the cap: student 0 gets 80 (> 50), two students
// get none, and the rest get 1..5. A cap that leaked would show as student 0
// returning everything. `OTHER_ORG` gets rows on the SAME student ids, so an org
// predicate that leaked would show up too.
const cleanup = async (): Promise<void> => {
  await db`delete from wellness_checkins where org_auth0_id = ${ORG}`
  await db`delete from wellness_checkins where org_auth0_id = ${OTHER_ORG}`
  await db`delete from students where auth0_id = ${ORG}`
}

await cleanup()
await db`
  insert into students (auth0_id, full_name)
  select ${ORG}, 'P' || g from generate_series(0, ${N_STUDENTS - 1}) g
`
const ids = (
  await db<{ id: string }[]>`select id from students where auth0_id = ${ORG} order by full_name`
).map((r) => r.id)
check(ids.length === N_STUDENTS, `expected ${N_STUDENTS} students, got ${ids.length}`)

let seeded = 0
for (let i = 0; i < N_STUDENTS; i++) {
  const n = i === 0 ? 80 : i < 2 ? 0 : (i % 5) + 1
  seeded += n
  for (let k = 0; k < n; k++) {
    await db`
      insert into wellness_checkins (
        org_auth0_id, student_id, sleep_hours, fatigue, note, created_at
      ) values (
        ${ORG}, ${ids[i]}::uuid, ${7 + (k % 2)}, ${(k % 5) + 1}, ${`n${i}-${k}`},
        ${'2026-01-01T00:00:00Z'}::timestamptz + (${k} * interval '1 hour')
      )
    `
  }
  // Same player, another org's history.
  await db`
    insert into wellness_checkins (org_auth0_id, student_id, note)
    values (${OTHER_ORG}, ${ids[i]}::uuid, ${`other-${i}`})
  `
}

setHistoryStoreConnectionForTests(counting)
// Warm the initializer with a NON-EMPTY id list. `listWellnessForStudents` returns
// before `withHistoryStoreOrThrow` when the list is empty — which is the
// short-circuit under test two scenarios later — so warming with `[]` never
// reaches `ensureInitialized`, and the initializer's own two
// `wellness_checkins`-matching statements then landed inside the counted window
// (`readsBefore: 122` for 120 calls, which is what gave it away).
await listWellnessForStudents(ORG, ids.slice(0, 1), PER)

// ── BEFORE: one call per student ─────────────────────────────────────────────
// Sequential and awaited, deliberately: the real fan-out was `Promise.all`ed, but
// `flatMap` over an array of PROMISES (the obvious transcription) leaves every
// read in flight, so the array holds 120 unresolved promises instead of 407 rows
// and they keep resolving — and get counted — during the AFTER window below.
// That is what made a first pass of this probe report `readsBefore: 0`,
// `rowsBefore: 120` and `readsAfter: 123`.
armed = true
const before: WellnessCheckin[] = []
for (const id of ids) before.push(...(await listWellness(ORG, id, PER)))
const beforeReads = reads
armed = false

// ── AFTER: one call for the roster, grouped back onto it ─────────────────────
reads = 0
armed = true
const batched = await listWellnessForStudents(ORG, ids, PER)
const afterReads = reads
armed = false
const byStudent = groupWellnessByStudent(ids, batched)
const after = ids.flatMap((id) => byStudent.get(id) ?? [])

const norm = (r: unknown) => JSON.stringify(r)
const out: Record<string, unknown> = {
  students: ids.length,
  perStudentCap: PER,
  rowsBefore: before.length,
  rowsAfter: after.length,
  readsBefore: beforeReads,
  readsAfter: afterReads,
}

check(after.length === before.length, `row count differs: ${before.length} vs ${after.length}`)
const firstDiff = before.findIndex((r, i) => norm(r) !== norm(after[i]))
check(
  firstDiff === -1,
  `rows differ at index ${firstDiff}: ${norm(before[firstDiff])} vs ${norm(after[firstDiff])}`,
)
out.identical = firstDiff === -1 && before.length === after.length

// The round-trip claim.
check(afterReads === 1, `expected 1 read for the whole roster, got ${afterReads}`)
check(
  beforeReads === ids.length,
  `expected ${ids.length} reads on the fan-out path, got ${beforeReads}`,
)

// The cap is per student, not per roster.
const counts = new Map<string, number>()
for (const r of after) counts.set(r.student_id, (counts.get(r.student_id) ?? 0) + 1)
const capped = counts.get(ids[0]) ?? 0
check(capped === PER, `student 0 has ${capped} check-ins out, ${PER} expected`)
// How many student 0 was SEEDED with, so the test can show the cap dropped rows
// rather than there never having been any.
const seededForStudentZero = 80
check(capped < seededForStudentZero, 'student 0 was not actually over the cap')
out.studentZeroSeeded = seededForStudentZero
out.studentZeroReturned = capped
const over = [...counts.values()].filter((n) => n > PER).length
check(over === 0, `${over} students exceeded the cap`)
out.maxPerStudent = Math.max(...counts.values())
out.totalCheckinsSeeded = seeded

// The org predicate: another org's rows on the same student ids must not appear.
const leaked = after.filter((r) => String(r.note).startsWith('other-'))
check(leaked.length === 0, `${leaked.length} rows leaked from another org`)

// Ordering within a student is newest first, which is what `listWellness` gave.
const firstStudent = byStudent.get(ids[0]) ?? []
check(
  firstStudent.every((r, i) => i === 0 || firstStudent[i - 1].created_at >= r.created_at),
  'check-ins are not newest-first within a student',
)

// Every requested id gets an entry, so an empty student is [] and not undefined.
check(
  ids.every((id) => byStudent.has(id)),
  'a requested student has no group entry',
)
check((byStudent.get(ids[1]) ?? []).length === 0, 'a student with no check-ins is not empty')

// An empty id list is a short-circuit, not a query — asserted by the count.
armed = true
reads = 0
const empty = await listWellnessForStudents(ORG, [], PER)
const emptyReads = reads
armed = false
check(empty.length === 0 && emptyReads === 0, `empty list spent ${emptyReads} read(s)`)
out.emptyListReads = emptyReads

// Duplicates in the id list collapse rather than double-counting.
armed = true
reads = 0
const dupes = await listWellnessForStudents(ORG, [ids[0], ids[0], ids[0]], PER)
const dupeReads = reads
armed = false
check(dupeReads === 1, `expected 1 read for a duplicate id list, got ${dupeReads}`)
check(dupes.length === PER, `duplicate ids changed the row count: ${dupes.length}`)
out.duplicateIdsReads = dupeReads

await cleanup()
await db.close()
console.log(JSON.stringify({ ...out, failures }))
if (failures.length > 0) process.exit(1)
