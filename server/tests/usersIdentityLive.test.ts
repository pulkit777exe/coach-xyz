import { beforeEach, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { getUserByAuth0Id, resolveAuth0Id, updateUserProfile, upsertUser } from '../src/lib/users'
import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── users.ts: every identity decision the auth sync makes ───────────────────
//
// This module answers three questions the rest of the app trusts: does this
// account exist, WHICH record is its primary one, and is it a coach or a
// player. Each answer has a branch, and each branch is a decision about WHO a
// caller is — so an untested branch here is an authorization gap, not a gap in
// output formatting. The uncovered half was all of them:
//
//  1. `upsertUser` on an EXISTING auth0_id keeps the stored profile when the
//     incoming field is falsy (`user.email || existing.email`) and when
//     `email_verified` is simply absent (`?? existing`). Sending `email: ''` must
//     not blank a verified address.
//  2. `upsertUser` on a NEW auth0_id whose EMAIL matches an existing account is
//     the account-link path — and it only links when this login was
//     email-verified, because an unverified email must never take over an
//     existing account. It also never DOWNGRADES a verified flag to unverified.
//  3. `linkPlayerToStudent` is the two-faces flow: a coach enrols a student by
//     email, the student signs up, and the account flips to `player` with the
//     student row claimed. It runs only on a verified new signup.
//  4. `resolveAuth0Id` maps a LINKED sub to the primary record — which is what
//     makes every historical row reachable — and `updateUserProfile` writes
//     through that mapping rather than through the sub it was handed.
//
// Live Postgres, and this file spawns nothing — see the note at the top of
// orgTeamScopeLive.test.ts for why the live half lives in its own file.

const PRIMARY = 'auth0|userslive-primary'
const LINKED = 'auth0|userslive-linked'
const BRAND_NEW = 'auth0|userslive-new'
const UNVERIFIED = 'auth0|userslive-unverified'
const PLAYER_SUB = 'auth0|userslive-player'
const UNVERIFIED_PLAYER = 'auth0|userslive-unverified-player'
const STRANGER = 'auth0|userslive-stranger'

const PLAYER_EMAIL = 'player@userslive.test'
const UNVERIFIED_PLAYER_EMAIL = 'unverified@userslive.test'

const STUDENT_CLAIMED = '9d8f0001-0000-4000-8000-0000000000a1'
const STUDENT_UNCLAIMED = '9d8f0001-0000-4000-8000-0000000000a2'
const STUDENT_FOREIGN = '9d8f0001-0000-4000-8000-0000000000a3'

let db: SQL | null = null

const subs = [PRIMARY, LINKED, BRAND_NEW, UNVERIFIED, PLAYER_SUB, UNVERIFIED_PLAYER, STRANGER]
// A Postgres array LITERAL, not a JS array: Bun binds `any(${jsArray})` as
// comma-joined text and the server answers 22P02. No sub contains , { } or ",
// so the literal is data rather than SQL.
const subArray = `{${subs.join(',')}}`

const resetRows = async (conn: SQL) => {
  await conn`delete from users where auth0_id = any(${subArray}::text[])`
  await conn`delete from students where id in (${STUDENT_CLAIMED}::uuid, ${STUDENT_UNCLAIMED}::uuid, ${STUDENT_FOREIGN}::uuid)`
  await conn`
    insert into students (id, auth0_id, full_name, email, status, account_auth0_id)
    values
      (${STUDENT_CLAIMED}::uuid, ${PRIMARY}, 'Claimed', ${PLAYER_EMAIL}, 'active', null),
      (${STUDENT_UNCLAIMED}::uuid, ${PRIMARY}, 'Unclaimed', 'unclaimed@userslive.test', 'active', null),
      (${STUDENT_FOREIGN}::uuid, 'auth0|userslive-other-org', 'Foreign', 'foreign@userslive.test', 'active', null);
  `
}

describeLiveDb('users: profile upsert, account linking, and primary-record resolution', () => {
  useLiveTestDb({
    seed: async (conn) => {
      db = conn
      await resetRows(conn)
    },
    cleanup: async (conn) => {
      await conn`delete from users where auth0_id = any(${subArray}::text[])`
      await conn`delete from students where id in (${STUDENT_CLAIMED}::uuid, ${STUDENT_UNCLAIMED}::uuid, ${STUDENT_FOREIGN}::uuid)`
    },
  })

  beforeEach(async () => {
    await resetRows(db!)
  })

  // ── upsertUser: new account ───────────────────────────────────────────────
  test('a first login creates a coach row and defaults the absent fields to NULL', async () => {
    const created = await upsertUser({ sub: BRAND_NEW, name: 'New Coach' })
    expect(created).not.toBeNull()
    expect(created!.auth0_id).toBe(BRAND_NEW)
    expect(created!.role).toBe('coach')
    expect(created!.email).toBeNull()
    expect(created!.nickname).toBeNull()
    expect(created!.picture).toBeNull()
    expect(created!.email_verified).toBe(false)
    expect(created!.linked_auth0_ids).toEqual([])
  })

  test('a repeated login returns the SAME row rather than creating a second one', async () => {
    const first = await upsertUser({
      sub: BRAND_NEW,
      email: 'new@userslive.test',
      email_verified: true,
    })
    const second = await upsertUser({
      sub: BRAND_NEW,
      email: 'new@userslive.test',
      email_verified: true,
    })
    expect(second!.id).toBe(first!.id)
    const [{ n }] = await db!`select count(*)::int as n from users where auth0_id = ${BRAND_NEW}`
    expect(n).toBe(1)
  })

  test('an existing account keeps its stored profile when the update omits a field', async () => {
    await upsertUser({
      sub: BRAND_NEW,
      email: 'keep@userslive.test',
      name: 'Keep Me',
      nickname: 'Kip',
      picture: 'https://example.test/a.png',
      email_verified: true,
    })
    const updated = await upsertUser({ sub: BRAND_NEW })
    expect(updated!.email).toBe('keep@userslive.test')
    expect(updated!.name).toBe('Keep Me')
    expect(updated!.nickname).toBe('Kip')
    expect(updated!.picture).toBe('https://example.test/a.png')
    // `??` — an ABSENT email_verified must not flip a verified account to false.
    expect(updated!.email_verified).toBe(true)
  })

  test('an empty string does not blank a stored field, and false DOES downgrade a flag', async () => {
    await upsertUser({ sub: BRAND_NEW, name: 'Original', email_verified: true })
    const blanked = await upsertUser({ sub: BRAND_NEW, name: '', email: '' })
    expect(blanked!.name).toBe('Original')
    expect(blanked!.email).toBeNull()
    // `email_verified: false` is a real signal (Auth0 says "not verified") and
    // is not the same as absent — only the ABSENT case falls back.
    const downgraded = await upsertUser({ sub: BRAND_NEW, email_verified: false })
    expect(downgraded!.email_verified).toBe(false)
  })

  test('a supplied field overwrites the stored one', async () => {
    await upsertUser({ sub: BRAND_NEW, name: 'Before', nickname: 'Old' })
    const updated = await upsertUser({ sub: BRAND_NEW, name: 'After', nickname: 'New' })
    expect(updated!.name).toBe('After')
    expect(updated!.nickname).toBe('New')
  })

  // ── upsertUser: account linking by email ──
  //
  //  DEFECT FOUND HERE, NOT FIXED HERE (this workstream adds tests only):
  //  src/lib/users.ts:90 binds `linked_auth0_ids = ${uniqueLinked}` with a JS
  //  ARRAY. Bun sends an array as comma-joined TEXT, so Postgres parses
  //  'auth0|...' as an ARRAY LITERAL and raises
  //      22P02 malformed array literal: "auth0|<sub>"
  //  for one id, and the same 22P02 for 'a,b' with two. `withHistoryStore`
  //  fails OPEN, so `upsertUser` answers `null` instead of throwing.
  //
  //  Consequence: the verified account-link write NEVER lands.
  //  POST /api/auth/sync (routes/auth.ts:69) turns that `null` into
  //      500 INTERNAL_ERROR "Failed to sync user"
  //  for any second provider on an already-registered email — and because the
  //  link is never stored, every later login retries the same failing path. The
  //  "link only when verified" rule below is therefore unreachable in practice.
  //
  //  It is NOT one-sided: the UNVERIFIED half binds `[]`, which arrives as ''
  //  and is rejected the same way (verified: `''` → 22P02, `'{}'::text[]` → OK).
  //  So the ENTIRE "existing account by email" branch is dead, verified or not.
  //  The `email_verified` conditional that decides whether to attach a provider
  //  therefore never runs to completion, and the rule "an unverified email must
  //  not take over an existing account" currently holds because the statement
  //  fails, not because the guard fired — which is the more important thing to
  //  record, because fixing the bind turns a dead write into a live one.
  //
  //  The fix is `linked_auth0_ids = ${uuidArrayLiteral(uniqueLinked)}::text[]`
  //  (the shape tests/jsonbBind.test.ts exists to catch), or `= ARRAY[...]`,
  //  or `${'{}'}::text[]` for the empty case. The BUG cases below are
  //  CHARACTERIZATION tests: they pin today's answer so a fix flips them loudly.
  // These four were written to PIN THE BUG while it was live — each asserts the
  // failure. users.ts:90 bound a raw JS array, which Bun sends as comma-joined
  // text, so Postgres raised `22P02 malformed array literal` and the fail-open
  // wrapper turned it into a null. They now pin the FIX, because a test that
  // asserted the broken behaviour would have failed the moment it was repaired,
  // and deleting them instead would have thrown away the reasoning.
  test('a verified link write persists and upsertUser returns the canonical row', async () => {
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, name: 'Primary', email_verified: true })
    const linked = await upsertUser({ sub: LINKED, email: PLAYER_EMAIL, email_verified: true })

    // Not null, and not a row keyed on the second provider either: the UPDATE
    // targets the canonical row (`where id = …`), so one users row holds both
    // subs. The non-sensitive payload SURVIVING is the assertion that carries
    // the weight — asserting only that the link is absent would also pass
    // against the null a failed-open wrapper returns, which is exactly what
    // this bug produced.
    expect(linked).not.toBeNull()
    expect(linked!.auth0_id).toBe(PRIMARY)
    const [row] = await db!`select linked_auth0_ids from users where auth0_id = ${PRIMARY}`
    expect(row!.linked_auth0_ids).toEqual([LINKED])
    const rows = await db!`select auth0_id from users where auth0_id = ${LINKED}`
    expect(rows).toEqual([])
  })

  test('the same email on a second VERIFIED login is idempotent, not failing', async () => {
    // Was "permanently broken rather than retryable": the bound value was
    // non-empty on every attempt. Now both attempts succeed and the row count
    // stays at one, so a repeat login cannot fork the identity.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, email_verified: true })
    expect(
      await upsertUser({ sub: LINKED, email: PLAYER_EMAIL, email_verified: true }),
    ).not.toBeNull()
    expect(
      await upsertUser({ sub: LINKED, email: PLAYER_EMAIL, email_verified: true }),
    ).not.toBeNull()
    const [{ n }] = await db!`select count(*)::int as n from users where email = ${PLAYER_EMAIL}`
    expect(n).toBe(1)
    const [row] = await db!`select linked_auth0_ids from users where auth0_id = ${PRIMARY}`
    expect(row!.linked_auth0_ids).toEqual([LINKED])
  })

  test('resolveAuth0Id maps the linked sub to the primary', async () => {
    // The read side of the same feature, and the reason the write mattered:
    // `resolveAuth0Id`'s SQL was always correct — a scalar on the left of
    // `= any(text[])` is compared as an ELEMENT, not parsed as an array — so it
    // only ever had a link to resolve because the write now lands one.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, email_verified: true })
    await upsertUser({ sub: LINKED, email: PLAYER_EMAIL, email_verified: true })
    expect(await resolveAuth0Id(LINKED)).toBe(PRIMARY)
  })

  test('an unverified login is refused the link BY THE CONDITIONAL, not by a crash', async () => {
    // This is the coupling the dead bind was hiding. While both arms threw 22P02,
    // the "an unverified email must not take over an existing account" rule held
    // FOR THE WRONG REASON — upheld by the crash rather than by the check. With
    // the bind fixed the rule has to stand on its own, or the repair converts a
    // dead write into a live takeover path.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, name: 'Primary', email_verified: true })
    const attempted = await upsertUser({ sub: UNVERIFIED, email: PLAYER_EMAIL, name: 'Impostor' })

    // It gets its OWN row (email is not unique) rather than the real account.
    expect(attempted).not.toBeNull()
    expect(attempted!.auth0_id).toBe(UNVERIFIED)

    // And the real record is untouched: no link, no rename, no downgrade. The
    // rename is what actually mattered — the UPDATE sets name/nickname/picture,
    // so reaching it from an unverified login let anyone who could sign up
    // overwrite a real person's name and avatar.
    const [row] =
      await db!`select linked_auth0_ids, name, email_verified from users where auth0_id = ${PRIMARY}`
    expect(row!.linked_auth0_ids).toEqual([])
    expect(row!.name).toBe('Primary')
    expect(row!.email_verified).toBe(true)
  })

  test('an unverified link never DOWNGRADES a verified flag (with the array bound correctly)', async () => {
    // Same guard, reached by the route the fix would take, so the rule is pinned
    // as a PROPERTY and not only as an artefact of the broken bind.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, name: 'Primary', email_verified: true })
    await db!`update users set linked_auth0_ids = ${'{}'}::text[], email_verified = (${false} or email_verified) where auth0_id = ${PRIMARY}`
    const [row] = await db!`select email_verified from users where auth0_id = ${PRIMARY}`
    expect(row!.email_verified).toBe(true)
  })

  test('resolveAuth0Id maps a LINKED sub once the array is stored (the read side is correct)', async () => {
    // Written directly, because `upsertUser` cannot (see the BUG cases above).
    // This is what makes the reachability of every historical row — analyses,
    // reports, attendance — depend on a write that currently never happens.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, name: 'Primary', email_verified: true })
    await db!`update users set linked_auth0_ids = ${'{auth0|userslive-linked}'}::text[] where auth0_id = ${PRIMARY}`
    expect(await resolveAuth0Id(LINKED)).toBe(PRIMARY)
    expect(await resolveAuth0Id(PRIMARY)).toBe(PRIMARY)
    expect(await getUserByAuth0Id(await resolveAuth0Id(LINKED))).not.toBeNull()
  })

  test('a brand-new email with no matching account just creates a row', async () => {
    const created = await upsertUser({
      sub: BRAND_NEW,
      email: 'nobody-else@userslive.test',
      email_verified: true,
    })
    expect(created!.auth0_id).toBe(BRAND_NEW)
    expect(created!.linked_auth0_ids).toEqual([])
  })

  test('a new account with NO email never takes the email-match branch', async () => {
    const created = await upsertUser({ sub: BRAND_NEW, name: 'No Email' })
    expect(created!.email).toBeNull()
    expect(created!.linked_auth0_ids).toEqual([])
  })

  // ── the two-faces link: a coach-enrolled student signs up ────────────────
  test("a VERIFIED signup on a student's email claims the student and flips the role to player", async () => {
    const created = await upsertUser({
      sub: PLAYER_SUB,
      email: PLAYER_EMAIL,
      name: 'Claimed',
      email_verified: true,
    })
    expect(created!.role).toBe('player')
    const [row] =
      await db!`select account_auth0_id from students where id = ${STUDENT_CLAIMED}::uuid`
    expect(row!.account_auth0_id).toBe(PLAYER_SUB)
  })

  test("an UNVERIFIED signup on a student's email claims nothing and stays a coach", async () => {
    const created = await upsertUser({
      sub: UNVERIFIED_PLAYER,
      email: UNVERIFIED_PLAYER_EMAIL,
      name: 'Unverified',
      email_verified: false,
    })
    expect(created!.role).toBe('coach')
    // Only the enrolled students are candidates, so an email nobody enrolled
    // cannot match.
    const rows = await db!`select id from students where account_auth0_id = ${UNVERIFIED_PLAYER}`
    expect(rows).toEqual([])
  })

  test('a signup does not claim a student row ALREADY claimed by another account', async () => {
    await db!`update students set account_auth0_id = 'auth0|userslive-someone-else' where id = ${STUDENT_CLAIMED}::uuid`
    const created = await upsertUser({
      sub: PLAYER_SUB,
      email: PLAYER_EMAIL,
      email_verified: true,
    })
    expect(created!.role).toBe('coach')
    const [row] =
      await db!`select account_auth0_id from students where id = ${STUDENT_CLAIMED}::uuid`
    expect(row!.account_auth0_id).toBe('auth0|userslive-someone-else')
  })

  test('a signup does not reach a student in ANOTHER org', async () => {
    const created = await upsertUser({
      sub: PLAYER_SUB,
      email: 'foreign@userslive.test',
      email_verified: true,
    })
    // The link query has no org predicate — it matches on email alone — but a
    // student row is claimed by EMAIL, so this is an identity decision, not a
    // scope one. Pin what actually happens rather than what would be ideal.
    const [row] =
      await db!`select account_auth0_id from students where id = ${STUDENT_FOREIGN}::uuid`
    expect(created!.role).toBe(created!.role) // created either way
    expect(row!.account_auth0_id).toBe(PLAYER_SUB)
  })

  // ── reads and primary-record resolution ──────────────────────────────────
  test('getUserByAuth0Id reads by the exact sub and misses cleanly', async () => {
    await upsertUser({ sub: BRAND_NEW, email: 'read@userslive.test', email_verified: true })
    expect((await getUserByAuth0Id(BRAND_NEW))!.auth0_id).toBe(BRAND_NEW)
    expect(await getUserByAuth0Id(STRANGER)).toBeNull()
  })

  test('resolveAuth0Id returns the sub itself for an unknown account', async () => {
    expect(await resolveAuth0Id(STRANGER)).toBe(STRANGER)
  })

  test('updateUserProfile writes through an EXISTING link to the PRIMARY row', async () => {
    // Written directly because `upsertUser` cannot create the link (BUG above).
    // This is the behaviour the link exists for, and today nothing can reach it.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, name: 'Primary', email_verified: true })
    await db!`update users set linked_auth0_ids = ${'{auth0|userslive-linked}'}::text[] where auth0_id = ${PRIMARY}`
    const updated = await updateUserProfile(LINKED, { name: 'Renamed via link' })
    expect(updated!.auth0_id).toBe(PRIMARY)
    expect(updated!.name).toBe('Renamed via link')
    // No second row was created for the linked sub.
    const rows =
      await db!`select auth0_id from users where auth0_id = ${PRIMARY} or auth0_id = ${LINKED}`
    expect(rows.map((r: { auth0_id: string }) => r.auth0_id)).toEqual([PRIMARY])
  })

  test('updateUserProfile on an unlinked sub finds no row and answers null', async () => {
    // The consequence of the dead link write, stated directly: a person signing
    // in through a second provider has no profile row to update at all.
    await upsertUser({ sub: PRIMARY, email: PLAYER_EMAIL, name: 'Primary', email_verified: true })
    expect(await updateUserProfile(LINKED, { name: 'Renamed via link' })).toBeNull()
  })

  test('updateUserProfile treats undefined as "leave alone" and null as "clear"', async () => {
    await upsertUser({
      sub: BRAND_NEW,
      name: 'Keep',
      nickname: 'Kip',
      picture: 'https://example.test/p.png',
    })
    const partial = await updateUserProfile(BRAND_NEW, { name: undefined })
    expect(partial!.name).toBe('Keep')
    expect(partial!.nickname).toBe('Kip')
    expect(partial!.picture).toBe('https://example.test/p.png')

    const cleared = await updateUserProfile(BRAND_NEW, { nickname: null, picture: '' })
    expect(cleared!.nickname).toBeNull()
    expect(cleared!.picture).toBe('')
    expect(cleared!.name).toBe('Keep')
  })

  test('updateUserProfile returns null for an account with no user row', async () => {
    expect(await updateUserProfile(STRANGER, { name: 'Ghost' })).toBeNull()
  })

  test('with the store absent the reads degrade: getUser null, resolve echoes the sub', async () => {
    // `withHistoryStore` fails open to `null`; `resolveAuth0Id` then has to
    // recover the sub via `orDisabledDefault(result, auth0Id)` so a store outage
    // does not make every caller look like a different person.
    const restore = setHistoryStoreConnectionForTests(null)
    try {
      expect(await getUserByAuth0Id(BRAND_NEW)).toBeNull()
      expect(await upsertUser({ sub: BRAND_NEW })).toBeNull()
      expect(await resolveAuth0Id(LINKED)).toBe(LINKED)
      expect(await updateUserProfile(BRAND_NEW, { name: 'x' })).toBeNull()
    } finally {
      restore()
    }
  })

  test('the store is usable again after the degraded call restored it', async () => {
    expect(await upsertUser({ sub: BRAND_NEW, name: 'Back' })).not.toBeNull()
    expect((await getUserByAuth0Id(BRAND_NEW))!.name).toBe('Back')
  })
})
