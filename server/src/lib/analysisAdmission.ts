// ── Analysis admission ──────────────────────────────────────────────────────
// One owner for the §17 gate every non-anonymous analysis start passes
// through: atomic quota reservation → fair-queue priority → usage-ledger
// record. Both admission sites (routes/analyze.ts and routes/me.ts) differed
// only in their base priority (authenticated browser jobs base 5, player-hub
// jobs base 10 — authenticated humans outrank the anonymous queue), so the
// base is an explicit parameter. Quota rejection reuses rateLimited (429)
// verbatim.

import {
  getOrgTier,
  orgDailyAnalysisLimit,
  recordUsage,
  secondsUntilMidnightUtc,
  tryReserveUsage,
  type OrgTier,
} from './analyses'
import { logger } from './logger'
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
  tryReserveUsage: typeof tryReserveUsage
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

const defaultDeps: AnalysisAdmissionDeps = { tryReserveUsage, getOrgTier, recordUsage }

/**
 * Admit an analysis start: atomically reserve quota first (rejection renders
 * the canonical 429 RATE_LIMITED via rateLimited and records nothing), then
 * tier → priority → usage-ledger record, in exactly that order. The
 * reservation and the check are one atomic step, so concurrent admissions
 * cannot over-admit. A null reservation means the store is unavailable —
 * fail OPEN (free tier), never 429. Tier/usage failures degrade (free tier,
 * dropped usage row); quota failures propagate so call sites keep their own
 * catch context.
 */
export async function admitAnalysis({
  orgAuth0Id,
  basePriority,
  set,
  deps = defaultDeps,
}: AnalysisAdmissionInput): Promise<AnalysisAdmission> {
  const reservation = await deps.tryReserveUsage(orgAuth0Id, 'analysis', orgDailyAnalysisLimit())
  if (reservation === null) {
    // Store unavailable — fail open per the no-DB policy (the wrapper
    // already logged the outage), at free-tier priority.
    return { ok: true, priority: basePriority }
  }
  if ('capped' in reservation) {
    return {
      ok: false,
      error: rateLimited(
        set,
        'Organization daily analysis limit reached. Try again tomorrow.',
        secondsUntilMidnightUtc(),
      ),
    }
  }
  let tier: OrgTier
  try {
    tier = await deps.getOrgTier(orgAuth0Id)
  } catch (error) {
    // Fail CLOSED to free-tier priority: never grant paid priority on a
    // lookup error. But log it — a payer silently demoted on every
    // admission is a billing-visibility bug, not a policy.
    logger.warn('org_tier_lookup_failed', {
      type: 'org_tier_lookup_failed',
      orgAuth0Id,
      error: error instanceof Error ? error.message : String(error),
    })
    tier = 'free'
  }
  const priority = analysisPriority(basePriority, tier)
  try {
    await deps.recordUsage(orgAuth0Id, 'analysis')
  } catch (error) {
    // Usage-ledger loss under-counts the daily quota while the fail-open
    // admission above already granted access — a quota-integrity signal,
    // never silent.
    logger.error('usage_record_failed', {
      type: 'usage_record_failed',
      orgAuth0Id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return { ok: true, priority }
}
