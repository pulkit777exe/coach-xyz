// ── Bounded probe spawn ──────────────────────────────────────────────────────
// Probe-spawning suites run a fresh `bun <probe>` per case and wait for it.
//
// The contract is: the probe prints ONE JSON object as its last stdout line and
// exits 0. This helper is built around that and is deliberately NOT a
// general-purpose runner.
//
// THE WAIT IS ON `exit`, NOT ON EOF. This is the single most load-bearing
// decision in the file, and it took six rounds of a CI investigation to find.
// A `spawnSync` call returns only when the child has exited AND its stdio has
// reached EOF — and those are independent, because a probe's stdout is
// inherited by any grandchild it leaves behind. A probe that finishes its work,
// prints its result, leaves a background process holding the pipe and exits
// cleanly still blocks the parent for the entire budget.
//
// That is exactly what the CI probe flake was. The red run produced 167
// failures and **all 167 carried the probe's complete stdout** — every one had
// done its job. It was never a slow boot, never the module graph, and never
// runner performance; those explanations were wrong because they were inferred
// from a kill message, and a kill message cannot distinguish a slow child from
// a blocked read. The `EXIT_DRAIN_GRACE_MS` comment below carries the local
// reproduction of both shapes.
//
// So: resolve on `exit` plus a bounded drain. A genuine hang still costs
// `timeoutMs` (not the suite budget) and produces a diagnosable failure whose
// message says which of the two defects it is — the probe never produced a
// result, or it produced one and then refused to terminate.
//
// ADOPTION IS ALMOST COMPLETE, and the gap is deliberate: `studentScope.test.ts`
// and `studentImportTeam.test.ts` are owned by another workstream and still call
// `Bun.spawn` directly, so the family is one file short of done. If you are
// diagnosing a hang, check those two first — the existence of this file does not
// mean every probe in the suite is bounded.
import { spawn } from 'node:child_process'

/**
 * How long to keep draining stdio after the child's `exit` event, in ms.
 *
 * This is the whole fix for the CI probe flake, so it is worth being precise
 * about what it is for. `spawnSync` returns only when the child has exited AND
 * its stdout/stderr have reached EOF. Those two things are independent, and a
 * probe's stdout is inherited by any grandchild it leaves behind — so a probe
 * that prints its result, leaves a background process holding the pipe, and
 * exits cleanly still blocks the parent for the entire budget.
 *
 * Reproduced locally, both shapes:
 *   - grandchild + `process.exit(0)` -> child exits (exitCode 0, signal null)
 *     but `spawnSync` does not return until the 4000ms budget expires.
 *   - grandchild, no exit            -> same, plus SIGKILL and `exitCode: null`.
 *
 * The red CI run had 167 failures and **167 of them carried the probe's complete
 * stdout** — every one had finished its work. So this was never a slow boot.
 * Resolving on `exit` with a bounded drain makes the wait independent of EOF,
 * which is the only correct signal for "this process is finished".
 *
 * 250ms is comfortably longer than the flush of the few KB a probe prints (the
 * largest observed stdout was 6.3KB, far inside a pipe's buffer) and far shorter
 * than the 10s budget, so a clean probe pays nothing for it.
 */
const EXIT_DRAIN_GRACE_MS = 250

export type ProbeRun = { stdout: string; stderr: string; exitCode: number | null }

/**
 * Wall-clock budget for ONE probe spawn, in ms.
 *
 * Measured on an idle laptop, one spawn of every probe in tests/ (2026-10-02):
 * the fastest are ~150ms, the median ~900ms, and the slowest — the two that
 * deliberately take real dependencies down and wait for them to time out —
 * ~2.4s. So 10s is ~10x the median and ~4x the worst case: wide enough that a
 * legitimately slow probe on a loaded runner is never mistaken for a hung one,
 * and tight enough that a wedged child costs 10s instead of the suite's 30s.
 *
 * It is deliberately NOT the suite budget (30s, from `--timeout`). Reusing that
 * number is the exact confusion this helper exists to remove: "too long" has to
 * be decided by the thing that is waiting, not by the runner's global setting.
 * A probe that genuinely needs longer than this passes its own `timeoutMs` at
 * the call site, which keeps the exception in the file that can explain it —
 * `degradation.test.ts` and `healthDeep.test.ts` do exactly that.
 */
export const PROBE_TIMEOUT_MS = 10_000

/** Runs `bun <probe>` to completion, or kills it at `timeoutMs` and throws. */
export const runProbeProcess = async (opts: {
  /** Probe entry file, absolute. Omit when passing `script`. */
  probe?: string
  /** Inline program for `bun -e` — for probes too small to deserve a file. */
  script?: string
  /** Working directory; the server root, so `bun` autoloads `server/.env`. */
  cwd: string
  /** Child environment. Pass an explicit copy — do not leak the parent's. */
  env: Record<string, string>
  /** Wall-clock budget for this one spawn. Defaults to `PROBE_TIMEOUT_MS`. */
  timeoutMs?: number
}): Promise<ProbeRun> => {
  const { probe, script } = opts
  if (probe === undefined && script === undefined) {
    throw new Error('runProbeProcess needs either a probe file or an inline script')
  }
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  const label = probe ?? '(inline script)'
  // 32MB, the same cap spawnSync's maxBuffer gave us. There is no natural EOF to
  // bound the read any more, so the accumulation has to be bounded explicitly.
  const MAX_OUTPUT = 32 * 1024 * 1024

  const child = spawn(process.execPath, script !== undefined ? ['-e', script] : [probe!], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => {
    if (stdout.length < MAX_OUTPUT) stdout += c
  })
  child.stderr?.on('data', (c: string) => {
    if (stderr.length < MAX_OUTPUT) stderr += c
  })

  const outcome = await new Promise<{ exitCode: number | null; signal: string | null; timedOut: boolean }>(
    (resolve, reject) => {
      let settled = false
      const settle = (v: { exitCode: number | null; signal: string | null; timedOut: boolean }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone; the budget is about the wait, not about the signal
        }
        settle({ exitCode: child.exitCode, signal: 'SIGKILL', timedOut: true })
      }, timeoutMs)

      child.on('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e)
      })
      // `exit` fires when the PROCESS dies. `close` waits for stdio to reach EOF,
      // which is the thing that never happens when a grandchild holds the
      // inherited pipe — so `exit` is the only signal that means "this probe is
      // finished", and waiting for anything after it reintroduces the bug.
      child.on('exit', (code, signal) => {
        const done = () => settle({ exitCode: code, signal, timedOut: false })
        // Resolve as soon as BOTH streams have ended — EOF for a well-behaved
        // probe, and it costs nothing — falling back to the bounded grace for
        // the pathological case where one stream never ends because a grandchild
        // inherited it. Without this fast path every clean spawn would pay the
        // full grace, which is ~25s across the suite.
        //
        // The grace itself is deliberately NOT pinned by a fixture: no test here
        // can force trailing output to arrive after `exit` deterministically, so
        // a mutation setting it to 0 stays green. It is engineering, not a
        // guarded claim, and it is recorded as such rather than asserted.
        let ended = 0
        const onEnd = () => {
          if (++ended === 2) done()
        }
        child.stdout?.on('end', onEnd)
        child.stderr?.on('end', onEnd)
        setTimeout(done, EXIT_DRAIN_GRACE_MS)
      })
    },
  )

  if (outcome.timedOut) {
    // A budget that fires means the PROCESS did not go away — not that the probe
    // failed to do its work. Those are different defects and this repo has already
    // spent six rounds conflating them, so they get different messages.
    if (hasParseableLastLine(stdout)) {
      throw new Error(
        `probe produced its result but did not exit within ${timeoutMs}ms (killed): ${label}\n` +
          `The output below is COMPLETE — the probe finished its work and its last line\n` +
          `parses as JSON, so this is a process that will not terminate (an open handle\n` +
          `or a grandchild holding it), NOT a slow or hung probe. Raising\n` +
          `PROBE_TIMEOUT_MS would only make this cost more.\n` +
          `--- stdout (${stdout.length} bytes) ---\n${stdout}\n` +
          `--- stderr (${stderr.length} bytes) ---\n${stderr}`,
      )
    }
    throw new Error(
      `probe did not finish within ${timeoutMs}ms and was killed: ${label}\n` +
        `--- stdout (${stdout.length} bytes) ---\n${stdout}\n` +
        `--- stderr (${stderr.length} bytes) ---\n${stderr}`,
    )
  }
  return { stdout, stderr, exitCode: outcome.exitCode }
}

/** Does this stdout end in a line that parses as JSON — every probe's contract? */
const hasParseableLastLine = (stdout: string): boolean => {
  const last = stdout.trim().split('\n').at(-1) ?? ''
  if (last === '') return false
  try {
    JSON.parse(last)
    return true
  } catch {
    return false
  }
}

/**
 * The last stdout line, parsed as JSON — every probe's contract. Carries the
 * whole stdout in the failure, so a probe that crashed mid-scenario shows what
 * it got through instead of just "Unexpected token".
 */
export const lastJsonLine = <T>(stdout: string): T => {
  const lines = stdout.trim().split('\n')
  const last = lines.at(-1) ?? ''
  try {
    return JSON.parse(last) as T
  } catch {
    throw new Error(`probe produced no parseable last line. stdout:\n${stdout}`)
  }
}
