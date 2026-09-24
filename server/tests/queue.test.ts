import { describe, expect, test } from 'bun:test'
import { join } from 'path'

import { buildFailedAnalysisStatus, classifyFailure, JOB_PRIORITY } from '../src/lib/queue'

// ── queue.ts import hygiene + pure policy functions ─────────────────────────
// Importing queue.ts must not connect Redis, start intervals, or register
// signal handlers — production builds all of that in startQueueInfrastructure().
// The hygiene checks run in a FRESH Bun process so this suite's own module
// cache (and any handlers other tests registered) can't mask an import-time
// side effect. The full start/stop lifecycle is exercised without Redis
// configured (every handle stays null — the "queue disabled" posture), which
// is as far as lifecycle testing can go without a live Redis; the real
// Upstash-configured startup path is covered by the live smoke.

const QUEUE_MODULE = join(import.meta.dir, '../src/lib/queue.ts')
const SERVER_DIR = join(import.meta.dir, '..')

const runScript = (script: string, opts: { cwd: string; env?: Record<string, string> }) => {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `subprocess failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
}

const importOnlyScript = `
const before = {
  sigterm: process.listenerCount('SIGTERM'),
  sigint: process.listenerCount('SIGINT'),
}
// Spy on outbound TCP — any Redis connection attempt goes through Socket#connect.
const net = require('node:net')
let connects = 0
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  connects += 1
  return originalConnect.apply(this, args)
}
const mod = await import(${JSON.stringify(QUEUE_MODULE)})
console.log(
  JSON.stringify({
    before,
    after: {
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    },
    connects,
    instances: {
      analysisQueue: mod.analysisQueue,
      aiReportQueue: mod.aiReportQueue,
      worker: mod.worker,
      aiReportWorker: mod.aiReportWorker,
      queueEvents: mod.queueEvents,
    },
    api: {
      start: typeof mod.startQueueInfrastructure,
      stop: typeof mod.stopQueueInfrastructure,
      ready: typeof mod.onQueueInfrastructureReady,
    },
  }),
)
// The import graph has pre-existing import-time clients of its own (lib/redis
// connects its KV helper), so the event loop may not drain on its own — flush
// the report and exit explicitly.
await new Promise((resolve) => setTimeout(resolve, 100))
process.exit(0)
`

describe('import hygiene (fresh process, Redis env intact)', () => {
  test('importing queue.ts registers no signal handlers, opens no sockets, builds no instances', () => {
    // cwd = server dir so Bun autoloads server/.env — the import must stay
    // inert even with a real Upstash configuration present.
    const result = runScript(importOnlyScript, { cwd: SERVER_DIR })

    expect(result.after).toEqual(result.before)
    expect(result.connects).toBe(0)
    expect(result.instances).toEqual({
      analysisQueue: null,
      aiReportQueue: null,
      worker: null,
      aiReportWorker: null,
      queueEvents: null,
    })
    expect(result.api).toEqual({
      start: 'function',
      stop: 'function',
      ready: 'function',
    })
  }, 30000)
})

const lifecycleScript = `
// No Redis, no DB: every handle must stay null while the wiring (signals,
// ready callbacks, idempotence) is fully exercised.
const mod = await import(${JSON.stringify(QUEUE_MODULE)})

const counts = () => ({
  sigterm: process.listenerCount('SIGTERM'),
  sigint: process.listenerCount('SIGINT'),
})

let readyFired = 0
mod.onQueueInfrastructureReady(() => {
  readyFired += 1
})
const beforeStart = { ...counts(), ready: readyFired }

mod.startQueueInfrastructure()
const afterStart = { ...counts(), ready: readyFired }

// Second start is a no-op — no double registration, no double fan-out.
mod.startQueueInfrastructure()
const afterSecondStart = { ...counts(), ready: readyFired }

// Subscribers that register after start run immediately (still once each).
mod.onQueueInfrastructureReady(() => {
  readyFired += 1
})
const afterLateSubscriber = { ...counts(), ready: readyFired }

let enqueueError = null
try {
  await mod.enqueueAnalysis({
    server_job_id: 'srv-hygiene',
    engine_job_id: 'eng-hygiene',
    session_token: null,
    player_index: null,
    video_key: 'k',
  })
} catch (err) {
  enqueueError = err instanceof Error ? err.message : String(err)
}
const stillDisabled = {
  analysisQueue: mod.analysisQueue,
  worker: mod.worker,
  queueEvents: mod.queueEvents,
}

await mod.stopQueueInfrastructure()
const afterStop = { ...counts(), ready: readyFired }

console.log(
  JSON.stringify({ beforeStart, afterStart, afterSecondStart, afterLateSubscriber, enqueueError, stillDisabled, afterStop }),
)
`

describe('start/stop lifecycle (fresh process, no Redis configured)', () => {
  test('start wires signals + ready callbacks once; stop closes them all back down', () => {
    const env: Record<string, string> = { ...process.env }
    // Strip Redis/DB config so construction stays connectionless here.
    env.UPSTASH_REDIS_REST_URL = ''
    env.UPSTASH_REDIS_REST_TOKEN = ''
    env.UPSTASH_REDIS_IOREDIS_URL = ''
    env.DATABASE_URL = ''
    const result = runScript(lifecycleScript, { cwd: '/tmp', env })

    const baseline = result.beforeStart as Record<string, number>
    const afterStart = result.afterStart as Record<string, number>
    const afterSecondStart = result.afterSecondStart as Record<string, number>
    const afterLateSubscriber = result.afterLateSubscriber as Record<string, number>
    const afterStop = result.afterStop as Record<string, number>

    // Import: nothing registered, nothing fired.
    expect(baseline.ready).toBe(0)

    // Start: +1 SIGTERM, +1 SIGINT, ready callbacks fired exactly once.
    expect(afterStart.sigterm).toBe(baseline.sigterm + 1)
    expect(afterStart.sigint).toBe(baseline.sigint + 1)
    expect(afterStart.ready).toBe(1)

    // Idempotent start: no double registration, no double fan-out.
    expect(afterSecondStart).toEqual(afterStart)

    // Late subscriber runs immediately.
    expect(afterLateSubscriber.ready).toBe(2)

    // Without Redis configured the queue stays disabled…
    expect(result.enqueueError).toBe('QUEUE_UNAVAILABLE')
    expect(result.stillDisabled).toEqual({
      analysisQueue: null,
      worker: null,
      queueEvents: null,
    })

    // Stop: signal handlers removed, nothing re-fires.
    expect(afterStop.sigterm).toBe(baseline.sigterm)
    expect(afterStop.sigint).toBe(baseline.sigint)
    expect(afterStop.ready).toBe(2)
  }, 30000)
})

describe('classifyFailure (the shared retry-policy predicate)', () => {
  test('unrecoverable error is final even with attempts remaining', () => {
    const verdict = classifyFailure('UnrecoverableError: GEMINI_QUOTA_EXCEEDED: quota', 1, 3)
    expect(verdict.isUnrecoverable).toBe(true)
    expect(verdict.retriesExhausted).toBe(false)
    expect(verdict.isFinalFailure).toBe(true)
  })

  test('exhausted retries are final for an ordinary retryable error', () => {
    const verdict = classifyFailure('Connection reset', 3, 3)
    expect(verdict.isUnrecoverable).toBe(false)
    expect(verdict.retriesExhausted).toBe(true)
    expect(verdict.isFinalFailure).toBe(true)
  })

  test('recoverable error with attempts left is not final', () => {
    const verdict = classifyFailure('Connection reset', 1, 3)
    expect(verdict.isFinalFailure).toBe(false)
  })

  test('defaults to 3 attempts when the job declares none', () => {
    expect(classifyFailure('Connection reset', 3, undefined).isFinalFailure).toBe(true)
    expect(classifyFailure('Connection reset', 2, undefined).isFinalFailure).toBe(false)
  })

  test('missing failedReason is never treated as unrecoverable', () => {
    expect(classifyFailure(undefined, 1, 3).isFinalFailure).toBe(false)
  })
})

describe('buildFailedAnalysisStatus (shared synthetic failed payload)', () => {
  test('emits the identical failed skeleton with overrides last', () => {
    const status = buildFailedAnalysisStatus({
      error: 'Analysis job expired or was not found in the engine.',
      error_code: 'JOB_NOT_FOUND',
      retryable: true,
    })
    expect(status).toEqual({
      stage: -1,
      stage_name: 'Failed',
      progress: 0,
      complete: true,
      video_ready: false,
      summary: null,
      error: 'Analysis job expired or was not found in the engine.',
      error_code: 'JOB_NOT_FOUND',
      retryable: true,
    })
    // Key order is part of the persisted status_json shape.
    expect(Object.keys(status)).toEqual([
      'stage',
      'stage_name',
      'progress',
      'complete',
      'video_ready',
      'summary',
      'error',
      'error_code',
      'retryable',
    ])
  })
})

describe('priority mapping', () => {
  test('JOB_PRIORITY is the documented anonymous baseline (0)', () => {
    expect(JOB_PRIORITY).toBe(0)
  })
})
