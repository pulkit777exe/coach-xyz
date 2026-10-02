import { SQL } from 'bun'
import { afterAll, beforeAll, describe } from 'bun:test'

import { setHistoryStoreConnectionForTests, withHistoryStoreOrThrow } from '../src/lib/historyStore'

// ── Live-Postgres suites: which database, and how the store reaches it ────────
// A suite gated on `Boolean(process.env.DATABASE_URL)` is gated on the LIVE Neon
// URL, and CI deliberately leaves `DATABASE_URL` unset ("nothing destructive
// ever runs against Neon from CI"). Its ephemeral service is only reachable via
// TEST_DATABASE_URL / PERF_DATABASE_URL, so every such suite skipped on every
// CI run and the live-SQL evidence — the class no fixture can produce — had
// never once been gathered. Six files already gated on TEST_DATABASE_URL
// correctly (archive, dataRights, offboard, retentionSweep, studentDelete,
// teamStudentLink); this module is the in-process twin of that gate.
//
// Two pieces, and both are needed:
//
//  1. `describeLiveDb` — the gate. Resolution order is
//     TEST_DATABASE_URL → PERF_DATABASE_URL → DATABASE_URL, so CI (and any
//     ephemeral-database script) gets its own instance while a developer with a
//     real DATABASE_URL keeps today's behaviour instead of silently losing
//     coverage. DATABASE_URL is LAST on purpose: it is the only one of the
//     three that can destroy real data.
//
//  2. `useLiveTestDb()` — the wiring. `historyStore` builds its connection from
//     `DATABASE_URL` at IMPORT time (module-level `new SQL(...)`), so flipping
//     the gate alone would leave the suite pointed at the live database (or, in
//     CI, at no database at all: the store's `sql` is `null` and every
//     `withHistoryStore` call silently returns `null` through
//     `orDisabledDefault` — a green run of assertions against nothing). This
//     points the store's single module-level slot at the resolved URL.
//
// The re-arming subtlety, from `archivePgProbe.ts`: `ensureInitialized` memoises
// its run in a shared `initPromise`, so a connection swap that left the memo
// alone would hand back the FIRST connection's already-resolved promise and skip
// the DDL entirely. `setHistoryStoreConnectionForTests` nulls `initPromise`
// alongside the connection, which is precisely the "start over" this needs —
// so a fresh swap is also a fresh schema run against the target database.

/**
 * The database a live-Postgres suite should run against, or '' when none is
 * configured. Never call this before `hasLiveTestDb` is true — an empty URL
 * handed to `new SQL` connects to nothing useful and the suite would report a
 * connection failure instead of skipping.
 *
 * An EMPTY value counts as unset, which is why this is not a `??` chain. Both
 * `DATABASE_URL= bun test` and `TEST_DATABASE_URL=` are ordinary ways to spell
 * "not set", and `??` reads `''` as present — so `TEST_DATABASE_URL=` in front of
 * a perfectly good `DATABASE_URL` would skip the suite instead of running it,
 * silently, which is the exact failure this module exists to end. `historyStore`
 * makes the same call about its own `DATABASE_URL`: `(process.env.DATABASE_URL ??
 * '').trim()` and a falsy check, i.e. empty means disabled.
 */
export const liveTestDbUrl = (): string => {
  for (const name of ['TEST_DATABASE_URL', 'PERF_DATABASE_URL', 'DATABASE_URL'] as const) {
    const value = (process.env[name] ?? '').trim()
    if (value) return value
  }
  return ''
}

/**
 * Evaluated once at import, so `describeLiveDb` below can pick `describe` vs
 * `describe.skip` at module load — the only time the choice can be made.
 */
export const hasLiveTestDb = liveTestDbUrl().length > 0

/** The gate. Pairs with `useLiveTestDb()` inside the body. */
export const describeLiveDb = hasLiveTestDb ? describe : describe.skip

/**
 * Point the history store at `liveTestDbUrl()` for the enclosing describe.
 *
 * Call this INSIDE a `describeLiveDb(...)` body, next to the suite's own
 * `beforeAll`: it registers its own `beforeAll`/`afterAll` pair, and keeping the
 * scope to the live block means the hermetic half of a mixed file keeps running
 * against whatever connection it installed for itself.
 *
 * A suite that seeds or cleans up THROUGH the store must pass those as
 * `seed`/`cleanup` rather than registering its own hooks. Bun runs `beforeAll`
 * and `afterAll` in registration order, so this call's two hooks sit at the same
 * position in both sequences: a call placed before the suite's own hooks wires
 * the store in first (good) but restores it to null first too, so the suite's
 * teardown then fails against no connection. A call placed after them inverts
 * it. Only one position is right, and it is not expressible from the call site —
 * so the ordering lives here, where it is correct by construction.
 *
 * When the resolved URL is already `DATABASE_URL` the store built the right
 * connection at import, so the swap is skipped — no second pool to the same
 * database, and `restore` stays null.
 */
export const useLiveTestDb = (opts?: {
  seed?: (db: SQL) => Promise<void>
  cleanup?: (db: SQL) => Promise<void>
}): void => {
  // Registering hooks inside a SKIPPED describe makes Bun count them as two extra
  // skipped "tests", which inflates the very skip tally this module exists to
  // make honest. Nothing runs either way, so the honest number is the smaller
  // one. This is the no-database case, and it is exactly when the wiring would
  // have nothing to point at.
  if (!hasLiveTestDb) return

  const url = liveTestDbUrl()
  const alreadyWired = url === (process.env.DATABASE_URL ?? '').trim()

  let restore: (() => void) | null = null
  let db: SQL | null = null

  // `seed`/`cleanup` are handed the SAME connection the store uses, in both
  // wirings: our own when the store was swapped, and the store's own when
  // `DATABASE_URL` already pointed at the resolved URL (so the "no second pool
  // to the same database" property holds).
  const withDb = async (fn?: (conn: SQL) => Promise<void>): Promise<void> => {
    if (!fn) return
    if (alreadyWired) {
      await withHistoryStoreOrThrow(fn)
      return
    }
    await fn(db as SQL)
  }

  beforeAll(async () => {
    if (!alreadyWired) {
      db = new SQL(url)
      restore = setHistoryStoreConnectionForTests(db)
    }
    await withDb(opts?.seed)
  })

  afterAll(async () => {
    // Cleanup BEFORE the restore, or it runs against a null store and fails as
    // an unnamed hook error ("History store is not configured"). This is why
    // seed/cleanup are parameters here rather than the suite's own hooks: Bun
    // runs hooks in registration order, so a suite cannot place this call's
    // wiring first and its teardown last at the same time.
    await withDb(opts?.cleanup)
    // Restore before closing: the store must stop pointing at this connection
    // first, or a later teardown path that still calls the wrapper dies with
    // ERR_POSTGRES_CONNECTION_CLOSED instead of finishing.
    restore?.()
    restore = null
    const opened = db
    db = null
    await opened?.close()
  })
}
