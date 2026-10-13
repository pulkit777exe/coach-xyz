// ── Org compete subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'

// ── Seasons & matches ──────────────────────────────────────────────────────

export type Season = {
  id: string
  org_auth0_id: string
  name: string
  starts_on: string | null
  ends_on: string | null
  created_at: string
}

export type Match = {
  id: string
  org_auth0_id: string
  team_id: string | null
  season_id: string | null
  opponent: string | null
  match_on: string | null
  location: string | null
  result: string | null
  created_at: string
}

export const orgSeasons = async (auth0Id: string): Promise<{ seasons: Season[] }> =>
  queryJson<{ seasons: Season[] }>(orgUrl(auth0Id, '/seasons'))

export const orgCreateSeason = async (
  auth0Id: string,
  input: { name: string; starts_on?: string | null; ends_on?: string | null },
): Promise<{ season: Season }> =>
  mutateJson<{ season: Season }>(orgUrl(auth0Id, '/seasons'), 'POST', pickDefined(input))

export const orgDeleteSeason = async (auth0Id: string, id: string): Promise<{ deleted: boolean }> =>
  mutateJson<{ deleted: boolean }>(orgUrl(auth0Id, `/seasons/${encodeURIComponent(id)}`), 'DELETE')

export const orgMatches = async (
  auth0Id: string,
  opts: { teamId?: string | null; seasonId?: string | null } = {},
): Promise<{ matches: Match[] }> => {
  const params = new URLSearchParams()
  if (opts.teamId) params.set('team_id', opts.teamId)
  if (opts.seasonId) params.set('season_id', opts.seasonId)
  const qs = params.toString()
  return queryJson<{ matches: Match[] }>(orgUrl(auth0Id, `/matches${qs ? `?${qs}` : ''}`))
}

export const orgCreateMatch = async (
  auth0Id: string,
  input: {
    team_id?: string | null
    season_id?: string | null
    opponent?: string | null
    match_on?: string | null
    location?: string | null
    result?: string | null
  },
): Promise<{ match: Match }> =>
  mutateJson<{ match: Match }>(orgUrl(auth0Id, '/matches'), 'POST', pickDefined(input))

export const orgDeleteMatch = async (auth0Id: string, id: string): Promise<{ deleted: boolean }> =>
  mutateJson<{ deleted: boolean }>(orgUrl(auth0Id, `/matches/${encodeURIComponent(id)}`), 'DELETE')
