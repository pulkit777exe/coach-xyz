import { Elysia } from 'elysia'

import { buildError, chatEngineStatus, errorBody, wrapEngineError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import { resolveJobCaller, verifyJobAccess } from '../lib/jobAccess'
import { checkChatLimit, getIP, rateLimited } from '../lib/ratelimit'
import { playerTranscript } from '../lib/transcript'
import { getAnalysisByServerJobId } from '../lib/analyses'
import { parseSseDataEvents } from '../lib/sse'
import { ENGINE_URL, engineServiceHeaders, requestIdFrom, withTimeout } from '../lib/engine'
import { logger } from '../lib/logger'

/** Events on the engine's chat/stream SSE feed (core.chat_client vocabulary). */
type ChatStreamEvent = {
  type?: string
  text?: string
  message?: string
  timestamp_refs?: number[]
  event_refs?: number[]
}

/**
 * Resolve the engine job ID and conversation history for a given server job.
 * Used by the streaming chat route (/api/chat/stream — the only chat wire route).
 */
async function resolveChatContext(jobId: string, request: Request) {
  const serverJob = await getJob(jobId)
  // Redis mapping expired — fall back to the persisted row like status:
  // chat must survive the same 2h TTL the status poll does.
  const persisted = serverJob ? null : await getAnalysisByServerJobId(jobId)
  const source = serverJob ?? persisted
  if (!source)
    return {
      error: buildError('JOB_NOT_FOUND', 'Analysis session not found.', false) as unknown,
    }

  const access = verifyJobAccess(request, serverJob, persisted)
  if (!access.ok) return { error: access.body as unknown, status: access.status }

  const history = await playerTranscript.load({ serverJobId: jobId })
  const historyForEngine = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))

  return { engineJobId: source.engine_job_id, historyForEngine }
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
  return rateLimited(
    set,
    'Too many chat requests. Try again later.',
    Math.ceil((reset - Date.now()) / 1000),
  )
}

export default new Elysia()
  // Streaming chat — proxies SSE from engine to frontend
  .post('/api/chat/stream', async ({ body, request, set }) => {
    const { job_id, message } = ((body ?? {}) as { job_id?: unknown; message?: unknown })

    if (typeof job_id !== 'string' || !job_id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'job_id is required.', false)
    }
    if (typeof message !== 'string' || !message.trim()) {
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
        // Chat posture: engine-owned body, 4xx pass through, ≥500 → 502.
        const errBody = (await engineRes.json().catch(() => ({}))) as Record<string, unknown>
        const failure = {
          ...wrapEngineError({
            code: typeof errBody.code === 'string' ? errBody.code : 'CHAT_FAILED',
            message: typeof errBody.message === 'string' ? errBody.message : 'AI service error.',
            retryable:
              typeof errBody.retryable === 'boolean' ? errBody.retryable : engineRes.status >= 500,
          }),
          status: engineRes.status,
        }
        set.status = chatEngineStatus(failure) ?? 502
        return errorBody(failure)
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
        let fullText = ''
        let timestampRefs: number[] = []
        let eventRefs: number[] = []

        try {
          // Buffered SSE line parsing — a `data:` line straddling two chunks
          // is reassembled before parsing (lib/sse.ts), not dropped.
          for await (const event of parseSseDataEvents<ChatStreamEvent>(parseStream)) {
            if (event.type === 'done') {
              fullText = event.text || ''
              timestampRefs = event.timestamp_refs || []
              eventRefs = event.event_refs || []
            }
          }
        } catch (err) {
          logger.error('chat_stream_parse_error', {
            type: 'chat_stream_parse_error',
            error: err instanceof Error ? err.message : 'unknown',
          })
        }

        try {
          // Always save the user message
          await playerTranscript.append({ serverJobId: jobId }, { role: 'user', content: userMsg })
          // Save assistant reply only if we got a complete response
          if (fullText) {
            await playerTranscript.append(
              { serverJobId: jobId },
              {
                role: 'assistant',
                content: fullText,
                timestamp_refs: timestampRefs,
                event_refs: eventRefs,
              },
            )
          }
        } catch (err) {
          logger.error('chat_stream_save_error', {
            type: 'chat_stream_save_error',
            error: err instanceof Error ? err.message : 'unknown',
          })
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

      logger.error('chat_stream_proxy_error', {
        type: 'chat_stream_proxy_error',
        error: error instanceof Error ? error.message : 'unknown',
      })
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Chat service error.', true)
    }
  })

  // Load conversation history for a job
  .get('/api/conversation/:jobId', async ({ params, request, set }) => {
    const serverJob = await getJob(params.jobId)
    // Same persisted fallback as the stream route above.
    const persisted = serverJob ? null : await getAnalysisByServerJobId(params.jobId)
    const source = serverJob ?? persisted
    if (!source) {
      set.status = 404
      return buildError('JOB_NOT_FOUND', 'Analysis session not found.', false)
    }

    const access = verifyJobAccess(request, serverJob, persisted)
    if (!access.ok) {
      set.status = access.status
      return access.body
    }

    const messages = await playerTranscript.load({ serverJobId: params.jobId })
    set.status = 200
    return { messages }
  })
