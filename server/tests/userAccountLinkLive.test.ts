import { expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { resolveAuth0Id, upsertUser } from '../src/lib/users'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Account linking: the array bind that made it a dead endpoint ──────────────
//
// `upsertUser` reached for `linked_auth0_ids = ${uniqueLinked}` — a JS array.
// Bun sends a JS array as comma-joined text, so Postgres was asked to parse
// `auth0|abc` as an array literal and raised `22P02 malformed array literal`.
// Verified against live Postgres for every arity that reaches the statement:
// one id, two ids, and the EMPTY array the unverified branch produces when the
// row has no links yet. Both arms of the branch always threw.
//
// The reason this was a 500 and not a degraded link is the wrapper: `upsertUser`
// runs inside `withHistoryStore`, which fails OPEN and returns null, and
// `POST /api/auth/sync` turns that null into `500 Failed to sync user`. Because
// the link never persisted, every subsequent login retried the same failing
// statement — permanently broken, not retryable.
//
// No fixture can catch this class: the tests that stub `db` as a plain tag
// function never hand Bun a real array to serialise. Hence live Postgres, and
// hence this file spawns nothing (a live-database suite that spawns probes
// makes every probe in it wait on the inherited pool — see the note in
// orgTeamScopeLive.test.ts).

const EMAIL = 'link-target@link.test'
const PRIMARY = 'auth0|link-primary'
const SECOND = 'auth0|link-second'

// Every sub this file writes, INCLUDING the unverified one — it gets its own
// row now (email is not unique), so a cleanup keyed on EMAIL alone would erase it
// anyway and a cleanup that missed it would leak into the next test.
const SUBS = '{auth0|link-primary,auth0|link-second,auth0|link-unverified}'
const clear = async (db: SQL) => {
  await db`delete from users where email = ${EMAIL} or auth0_id = any(${SUBS}::text[])`
}

const seed = async (db: SQL) => {
  await clear(db)
  await db`
    insert into users (auth0_id, email, name, email_verified, linked_auth0_ids)
    values (${PRIMARY}, ${EMAIL}, 'Primary Account', true, '{}'::text[])
  `
}

describeLiveDb('account linking writes linked_auth0_ids', () => {
  useLiveTestDb({ seed, cleanup: clear })

  test('a second provider on a registered email persists its link', async () => {
    const before = await upsertUser({
      sub: PRIMARY,
      email: EMAIL,
      name: 'Primary Account',
      email_verified: true,
    })
    expect(before).not.toBeNull()

    const linked = await upsertUser({
      sub: SECOND,
      email: EMAIL,
      name: 'Second Provider',
      email_verified: true,
    })

    // The non-sensitive payload must SURVIVE. Asserting only that the id is
    // absent would also pass against the null a failed-open wrapper returns,
    // which is the bug this whole branch had — so the record coming back at all
    // is the assertion that carries the weight.
    expect(linked).not.toBeNull()
    // The UPDATE targets the CANONICAL row (`where id = …`), so auth0_id does
    // NOT become the second provider: there is one users row per email, with the
    // alternative provider subs listed in linked_auth0_ids. Asserting the
    // opposite would demand two rows for one person, which is the thing this
    // design exists to avoid.
    expect(linked!.auth0_id).toBe(PRIMARY)
    expect(linked!.email).toBe(EMAIL)
    expect(linked!.linked_auth0_ids ?? []).toContain(SECOND)

    // The read path's whole purpose depends on that write having landed.
    const stored = await resolveAuth0Id(SECOND)
    expect(stored).toBe(PRIMARY)
  })

  test('the column is a real text[] holding the second sub', async () => {
    await upsertUser({
      sub: PRIMARY,
      email: EMAIL,
      name: 'Primary Account',
      email_verified: true,
    })
    await upsertUser({ sub: SECOND, email: EMAIL, name: 'Second Provider', email_verified: true })

    const rows = (await (
      await import('../src/lib/historyStore')
    ).withHistoryStoreOrThrow(
      async (db) => db`select linked_auth0_ids from users where email = ${EMAIL}`,
    )) as Array<{
      linked_auth0_ids: string[]
    }>
    expect(Array.isArray(rows[0]?.linked_auth0_ids)).toBe(true)
    expect(rows[0].linked_auth0_ids).toEqual([SECOND])
  })

  test('an unverified login gets its OWN row and never touches the account', async () => {
    await upsertUser({
      sub: PRIMARY,
      email: EMAIL,
      name: 'Primary Account',
      email_verified: true,
    })

    // The takeover guard. Before the bind was fixed it held FOR THE WRONG REASON
    // — both arms of the branch threw 22P02, so the crash was what prevented the
    // takeover, not the conditional. Fixing the bind without closing this would
    // have turned a dead write into a live takeover path.
    const unverified = await upsertUser({
      sub: 'auth0|link-unverified',
      email: EMAIL,
      name: 'Impostor',
      email_verified: false,
    })

    // Its own row rather than the existing account: `email` is NOT unique, so
    // there is no need to borrow the canonical record in order to store it.
    expect(unverified).not.toBeNull()
    expect(unverified!.auth0_id).toBe('auth0|link-unverified')
    expect(unverified!.email_verified).toBe(false)

    // And the real account is untouched — not renamed, not linked, not
    // downgraded. The rename is the part that actually mattered: the UPDATE
    // sets name/nickname/picture, so reaching it from an unverified login let
    // anyone who could sign up overwrite a real person's name and avatar.
    const canonical = (await (
      await import('../src/lib/historyStore')
    ).withHistoryStoreOrThrow(
      async (db) =>
        db`select name, email_verified, linked_auth0_ids from users where auth0_id = ${PRIMARY}`,
    )) as Array<{ name: string; email_verified: boolean; linked_auth0_ids: string[] }>
    expect(canonical[0].name).toBe('Primary Account')
    expect(canonical[0].email_verified).toBe(true)
    // The impostor's sub specifically — not an equality against [], because a
    // prior test in this file legitimately links SECOND to PRIMARY, and asserting
    // emptiness would make this one depend on execution order.
    expect(canonical[0].linked_auth0_ids ?? []).not.toContain('auth0|link-unverified')

    await (
      await import('../src/lib/historyStore')
    ).withHistoryStoreOrThrow(
      async (db) => db`delete from users where auth0_id = ${'auth0|link-unverified'}`,
    )
  })

  test('a verified link onto a row with NO existing links binds arity 1', async () => {
    // The row's linked_auth0_ids starts as the '{}' default, so the literal
    // built here holds ONE element. The old bind sent the raw value and Postgres
    // tried to parse `auth0|link-second` as an array literal — so arity 1 is the
    // case a fixture seeded with two existing links would never have reached.
    const linked = await upsertUser({
      sub: SECOND,
      email: EMAIL,
      name: 'Primary Account',
      email_verified: true,
    })
    expect(linked).not.toBeNull()
    expect(linked!.linked_auth0_ids).toEqual([SECOND])
  })
})
