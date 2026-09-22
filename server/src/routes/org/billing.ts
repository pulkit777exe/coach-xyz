import {
  getOrgTier,
  getTodayUsage,
  orgDailyAnalysisLimit,
} from '../../lib/analyses'
import { resolveCaller } from '../../lib/caller'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Subscription & usage (billing structure, §28) ──────────────────────
  .get('/api/org/:auth0Id/subscription', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (role !== 'owner' && role !== 'admin') {
      set.status = 403
      return buildError('FORBIDDEN', 'Subscription details are owner/admin only', false)
    }
    set.status = 200
    return {
      subscription: { tier: await getOrgTier(auth0Id), status: 'active' },
      usage_today: await getTodayUsage(auth0Id),
      daily_analysis_limit: orgDailyAnalysisLimit(),
    }
  })
