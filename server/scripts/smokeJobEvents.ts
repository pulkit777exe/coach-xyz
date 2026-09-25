// Live analysis-event smoke test. This is intentionally separate from the
// Redis-free unit suite: it proves the real Python engine → Upstash publish →
// Bun Redis subscriber → authenticated SSE route path.
//
//   cd server && bun run smoke:events
//
// CI/local runs without Redis or the engine virtualenv should skip cleanly;
// configured environments must fail loudly if the live chain is broken.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { jobEventsRoute } from '../src/routes/jobEvents'
import { mintAttributionToken } from '../src/lib/attribution'
import { startJobEventBus, stopJobEventBus } from '../src/lib/jobEvents'
import { statusResponse, type StatusResolution } from '../src/routes/status'
import type { ServerJob } from '../src/lib/jobs'

const execFileAsync = promisify(execFile)
const tag = `smoke-events-${Math.random().toString(36).slice(2, 8)}`
const serverJobId = `${tag}-server`
const engineJobId = `${tag}-engine`
const smokeSub = `smoke|analysis-${tag}`
const engineDir = resolve(import.meta.dir, '../../engine')
const pythonPath = resolve(engineDir, '.venv/bin/python')

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1
    console.log(`  ok  ${label}`)
  } else {
    failed += 1
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
  }
}

function readWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

async function runEngine(code: string): Promise<void> {
  await execFileAsync(pythonPath, ['-c', code], {
    cwd: engineDir,
    env: {
      ...process.env,
      SMOKE_ENGINE_JOB_ID: engineJobId,
    },
    timeout: 20_000,
  })
}

async function cleanupEngineJob(): Promise<void> {
  await runEngine(
    "from core import jobs; jobs.redis.delete(f\"{jobs.KEY}{__import__('os').environ['SMOKE_ENGINE_JOB_ID']}\")",
  ).catch((error: unknown) => {
    console.error(
      `engine cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
}

async function main(): Promise<void> {
  const hasRedis = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  )
  if (!hasRedis || !existsSync(pythonPath)) {
    console.log(
      JSON.stringify({
        tag,
        skipped: true,
        reason: !hasRedis ? 'Redis is not configured' : 'engine virtualenv is unavailable',
      }),
    )
    return
  }

  const smokeServiceToken = `smoke-service-${tag}`
  process.env.SERVICE_TOKEN = smokeServiceToken
  const attribution = mintAttributionToken(smokeSub, smokeServiceToken)
  if (!attribution) throw new Error('Could not mint the smoke attribution token')

  const serverJob: ServerJob = {
    server_job_id: serverJobId,
    engine_job_id: engineJobId,
    session_token: null,
    player_index: null,
    model: 'gemini-2.5-flash',
    created_at: Date.now(),
    owner_ids: [smokeSub],
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  const requestController = new AbortController()
  let busStarted = false
  try {
    // Create the engine job before subscribing, so the first event cannot be
    // mistaken for the event being tested. The later transition is published
    // only after the SSE route is ready.
    await runEngine(
      'from core.jobs import create_job; create_job(__import__("os").environ["SMOKE_ENGINE_JOB_ID"])',
    )

    busStarted = await startJobEventBus()
    check('Redis event bus starts', busStarted)
    if (!busStarted) {
      console.log(JSON.stringify({ tag, passed, failed, redisConfigured: true }))
      process.exitCode = 1
      return
    }

    const route = jobEventsRoute({
      getJob: async () => serverJob,
      resolveStatus: async (): Promise<StatusResolution> => ({
        ok: true,
        response: statusResponse(serverJobId, {
          state: 'analyzing',
          stage: 1,
          stage_name: 'Analyzing Technique',
          progress: 20,
        }),
      }),
    })
    const unauthorized = await route.handle(
      new Request(`http://smoke.test/api/job-events/${serverJobId}`),
    )
    check('unauthenticated SSE access is rejected', unauthorized.status === 403)

    const response = await route.handle(
      new Request(`http://smoke.test/api/job-events/${serverJobId}`, {
        headers: { 'x-attribution': attribution.token },
        signal: requestController.signal,
      }),
    )
    check('SSE route responds with an event stream', response.status === 200)
    if (!response.body) throw new Error('SSE response has no body')
    reader = response.body.getReader()

    const first = await readWithTimeout(reader.read(), 10_000)
    const firstText = new TextDecoder().decode(first.value)
    check('initial snapshot arrives', firstText.includes('"type":"snapshot"'), firstText)

    await runEngine(
      'from core.jobs import transition_job; transition_job(__import__("os").environ["SMOKE_ENGINE_JOB_ID"], "scanning", progress=45, stage=1)',
    )

    let progressText = ''
    for (let attempt = 0; attempt < 3 && !progressText; attempt += 1) {
      const frame = await readWithTimeout(reader.read(), 15_000)
      progressText = new TextDecoder().decode(frame.value)
    }
    check(
      'engine transition reaches the authenticated SSE client',
      progressText.includes('"type":"progress"') &&
        progressText.includes('"state":"scanning"') &&
        progressText.includes('"progress":45'),
      progressText,
    )
  } finally {
    requestController.abort()
    await reader?.cancel().catch((error: unknown) => {
      console.error(
        `SSE reader cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    if (busStarted) await stopJobEventBus()
    await cleanupEngineJob()
  }

  console.log(JSON.stringify({ tag, passed, failed, redisConfigured: true }))
  if (failed > 0) process.exitCode = 1
}

await main()
// The live Redis/stream libraries can retain a handle after the assertions
// complete; this standalone smoke owns its process and exits deterministically.
process.exit(process.exitCode ?? 0)
