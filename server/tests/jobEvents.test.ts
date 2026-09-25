import { describe, expect, test } from 'bun:test'

import { jobEventsRoute } from '../src/routes/jobEvents'
import type { JobEventListener } from '../src/lib/jobEvents'
import type { ServerJob } from '../src/lib/jobs'
import { statusResponse, type StatusResolution } from '../src/routes/status'

const job: ServerJob = {
  server_job_id: 'job-1',
  engine_job_id: 'engine-1',
  session_token: null,
  player_index: null,
  model: 'gemini-2.5-flash',
  created_at: 1,
  owner_ids: [],
}

const request = () => new Request('http://localhost/api/job-events/job-1')

describe('/api/job-events/:jobId', () => {
  test('sends a snapshot, streams progress, then reconciles a terminal event', async () => {
    let listener: JobEventListener | null = null
    let subscribedJobId = ''
    let terminalResolveCalls = 0
    const resolve = async (): Promise<StatusResolution> => {
      terminalResolveCalls += 1
      return {
        ok: true,
        response: statusResponse('job-1', {
          state: terminalResolveCalls > 1 ? 'completed' : 'analyzing',
          complete: terminalResolveCalls > 1,
          progress: terminalResolveCalls > 1 ? 100 : 45,
        }),
      }
    }
    const route = jobEventsRoute({
      getJob: async () => job,
      startBus: async () => true,
      resolveStatus: resolve,
      onEvent: (jobId, handler) => {
        subscribedJobId = jobId
        listener = handler
        return () => {
          listener = null
        }
      },
    })

    const response = await route.handle(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(subscribedJobId).toBe('engine-1')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    const first = await reader.read()
    expect(decoder.decode(first.value)).toContain('"type":"snapshot"')
    expect(first.value).toBeDefined()

    listener!({
      job_id: 'engine-1',
      status: {
        state: 'analyzing',
        stage: 3,
        stage_name: 'Analyzing Technique',
        progress: 60,
        complete: false,
        summary: null,
        error: null,
        error_code: null,
        retryable: true,
      },
    })
    const second = await reader.read()
    expect(decoder.decode(second.value)).toContain('"type":"progress"')
    expect(decoder.decode(second.value)).toContain('"progress":60')

    listener!({
      job_id: 'engine-1',
      status: {
        state: 'completed',
        stage: 6,
        stage_name: 'Complete',
        progress: 100,
        complete: true,
        summary: { form_score: 8 },
        error: null,
        error_code: null,
        retryable: false,
      },
    })
    const third = await reader.read()
    expect(decoder.decode(third.value)).toContain('"type":"status"')
    expect(decoder.decode(third.value)).toContain('"complete":true')
    const closed = await reader.read()
    expect(closed.done).toBe(true)
    expect(listener).toBeNull()
  })

  test('closes an open stream when the shared event bus disconnects', async () => {
    let disconnect: (() => void) | null = null
    const route = jobEventsRoute({
      getJob: async () => job,
      startBus: async () => true,
      resolveStatus: async () => ({
        ok: true,
        response: statusResponse('job-1', { state: 'analyzing', progress: 20 }),
      }),
      onEvent: () => () => {},
      onBusDisconnect: (handler) => {
        disconnect = handler
        return () => {
          disconnect = null
        }
      },
    })
    const response = await route.handle(request())
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    await reader.read()
    disconnect!()
    expect((await reader.read()).done).toBe(true)
    expect(disconnect).toBeNull()
  })

  test('returns a bounded fallback signal when the event bus is unavailable', async () => {
    const route = jobEventsRoute({
      getJob: async () => job,
      startBus: async () => false,
    })
    const response = await route.handle(request())
    expect(response.status).toBe(503)
    expect(((await response.json()) as { code?: string }).code).toBe('EVENT_STREAM_UNAVAILABLE')
  })

  test('does not open a stream for an unauthorized job', async () => {
    const route = jobEventsRoute({
      getJob: async () => ({ ...job, owner_ids: ['auth0|owner'] }),
      startBus: async () => true,
    })
    const response = await route.handle(
      new Request('http://localhost/api/job-events/job-1', {
        headers: { 'x-attribution': 'invalid' },
      }),
    )
    expect(response.status).toBe(403)
  })
})
