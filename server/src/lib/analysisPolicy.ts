// ── Analysis policy (quotas, tiers, usage, retention) ────────────────────────
// Pure policy + ledger reads/writes for analysis admission and retention:
// daily org caps, tier lookup, usage ledger, retention window + pruning.
// The persistence seam stays in ./analyses (history rows, stages, stats);
// routes and admission import policy here so quota/tier/retention evolve in
// one module without touching the history queries.

import { ensureInitialized, withHistoryStore } from './historyStore'

/** Daily per-org analysis cap (§17 precursor). */

export const orgDailyAnalysisLimit = (): number => {
  const raw = Number(process.env.ORG_DAILY_ANALYSIS_LIMIT ?? 50)
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 10000) : 50
}

/** Analyses started by this org since midnight UTC. Fail-open without a DB. */

export const countTodayOrgAnalyses = async (orgAuth0Id: string): Promise<number | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ count: number }[]>`
      select count(*)::int as count from analysis_history
      where auth0_id = ${orgAuth0Id}
        and requested_at >= date_trunc('day', now());
    `
    return rows?.[0]?.count ?? 0
  })
}

/** Daily per-org quota verdict. Fail-open without org identity or DB. */ export const checkOrgDailyQuota =
  async (orgAuth0Id: string | null): Promise<{ allowed: boolean; retryAfterSec: number }> => {
    if (!orgAuth0Id) return { allowed: true, retryAfterSec: 0 }
    const count = await countTodayOrgAnalyses(orgAuth0Id)
    if (count === null || count < orgDailyAnalysisLimit()) {
      return { allowed: true, retryAfterSec: 0 }
    }
    const now = Date.now()
    const midnightUtc = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1,
    )
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((midnightUtc - now) / 1000)),
    }
  }

export type OrgTier = 'free' | 'pro' | 'elite'

/** Org tier (default free). Quotas and queue priority derive from this. */

export const getOrgTier = async (orgAuth0Id: string): Promise<OrgTier> => {
  const tier = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ tier: OrgTier }[]>`
      insert into subscriptions (org_auth0_id) values (${orgAuth0Id})
      on conflict (org_auth0_id) do nothing
      returning tier;
    `
    if (rows?.[0]) return rows[0].tier
    const existing = await db<{ tier: OrgTier }[]>`
      select tier from subscriptions where org_auth0_id = ${orgAuth0Id} limit 1;
    `
    return existing?.[0]?.tier ?? 'free'
  })
  return tier ?? 'free'
}

/** Append to the org usage ledger (§17 quotas, future billing). */

export const recordUsage = async (
  orgAuth0Id: string,
  kind: string,
  quantity = 1,
): Promise<void> => {
  await withHistoryStore(async (db) => {
    await ensureInitialized()
    await db`
      insert into usage_records (org_auth0_id, kind, quantity)
      values (${orgAuth0Id}, ${kind.slice(0, 60)}, ${quantity});
    `
  })
}

/** Usage totals per kind since midnight UTC (for quota + status views). */

export const getTodayUsage = async (orgAuth0Id: string): Promise<Record<string, number>> => {
  const rows =
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      return (
        (await db<{ kind: string; total: number }[]>`
      select kind, sum(quantity)::int as total from usage_records
      where org_auth0_id = ${orgAuth0Id} and period_day = current_date
      group by kind;
    `) ?? []
      )
    })) ?? []
  return Object.fromEntries(rows.map((r) => [r.kind, r.total]))
}

/** Retention window for analysis artifacts (days). */

export const retentionDays = (): number => {
  const raw = Number(process.env.RETENTION_DAYS ?? 365)
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 30), 3650) : 365
}

/**
 * Delete analyses (plus findings + chat) older than the retention window.
 * Derived rows go first so no orphans survive the history delete. Returns
 * the number of analyses pruned.
 */

export const pruneRetention = async (): Promise<number> => {
  const days = retentionDays()
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const stale = await db<{ server_job_id: string }[]>`
      select server_job_id from analysis_history
      where requested_at < now() - (${days} || ' days')::interval;
    `
      if (!stale?.length) return 0
      const ids = stale.map((r) => r.server_job_id)
      await db`delete from findings where server_job_id = any(${ids});`
      await db`delete from clips where server_job_id = any(${ids});`
      await db`delete from player_events where server_job_id = any(${ids});`
      await db`delete from chat_messages where server_job_id = any(${ids});`
      await db`delete from analysis_history where server_job_id = any(${ids});`
      return ids.length
    })) ?? 0
  )
}
