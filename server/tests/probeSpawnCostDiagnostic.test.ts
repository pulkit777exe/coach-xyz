import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Measuring spawn cost from OUTSIDE the suite measured a machine that was fine ──
//
// Every component of a probe has now been timed, on the runner, in the run that failed 41
// tests, and every one of them is fast:
//
//   bare `bun -e`                       13ms   laptop      4ms exec+load   runner
//   import src/app.ts                  290ms   laptop    284-522ms         runner
//   import('bun:test') alone            30ms   laptop
//   20 x mock.module                     2ms   laptop
//   buildApp()                           8ms   laptop
//   first app.handle()                  16ms   laptop
//   ensureInitialized() DDL          58-139ms   laptop
//   spawnSync at 6GB parent heap        30ms   laptop
//   a real probe, 8-way concurrent       19ms   laptop
//
// None of that sums to ten seconds. And the measurement was taken as a workflow step AFTER
// the suite finished — so it described the machine at 15:31, not the machine that ran the
// failing tests between 15:23 and 15:31. In the failing run it read 284ms; in a GREEN run
// it read 522ms. The failing run measured FASTER than the passing one, which is not a
// property of any code path and is the clearest sign yet that the number was never about
// the thing it was supposed to be about.
//
// So this measures from INSIDE the suite, under `bun test --timeout 30000 --isolate`,
// which is the only context in which the slowness has ever been observed. It times the
// same probes that time out, in the same process, at the same moment.
//
// It asserts only that a probe COMPLETES. Every timing is printed rather than asserted,
// because an assertion on a machine-speed number is a test that fails on someone else's
// hardware and passes on a wedged one — and the failure this file exists to diagnose is
// precisely the case where an assertion would be least informative and most confident.

const SERVER = join(import.meta.dirname, '..')
const REPEATS = 3
const BUDGET_MS = 30_000

/**
 * The environment a real test hands its child.
 *
 * `tests/downloadAudit.test.ts:18-22` builds it by copying `process.env` IN FULL and then
 * adding `SERVICE_TOKEN` and `DATABASE_URL=''` — so on a GitHub runner the child inherits
 * every variable Actions injects. My original measurement passed seven hand-picked variables
 * instead, which is why it read 42ms while the same probe was hitting a 10s budget in the same
 * run. **The two differ in exactly one thing, and that thing is the environment**, so timing
 * both is the experiment: same probe, same machine, same moment, one variable changed.
 */
const INHERITED_ENV: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
)
INHERITED_ENV.SERVICE_TOKEN = 'audit-token'
INHERITED_ENV.DATABASE_URL = ''

const CI_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  DATABASE_URL: '',
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  PERF_DATABASE_URL: process.env.PERF_DATABASE_URL ?? '',
  TZ: 'UTC',
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1] : Math.round((s[s.length - 1] + s[s.length >> 1]) / 2)
}

/**
 * Did the CHILD exit, or did the parent's read stay blocked waiting for EOF?
 *
 * This is the discriminator the whole investigation has been missing. `spawnSync` reports a
 * timeout when the child's pipes never reach EOF, and that is indistinguishable from a slow
 * child — both arrive as `signal: SIGKILL` with no output. Reproduced directly:
 *
 *   clean exit                       spawnSync returned in    17ms
 *   exits + background grandchild    spawnSync returned in   8008ms  KILLED
 *
 * The second child had exited in under a millisecond. So `runProbeProcess`'s timeout means
 * "no EOF within the budget", NOT "the child took too long" — and every conclusion drawn from
 * those kill messages, including this repo's, has been reading the second as the first.
 *
 * A wrapper writes the timestamp of its own exit to a file; the gap between that and the moment
 * `spawnSync` returned is the blocked read. `killSignal: 'SIGKILL'` on an already-exited child
 * is the same tell.
 */
const exitStamp = (
  probe: string,
  env: Record<string, string>,
): { gap: number | null; killed: boolean; wall: number } => {
  const stamp = join(tmpdir(), `probe-exit-${process.pid}-${Date.now()}`)
  const wrapper = `
    process.on('exit', () => { try { require('fs').writeFileSync(${JSON.stringify(stamp)}, String(Date.now())) } catch {} })
    await import(${JSON.stringify(join(SERVER, 'tests', probe))})
  `
  const t0 = Date.now()
  const r = spawnSync(process.execPath, ['-e', wrapper], {
    cwd: SERVER,
    env,
    encoding: 'utf8',
    timeout: BUDGET_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  const wall = Date.now() - t0
  const killed =
    (r.error as { code?: string } | undefined)?.code === 'ETIMEDOUT' || r.signal !== null

  // `readFileSync` throwing IS the interesting case: the child never reached `process.on('exit')`,
  // so it did not exit of its own accord within the budget. That is a genuinely slow or wedged
  // child, and it is a DIFFERENT answer from "exited at T, parent returned at T+30s".
  let exitedAt: number
  try {
    exitedAt = Number(readFileSync(stamp, 'utf8'))
    rmSync(stamp, { force: true })
  } catch {
    return { gap: null, killed, wall }
  }
  return { gap: wall - (exitedAt - t0), killed, wall }
}

const timeProbe = (
  probe: string,
  env: Record<string, string>,
): { wall: number; killed: boolean; out: string } => {
  // `env`, NOT `CI_ENV`. The first version of this file ignored its own parameter and always
  // passed `CI_ENV`, so both rows of the environment experiment measured the SAME environment
  // while the report labelled one of them "inherited process.env" — and the conclusion drawn
  // from them ("the environment is not it, 285ms against 288ms across an 8-var and a 111-var
  // environment") was read off two runs of one env plus noise. The rows looked near-identical
  // for exactly the reason a fake control always does. eslint's `no-unused-vars` would have
  // caught it had the parameter been named `_env`; it was named `env` and used nowhere.
  const started = Date.now()
  const r = spawnSync(process.execPath, [join('tests', probe)], {
    cwd: SERVER,
    env,
    encoding: 'utf8',
    timeout: BUDGET_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    wall: Date.now() - started,
    killed: (r.error as { code?: string } | undefined)?.code === 'ETIMEDOUT' || r.signal !== null,
    out: (r.stderr ?? r.stdout ?? '').trim().slice(-120).replace(/\s+/g, ' '),
  }
}

describe('probe spawn cost, measured in the context where it is slow', () => {
  // The timeout is the DIAGNOSTIC's, not the probe's: `PROBE_TIMEOUT_MS` stays untouched
  // (raising it converts a runner wedge into a longer wedge). This only lets the report finish
  // when one spawn wedges, which is the case the report exists for.
  test('a probe completes, and its cost is printed', () => {
    // Chosen because they need NO extra environment, so they run their full body under the
    // CI env above. `emailRouteGuardsProbe` was the first choice and measured 13ms — it
    // exits immediately with "EMAIL_GUARD_ROLES must list at least one role", so the number
    // was the cost of a probe that did nothing, which is the most dangerous kind of
    // measurement: fast, plausible, and about nothing. The `last output` line is printed for
    // exactly this reason, so a probe that bails early is visible rather than flattering.
    //
    // `authMatrixProbe` mocks `historyStore`; `downloadAuditProbe` does NOT, so the 20 of 41
    // probe files that re-run the full DDL per spawn are represented. If they differ, DDL is
    // the cost.
    const probes = ['authMatrixProbe.ts', 'downloadAuditProbe.ts']
    // The two envs, timed against each other on the same probe in the same process.
    console.log(
      `PROBE SPAWN COST env sizes: minimal=${Object.keys(CI_ENV).length} vars, ` +
        `inherited=${Object.keys(INHERITED_ENV).length} vars`,
    )
    const ENVS: [string, Record<string, string>][] = [
      ['minimal CI env', CI_ENV],
      ['inherited process.env', INHERITED_ENV],
    ]
    const report: string[] = []
    /** Any case killed — asserted ONCE after the report prints, never inside the loop. */
    let killedAny = false
    /**
     * Push AND print. Printing only at the end means a timeout mid-loop — which is exactly
     * what a wedged spawn produces — discards every case already measured. That is the same
     * defect this file has already had twice: it printed nothing on its own first
     * reproduction, and it would do so again on any run slow enough to matter.
     */
    const emit = (line: string): void => {
      report.push(line)
      console.log(`PROBE SPAWN COST: ${line}`)
    }

    for (const probe of probes) {
      for (const [envName, env] of ENVS) {
        const runs: number[] = []
        let killed = false
        let last = ''
        for (let i = 0; i < REPEATS; i++) {
          const r = timeProbe(probe, env)
          runs.push(r.wall)
          killed = killed || r.killed
          last = r.out
        }
        const m = median(runs)
        emit(
          `  ${probe.padEnd(24)} ${envName.padEnd(22)} median ${String(m).padStart(6)}ms  ` +
            `runs=[${runs.join(', ')}]` +
            (killed ? `  KILLED at ${BUDGET_MS}ms` : ''),
        )
        if (last) emit(`      last output: ${last}`)
        // The ONLY assertion: the probe finished. A timing assertion here would fail on a slow
        // machine and pass on a wedged one, which is the inverse of what is wanted.
        killedAny = killedAny || killed

        // The discriminator: how long after the CHILD EXITED did spawnSync return? ~0 means
        // any timeout was the child's own. Seconds means the child was already gone and the
        // parent's read was blocked on a pipe that never reached EOF.
        const s = exitStamp(probe, env)
        // Three distinct answers, and conflating them is what made every previous conclusion
        // from a kill message wrong:
        //   gap ≈ 0, not killed  → the child took its own time and returned normally
        //   gap ≈ 0, killed      → the CHILD was slow or wedged; the read was not the problem
        //   gap > 1s             → the child was long gone and the parent's read never saw EOF,
        //                          so the budget was spent on a pipe, not on a process
        emit(
          `      child-exit → spawnSync-return gap: ${
            s.gap === null ? 'child never stamped an exit (never exited)' : `${s.gap}ms`
          }${s.killed ? `  KILLED at ${BUDGET_MS}ms` : ''}` +
            (s.gap !== null && s.gap > 1000
              ? '   ← THE CHILD WAS ALREADY GONE; THE READ WAS BLOCKED'
              : s.gap === null && s.killed
                ? '   ← THE CHILD ITSELF NEVER EXITED'
                : ''),
        )
      }
    }
    // The environment size is part of the finding: if the inherited env is three variables
    // larger than the minimal one, "the environment" cannot be the cause and the hypothesis
    // dies here rather than after another red run.
    report.push(
      `  env sizes: minimal=${Object.keys(CI_ENV).length} vars, inherited=${Object.keys(INHERITED_ENV).length} vars`,
    )

    // Printed unconditionally — a diagnostic whose output only appears on failure is a
    // diagnostic that is missing precisely when the failure is intermittent.
    console.log(`\nPROBE SPAWN COST (in-suite, ${REPEATS} runs each):\n${report.join('\n')}\n`)

    // The ONLY assertion, and it comes AFTER the print. It was inside the loop, so a kill
    // threw before a single line was emitted — which is why the first reproduction on the
    // runner produced a red test and no evidence at all. **A diagnostic that reports on
    // success is silent exactly when it matters**, and the cheapest way to be silent is to
    // assert before printing.
    expect(killedAny).toBe(false)
    // `heapUsed` is not on Bun's `MemoryUsageFn`, so the object is read once and narrowed
    // rather than calling through the function — the typechecker caught it, which is the
    // only reason this line is not also wrong on the runner.
    const mem = process.memoryUsage() as { rss: number; heapUsed?: number }
    // Open descriptors, read straight off /proc. This is the number the whole fd-exhaustion
    // hypothesis turns on and the ONE thing never measured: `spawnSync` copies the parent's fd
    // table, and the parent here is a single process running all 117 files under `--isolate`
    // (module registry reset, NOT a fresh process), so sockets opened by one file survive into
    // the next. Locally the limit is 524288 and nothing can go wrong; a runner's soft limit is
    // commonly 1024. Reported with the limit alongside, because a count without a ceiling says
    // nothing — 400 is healthy at 524288 and critical at 512.
    // An IIFE rather than `let fds = -1` plus try/catch: the initializer is dead on both
    // paths and eslint says so. It said so about the SAME shape in `exitStamp` a few commits
    // ago, so this is the second time in this one file — the pattern is the habit to drop,
    // not the line to patch.
    const fds = (() => {
      try {
        return readdirSync('/proc/self/fd').length
      } catch {
        return -1
      }
    })()
    const nofile = Bun.spawnSync(['sh', '-c', 'ulimit -n']).stdout.toString().trim() || '?'
    console.log(
      `  parent: rss=${Math.round(mem.rss / 1024 / 1024)}MB uptime=${Math.round(process.uptime())}s ` +
        `heapUsed=${Math.round((mem.heapUsed ?? 0) / 1024 / 1024)}MB\n` +
        `  parent open fds: ${fds} of ulimit -n ${nofile}` +
        (fds > 0 && nofile !== '?' && fds / Number(nofile) > 0.5
          ? '   ← ABOVE HALF THE LIMIT'
          : '') +
        '\n',
    )
  }, 120_000)
})
