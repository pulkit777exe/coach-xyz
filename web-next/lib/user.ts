import { mutateJson, queryJson } from './data/client'
import { authUserUrl, identityUrl } from './data/transport'

// ── User identity client ───────────────────────────────────────────────────
// Entity facade over the data core for auth sync + profile reads.

// ── Auth API ─────────────────────────────────────────────────────────────────

export type UserRecord = {
  id: string
  auth0_id: string
  email: string | null
  name: string | null
  nickname: string | null
  picture: string | null
  email_verified: boolean
  role: 'coach' | 'player'
  created_at: string
  updated_at: string
}

export async function syncUser(user: {
  sub: string
  email?: string
  name?: string
  nickname?: string
  picture?: string
  email_verified?: boolean
}): Promise<{ user: UserRecord }> {
  return mutateJson<{ user: UserRecord }>(identityUrl('/api/auth/sync'), 'POST', user)
}

export async function getUserProfile(auth0Id: string): Promise<{ user: UserRecord }> {
  return queryJson<{ user: UserRecord }>(authUserUrl(auth0Id))
}
