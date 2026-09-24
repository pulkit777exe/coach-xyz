// ── Analysis admission ──────────────────────────────────────────────────────
// One owner for the §17 gate every non-anonymous analysis start passes
// through: per-org daily quota → fair-queue priority → usage-ledger record.
// Both admission sites (routes/analyze.ts and routes/me.ts) differed only in
// their base priority (authenticated browser jobs base 5, player-hub jobs
// base 10 — authenticated humans outrank the anonymous queue), so the base is
// an explicit parameter. Quota rejection reuses rateLimited (429) verbatim.

import { checkOrgDailyQuota, getOrgTier, recordUsage, type OrgTier } from './analyses'
import { rateLimited, type RateLimitedBody } from './ratelimit'

/**
 * Fair queueing (§17): base priority + tier bump — authenticated jobs outrank
 * anonymous ones (the base), paid tiers outrank free (elite +10, pro +5,
 * free +0). FIFO within a priority (no starvation).
 */
export function analysisPriority(basePriority: number, tier: OrgTier): number {
  return basePriority + (tier === 'elite' ? 10 : tier === 'pro' ? 5 : 0)
}

export type AnalysisAdmissionDeps = {
  checkOrgDailyQuota: typeof checkOrgDailyQuota
  getOrgTier: typeof getOrgTier
  recordUsage: typeof recordUsage
}

export type AnalysisAdmission =
  { ok: true; priority: number } | { ok: false; error: RateLimitedBody }

export type AnalysisAdmissionInput = {
  /** Org whose daily quota and tier gate this job (the analysis's owner org). */
  orgAuth0Id: string
  /** Tier-independent priority floor — 5 for /api/analyze, 10 for /api/me/analyze. */
  basePriority: number
  set: { status?: number | string }
  /** Test seam — defaults to the real quota/tier/usage stores. */
  deps?: AnalysisAdmissionDeps
}

const defaultDeps: AnalysisAdmissionDeps = { checkOrgDailyQuota, getOrgTier, recordUsage }

/**
 * Admit an analysis start: quota first (rejection renders the canonical 429
 * RATE_LIMITED via rateLimited and records nothing), then tier → priority →
 * usage record, in exactly that order. Tier/usage failures degrade (free tier,
 * dropped usage row); quota failures propagate so call sites keep their own
 * catch context.
 */
export async function admitAnalysis({
  orgAuth0Id,
  basePriority,
  set,
  deps = defaultDeps,
}: AnalysisAdmissionInput): Promise<AnalysisAdmission> {
  const quota = await deps.checkOrgDailyQuota(orgAuth0Id)
  if (!quota.allowed) {
    return {
      ok: false,
      error: rateLimited(
        set,
        'Organization daily analysis limit reached. Try again tomorrow.',
        quota.retryAfterSec,
      ),
    }
  }
  const tier = await deps.getOrgTier(orgAuth0Id).catch(() => 'free' as const)
  const priority = analysisPriority(basePriority, tier)
  await deps.recordUsage(orgAuth0Id, 'analysis').catch(() => {})
  return { ok: true, priority }
}
