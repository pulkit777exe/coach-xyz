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

// THE CI PROBE FLAKE, reproduced. Six rounds of that investigation concluded the
// cause was runner slowness on a cold module graph. It was not: the red run had
// 167 failures and all 167 carried the probe's COMPLETE stdout, so every one of
// those probes had already finished its work before it was killed.
//
// The mechanism is that `spawnSync` returns only when the child has exited AND
// its stdio has reached EOF, and those are independent — a probe's stdout is
// inherited by any grandchild it leaves behind. Both shapes below are local
// reproductions, and both were checked against the old implementation first:
// each one blocked for the ENTIRE budget despite the probe's work being done.
//
// These two cases are the reason the fix cannot be "raise the budget": the
// budget is not what is wrong. Waiting on EOF is.
describe('a probe whose stdout is held open by a grandchild is not a slow probe', () => {
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

  /**
   * Prints its result and leaves a background grandchild INHERITING stdout, so
   * the pipe never reaches EOF. The trailing statement controls which variant
   * this is, and BOTH are needed to reproduce the real signature:
   *
   *   - `process.exit(0)`  -> the common shape: 30 of 42 real probes call it,
   *     so the child really does terminate and only the pipe is held.
   *   - `setInterval`      -> the child stays alive by itself. Note that
   *     spawning a grandchild with `unref()` does NOT achieve this: nothing
   *     else keeps the loop open, so the child exits anyway and the test would
   *     silently be exercising the wrong variant (which it did, first time).
   */
  const lingerScript = (exit: boolean): string =>
    'console.log(JSON.stringify({ ok: true, answer: 42 }));' +
    'require("child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{},3000)"],' +
    '{ stdio: "inherit", detached: true }).unref();' +
    (exit ? 'process.exit(0)' : 'setInterval(() => {}, 1000)')

  test('the child exits cleanly: it resolves promptly with the real exit code', async () => {
    const budget = 6000
    const began = Date.now()
    const run = await runProbeProcess({
      probe: '',
      script: lingerScript(true),
      cwd,
      env,
      timeoutMs: budget,
    })
    const took = Date.now() - began
    // Old behaviour: blocked for the whole 6000ms and reported SIGKILL. New:
    // resolves on `exit` plus the drain grace, so a fraction of the budget.
    expect(took).toBeLessThan(budget / 2)
    expect(run.exitCode).toBe(0)
    expect(lastJsonLine<{ ok: boolean; answer: number }>(run.stdout)).toEqual({
      ok: true,
      answer: 42,
    })
  })

  test('the child never exits: the error names the real defect, not a timeout', async () => {
    const message = await capture(() =>
      runProbeProcess({
        probe: '',
        script: lingerScript(false),
        cwd,
        env,
        timeoutMs: 2000,
      }),
    )
    // The two defects must not read the same. "did not finish" says the probe was
    // too slow; this one had already delivered a complete, parseable result.
    expect(message).toContain('produced its result but did not exit within 2000ms')
    expect(message).toContain('NOT a slow or hung probe')
    expect(message).not.toContain('did not finish within')
    // And the result it delivered is still in the message, as the diagnosis.
    expect(message).toContain('{"ok":true,"answer":42}')
  })

  test('a genuine hang with no result is still reported as a timeout', async () => {
    // The counterpart both directions need: if the new wording fired for every
    // budget, it would be decoration and the honest case would be mislabelled.
    const message = await capture(() =>
      runProbeProcess({
        probe: '',
        script: 'console.log("halfway"); setInterval(() => {}, 1000)',
        cwd,
        env,
        timeoutMs: 1500,
      }),
    )
    expect(message).toContain('did not finish within 1500ms and was killed')
    expect(message).not.toContain('produced its result')
  })
})
