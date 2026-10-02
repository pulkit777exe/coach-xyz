// Students status CHECK migration against ephemeral Postgres, in a fresh
// process with no mocks. Rebuilds the pre-migration shape (three-value inline
// CHECK), runs the sole DDL owner, and proves archived rows insert — plus the
// constraint is now the named version. Throws on mismatch.

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)

// Init FIRST. The pre-migration surgery below is plain `alter table students`,
// and on a fresh database `students` does not exist yet — so running it before
// the DDL owner died with 42P01 `relation "students" does not exist`, and only
// on the ephemeral Postgres CI provides (every already-initialised database
// hides it). Schema first, then rebuild the old world, then re-run init to
// prove the migration.
await ensureInitialized()

// Rebuild the old world: drop the named constraint if present and install the
// three-value inline check under its auto-generated name.
await db.unsafe(`alter table if exists students drop constraint if exists students_status_check;`)
await db.unsafe(`alter table students drop constraint if exists students_status_old;`)
await db.unsafe(`alter table students drop constraint if exists students_status;`)
await db`
  do $$
  declare _conname text;
  begin
    select conname into _conname from pg_constraint
    where conrelid = 'students'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%';
    if _conname is not null then
      execute format('alter table students drop constraint %I', _conname);
    end if;
  end $$;
`
await db.unsafe(
  `alter table students add constraint students_status_old check (status in ('active','inactive','transferred'));`,
)

// Re-arm the DDL owner. `ensureInitialized` memoises its run in a shared
// `initPromise`, so the second call below would return the FIRST call's already
// resolved promise and never re-execute the migration — the very thing this
// probe exists to prove. The test seam resets that memo along with the
// connection, which is exactly the "start over" this needs.
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

const named = await db<{ conname: string }[]>`
  select conname from pg_constraint
  where conrelid = 'students'::regclass and conname = 'students_status_check';
`
check(named.length === 1, 'named students_status_check missing after init')

const ORG = 'auth0|archive-org'
const STUDENT = '00000000-0000-4000-8000-0000000000a1'
await db`delete from students where id = ${STUDENT}::uuid;`
await db`insert into students (id, auth0_id, full_name, status) values (${STUDENT}::uuid, ${ORG}, 'Archie Ved', 'archived');`
const rows = await db<{ status: string }[]>`
  select status from students where id = ${STUDENT}::uuid;
`
check(rows[0]?.status === 'archived', 'archived row did not persist')
await db`delete from students where id = ${STUDENT}::uuid;`

await db.close()
console.log(JSON.stringify({ migrated: true }))
