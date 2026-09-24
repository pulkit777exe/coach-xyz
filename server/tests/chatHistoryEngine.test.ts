import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { chatHistoryRoutes } from '../src/routes/chatHistory'
import { generateSimpleResponse } from '../src/lib/aiResponse'
import type { Transcript, TranscriptMessage, TranscriptMessageInput } from '../src/lib/transcript'

// Route-level tests for the dashboard chat's engine call: the request now
// goes through lib/engine's chat entry, so it carries service + x-request-id
// headers, surfaces engine ERROR responses as shaped CoachAIErrors, and
// still falls back to generateSimpleResponse on connectivity loss.

const TOKEN = 'chat-history-test-token'
const AUTH0 = 'auth0|coach-chat'
const JOB = 'job-chat-1'
const SUMMARY = { sport: 'tennis', form_score: 7.5, summary: 'Solid session.' }

const realFetch = globalThis.fetch
const realServiceToken = process.env.SERVICE_TOKEN

beforeAll(() => {
  process.env.SERVICE_TOKEN = TOKEN
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  if (realServiceToken === undefined) delete process.env.SERVICE_TOKEN
  else process.env.SERVICE_TOKEN = realServiceToken
})

type Appended = { serverJobId: string; auth0Id?: string | null; message: TranscriptMessageInput }

function fakeTranscript(initial: TranscriptMessage[] = []) {
  const appended: Appended[] = []
  const transcript: Transcript = {
    async load() {
      return initial
    },
    async append(scope, message) {
      appended.push({ serverJobId: scope.serverJobId, auth0Id: scope.auth0Id, message })
    },
  }
  return { transcript, appended }
}

function buildApp(transcript: Transcript) {
  return chatHistoryRoutes({
    getAnalysis: async (auth0Id, serverJobId) => {
      if (auth0Id !== AUTH0 || serverJobId !== JOB) return null
      return { engine_job_id: 'eng-job-9', summary_json: SUMMARY }
    },
    transcript,
  })
}

function postChat(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/auth/user/${AUTH0}/analyses/${JOB}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-service-token': TOKEN,
      'x-verified-auth0-id': AUTH0,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const HISTORY: TranscriptMessage[] = [
  { id: 'm1', role: 'user', content: 'earlier question', created_at: 1_700_000_000_000 },
]

describe('POST .../analyses/:jobId/chat engine call', () => {
  test('flows service + x-request-id headers and sends no system_prompt', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            reply: 'Keep your elbow up.',
            timestamp_refs: [12.5],
            event_refs: [],
          }),
          { status: 200 },
        ),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const store = fakeTranscript(HISTORY)
    const res = await buildApp(store.transcript).handle(
      postChat({ message: 'How was my serve?' }, { 'x-request-id': 'req-abc-123' }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Keep your elbow up.', role: 'assistant' })

    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(input).endsWith('/chat')).toBe(true)
    const headers = init.headers as Record<string, string>
    expect(headers['x-request-id']).toBe('req-abc-123')
    expect(headers['x-service-token']).toBe(TOKEN)
    expect(headers['Content-Type']).toBe('application/json')

    const payload = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(payload).toEqual({
      job_id: 'eng-job-9',
      message: 'How was my serve?',
      conversation_history: [{ role: 'user', content: 'earlier question' }],
    })
    // The dead wire field is gone: nothing but the pinned contract is sent.
    expect('system_prompt' in payload).toBe(false)

    expect(store.appended.map((a) => a.message.role)).toEqual(['user', 'assistant'])
  })

  test('engine 503 surfaces a shaped CoachAIError instead of the keyword fallback', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'GEMINI_ERROR',
            message: 'AI service error. Please try again.',
            layer: 'engine',
            retryable: true,
          }),
          { status: 503 },
        ),
      ),
    ) as unknown as typeof fetch

    const store = fakeTranscript(HISTORY)
    const res = await buildApp(store.transcript).handle(postChat({ message: 'How was my serve?' }))

    // chat.ts posture: 4xx passes through, 5xx maps to 502.
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      code: 'GEMINI_ERROR',
      message: 'AI service error. Please try again.',
      layer: 'engine',
      retryable: true,
    })
    // Not the deterministic fallback — and no fake assistant reply persisted.
    expect(body.message).not.toBe(generateSimpleResponse('How was my serve?', SUMMARY))
    expect(store.appended.map((a) => a.message.role)).toEqual(['user'])
  })

  test('engine 429 passes its status through (chat.ts 4xx posture)', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'GEMINI_QUOTA_EXCEEDED',
            message: 'AI quota exceeded. Please try again later.',
            layer: 'engine',
            retryable: false,
          }),
          { status: 429 },
        ),
      ),
    ) as unknown as typeof fetch

    const store = fakeTranscript(HISTORY)
    const res = await buildApp(store.transcript).handle(postChat({ message: 'How was my serve?' }))

    expect(res.status).toBe(429)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('GEMINI_QUOTA_EXCEEDED')
    expect(body.layer).toBe('engine')
    expect(store.appended.map((a) => a.message.role)).toEqual(['user'])
  })

  test('connectivity refusal still falls back to generateSimpleResponse', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch

    const store = fakeTranscript(HISTORY)
    const res = await buildApp(store.transcript).handle(postChat({ message: 'How was my serve?' }))

    // Behavior preserved: engine unreachable → deterministic local reply,
    // both messages persisted, HTTP 200.
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message?: string; role?: string }
    expect(body.role).toBe('assistant')
    expect(body.message).toBe(generateSimpleResponse('How was my serve?', SUMMARY))
    expect(store.appended.map((a) => a.message.role)).toEqual(['user', 'assistant'])
    expect(store.appended[1].message.content).toBe(body.message)
  })
})
