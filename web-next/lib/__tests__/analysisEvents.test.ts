import { afterEach, describe, expect, it, vi } from 'vitest'

import { startAnalysisStatus } from '../analysisEvents'
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
