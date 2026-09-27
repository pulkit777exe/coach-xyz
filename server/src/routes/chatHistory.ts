import { Elysia } from 'elysia'

import { getUserAnalysisById } from '../lib/analyses'
import type { DashboardAnalysis } from '../lib/analyses'
import { askEngineChat, requestIdFrom } from '../lib/engine'
import { buildError, chatEngineStatus, isCoachAIError } from '../lib/errors'
import { serviceGuard } from '../lib/serviceGuard'
import { generateSimpleResponse } from '../lib/aiResponse'
import { dashboardTranscript } from '../lib/transcript'
import type { Transcript } from '../lib/transcript'
import { accountJobScope } from '../lib/accountScope'

// Analysis chat transcript + ask-analysis endpoint (split from
// routes/auth.ts). The engine reply falls back to the deterministic local
// responder when /chat is UNREACHABLE (connectivity loss/timeout) or returns
// empty. An engine ERROR RESPONSE (429/5xx with a body) is surfaced as a
// shaped CoachAIError instead of being mistaken for disconnection — the one
// deliberate error-path improvement over the old catch-everything fallback.
//
// The engine call goes through lib/engine's chat entry (timeout wrapper,
// connectivity classification, x-request-id correlation) — same seam as
// scan/status/download/sports.

/** Everything this route group needs, so tests can stub the DB and engine. */
export type ChatHistoryDeps = {
  getAnalysis: (
    auth0Id: string,
    serverJobId: string,
  ) => Promise<Pick<DashboardAnalysis, 'engine_job_id' | 'summary_json'> | null>
  transcript: Transcript
}

export const chatHistoryRoutes = (
  deps: ChatHistoryDeps = { getAnalysis: getUserAnalysisById, transcript: dashboardTranscript },
) =>
  new Elysia()
    .use(serviceGuard)
    .get('/api/auth/user/:auth0Id/analyses/:jobId/chat', async ({ params, request, set }) => {
      const { auth0Id, jobId } = params
      if (!auth0Id || !jobId) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing required parameters', false)
      }
      // The transcript is a free-text channel over the analysis: it can carry
      // anything a coach typed about the video, so it inherits the analysis's
      // student scope rather than being readable on its own terms.
      const gate = await accountJobScope(auth0Id, jobId, request, 'read')
      if (!gate.ok) {
        set.status = gate.status
        return gate.error
      }

      const messages = await deps.transcript.load({ serverJobId: jobId, auth0Id })
      set.status = 200
      return {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp_refs: m.timestamp_refs,
          event_refs: m.event_refs,
          created_at: m.created_at / 1000,
        })),
      }
    })
    .post(
      '/api/auth/user/:auth0Id/analyses/:jobId/chat',
      async ({ params, body, request, set }) => {
        const { auth0Id, jobId } = params
        if (!auth0Id || !jobId) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing required parameters', false)
        }

        // Ahead of the transcript.append below: appending is a write against
        // another team's analysis, and it is the engine call that makes it
        // observable.
        const gate = await accountJobScope(auth0Id, jobId, request, 'write')
        if (!gate.ok) {
          set.status = gate.status
          return gate.error
        }

        const { message } = body as { message?: string }
        if (!message || typeof message !== 'string') {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing message', false)
        }

        await deps.transcript.append(
          { serverJobId: jobId, auth0Id },
          { role: 'user', content: message },
        )

        const analysis = await deps.getAnalysis(auth0Id, jobId)
        if (!analysis) {
          set.status = 404
          return buildError('NOT_FOUND', 'Analysis not found', false)
        }

        const summary = analysis.summary_json as Record<string, unknown> | null

        const history = await deps.transcript.load({ serverJobId: jobId, auth0Id })
        const conversationHistory = history.map((m) => ({
          role: m.role,
          content: m.content,
        }))

        let assistantMessage: string
        try {
          // The engine builds its own prompt from the job summary
          // (engine/core/chat_prompt.py) — nothing beyond job_id, message,
          // and conversation_history goes on the wire.
          const data = await askEngineChat(
            {
              job_id: analysis.engine_job_id,
              message,
              conversation_history: conversationHistory,
            },
            requestIdFrom(request),
          )
          assistantMessage = data.reply || data.message || ''
        } catch (error) {
          if (isCoachAIError(error)) {
            const status = chatEngineStatus(error)
            if (status !== null) {
              // The engine answered with an error — surface it shaped
              // (chat posture: 4xx pass through, otherwise 502).
              const { code, message: errMessage, layer, retryable } = error
              set.status = status
              return { code, message: errMessage, layer, retryable }
            }
          }
          // Connectivity loss (the engine never answered, or a malformed
          // success body) — keep the deterministic local fallback, as before.
          assistantMessage = generateSimpleResponse(message, summary)
        }

        if (!assistantMessage) {
          assistantMessage = generateSimpleResponse(message, summary)
        }

        await deps.transcript.append(
          { serverJobId: jobId, auth0Id },
          { role: 'assistant', content: assistantMessage },
        )

        set.status = 200
        return {
          message: assistantMessage,
          role: 'assistant',
        }
      },
    )

export default chatHistoryRoutes()
