// ── workerLifecycle tests (pure gain: zero queue tests existed) ─────────────
// All adapters are exercised with in-memory fakes — no Redis, BullMQ server,
// or Supabase. Importing the lifecycle module is side-effect free when the
// Upstash env is unset (queues stay null, workers start only via bootWorkers).

import { describe, expect, test } from 'bun:test'
import {
  STUCK_SWEEP_INITIAL_DELAY_MS,
  STUCK_SWEEP_INTERVAL_MS,
  STUCK_TIMEOUT_MS,
  RETENTION_SWEEP_INITIAL_DELAY_MS,
  RETENTION_SWEEP_INTERVAL_MS,
  classifyProcessorError,
  createIdempotentBoot,
  extractUnrecoverableCode,
  findStuckJobs,
  getAnalysisWorkerConcurrency,
  getReportWorkerConcurrency,
  handleAnalysisFailure,
  handleReportFailure,
  isTerminalJobState,
  pruneOldAnalyses,
  recoverStuckJobs,
  runAiReportProcessor,
  runAnalysisProcessor,
  shouldMarkAnalysisFailed,
  shutdownInOrder,
  startSweeps,
} from '../src/lib/workerLifecycle'
import type { AnalysisPayload, AiReportPayload } from '../src/lib/workerLifecycle'

const analysisData = (overrides: Partial<AnalysisPayload> = {}): AnalysisPayload => ({
  server_job_id: 'srv-1',
  engine_job_id: 'eng-1',
  session_token: null,
  player_index: null,
  video_key: null,
  owner_ids: [],
  ...overrides,
})

const reportData = (overrides: Partial<AiReportPayload> = {}): AiReportPayload => ({
  report_job_id: 'rep-job-1',
  auth0_id: 'auth0|coach-1',
  report_type: 'progress',
  report_context: {},
  ...overrides,
})

const engineError = (code: string, retryable: boolean) => ({
  code,
  message: `${code} happened`,
  layer: 'engine' as const,
  retryable,
})

// ── Retry mapping ────────────────────────────────────────────────────────────

describe('classifyProcessorError', () => {
  test('non-retryable engine error maps to doomed (UnrecoverableError path)', () => {
    const mapped = classifyProcessorError(engineError('NO_PLAYERS_DETECTED', false))
    expect(mapped.retryable).toBe(false)
    expect(mapped.code).toBe('NO_PLAYERS_DETECTED')
  })

  test('retryable engine error keeps its identity for BullMQ retries', () => {
    const err = engineError('GEMINI_TIMEOUT', true)
    const mapped = classifyProcessorError(err)
    expect(mapped.retryable).toBe(true)
    expect(mapped.error).toBe(err)
  })

  test('plain errors wrap as retryable ENGINE_ERROR by default', () => {
    const mapped = classifyProcessorError(new Error('boom'))
    expect(mapped.retryable).toBe(true)
    expect(mapped.code).toBe('ENGINE_ERROR')
    expect(mapped.message).toBe('boom')
  })
})

describe('runAnalysisProcessor retry mapping', () => {
  test('non-retryable engine failure throws UnrecoverableError CODE: message', async () => {
    let calls = 0
    const deps = {
      analyzeVideo: async () => {
        calls++
        throw engineError('VIDEO_DECODE_FAILED', false)
      },
      getEngineJobStatus: async () => {
        throw new Error('unreachable')
      },
      getJob: async () => null,
      persistAnalysisStatus: async () => {},
    }
    const thrown = await runAnalysisProcessor(analysisData(), async () => 'active', deps).catch(
      (e) => e,
    )
    expect(calls).toBe(1)
    expect((thrown as Error).name).toBe('UnrecoverableError')
    expect((thrown as Error).message).toBe('VIDEO_DECODE_FAILED: VIDEO_DECODE_FAILED happened')
  })

  test('retryable engine failure rethrows the engine error (BullMQ retries)', async () => {
    const err = engineError('GEMINI_TIMEOUT', true)
    const deps = {
      analyzeVideo: async () => {
        throw err
      },
      getEngineJobStatus: async () => {
        throw new Error('unreachable')
      },
      getJob: async () => null,
      persistAnalysisStatus: async () => {},
    }
    const thrown = await runAnalysisProcessor(analysisData(), async () => 'active', deps).catch(
      (e) => e,
    )
    expect(thrown).toBe(err)
  })
})

describe('runAiReportProcessor retry mapping', () => {
  const baseDeps = () => {
    const patches: unknown[] = []
    return {
      patches,
      deps: {
        updateAiReportJob: async (_id: string, patch: unknown) => {
          patches.push(patch)
          return null
        },
        generateAiReport: async () => ({ report: {}, raw: 'raw' }),
        persistAiReportRecord: async () => ({ id: 'rep-1' }),
      },
    }
  }

  test('non-retryable failure marks the job failed then throws UnrecoverableError', async () => {
    const { patches, deps } = baseDeps()
    const failing = {
      ...deps,
      generateAiReport: async () => {
        throw engineError('GEMINI_QUOTA_EXCEEDED', false)
      },
    }
    const thrown = await runAiReportProcessor(reportData(), async () => 'active', failing).catch(
      (e) => e,
    )
    expect((thrown as Error).name).toBe('UnrecoverableError')
    expect(patches).toEqual([
      { status: 'running', progress: 10 },
      { status: 'failed', error: 'GEMINI_QUOTA_EXCEEDED: GEMINI_QUOTA_EXCEEDED happened' },
    ])
  })

  test('success persists the report row and marks the job done', async () => {
    const { patches, deps } = baseDeps()
    const result = await runAiReportProcessor(reportData(), async () => 'active', deps)
    expect(result).toEqual({ ok: true })
    expect(patches[patches.length - 1]).toEqual({
      status: 'done',
      progress: 100,
      report_id: 'rep-1',
    })
  })
})

// ── Idempotency ──────────────────────────────────────────────────────────────

describe('isTerminalJobState', () => {
  test('completed/failed are terminal; active/waiting/null are not', () => {
    expect(isTerminalJobState('completed')).toBe(true)
    expect(isTerminalJobState('failed')).toBe(true)
    expect(isTerminalJobState('active')).toBe(false)
    expect(isTerminalJobState('waiting')).toBe(false)
    expect(isTerminalJobState(null)).toBe(false)
    expect(isTerminalJobState(undefined)).toBe(false)
  })
})

describe('processor idempotency', () => {
  test('analysis skips engine call when already terminal', async () => {
    let calls = 0
    const deps = {
      analyzeVideo: async () => {
        calls++
      },
      getEngineJobStatus: async () => ({ status: 'not_found' as const }),
      getJob: async () => null,
      persistAnalysisStatus: async () => {},
    }
    for (const state of ['completed', 'failed']) {
      const result = await runAnalysisProcessor(analysisData(), async () => state, deps)
      expect(result).toEqual({ ok: true, skipped: 'already_terminal' })
    }
    expect(calls).toBe(0)
  })

  test('report skips engine call when already terminal', async () => {
    let calls = 0
    const deps = {
      updateAiReportJob: async () => null,
      generateAiReport: async () => {
        calls++
        return { report: {}, raw: 'raw' }
      },
      persistAiReportRecord: async () => ({ id: 'rep-1' }),
    }
    const result = await runAiReportProcessor(reportData(), async () => 'completed', deps)
    expect(result).toEqual({ ok: true, skipped: 'already_terminal' })
    expect(calls).toBe(0)
  })
})

// ── Persist-on-failure ───────────────────────────────────────────────────────

describe('shouldMarkAnalysisFailed', () => {
  test('exhausted retries mark; remaining retries do not', () => {
    expect(
      shouldMarkAnalysisFailed({ attemptsMade: 3, attempts: 3, failedReason: 'boom' }).mark,
    ).toBe(true)
    expect(
      shouldMarkAnalysisFailed({ attemptsMade: 1, attempts: 3, failedReason: 'boom' }).mark,
    ).toBe(false)
  })

  test('unrecoverable marks even with retries remaining', () => {
    const r = shouldMarkAnalysisFailed({
      attemptsMade: 0,
      attempts: 3,
      failedReason: 'UnrecoverableError: VIDEO_DECODE_FAILED: bad file',
    })
    expect(r).toEqual({ mark: true, unrecoverable: true })
  })
})

describe('extractUnrecoverableCode', () => {
  test('takes the leading CODE token; null-safe', () => {
    expect(extractUnrecoverableCode('UnrecoverableError: VIDEO_DECODE_FAILED: bad')).toBe(
      'UnrecoverableError',
    )
    expect(extractUnrecoverableCode(null)).toBe(null)
    expect(extractUnrecoverableCode(undefined)).toBe(null)
  })
})

describe('handleAnalysisFailure', () => {
  const failureDeps = () => {
    const calls = { mark: [] as unknown[], persist: [] as unknown[] }
    return {
      calls,
      deps: {
        markEngineJobFailed: async (
          engineJobId: string,
          message: string,
          code: string,
          retryable: boolean,
          serverJobId?: string | null,
        ) => {
          calls.mark.push({ engineJobId, message, code, retryable, serverJobId })
        },
        getJob: async () => ({ model: 'gemini-2.5-flash' }) as never,
        persistAnalysisStatus: async (record: unknown) => {
          calls.persist.push(record)
        },
      },
    }
  }

  test('exhausted retries mark the engine job + persist Failed history', async () => {
    const { calls, deps } = failureDeps()
    const job = {
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: analysisData(),
    }
    const result = await handleAnalysisFailure(
      { jobId: 'bull-1', failedReason: 'Error: timeout' },
      async () => job,
      deps,
    )
    expect(result).toEqual({ handled: true, errorCode: 'ANALYSIS_FAILED', retryable: true })
    expect(calls.mark).toEqual([
      {
        engineJobId: 'eng-1',
        message: 'Analysis failed after retries. Please try again.',
        code: 'ANALYSIS_FAILED',
        retryable: true,
        serverJobId: 'srv-1',
      },
    ])
    expect(calls.persist.length).toBe(1)
    const record = calls.persist[0] as {
      serverJobId: string
      status: { stage: number; stage_name: string; complete: boolean; error_code: string }
    }
    expect(record.serverJobId).toBe('srv-1')
    expect(record.status.stage).toBe(-1)
    expect(record.status.stage_name).toBe('Failed')
    expect(record.status.complete).toBe(true)
    expect(record.status.error_code).toBe('ANALYSIS_FAILED')
  })

  test('unrecoverable failure persists with retryable=false', async () => {
    const { calls, deps } = failureDeps()
    const job = { attemptsMade: 0, opts: { attempts: 3 }, data: analysisData() }
    const result = await handleAnalysisFailure(
      { jobId: 'bull-1', failedReason: 'UnrecoverableError: VIDEO_DECODE_FAILED: bad file' },
      async () => job,
      deps,
    )
    expect(result.handled).toBe(true)
    expect(result.retryable).toBe(false)
    expect((calls.mark[0] as { retryable: boolean }).retryable).toBe(false)
  })

  test('retries remaining → not handled, no persistence', async () => {
    const { calls, deps } = failureDeps()
    const job = { attemptsMade: 1, opts: { attempts: 3 }, data: analysisData() }
    const result = await handleAnalysisFailure(
      { jobId: 'bull-1', failedReason: 'Error: timeout' },
      async () => job,
      deps,
    )
    expect(result).toEqual({ handled: false })
    expect(calls.mark).toEqual([])
    expect(calls.persist).toEqual([])
  })

  test('missing engine job → not handled', async () => {
    const { deps } = failureDeps()
    expect(await handleAnalysisFailure({ jobId: 'x' }, async () => null, deps)).toEqual({
      handled: false,
    })
    expect(
      await handleAnalysisFailure({ jobId: 'x' }, async () => ({ data: {} }) as never, deps),
    ).toEqual({ handled: false })
  })
})

describe('handleReportFailure', () => {
  test('exhausted retries mark the Redis record failed', async () => {
    const updates: unknown[] = []
    const result = await handleReportFailure(
      { jobId: 'bull-r', failedReason: 'Error: llm down' },
      async () => ({
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: { report_job_id: 'rep-job-1' },
      }),
      {
        updateAiReportJob: async (_id: string, patch: unknown) => {
          updates.push(patch)
          return null
        },
      },
    )
    expect(result).toEqual({ handled: true })
    expect(updates).toEqual([{ status: 'failed', error: 'Error: llm down' }])
  })

  test('remaining retries / missing id → not handled', async () => {
    const noop = { updateAiReportJob: async () => null }
    expect(
      await handleReportFailure(
        { jobId: 'b' },
        async () => ({ attemptsMade: 1, opts: { attempts: 3 }, data: { report_job_id: 'r' } }),
        noop,
      ),
    ).toEqual({ handled: false })
    expect(await handleReportFailure({ jobId: 'b' }, async () => null, noop)).toEqual({
      handled: false,
    })
  })
})

// ── Sweep scheduling ─────────────────────────────────────────────────────────

describe('findStuckJobs', () => {
  test('13-min threshold filters active jobs (missing processedOn = fresh)', () => {
    const now = 1_000_000_000
    const jobs = [
      { processedOn: now - STUCK_TIMEOUT_MS - 1, token: 'a', data: { engine_job_id: 'old' } },
      { processedOn: now - STUCK_TIMEOUT_MS + 60_000, token: 'b', data: {} },
      { processedOn: null, token: 'c', data: {} },
    ]
    const stuck = findStuckJobs(jobs, now)
    expect(stuck.map((j) => j.token)).toEqual(['a'])
  })
})

describe('recoverStuckJobs', () => {
  test('fails only stuck jobs and returns their count', async () => {
    const now = 2_000_000_000
    const failed: string[] = []
    const count = await recoverStuckJobs(
      async () => [
        { processedOn: now - 14 * 60 * 1000, token: 't1', data: { engine_job_id: 'e1' } },
        { processedOn: now - 60_000, token: 't2', data: {} },
      ],
      async (job) => {
        failed.push(job.token ?? '?')
      },
      now,
    )
    expect(count).toBe(1)
    expect(failed).toEqual(['t1'])
  })

  test('lookup errors resolve to 0 (sweep never throws)', async () => {
    const count = await recoverStuckJobs(
      async () => {
        throw new Error('redis down')
      },
      async () => {},
    )
    expect(count).toBe(0)
  })
})

describe('pruneOldAnalyses', () => {
  test('returns pruned count; errors resolve to 0', async () => {
    expect(await pruneOldAnalyses(async () => 7)).toBe(7)
    expect(
      await pruneOldAnalyses(async () => {
        throw new Error('db down')
      }),
    ).toBe(0)
  })
})

describe('startSweeps', () => {
  test('registers 10-min + daily intervals, staggered initial runs, and stops both', () => {
    const intervals: number[] = []
    const timeouts: number[] = []
    const cleared: unknown[] = []
    let unrefs = 0
    const handles = [{ id: 'stuck' }, { id: 'retention' }]
    let n = 0
    const stopper = startSweeps(
      () => {},
      () => {},
      {
        setIntervalFn: ((fn: () => void, ms: number) => {
          void fn
          intervals.push(ms)
          return {
            unref: () => {
              unrefs++
            },
          }
        }) as never,
        setTimeoutFn: ((fn: () => void, ms: number) => {
          void fn
          timeouts.push(ms)
          return n++
        }) as never,
        clearIntervalFn: ((h: unknown) => {
          cleared.push(h)
        }) as never,
      },
    )
    expect(intervals).toEqual([STUCK_SWEEP_INTERVAL_MS, RETENTION_SWEEP_INTERVAL_MS])
    expect(timeouts).toEqual([STUCK_SWEEP_INITIAL_DELAY_MS, RETENTION_SWEEP_INITIAL_DELAY_MS])
    expect(unrefs).toBe(2)
    void handles
    stopper.stop()
    expect(cleared.length).toBe(2)
  })

  test('sweep callbacks invoke the injected runners', () => {
    const ran: string[] = []
    const fns: Array<() => void> = []
    startSweeps(
      () => {
        ran.push('stuck')
      },
      () => {
        ran.push('retention')
      },
      {
        setIntervalFn: (() => ({ unref: () => {} })) as never,
        setTimeoutFn: ((fn: () => void) => {
          fns.push(fn)
          return 0
        }) as never,
      },
    )
    for (const fn of fns) fn()
    expect(ran).toEqual(['stuck', 'retention'])
  })
})

// ── Shutdown ordering ────────────────────────────────────────────────────────

describe('shutdownInOrder', () => {
  test('closes workers first, then events/queues/connections', async () => {
    const order: string[] = []
    const closable = (name: string) => ({
      close: async () => {
        order.push(name)
      },
    })
    await shutdownInOrder([
      closable('worker:analysis'),
      closable('worker:report'),
      closable('events:analysis'),
      closable('events:report'),
      closable('queue:analysis'),
      closable('queue:report'),
      closable('connection'),
    ])
    expect(order).toEqual([
      'worker:analysis',
      'worker:report',
      'events:analysis',
      'events:report',
      'queue:analysis',
      'queue:report',
      'connection',
    ])
  })

  test('a failing stage does not block later stages', async () => {
    const order: string[] = []
    await shutdownInOrder([
      {
        close: async () => {
          order.push('w1')
        },
      },
      {
        close: async () => {
          order.push('boom')
          throw new Error('stuck handle')
        },
      },
      {
        close: async () => {
          order.push('q1')
        },
      },
    ])
    expect(order).toEqual(['w1', 'boom', 'q1'])
  })
})

// ── Boot idempotency ─────────────────────────────────────────────────────────

describe('createIdempotentBoot', () => {
  test('concurrent + repeat boots run start exactly once', async () => {
    let starts = 0
    const boot = createIdempotentBoot(async () => {
      starts++
      await new Promise((r) => setTimeout(r, 5))
    })
    await Promise.all([boot(), boot(), boot()])
    await boot()
    expect(starts).toBe(1)
  })

  test('failed start propagates and allows a later retry', async () => {
    let starts = 0
    const boot = createIdempotentBoot(async () => {
      starts++
      if (starts === 1) throw new Error('no redis yet')
    })
    await expect(boot()).rejects.toThrow('no redis yet')
    await boot()
    expect(starts).toBe(2)
  })
})

// ── Concurrency defaults ─────────────────────────────────────────────────────

describe('worker concurrency env defaults', () => {
  test('defaults to 1 when env is unset', () => {
    const w = process.env.WORKER_CONCURRENCY
    const r = process.env.REPORT_WORKER_CONCURRENCY
    delete process.env.WORKER_CONCURRENCY
    delete process.env.REPORT_WORKER_CONCURRENCY
    try {
      expect(getAnalysisWorkerConcurrency()).toBe(1)
      expect(getReportWorkerConcurrency()).toBe(1)
    } finally {
      if (w !== undefined) process.env.WORKER_CONCURRENCY = w
      if (r !== undefined) process.env.REPORT_WORKER_CONCURRENCY = r
    }
  })
})
