import type { SQL } from 'bun'

import { orDisabledDefault, withHistoryStore } from './historyStore'
import { uuidArrayLiteral } from './org/scope'
export type UserRecord = {
  id: string
  auth0_id: string
  email: string | null
  name: string | null
  nickname: string | null
  picture: string | null
  email_verified: boolean
  linked_auth0_ids: string[]
  role: 'coach' | 'player'
  created_at: string
  updated_at: string
}

/**
 * Links a user to the student row matching their email (two-faces player flow).
 * Called when a brand-new user logs in with an email that a coach registered on
 * a student record. Marks the student as linked to this account and flips the
 * user's role to `player`.
 */

const linkPlayerToStudent = async (db: SQL, sub: string, email: string): Promise<boolean> => {
  const matches = await db<{ id: string }[]>`
    select id from students
    where email = ${email}
      and (account_auth0_id is null or account_auth0_id = ${sub})
    limit 1;
  `
  if (!matches?.[0]) return false

  await db`
    update students set account_auth0_id = ${sub}, updated_at = now()
    where id = ${matches[0].id};
  `
  await db`
    update users set role = 'player', updated_at = now()
    where auth0_id = ${sub};
  `
  return true
}

export const upsertUser = async (user: {
  sub: string
  email?: string
  name?: string
  nickname?: string
  picture?: string
  email_verified?: boolean
}): Promise<UserRecord | null> => {
  return withHistoryStore(async (db) => {
    // Check if a user with this auth0_id already exists
    const existingById = await db<UserRecord[]>`
      select * from users where auth0_id = ${user.sub} limit 1;
    `
    if (existingById?.[0]) {
      // Existing user — update profile fields
      const rows = await db<UserRecord[]>`
        update users set
          email = ${user.email || existingById[0].email},
          name = ${user.name || existingById[0].name},
          nickname = ${user.nickname || existingById[0].nickname},
          picture = ${user.picture || existingById[0].picture},
          email_verified = ${user.email_verified ?? existingById[0].email_verified},
          updated_at = now()
        where auth0_id = ${user.sub}
        returning *;
      `
      return rows?.[0] ?? null
    }

    // No existing user with this auth0_id — check if email matches an existing account
    if (user.email) {
      const existingByEmail = await db<UserRecord[]>`
        select * from users where email = ${user.email} limit 1;
      `
      // Only a VERIFIED login may attach itself to an existing account — and,
      // just as importantly, only a verified one may WRITE to it. The statement
      // below sets name/nickname/picture, so letting an unverified login reach
      // it would let anyone who can sign up with an unverified email rename a
      // real account and repoint its avatar: measured, an unverified login
      // renamed the canonical row from "Real Owner" to "Impostor" and left it
      // that way. No privilege escalation (the link is withheld and
      // `resolveAuth0Id` keeps the new sub separate, so the impostor still only
      // ever acts as itself) — but a persistent integrity defect on someone
      // else's record, and `email` is NOT unique, so the answer is simple.
      //
      // The unverified case falls through to the insert path below and gets its
      // own row, unlinked and unverified. Nothing is lost: an unverified login
      // was never entitled to the existing account in the first place.
      //
      // This is the coupling the dead bind was hiding. While the statement threw
      // 22P02 on both arms, the "an unverified email must not take over an
      // existing account" rule held FOR THE WRONG REASON — it was upheld by the
      // crash, not by this conditional. Fixing the bind without this guard
      // would have converted a broken write into a live takeover path.
      if (existingByEmail?.[0] && user.email_verified === true) {
        // Found existing account by email — link the new provider. Never
        // downgrade a verified flag to unverified (guaranteed by the guard
        // above: this branch only runs for a verified login).
        const mergedLinked = [
          ...(existingByEmail[0].linked_auth0_ids || []),
          user.sub,
        ]
        const uniqueLinked = [...new Set(mergedLinked)]
        // The array must be bound as a Postgres array LITERAL, not as a JS array.
        //
        // Bun sends a JS array as comma-joined text, so the old
        // `linked_auth0_ids = ${uniqueLinked}` handed Postgres the string
        // `auth0|abc` and asked it to parse that as an array literal — which
        // raises `22P02 malformed array literal`. Verified against a live
        // Postgres for every arity that reaches here: one id, two ids, and the
        // EMPTY array (`''`, from the unverified branch when the row has no
        // links yet) all fail. So both arms of this branch always threw.
        //
        // The consequence was not a degraded link, it was a dead endpoint: the
        // wrapper is `withHistoryStore`, which fails OPEN and returns null, and
        // `POST /api/auth/sync` turns that into `500 Failed to sync user` for
        // any second provider signing in on an already-registered email. Because
        // the link never persisted, every later login retried the same failing
        // statement — permanently broken rather than retryable.
        //
        // `uuidArrayLiteral` is named for uuids but is generic
        // (`{${ids.join(',')}}`); it is the documented SSOT for this binding
        // shape, so it is reused rather than duplicated with a text-flavoured
        // name. An auth0 sub is `auth0|<hex>`, which needs no element quoting —
        // a value containing `,` `{` `}` or whitespace would need it, and
        // nothing that reaches this column can.
        const rows = await db<UserRecord[]>`
          update users set
            linked_auth0_ids = ${uuidArrayLiteral(uniqueLinked)}::text[],
            name = ${user.name || existingByEmail[0].name},
            nickname = ${user.nickname || existingByEmail[0].nickname},
            picture = ${user.picture || existingByEmail[0].picture},
            email_verified = ${user.email_verified === true || existingByEmail[0].email_verified === true},
            updated_at = now()
          where id = ${existingByEmail[0].id}
          returning *;
        `
        return rows?.[0] ?? null
      }
    }

    // New user — create record. Defaults to 'coach'; if this email belongs to a
    // student a coach enrolled, the account is linked and flipped to 'player'.
    // The link-to-player step only happens when the new account is verified.
    const rows = await db<UserRecord[]>`
      insert into users (auth0_id, email, name, nickname, picture, email_verified)
      values (${user.sub}, ${user.email || null}, ${user.name || null}, ${user.nickname || null}, ${user.picture || null}, ${user.email_verified === true})
      returning *;
    `
    const created = rows?.[0] ?? null

    if (created && user.email && user.email_verified === true) {
      const linked = await linkPlayerToStudent(db, user.sub, user.email)
      if (linked) {
        const fresh = await db<UserRecord[]>`
          select * from users where auth0_id = ${user.sub} limit 1;
        `
        return fresh?.[0] ?? created
      }
    }
    return created
  })
}

export const getUserByAuth0Id = async (auth0Id: string): Promise<UserRecord | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<UserRecord[]>`
      select * from users where auth0_id = ${auth0Id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

/**
 * Updates editable profile fields for the primary user record (resolving linked
 * accounts to the primary auth0_id first). Returns the freshest record.
 */

export const updateUserProfile = async (
  auth0Id: string,
  input: {
    name?: string | null
    nickname?: string | null
    picture?: string | null
  },
): Promise<UserRecord | null> => {
  const primary = (await resolveAuth0Id(auth0Id)) ?? auth0Id
  return withHistoryStore(async (db) => {
    const existing = await db<UserRecord[]>`
      select * from users where auth0_id = ${primary} limit 1;
    `
    if (!existing?.[0]) return null
    const rows = await db<UserRecord[]>`
      update users set
        name = ${input.name === undefined ? existing[0].name : input.name},
        nickname = ${input.nickname === undefined ? existing[0].nickname : input.nickname},
        picture = ${input.picture === undefined ? existing[0].picture : input.picture},
        updated_at = now()
      where auth0_id = ${primary}
      returning *;
    `
    return rows?.[0] ?? null
  })
}

/**
 * Resolves an auth0_id to the primary user record. Handles linked accounts:
 * if the given auth0_id is in another user's `linked_auth0_ids`, returns that
 * user's primary record so all historical data is accessible.
 */

export const resolveAuth0Id = async (auth0Id: string): Promise<string> => {
  const result = await withHistoryStore(async (db) => {
    const rows = await db<{ auth0_id: string }[]>`
      select auth0_id from users
      where auth0_id = ${auth0Id}
         or ${auth0Id} = any(linked_auth0_ids)
      limit 1;
    `
    return rows?.[0]?.auth0_id ?? auth0Id
  })
  return orDisabledDefault(result, auth0Id)
}

// ── Dashboard Queries ───────────────────────────────────────────────────────
