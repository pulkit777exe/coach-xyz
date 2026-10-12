import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}))

import {
  PIPELINE_POLL,
  capPipelineProgress,
  decideRetryAction,
  shouldApplyRekickoff,
} from '../usePipeline'
import { startJobPolling } from '../jobPolling'
import type { CoachAIError, JobStatus, ScanResult } from '@/types'

const mkScan = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  session_token: 'sess-1',
  video_key: 'key-1',
  angle: 'primary',
  player_count: 2,
  players: [
    { player_index: 1, confidence: 0.9, crop_base64: '' },
    { player_index: 2, confidence: 0.8, crop_base64: '' },
  ],
  ...overrides,
})

const mkError = (overrides: Partial<CoachAIError> = {}): CoachAIError => ({
  code: 'ANALYSIS_FAILED',
  message: 'Engine failed.',
  layer: 'engine',
  retryable: true,
  ...overrides,
})

const mkStatus = (progress: number, complete: boolean): JobStatus => ({
  job_id: 'j1',
  state: 'analyzing',
  stage: 1,
  stage_name: 'Analyzing',
  progress,
  complete,
  summary: null,
  video_ready: false,
  error: null,
  error_code: null,
  retryable: true,
})

const flush = () => Promise.resolve()

describe('PIPELINE_POLL (single poll config)', () => {
  it('pins interval/timeout/maxFailures in one place', () => {
    expect(PIPELINE_POLL.intervalMs).toBe(2000)
    expect(PIPELINE_POLL.timeoutMs).toBe(12 * 60 * 1000)
    expect(PIPELINE_POLL.maxFailures).toBe(5)
  })
})

describe('capPipelineProgress (single 99-cap)', () => {
  it('caps at 99 and passes through below', () => {
    expect(capPipelineProgress(0)).toBe(0)
    expect(capPipelineProgress(42)).toBe(42)
    expect(capPipelineProgress(99)).toBe(99)
    expect(capPipelineProgress(100)).toBe(99)
    expect(capPipelineProgress(150)).toBe(99)
  })
})

describe('decideRetryAction (single retry branch)', () => {
  it('re-kicks off when retryable, non-client, scanned, and a player is selected', () => {
    expect(
      decideRetryAction({
        error: mkError({ layer: 'engine', retryable: true }),
        scanResult: mkScan(),
        selectedPlayerIndex: 1,
      }),
    ).toBe('rekickoff')
  })

  it('re-kicks off for server-layer retryable errors too (only client is excluded)', () => {
    expect(
      decideRetryAction({
        error: mkError({ layer: 'server', retryable: true }),
        scanResult: mkScan(),
        selectedPlayerIndex: 2,
      }),
    ).toBe('rekickoff')
  })

  it('revives to selecting when scanned but no player was selected yet', () => {
    expect(
      decideRetryAction({
        error: mkError({ layer: 'engine', retryable: true }),
        scanResult: mkScan(),
        selectedPlayerIndex: null,
      }),
    ).toBe('revive')
  })

  it('resets on client-layer errors even when retryable (e.g. network)', () => {
    expect(
      decideRetryAction({
        error: mkError({ code: 'NETWORK_ERROR', layer: 'client', retryable: true }),
        scanResult: mkScan(),
        selectedPlayerIndex: 1,
      }),
    ).toBe('reset')
  })

  it('resets on non-retryable engine errors', () => {
    expect(
      decideRetryAction({
        error: mkError({ layer: 'engine', retryable: false }),
        scanResult: mkScan(),
        selectedPlayerIndex: 1,
      }),
    ).toBe('reset')
  })

  it('resets client validation errors (inline-only, never re-kickoff)', () => {
    expect(
      decideRetryAction({
        error: mkError({ code: 'INVALID_TYPE', layer: 'client', retryable: false }),
        scanResult: mkScan(),
        selectedPlayerIndex: null,
      }),
    ).toBe('reset')
  })

  it('resets when there is no scan to retry from', () => {
    expect(
      decideRetryAction({
        error: mkError({ layer: 'engine', retryable: true }),
        scanResult: null,
        selectedPlayerIndex: 1,
      }),
    ).toBe('reset')
  })

  it('resets when there is no error', () => {
    expect(decideRetryAction({ error: null, scanResult: mkScan(), selectedPlayerIndex: 1 })).toBe(
      'reset',
    )
  })
})

describe('shouldApplyRekickoff (generation guard)', () => {
  it('applies when the generation matches and the pipeline is not idle', () => {
    expect(shouldApplyRekickoff(1, 1, 'analyzing')).toBe(true)
    expect(shouldApplyRekickoff(2, 2, 'rendering')).toBe(true)
    expect(shouldApplyRekickoff(2, 2, 'error')).toBe(true)
  })

  it('drops stale generations (another retry started)', () => {
    expect(shouldApplyRekickoff(1, 2, 'analyzing')).toBe(false)
  })

  it('drops kickoffs that resolve after a reset to idle', () => {
    expect(shouldApplyRekickoff(3, 3, 'idle')).toBe(false)
  })
})

describe('re-kickoff with injected fetch (no live I/O)', () => {
  it('ignores a stale kickoff that resolves after a newer generation', async () => {
    let resolveStale!: (v: { job_id: string }) => void
    const stale = new Promise<{ job_id: string }>((res) => {
      resolveStale = res
    })
    const startAnalysisImpl = vi
      .fn<(scan: ScanResult, playerIndex: number) => Promise<{ job_id: string }>>()
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce({ job_id: 'job-new' })

    const gen1 = 1
    const pendingStale = startAnalysisImpl(mkScan(), 1)
    const gen2 = 2
    const pendingFresh = startAnalysisImpl(mkScan(), 1)

    resolveStale({ job_id: 'job-stale' })
    const [staleResult, freshResult] = await Promise.all([pendingStale, pendingFresh])

    expect(staleResult.job_id).toBe('job-stale')
    expect(freshResult.job_id).toBe('job-new')
    expect(startAnalysisImpl).toHaveBeenCalledTimes(2)
    // The stale result must not drive polling once the generation moved on.
    expect(shouldApplyRekickoff(gen1, gen2, 'analyzing')).toBe(false)
    expect(shouldApplyRekickoff(gen2, gen2, 'analyzing')).toBe(true)
  })
})

describe('poll integration with injected fetch/clock (no live I/O)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('caps in-progress progress at 99 through the shared helper', async () => {
    const fetchStatus = vi
      .fn<(jobId: string) => Promise<JobStatus>>()
      .mockResolvedValue(mkStatus(100, false))
    const seen: number[] = []

    const c = startJobPolling({
      jobId: 'j1',
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: PIPELINE_POLL.intervalMs,
      timeoutMs: PIPELINE_POLL.timeoutMs,
      maxFailures: PIPELINE_POLL.maxFailures,
      onStatus: (s) => {
        seen.push(capPipelineProgress(s.progress))
      },
    })
    await flush()

    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([99])

    c.stop()
  })

  it('passes sub-100 progress through unchanged', async () => {
    const fetchStatus = vi
      .fn<(jobId: string) => Promise<JobStatus>>()
      .mockResolvedValue(mkStatus(42, false))
    const seen: number[] = []

    const c = startJobPolling({
      jobId: 'j1',
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: PIPELINE_POLL.intervalMs,
      timeoutMs: PIPELINE_POLL.timeoutMs,
      maxFailures: PIPELINE_POLL.maxFailures,
      onStatus: (s) => {
        seen.push(capPipelineProgress(s.progress))
      },
    })
    await flush()

    expect(seen).toEqual([42])

    c.stop()
  })
})
