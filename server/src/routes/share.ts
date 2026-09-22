// ── Share routes ─────────────────────────────────────────────────────────────
// Two concerns in one module:
//   1. orgShareRoute  — guarded POST that mints a share token for an analysis.
//   2. publicShareRoute — UNGUARDED GET that resolves a token to read-only
//      analysis data for players (no auth, no service identity).
// The default export mounts both; index.ts wires it in (reserved edit).

import { Elysia } from 'elysia'
import { buildError } from '../lib/errors'
import {
  orgRoleGuard,
  serviceGuard,
  serviceGuardEnabled,
  SERVICE_HEADERS,
} from '../lib/serviceGuard'
import { createShareTokenStore } from '../lib/shareTokens'
import type { ShareTokenStore } from '../lib/shareTokens'
import { getAnalysisByServerJobId } from '../lib/supabaseHistory'
import type { DashboardAnalysis } from '../lib/supabaseHistory'

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
    .use(orgRoleGuard(['owner', 'admin', 'coach']))
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

      const verifiedAuth0Id = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
      if (serviceGuardEnabled() && analysis.auth0_id !== verifiedAuth0Id) {
        set.status = 403
        return buildError('FORBIDDEN', 'Not authorized to share this analysis', false)
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
      const { token } = params as { auth0Id: string; token: string }
      if (!token) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing share token', false)
      }
      const verifiedAuth0Id = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
      const record = await store.getShareToken(token)
      if (!record) {
        set.status = 404
        return buildError('NOT_FOUND', 'Share link not found', false)
      }
      if (serviceGuardEnabled() && record.auth0_id !== verifiedAuth0Id) {
        set.status = 403
        return buildError('FORBIDDEN', 'Not authorized to revoke this share', false)
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
