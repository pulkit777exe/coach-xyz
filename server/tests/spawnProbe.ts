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
// ADOPTION IS PARTIAL, and the mixed state is intentional for now: this
// currently serves `caller.test.ts` only, chosen because it is the cleanest
// specimen of the CI hang (two tests, byte-identical spawn helper, first passes
// in 331ms and second wedges). The other 22 probe suites still call
// `Bun.spawnSync` directly and still report the opaque 30s suite timeout.
// Migrating them is mechanical — each `run()` becomes `async` and awaits this —
// but `studentScope.test.ts` is currently owned by another workstream, so a
// half-converted family is the honest state. Expect follow-up churn here; do
// not read the existence of this file as "the probes are bounded".
import { spawnSync } from 'node:child_process'

export type ProbeRun = { stdout: string; stderr: string; exitCode: number | null }

/** Runs `bun <probe>` to completion, or kills it at `timeoutMs` and throws. */
export const runProbeProcess = async (opts: {
  /** Probe entry file, absolute. */
  probe: string
  /** Working directory; the server root, so `bun` autoloads `server/.env`. */
  cwd: string
  /** Child environment. Pass an explicit copy — do not leak the parent's. */
  env: Record<string, string>
  /** Wall-clock budget for this one spawn. */
  timeoutMs?: number
}): Promise<ProbeRun> => {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const child = spawnSync(process.execPath, [opts.probe], {
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
  const killed = child.signal === 'SIGKILL'
  if (killed) {
    throw new Error(
      `probe did not finish within ${timeoutMs}ms and was killed: ${opts.probe}\n` +
        `--- stdout (${stdout.length} bytes) ---\n${stdout}\n` +
        `--- stderr (${stderr.length} bytes) ---\n${stderr}`,
    )
  }
  return { stdout, stderr, exitCode: child.status }
}

/** The last non-empty stdout line, parsed as JSON — every probe's contract. */
export const lastJsonLine = <T>(stdout: string): T => {
  const lines = stdout.trim().split('\n')
  const last = lines.at(-1) ?? ''
  try {
    return JSON.parse(last) as T
  } catch {
    throw new Error(`probe produced no parseable last line. stdout:\n${stdout}`)
  }
}
