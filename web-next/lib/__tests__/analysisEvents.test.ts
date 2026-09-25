import { afterEach, describe, expect, it, vi } from 'vitest'

import { startAnalysisStatus, subscribeAnalysisEvents } from '../analysisEvents'
import type { JobStatus } from '@/types'

const status = (overrides: Partial<JobStatus> = {}): JobStatus => ({
  job_id: 'job-1',
  state: 'analyzing',
  stage: 3,
  stage_name: 'Analyzing Technique',
  progress: 50,
  complete: false,
  summary: null,
  video_ready: false,
  error: null,
  error_code: null,
  retryable: true,
  ...overrides,
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('startAnalysisStatus', () => {
  it('uses the event stream as the primary transport and does not fetch status', () => {
    const fetchStatus = vi.fn(async () => status())
    const onStatus = vi.fn()
    const onComplete = vi.fn()
    let emit: ((value: JobStatus) => void) | null = null

    const controller = startAnalysisStatus({
      jobId: 'job-1',
      fetchStatus,
      isComplete: (value) => value.complete,
      subscribeEvents: (_jobId, onEvent) => {
        emit = onEvent
        return () => {}
      },
      onStatus,
      onComplete,
    })

    emit!(status({ progress: 75 }))
    emit!(status({ state: 'completed', progress: 100, complete: true }))

    expect(onStatus).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(fetchStatus).not.toHaveBeenCalled()
    controller.stop()
  })

  it('fails a stalled stream connection instead of waiting forever for headers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'token-1', exp: Date.now() + 60_000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const onFailure = vi.fn()
    const stop = subscribeAnalysisEvents('job-1', vi.fn(), onFailure, new AbortController().signal)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Analysis event stream connection timed out.' }),
    )
    stop()
  })

  it('falls back to a bounded, slower status path when SSE is unavailable', () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(async () => status())
    const onTransient = vi.fn()
    const controller = startAnalysisStatus({
      jobId: 'job-1',
      fetchStatus,
      isComplete: (value) => value.complete,
      subscribeEvents: (_jobId, _onEvent, onFailure) => {
        onFailure(new Error('stream unavailable'))
        return () => {}
      },
      onTransient,
    })

    expect(onTransient).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledWith('job-1')
    controller.stop()
  })
})
