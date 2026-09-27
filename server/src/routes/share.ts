// ── Share routes ─────────────────────────────────────────────────────────────
// Two concerns in one module:
//   1. orgShareRoute  — guarded POST that mints a share token for an analysis.
//   2. publicShareRoute — UNGUARDED GET that resolves a token to read-only
//      analysis data for players (no auth, no service identity).
// The default export mounts both; index.ts wires it in (reserved edit).

import { Elysia } from 'elysia'
import { buildError } from '../lib/errors'
import { orgRoleGuard, serviceGuard, serviceGuardEnabled } from '../lib/serviceGuard'
import { resolveAccountScope } from '../lib/accountScope'
import { canSeeStudent } from '../lib/org/scope'
import { createShareTokenStore } from '../lib/shareTokens'
import type { ShareTokenStore } from '../lib/shareTokens'
import { getAnalysisByServerJobId } from '../lib/analyses'
import type { DashboardAnalysis } from '../lib/analyses'

const defaultStore = createShareTokenStore()

export type ShareRouteDeps = {
  store?: ShareTokenStore
  getAnalysis?: (serverJobId: string) => Promise<DashboardAnalysis | null>
}

export const orgShareRoute = (deps: ShareRouteDeps = {}) => {
  const store = deps.store ?? defaultStore
  const getAnalysis = deps.getAnalysis ?? getAnalysisByServerJobId

  return new Elysia({ name: 'orgShare' })
    .use(serviceGuard)
    .use(orgRoleGuard(['owner', 'admin', 'head_coach', 'assistant_coach', 'coach']))
    .post('/api/org/:auth0Id/analyses/:jobId/share-token', async ({ params, request, set }) => {
      const { auth0Id, jobId } = params as { auth0Id: string; jobId: string }
      if (!auth0Id || !jobId) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing auth0Id or jobId parameter', false)
      }

      const analysis = await getAnalysis(jobId)
      if (!analysis) {
        set.status = 404
        return buildError('NOT_FOUND', 'Analysis not found', false)
      }

      // `getAnalysis` is keyed by job alone, so this is the line that keeps one
      // org from minting a token into another's data. It has to compare against
      // the *org* named in the path, not the caller's own sub: analysis rows are
      // owned by the org, so the old `auth0_id !== verifiedAuth0Id` test could
      // only ever pass for the org owner and refused every coach, which is the
      // one caller the feature exists for. 403, as a write beside the guard.
      if (analysis.auth0_id !== auth0Id) {
        set.status = 403
        return buildError('FORBIDDEN', 'Not authorized to share this analysis', false)
      }

      // Identity and scope are only meaningful when the identity boundary is on.
      // With SERVICE_TOKEN unset there is no verified caller to resolve, and the
      // guard is inert by design — so the org check above stands alone, as before.
      if (serviceGuardEnabled()) {
        // Identity before scope: refusing an unverified caller must not cost a
        // roster query.
        const { caller, visible } = await resolveAccountScope(auth0Id, request)
        if (!caller.verified) {
          set.status = 403
          return buildError('FORBIDDEN', 'Missing verified identity', false)
        }

        // A share token is unauthenticated: anyone holding the link reads this
        // analysis. So the question is not "may you read it" but "may you
        // publish it", which makes it a write — a coach publishes the video of
        // their own team and is refused anyone else's.
        if (visible !== null && !canSeeStudent(visible, analysis.student_id ?? '')) {
          set.status = 403
          return buildError('FORBIDDEN', 'Not authorized to share this analysis', false)
        }
      }

      const issue = await store.createShareToken({
        auth0_id: auth0Id,
        server_job_id: jobId,
      })
      set.status = 201
      return {
        token: issue.token,
        expires_at: issue.expires_at,
        url: `/share/${issue.token}`,
      }
    })
    .delete('/api/org/:auth0Id/share-tokens/:token', async ({ params, request, set }) => {
      const { auth0Id, token } = params as { auth0Id: string; token: string }
      if (!token) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing share token', false)
      }
      const record = await store.getShareToken(token)
      if (!record) {
        set.status = 404
        return buildError('NOT_FOUND', 'Share link not found', false)
      }
      // Same correction as the mint above: a token is stamped with the *org*, so
      // comparing it to the caller's own sub refused every coach from revoking a
      // link they had published. Compare to the org in the path, then scope by the
      // analysis behind the token, since a link to another team's video is not the
      // caller's to withdraw.
      if (record.auth0_id !== auth0Id) {
        set.status = 403
        return buildError('FORBIDDEN', 'Not authorized to revoke this share', false)
      }
      if (serviceGuardEnabled()) {
        const { caller, visible } = await resolveAccountScope(auth0Id, request)
        if (!caller.verified) {
          set.status = 403
          return buildError('FORBIDDEN', 'Missing verified identity', false)
        }
        const analysis = await getAnalysis(record.server_job_id)
        if (visible !== null && (!analysis || !canSeeStudent(visible, analysis.student_id ?? ''))) {
          set.status = 403
          return buildError('FORBIDDEN', 'Not authorized to revoke this share', false)
        }
      }
      await store.deleteShareToken(token)
      set.status = 200
      return { deleted: true }
    })
}

export const publicShareRoute = (deps: ShareRouteDeps = {}) => {
  const store = deps.store ?? defaultStore
  const getAnalysis = deps.getAnalysis ?? getAnalysisByServerJobId

  return new Elysia({ name: 'publicShare' }).get('/api/share/:token', async ({ params, set }) => {
    const { token } = params as { token: string }
    if (!token) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing share token', false)
    }

    // Raw read first so we can distinguish 404 (never existed) from 410 (expired).
    const record = await store.getShareToken(token)
    if (!record) {
      set.status = 404
      return buildError('NOT_FOUND', 'Share link not found or was removed', false)
    }
    if (Date.parse(record.expires_at) <= Date.now()) {
      set.status = 410
      return buildError('SHARE_EXPIRED', 'This share link has expired.', false)
    }

    const analysis = await getAnalysis(record.server_job_id)
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }

    set.status = 200
    return {
      server_job_id: record.server_job_id,
      expires_at: record.expires_at,
      analysis: {
        summary_json: analysis.summary_json,
        display_name: analysis.display_name,
        requested_at: analysis.requested_at,
        model: analysis.model,
        video_ready: analysis.video_ready,
      },
    }
  })
}

export default new Elysia({ name: 'share' }).use(orgShareRoute()).use(publicShareRoute())
