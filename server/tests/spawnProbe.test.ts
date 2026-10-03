import { describe, expect, test } from 'bun:test'

import { lastJsonLine, PROBE_TIMEOUT_MS, runProbeProcess } from './spawnProbe'

// The bounded spawn is the only reason the CI-only probe slowness is legible at
// all (see the ledger entry), so its contract needs its own test rather than
// being taken on trust from the suites that use it. Three properties matter and
// each has bitten in a different way:
//
//  1. A child that never exits is reported as a TIMEOUT, naming the budget.
//     Otherwise it surfaces as an opaque suite-level "timed out after 30000ms"
//     with `exitCode: null` and none of the child's output — which is what made
//     the original 34 CI failures undiagnosable.
//  2. The child's PARTIAL output survives the kill. That is the diagnostic: a
//     probe that printed "got as far as the download handler" and then wedged
//     tells you where; an empty buffer tells you nothing.
//  3. A child that finishes INSIDE the budget is not reported as a timeout. The
//     budget has to be loose enough that a slow-but-healthy probe is never
//     mistaken for a wedged one, so that direction needs pinning too.
describe('runProbeProcess bounds the wait and keeps the diagnosis', () => {
  const cwd = import.meta.dir
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' }

  /** Run `fn` expecting it to throw, and return the message it threw with. */
  const capture = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn()
    } catch (e) {
      return (e as Error).message
    }
    throw new Error('expected runProbeProcess to throw, but it returned')
  }

  test('a child that never exits is named as a timeout', async () => {
    const began = Date.now()
    const message = await capture(() =>
      runProbeProcess({
        probe: '',
        script: 'setInterval(() => {}, 1000)',
        cwd,
        env,
        timeoutMs: 1500,
      }),
    )
    // Returns promptly rather than inheriting the suite budget.
    expect(Date.now() - began).toBeLessThan(15_000)
    expect(message).toContain('did not finish within 1500ms and was killed')
  })

  test("the killed child's partial stdout survives in the error", async () => {
    const message = await capture(() =>
      runProbeProcess({
        probe: '',
        script: 'console.log("partial output before the wedge"); setInterval(() => {}, 1000)',
        cwd,
        env,
        timeoutMs: 1500,
      }),
    )
    expect(message).toContain('partial output before the wedge')
  })

  test('a child that finishes inside the budget is not a timeout', async () => {
    const run = await runProbeProcess({
      probe: '',
      script: 'console.log(JSON.stringify({ ok: true }))',
      cwd,
      env,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    expect(run.exitCode).toBe(0)
    expect((run as { signal?: string }).signal).toBeUndefined()
    expect(lastJsonLine<{ ok: boolean }>(run.stdout)).toEqual({ ok: true })
  })

  test('a non-zero exit is reported, not swallowed', async () => {
    // The caller asserts on exitCode, so the helper must not turn a failing
    // probe into a success by returning its output as if nothing were wrong.
    const run = await runProbeProcess({
      probe: '',
      script: 'console.error("boom"); process.exit(3)',
      cwd,
      env,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    expect(run.exitCode).toBe(3)
    expect(run.stderr).toContain('boom')
  })
})
