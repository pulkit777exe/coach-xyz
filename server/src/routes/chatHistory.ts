import { Elysia } from 'elysia'

import { getUserAnalysisById } from '../lib/analyses'
import { saveChatMessage, getChatMessages } from '../lib/chatMessages'
import { buildError } from '../lib/errors'
import { serviceGuard } from '../lib/serviceGuard'
import { buildChatSystemPrompt, generateSimpleResponse } from '../lib/aiResponse'

// Analysis chat transcript + ask-an-analysis endpoint (split from
// routes/auth.ts). The engine reply falls back to the deterministic local
// responder when /chat is unreachable or returns empty.
export default new Elysia()
  .use(serviceGuard)
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
    const systemPrompt = buildChatSystemPrompt(summary)

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
