import type { SQL } from 'bun'

import { ensureInitialized, withHistoryStore } from './historyStore'
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
    await ensureInitialized()

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
      if (existingByEmail?.[0]) {
        // Found existing account by email — link the new provider
        // only when this login was email-verified. Unverified emails
        // can't takeover an existing account. Never downgrade a
        // verified flag to unverified.
        const mergedLinked = user.email_verified
          ? [...(existingByEmail[0].linked_auth0_ids || []), user.sub]
          : existingByEmail[0].linked_auth0_ids
        const uniqueLinked = [...new Set(mergedLinked)]
        const rows = await db<UserRecord[]>`
          update users set
            linked_auth0_ids = ${uniqueLinked},
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
    await ensureInitialized()
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
    await ensureInitialized()
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
    await ensureInitialized()
    const rows = await db<{ auth0_id: string }[]>`
      select auth0_id from users
      where auth0_id = ${auth0Id}
         or ${auth0Id} = any(linked_auth0_ids)
      limit 1;
    `
    return rows?.[0]?.auth0_id ?? auth0Id
  })
  return result ?? auth0Id
}

// ── Dashboard Queries ───────────────────────────────────────────────────────
