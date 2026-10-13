import { Elysia } from 'elysia'
import { upsertUser, getUserByAuth0Id, resolveAuth0Id } from '../lib/users'
import {
  getUserAnalyses,
  getUserAnalysisById,
  getUserStats,
  getAnalysisStages,
  deleteAnalysis,
  persistAnalysisStatus,
  updateAnalysisDisplayName,
} from '../lib/analyses'
import { findingsToCsv, getFindingsTrend, getStudentFindings, reviewFinding } from '../lib/findings'
import { parseFindingsTrendQuery, type FindingsTrendQuery } from '../lib/findingsPolicy'
export type { FindingsTrendQuery }
import {
  MAX_CLIPS_PER_ANALYSIS,
  countClips,
  createClip,
  deleteClip,
  listClips,
  parseClipInput,
} from '../lib/clips'
import { saveChatMessage, getChatMessages } from '../lib/chatMessages'
import { failEngineJobForServerJob } from '../lib/jobGuard'
import { withUserJob } from '../lib/userJob'
import { answerChatTurn, keywordFallback } from '../lib/chatTurn'
import { checkClipLimit, getIP } from '../lib/ratelimit'
import { buildError } from '../lib/errors'
import { serviceGuard, SERVICE_HEADERS } from '../lib/serviceGuard'
import { auditRoute } from '../lib/audit'
import { redactWellness, resolveMedicalAccess } from '../lib/permissions'

export function generateSimpleResponse(
  question: string,
  summary: Record<string, unknown> | null,
): string {
  // Single-sourced in lib/chatTurn (the interactor's fallback). This export
  // stays for compatibility; do not fork the logic here.
  return keywordFallback(question, summary)
}

const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

    // First login forms the org: ensure its registry row exists.
    const { ensureOrg } = await import('../lib/registry')
    await ensureOrg(primaryAuth0Id, name ?? nickname ?? null, sub).catch(() => null)

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
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100)
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
    const unlinked = url.searchParams.get('unlinked') === '1'

    const analyses = await getUserAnalyses(auth0Id, limit, offset, {
      unlinked,
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
  .get('/api/auth/user/:auth0Id/stats', async ({ params, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }

    const stats = await getUserStats(auth0Id)
    set.status = 200
    return { stats }
  })
  .get('/api/auth/user/:auth0Id/findings/trends', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }

    const url = new URL(request.url)
    const trends = await getFindingsTrend(auth0Id, parseFindingsTrendQuery(url.searchParams))
    set.status = 200
    return { trends }
  })
  .get('/api/auth/user/:auth0Id/findings', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const studentId = url.searchParams.get('student_id') ?? ''
    if (!UUID_PARAM_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a valid UUID', false)
    }
    const limitRaw = Number(url.searchParams.get('limit') || 50)
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50
    set.status = 200
    return { findings: await getStudentFindings(auth0Id, studentId, limit) }
  })
  .get('/api/auth/user/:auth0Id/findings/export', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const studentId = url.searchParams.get('student_id') ?? ''
    if (!UUID_PARAM_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a valid UUID', false)
    }
    const limitRaw = Number(url.searchParams.get('limit') || 200)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200
    const findings = await getStudentFindings(auth0Id, studentId, limit)
    set.status = 200
    set.headers['content-type'] = 'text/csv; charset=utf-8'
    set.headers['content-disposition'] = `attachment; filename="findings-${studentId}.csv"`
    return `\ufeff${findingsToCsv(findings)}`
  })
  // Clips (subclip bookmarks on the rendered video). Curatorial like finding
  // review: owner self-passes, members need finding.review.
  .get('/api/auth/user/:auth0Id/analyses/:jobId/clips', async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    set.status = 200
    return { clips: await listClips(auth0Id, jobId) }
  })
  .post('/api/auth/user/:auth0Id/analyses/:jobId/clips', async ({ params, body, request, set }) => {
    const { auth0Id, jobId } = params
    return withUserJob(
      request,
      set,
      {
        auth0Id,
        resourceId: jobId,
        permission: 'Clip creation requires the finding.review permission',
      },
      async (caller) => {
        const { allowed, reset } = await checkClipLimit(caller.verified ?? getIP(request))
        if (!allowed) {
          return {
            status: 429,
            body: {
              ...buildError('RATE_LIMITED', 'Too many clip writes. Try again later.', true),
              retry_after: Math.ceil((reset - Date.now()) / 1000),
            },
          }
        }
        const parsed = parseClipInput((body ?? {}) as Record<string, unknown>)
        if (!parsed.ok) {
          return { status: 400, body: buildError('INVALID_REQUEST', parsed.reason, false) }
        }
        const existing = await getUserAnalysisById(auth0Id, jobId)
        if (!existing) {
          return { status: 404, body: buildError('NOT_FOUND', 'Analysis not found', false) }
        }
        if ((await countClips(auth0Id, jobId)) >= MAX_CLIPS_PER_ANALYSIS) {
          return {
            status: 409,
            body: buildError('INVALID_REQUEST', 'Clip limit reached for this analysis', false),
          }
        }
        const clip = await createClip(auth0Id, jobId, parsed.cleaned, caller.verified)
        if (!clip) {
          return {
            status: 400,
            body: buildError('INVALID_REQUEST', 'Could not create clip (unknown finding?)', false),
          }
        }
        return {
          status: 201,
          body: { clip },
          audit: { action: 'clip.created', entity: 'clip', id: clip.id, meta: { jobId } },
        }
      },
    )
  })
  .delete(
    '/api/auth/user/:auth0Id/analyses/:jobId/clips/:clipId',
    async ({ params, request, set }) => {
      const { auth0Id, jobId, clipId } = params
      return withUserJob(
        request,
        set,
        {
          auth0Id,
          resourceId: clipId,
          jobId,
          permission: 'Clip deletion requires the finding.review permission',
        },
        async (caller) => {
          const { allowed, reset } = await checkClipLimit(caller.verified ?? getIP(request))
          if (!allowed) {
            return {
              status: 429,
              body: {
                ...buildError('RATE_LIMITED', 'Too many clip writes. Try again later.', true),
                retry_after: Math.ceil((reset - Date.now()) / 1000),
              },
            }
          }
          const removed = await deleteClip(auth0Id, jobId, clipId)
          if (!removed) {
            return { status: 404, body: buildError('NOT_FOUND', 'Clip not found', false) }
          }
          return {
            status: 200,
            body: { deleted: true },
            audit: { action: 'clip.deleted', entity: 'clip', id: clipId, meta: { jobId } },
          }
        },
      )
    },
  )
  .get('/api/auth/user/:auth0Id/analyses/:jobId/stages', async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    set.status = 200
    return { stages: await getAnalysisStages(auth0Id, jobId) }
  })
  .patch('/api/auth/user/:auth0Id/analyses/:jobId', async ({ params, body, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
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
  // Coach review of a finding (approve/flag). Requires the finding.review  // permission: owner self-passes; members resolve via org role.
  .patch('/api/auth/user/:auth0Id/findings/:findingId', async ({ params, body, request, set }) => {
    const { auth0Id, findingId } = params
    const { review_state } = (body ?? {}) as { review_state?: unknown }
    if (review_state !== 'approved' && review_state !== 'flagged') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'review_state must be approved or flagged', false)
    }
    return withUserJob(
      request,
      set,
      {
        auth0Id,
        resourceId: findingId,
        permission: 'Finding review requires the finding.review permission',
      },
      async () => {
        const updated = await reviewFinding(auth0Id, findingId, review_state)
        if (!updated) {
          return {
            status: 404,
            body: buildError('NOT_FOUND', 'Finding not found or already reviewed', false),
          }
        }
        return { status: 200, body: { id: findingId, review_state } }
      },
    )
  })
  // Cancel a running analysis. Failing the engine job stops status polling
  // from ever completing it, and the cancel-guard in persistAnalysisStatus
  // keeps late worker completions from resurrecting it.
  .post('/api/auth/user/:auth0Id/analyses/:jobId/cancel', async ({ params, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
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
    await failEngineJobForServerJob(jobId, 'Analysis cancelled.')
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
    await failEngineJobForServerJob(jobId, 'Analysis deleted.')
    const removed = await deleteAnalysis(auth0Id, jobId)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    auditRoute(request, auth0Id, 'analysis.deleted', 'analysis', jobId)
    set.status = 200
    return { deleted: true }
  })
  .get('/api/auth/user/:auth0Id/analyses/:jobId/chat', async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }

    const messages = await getChatMessages(jobId, auth0Id)
    const converted = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp_refs: m.timestamp_refs ?? undefined,
      event_refs: m.event_refs ?? undefined,
      created_at:
        typeof m.created_at === 'string' ? new Date(m.created_at).getTime() / 1000 : m.created_at,
    }))
    set.status = 200
    return { messages: converted }
  })
  .post('/api/auth/user/:auth0Id/analyses/:jobId/chat', async ({ params, body, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }

    const { message } = body as { message?: string }
    if (!message || typeof message !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing message', false)
    }

    await saveChatMessage({
      serverJobId: jobId,
      auth0Id,
      role: 'user',
      content: message,
    })

    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }

    const summary = analysis.summary_json as Record<string, unknown> | null
    const history = await getChatMessages(jobId, auth0Id)
    const assistantMessage = await answerChatTurn({
      message,
      summary,
      engineJobId: analysis.engine_job_id,
      conversationHistory: history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    })

    await saveChatMessage({
      serverJobId: jobId,
      auth0Id,
      role: 'assistant',
      content: assistantMessage,
    })

    set.status = 200
    return {
      message: assistantMessage,
      role: 'assistant',
    }
  })
