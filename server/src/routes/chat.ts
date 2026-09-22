import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import { resolveJobCaller, verifyJobAccess } from '../lib/jobAccess'
import { checkChatLimit, getIP } from '../lib/ratelimit'
import { getConversation, saveMessage } from '../lib/conversation'
import { ENGINE_URL, engineServiceHeaders, requestIdFrom, withTimeout } from '../lib/engine'

/**
 * Resolve the engine job ID and conversation history for a given server job.
 * Shared between /api/chat and /api/chat/stream.
 */
async function resolveChatContext(jobId: string, request: Request) {
  const serverJob = await getJob(jobId)
  if (!serverJob)
    return {
      error: buildError('JOB_NOT_FOUND', 'Analysis session not found.', false) as unknown,
    }

  const access = verifyJobAccess(request, serverJob)
  if (!access.ok) return { error: access.body as unknown, status: access.status }

  const history = await getConversation(jobId)
  const historyForEngine = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))

  return { engineJobId: serverJob.engine_job_id, historyForEngine }
}

/** Rate-limit key: verified sub when present (per-account Gemini spend),
 * otherwise the client IP. */
function chatLimitKey(request: Request): string {
  return resolveJobCaller(request) ?? getIP(request)
}

async function checkChatRateLimit(
  request: Request,
  set: { status?: number | string },
): Promise<ReturnType<typeof buildError> | null> {
  const { allowed, reset } = await checkChatLimit(chatLimitKey(request))
  if (allowed) return null
  const retryAfter = Math.ceil((reset - Date.now()) / 1000)
  set.status = 429
  return {
    ...buildError('RATE_LIMITED', 'Too many chat requests. Try again later.', true),
    retry_after: retryAfter,
  } as ReturnType<typeof buildError>
}

export default new Elysia()
  // Send a chat message and get AI reply (non-streaming)
  .post('/api/chat', async ({ body, request, set }) => {
    const { job_id, message } = body as { job_id?: string; message?: string }

    if (!job_id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'job_id is required.', false)
    }
    if (!message?.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'message is required.', false)
    }

    const limited = await checkChatRateLimit(request, set)
    if (limited) return limited

    const ctx = await resolveChatContext(job_id, request)
    if ('error' in ctx) {
      set.status = ctx.status ?? 404
      return ctx.error
    }
    const { engineJobId, historyForEngine } = ctx

    try {
      const res = await withTimeout(
        `${ENGINE_URL}/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...engineServiceHeaders(requestIdFrom(request)),
          },
          body: JSON.stringify({
            job_id: engineJobId,
            message: message.trim(),
            conversation_history: historyForEngine,
          }),
        },
        60_000,
      )

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const code = (errBody.code as string) ?? 'CHAT_FAILED'
        const msg = (errBody.message as string) ?? 'AI service error.'
        set.status = res.status >= 400 && res.status < 500 ? res.status : 502
        return buildError(code, msg, res.status >= 500)
      }

      const data = (await res.json()) as {
        reply: string
        timestamp_refs?: number[]
        event_refs?: number[]
      }

      await saveMessage(job_id, { role: 'user', content: message.trim() })
      await saveMessage(job_id, {
        role: 'assistant',
        content: data.reply,
        timestamp_refs: data.timestamp_refs,
        event_refs: data.event_refs,
      })

      set.status = 200
      return {
        reply: data.reply,
        timestamp_refs: data.timestamp_refs ?? [],
        event_refs: data.event_refs ?? [],
      }
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError'
      const isConnectivity = error instanceof TypeError || isTimeout

      if (isConnectivity) {
        set.status = 502
        return buildError(
          'ENGINE_UNAVAILABLE',
          'Analysis engine is temporarily unavailable. Please try again.',
          true,
        )
      }

      console.error(
        JSON.stringify({
          type: 'chat_proxy_error',
          message: error instanceof Error ? error.message : 'unknown',
          timestamp: new Date().toISOString(),
        }),
      )
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Chat service error.', true)
    }
  })

  // Streaming chat — proxies SSE from engine to frontend
  .post('/api/chat/stream', async ({ body, request, set }) => {
    const { job_id, message } = body as { job_id?: string; message?: string }

    if (!job_id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'job_id is required.', false)
    }
    if (!message?.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'message is required.', false)
    }

    const limited = await checkChatRateLimit(request, set)
    if (limited) return limited

    const ctx = await resolveChatContext(job_id, request)
    if ('error' in ctx) {
      set.status = ctx.status ?? 404
      return ctx.error
    }
    const { engineJobId, historyForEngine } = ctx

    try {
      const engineRes = await withTimeout(
        `${ENGINE_URL}/chat/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...engineServiceHeaders(requestIdFrom(request)),
          },
          body: JSON.stringify({
            job_id: engineJobId,
            message: message.trim(),
            conversation_history: historyForEngine,
          }),
        },
        120_000,
      )

      if (!engineRes.ok) {
        const errBody = (await engineRes.json().catch(() => ({}))) as Record<string, unknown>
        const code = (errBody.code as string) ?? 'CHAT_FAILED'
        const msg = (errBody.message as string) ?? 'AI service error.'
        set.status = engineRes.status >= 400 && engineRes.status < 500 ? engineRes.status : 502
        return buildError(code, msg, engineRes.status >= 500)
      }

      // Tee the stream: one copy goes to the client, we parse the other
      // to save messages once the stream completes
      const [clientStream, parseStream] = (engineRes.body as ReadableStream).tee()

      // Background: consume parseStream to save conversation on completion.
      // Always saves the user message; saves assistant message only if
      // the stream completed successfully with a "done" event.
      const userMsg = message.trim()
      const jobId = job_id
      ;(async () => {
        const reader = parseStream.getReader()
        const decoder = new TextDecoder()
        let fullText = ''
        let timestampRefs: number[] = []
        let eventRefs: number[] = []

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            for (const line of text.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))
                if (event.type === 'done') {
                  fullText = event.text || ''
                  timestampRefs = event.timestamp_refs || []
                  eventRefs = event.event_refs || []
                }
              } catch {
                /* partial JSON, ignore */
              }
            }
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              type: 'chat_stream_parse_error',
              message: err instanceof Error ? err.message : 'unknown',
              timestamp: new Date().toISOString(),
            }),
          )
        } finally {
          reader.releaseLock()
        }

        try {
          // Always save the user message
          await saveMessage(jobId, { role: 'user', content: userMsg })
          // Save assistant reply only if we got a complete response
          if (fullText) {
            await saveMessage(jobId, {
              role: 'assistant',
              content: fullText,
              timestamp_refs: timestampRefs,
              event_refs: eventRefs,
            })
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              type: 'chat_stream_save_error',
              message: err instanceof Error ? err.message : 'unknown',
              timestamp: new Date().toISOString(),
            }),
          )
        }
      })()

      // Return the stream directly to the client
      return new Response(clientStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError'
      const isConnectivity = error instanceof TypeError || isTimeout

      if (isConnectivity) {
        set.status = 502
        return buildError(
          'ENGINE_UNAVAILABLE',
          'Analysis engine is temporarily unavailable. Please try again.',
          true,
        )
      }

      console.error(
        JSON.stringify({
          type: 'chat_stream_proxy_error',
          message: error instanceof Error ? error.message : 'unknown',
          timestamp: new Date().toISOString(),
        }),
      )
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Chat service error.', true)
    }
  })

  // Load conversation history for a job
  .get('/api/conversation/:jobId', async ({ params, request, set }) => {
    const serverJob = await getJob(params.jobId)
    if (!serverJob) {
      set.status = 404
      return buildError('JOB_NOT_FOUND', 'Analysis session not found.', false)
    }

    const access = verifyJobAccess(request, serverJob)
    if (!access.ok) {
      set.status = access.status
      return access.body
    }

    const messages = await getConversation(params.jobId)
    set.status = 200
    return { messages }
  })
