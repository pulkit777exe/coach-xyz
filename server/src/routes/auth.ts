import { Elysia } from 'elysia'
import {
  upsertUser,
  getUserByAuth0Id,
  resolveAuth0Id,
} from '../lib/users'
import {
  getUserAnalyses,
  getUserAnalysisById,
  getUserStats,
  getAnalysisStages,
  deleteAnalysis,
  persistAnalysisStatus,
  updateAnalysisDisplayName,
} from '../lib/analyses'
import {
  getFindingsTrend,
  getStudentFindings,
  reviewFinding,
} from '../lib/findings'
import {
  saveChatMessage,
  getChatMessages,
} from '../lib/chatMessages'
import { markEngineJobFailed } from '../lib/engine'
import { getJob } from '../lib/jobs'
import { buildError } from '../lib/errors'
import { serviceGuard, SERVICE_HEADERS } from '../lib/serviceGuard'
import { resolveCaller } from '../lib/caller'
import { auditRoute } from '../lib/audit'
import { redactWellness, resolveMedicalAccess } from '../lib/permissions'

function generateSimpleResponse(question: string, summary: Record<string, unknown> | null): string {
  if (!summary) {
    return "I don't have the analysis details available. Please try again later."
  }

  const q = question.toLowerCase()

  if (q.includes('score') || q.includes('rating')) {
    return `Based on the analysis, the form score is ${summary.form_score ?? 'N/A'}/10 with an overall rating of "${summary.overall_rating ?? 'N/A'}". ${summary.summary || ''}`
  }
  if (q.includes('tip') || q.includes('improve') || q.includes('focus')) {
    const tips = summary.top_tips as string[] | undefined
    return tips?.length
      ? `Here are the key areas to focus on:\n${tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : 'Focus on the fundamentals shown in the analysis summary.'
  }
  if (q.includes('strength') || q.includes('good')) {
    const strengths = summary.strengths as string[] | undefined
    return strengths?.length
      ? `Your strengths from this session:\n${strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : "The analysis didn't highlight specific strengths."
  }
  if (q.includes('drill') || q.includes('practice')) {
    return summary.priority_drill
      ? `Recommended drill: ${summary.priority_drill}`
      : 'No specific drill recommended for this session.'
  }
  if (q.includes('event') || q.includes('shot')) {
    const events = summary.shot_events as Array<Record<string, unknown>> | undefined
    if (events?.length) {
      return `There were ${events.length} events detected. Here's a summary:\n${events.map((e, i) => `${i + 1}. ${e.timestamp}s - ${e.event_type}: Score ${e.form_score}/10`).join('\n')}`
    }
    return `The analysis detected ${summary.total_events ?? 0} events.`
  }

  return `${summary.summary || "Here's a summary of the analysis."} The form score was ${summary.form_score ?? 'N/A'}/10. Feel free to ask about specific events, tips, strengths, or drills.`
}

export type FindingsTrendQuery = {
  days: number
  category: string | null
  severity: string | null
  studentId: string | null
  teamId: string | null
}

const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pure parser for the findings-trends query string. Bounds days to 1..365,
 * strips text filters to a safe alphabet, and accepts only well-formed UUIDs
 * for id filters (they are interpolated as bound parameters, but tight input
 * keeps logs/URLs clean).
 */
export const parseFindingsTrendQuery = (params: URLSearchParams): FindingsTrendQuery => {
  const daysRaw = Number(params.get('days') || 30)
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 30
  const clean = (v: string | null): string | null => {
    if (!v) return null
    const t = v
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_ -]/g, '')
      .slice(0, 60)
    return t || null
  }
  const uuid = (v: string | null): string | null => {
    const t = v?.trim() ?? ''
    return UUID_PARAM_RE.test(t) ? t : null
  }
  return {
    days,
    category: clean(params.get('category')),
    severity: clean(params.get('severity')),
    studentId: uuid(params.get('student_id')),
    teamId: uuid(params.get('team_id')),
  }
}

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
    if (!auth0Id || !findingId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const { review_state } = (body ?? {}) as { review_state?: unknown }
    if (review_state !== 'approved' && review_state !== 'flagged') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'review_state must be approved or flagged', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.verified) {
      set.status = 403
      return buildError('FORBIDDEN', 'Missing verified identity', false)
    }
    if (caller.verified !== auth0Id && !caller.can('finding.review')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Finding review requires the finding.review permission', false)
    }
    const updated = await reviewFinding(auth0Id, findingId, review_state)
    if (!updated) {
      set.status = 404
      return buildError('NOT_FOUND', 'Finding not found or already reviewed', false)
    }
    set.status = 200
    return { id: findingId, review_state }
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
    const contextParts: string[] = []
    if (summary) {
      if (summary.sport) contextParts.push(`Sport: ${summary.sport}`)
      if (summary.form_score) contextParts.push(`Form Score: ${summary.form_score}/10`)
      if (summary.overall_rating) contextParts.push(`Rating: ${summary.overall_rating}`)
      if (summary.summary) contextParts.push(`Summary: ${summary.summary}`)
      if (summary.top_tips && Array.isArray(summary.top_tips)) {
        contextParts.push(`Top Tips: ${summary.top_tips.join('; ')}`)
      }
      if (summary.strengths && Array.isArray(summary.strengths)) {
        contextParts.push(`Strengths: ${summary.strengths.join('; ')}`)
      }
      if (summary.priority_drill) contextParts.push(`Priority Drill: ${summary.priority_drill}`)
      if (summary.shot_events && Array.isArray(summary.shot_events)) {
        const events = summary.shot_events as Array<Record<string, unknown>>
        contextParts.push(`Shot Events (${events.length}):`)
        events.forEach((e, i) => {
          contextParts.push(
            `  ${i + 1}. ${e.timestamp}s - ${e.event_type}: Score ${e.form_score}/10. ${e.feedback || ''}`,
          )
        })
      }
    }

    const systemPrompt = `You are a sports analysis AI assistant. You have previously analyzed a video and here is the analysis context:\n\n${contextParts.join('\n')}\n\nAnswer questions about this analysis. Be helpful, specific, and reference timestamps when relevant. Keep responses concise.`

    const history = await getChatMessages(jobId, auth0Id)
    const conversationHistory = history.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    let assistantMessage = ''
    try {
      const { ENGINE_URL, engineServiceHeaders } = await import('../lib/engine')
      const engineRes = await fetch(`${ENGINE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineServiceHeaders(),
        },
        body: JSON.stringify({
          job_id: analysis.engine_job_id,
          message,
          conversation_history: conversationHistory,
          system_prompt: systemPrompt,
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (engineRes.ok) {
        const data = (await engineRes.json()) as {
          reply?: string
          message?: string
        }
        assistantMessage = data.reply || data.message || ''
      }
    } catch {
      assistantMessage = generateSimpleResponse(message, summary)
    }

    if (!assistantMessage) {
      assistantMessage = generateSimpleResponse(message, summary)
    }

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
