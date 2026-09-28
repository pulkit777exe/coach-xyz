import { Elysia } from 'elysia'
import { upsertUser, getUserByAuth0Id, resolveAuth0Id } from '../lib/users'
import {
  getUserAnalyses,
  getUserAnalysisById,
  getUserStats,
  deleteAnalysis,
  persistAnalysisStatus,
  updateAnalysisDisplayName,
} from '../lib/analyses'
import { markEngineJobFailed } from '../lib/engine'
import { getJob } from '../lib/jobs'
import { pickInt } from '../lib/uuid'
import { buildError } from '../lib/errors'
import { logger } from '../lib/logger'
import { serviceGuard, SERVICE_HEADERS } from '../lib/serviceGuard'
import { auditRoute } from '../lib/audit'
import { redactWellness, resolveMedicalAccess } from '../lib/permissions'
import { accountJobScope, resolveAccountScope } from '../lib/accountScope'

import { findingsReadRoutes, findingsReviewRoutes } from './findings'
import clipsRoute from './clips'
import chatHistoryRoute from './chatHistory'

// Findings, clips, and analysis-chat routes moved into their own modules (see
// routes/findings.ts, routes/clips.ts, routes/chatHistory.ts). The sub-routers
// are mounted at the exact positions the routes occupied in the original
// chain, so the route table is unchanged. serviceGuard runs inside each module
// — the same pattern as routes/org (it is a named plugin, so it dedupes to a
// single run per request).
export { parseFindingsTrendQuery, type FindingsTrendQuery } from './findings'

export default new Elysia()
  .use(serviceGuard)
  .post('/api/auth/sync', async ({ body, set }) => {
    const { sub, email, name, nickname, picture, email_verified } = body as {
      sub: string
      email?: string
      name?: string
      nickname?: string
      picture?: string
      email_verified?: boolean
    }

    if (!sub) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: sub', false)
    }

    const user = await upsertUser({
      sub,
      email,
      name,
      nickname,
      picture,
      email_verified,
    })

    if (!user) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to sync user', true)
    }

    // Resolve to primary auth0_id in case this is a linked account
    const primaryAuth0Id = await resolveAuth0Id(sub)

    // First login forms the org: ensure its registry row exists. A failure
    // here is a 500, not a 200 — returning success without the org row
    // leaves a broken account (every org-scoped call fails downstream).
    const { ensureOrg } = await import('../lib/registry')
    try {
      await ensureOrg(primaryAuth0Id, name ?? nickname ?? null, sub)
    } catch (error) {
      logger.error('org_ensure_failed', {
        type: 'org_ensure_failed',
        auth0Id: primaryAuth0Id,
        error: error instanceof Error ? error.message : String(error),
      })
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to form organization', true)
    }

    set.status = 200
    return { user: { ...user, auth0_id: primaryAuth0Id } }
  })
  .get('/api/auth/user/:auth0Id', async ({ params, set }) => {
    const { auth0Id } = params

    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }

    const user = await getUserByAuth0Id(auth0Id)

    if (!user) {
      set.status = 404
      return buildError('NOT_FOUND', 'User not found', false)
    }

    set.status = 200
    return { user }
  })
  .get('/api/auth/user/:auth0Id/analyses', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }

    const url = new URL(request.url)
    // pickInt for clarity and one shared contract, not because the previous
    // `Math.min(Number(x) || fallback, max)` was broken: the `||` already
    // absorbed a NaN (`Number('abc') || 20` is 20) and Math.max floored a
    // negative offset, so every input this route can receive was already safe.
    // I checked that before claiming otherwise. What pickInt removes is three
    // hand-rolled variants of the same clamp and the `limit=1e999` case, where
    // `Infinity || 20` is Infinity and the old form silently capped at 100 while
    // the new one reports the intended fallback.
    const limit = pickInt(url.searchParams.get('limit'), { min: 1, max: 100, fallback: 20 })
    const offset = pickInt(url.searchParams.get('offset'), { min: 0, max: 100_000, fallback: 0 })
    const unlinked = url.searchParams.get('unlinked') === '1'

    const analyses = await getUserAnalyses(auth0Id, limit, offset, {
      unlinked,
      // Rows in this path are owned by the org, so without the caller's team
      // scope this read is org-wide — a team coach saw every player in the club.
      studentIds: (await resolveAccountScope(auth0Id, request)).visible,
    })
    set.status = 200
    return { analyses }
  })
  .get('/api/auth/user/:auth0Id/analyses/:jobId', async ({ params, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }

    const gate = await accountJobScope(auth0Id, jobId, request, 'read')
    if (!gate.ok) {
      set.status = gate.status
      return gate.error
    }

    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }

    // Wellness signals stay behind the medical boundary (§5).
    const caller = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    const maySee = await resolveMedicalAccess(auth0Id, caller)
    set.status = 200
    return {
      analysis: maySee
        ? analysis
        : {
            ...analysis,
            summary_json: redactWellness(analysis.summary_json),
          },
    }
  })
  .get('/api/auth/user/:auth0Id/stats', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }

    // Same scope as the list these tiles sit above, so the two agree.
    const stats = await getUserStats(auth0Id, {
      studentIds: (await resolveAccountScope(auth0Id, request)).visible,
    })
    set.status = 200
    return { stats }
  })
  .use(findingsReadRoutes)
  .use(clipsRoute)
  .patch('/api/auth/user/:auth0Id/analyses/:jobId', async ({ params, body, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }

    // Renaming a row the caller may not see is a write against another team's
    // data, so it is a 403 rather than the 404 a read would answer.
    const gate = await accountJobScope(auth0Id, jobId, request, 'write')
    if (!gate.ok) {
      set.status = gate.status
      return gate.error
    }

    const { display_name } = body as { display_name?: string }
    if (display_name !== undefined && typeof display_name !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'display_name must be a string', false)
    }

    if (display_name !== undefined) {
      const analysis = await updateAnalysisDisplayName(auth0Id, jobId, display_name)
      if (!analysis) {
        set.status = 404
        return buildError('NOT_FOUND', 'Analysis not found', false)
      }
      set.status = 200
      return { analysis }
    }

    const existing = await getUserAnalysisById(auth0Id, jobId)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    set.status = 200
    return { analysis: existing }
  })
  .use(findingsReviewRoutes)
  // Cancel a running analysis. Failing the engine job stops status polling
  // from ever completing it, and the cancel-guard in persistAnalysisStatus
  // keeps late worker completions from resurrecting it.
  .post('/api/auth/user/:auth0Id/analyses/:jobId/cancel', async ({ params, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const cancelGate = await accountJobScope(auth0Id, jobId, request, 'write')
    if (!cancelGate.ok) {
      set.status = cancelGate.status
      return cancelGate.error
    }
    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    if (analysis.complete) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Analysis is already complete', false)
    }
    const serverJob = await getJob(jobId)
    if (serverJob) {
      await markEngineJobFailed(
        serverJob.engine_job_id,
        'Analysis cancelled.',
        'ANALYSIS_CANCELLED',
        false,
        jobId,
      )
    }
    await persistAnalysisStatus({
      serverJobId: jobId,
      engineJobId: analysis.engine_job_id,
      sessionToken: analysis.session_token,
      playerIndex: analysis.player_index,
      model: analysis.model,
      status: {
        stage: -1,
        stage_name: 'Cancelled',
        progress: analysis.progress ?? 0,
        complete: true,
        video_ready: false,
        summary: null,
        error: 'Analysis cancelled.',
        error_code: 'ANALYSIS_CANCELLED',
        retryable: false,
      },
    })
    auditRoute(request, auth0Id, 'analysis.cancelled', 'analysis', jobId)
    set.status = 200
    return { cancelled: true }
  }) // Delete an analysis and its derived rows (retention §30).
  .delete('/api/auth/user/:auth0Id/analyses/:jobId', async ({ params, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    // Deleting reaches the engine and the derived rows, so the scope gate has
    // to come before the getJob/markEngineJobFailed pair, not after it.
    const deleteGate = await accountJobScope(auth0Id, jobId, request, 'write')
    if (!deleteGate.ok) {
      set.status = deleteGate.status
      return deleteGate.error
    }
    const serverJob = await getJob(jobId)
    if (serverJob) {
      await markEngineJobFailed(
        serverJob.engine_job_id,
        'Analysis deleted.',
        'ANALYSIS_CANCELLED',
        false,
        jobId,
      )
    }
    const removed = await deleteAnalysis(auth0Id, jobId)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    auditRoute(request, auth0Id, 'analysis.deleted', 'analysis', jobId)
    set.status = 200
    return { deleted: true }
  })
  .use(chatHistoryRoute)
