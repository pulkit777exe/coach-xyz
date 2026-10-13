// ── Org overview subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type { OrgOverview } from './types'

// ── Overview & analysis linking ──────────────────────────────────────────────

export const orgOverview = async (auth0Id: string): Promise<{ overview: OrgOverview }> => {
  return queryJson<{ overview: OrgOverview }>(orgUrl(auth0Id, '/overview'))
}

// ── Global search ────────────────────────────────────────────────────────────

export type SearchItem = {
  id: string
  label: string
  subtitle: string | null
}

export type OrgSearchResult = {
  students: SearchItem[]
  schedule: SearchItem[]
  reports: SearchItem[]
  analyses: SearchItem[]
}

export const orgSearch = async (auth0Id: string, query: string): Promise<OrgSearchResult> => {
  return queryJson<OrgSearchResult>(orgUrl(auth0Id, `/search?q=${encodeURIComponent(query)}`))
}
