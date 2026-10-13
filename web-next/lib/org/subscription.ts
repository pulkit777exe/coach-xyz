// ── Org subscription subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { queryJson } from '../data/client'
import { orgUrl } from '../data/transport'

// ── Subscription & usage ───────────────────────────────────────────────────

export type OrgSubscription = {
  subscription: { tier: string; status: string }
  usage_today: Record<string, number>
  daily_analysis_limit: number
}

export const orgSubscription = async (auth0Id: string): Promise<OrgSubscription> =>
  queryJson<OrgSubscription>(orgUrl(auth0Id, '/subscription'))
