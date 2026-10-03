// ── Bounded probe spawn ──────────────────────────────────────────────────────
// Probe-spawning suites run a fresh `bun <probe>` per case and wait for it.
// They used to do that with `Bun.spawnSync`, which has two problems that only
// show up on a loaded CI runner:
//
//   1. It BLOCKS the JS thread. Bun's per-test timeout cannot run while it is
//      blocked, so the runner's watchdog has to kill the child to unwind; the
//      test is then reported as "timed out after 30000ms" with `exitCode: null`
//      and — because the child was killed — NO output at all. The failure names
//      a duration and nothing else, so the next person cannot tell a hung probe
//      from a slow one.
//   2. It has no timeout of its own, so "how long is too long" is decided by the
//      test runner's global budget rather than by the thing that is waiting.
//      Raising `--timeout` to cover one slow runner just makes the same hang
//      cost twice as long.
//
// This helper keeps the "fresh process per case" contract and makes the wait
// explicit and self-reporting: the child is killed at `timeoutMs`, and the
// thrown error carries everything the child managed to print. A hang therefore
// costs `timeoutMs` (not the suite budget) and produces a diagnosable failure.
//
// Deliberately NOT a general-purpose runner: it is for probes that print one
// JSON object as their last stdout line and exit 0.
//
// ADOPTION IS ALMOST COMPLETE, and the gap is deliberate: `studentScope.test.ts`
// and `studentImportTeam.test.ts` are owned by another workstream and still call
// `Bun.spawn` directly, so the family is one file short of done. If you are
// diagnosing a hang, check those two first — the existence of this file does not
// mean every probe in the suite is bounded.
import { spawnSync } from 'node:child_process'

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
  const child = spawnSync(process.execPath, script !== undefined ? ['-e', script] : [probe!], {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    // spawnSync honours `timeout` on the child, but a grandchild holding the
    // pipes open would still keep the read blocked, so cap the read too.
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  // Detect the budget on EITHER signal, because they are not guaranteed together.
  // `spawnSync` reports a timeout as `signal: 'SIGKILL'` AND
  // `error.code: 'ETIMEDOUT'` (verified on bun 1.4.0/1.4.2), but `signal` is the
  // field that describes how the child died and `error` the field that describes
  // why the call returned — and the SIGKILL can be *delayed indefinitely* if the
  // child is in uninterruptible I/O, which is exactly what a `bun` process
  // reading a cold module graph off a runner's disk looks like. Checking both
  // means a timeout is still named as one when only the error carries it.
  const errCode = (child.error as { code?: string } | undefined)?.code
  const killed = child.signal === 'SIGKILL' || errCode === 'ETIMEDOUT'
  if (killed) {
    throw new Error(
      `probe did not finish within ${timeoutMs}ms and was killed: ${label}\n` +
        `--- stdout (${stdout.length} bytes) ---\n${stdout}\n` +
        `--- stderr (${stderr.length} bytes) ---\n${stderr}`,
    )
  }
  return { stdout, stderr, exitCode: child.status }
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
