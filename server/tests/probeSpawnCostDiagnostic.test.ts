import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
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

const timeProbe = (
  probe: string,
  env: Record<string, string>,
): { wall: number; killed: boolean; out: string } => {
  const started = Date.now()
  const r = spawnSync(process.execPath, [join('tests', probe)], {
    cwd: SERVER,
    env: CI_ENV,
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
        report.push(
          `  ${probe.padEnd(24)} ${envName.padEnd(22)} median ${String(m).padStart(6)}ms  ` +
            `runs=[${runs.join(', ')}]` +
            (killed ? `  KILLED at ${BUDGET_MS}ms` : ''),
        )
        if (last) report.push(`      last output: ${last}`)
        // The ONLY assertion: the probe finished. A timing assertion here would fail on a slow
        // machine and pass on a wedged one, which is the inverse of what is wanted.
        expect(killed).toBe(false)
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
    // `heapUsed` is not on Bun's `MemoryUsageFn`, so the object is read once and narrowed
    // rather than calling through the function — the typechecker caught it, which is the
    // only reason this line is not also wrong on the runner.
    const mem = process.memoryUsage() as { rss: number; heapUsed?: number }
    console.log(
      `  parent: rss=${Math.round(mem.rss / 1024 / 1024)}MB uptime=${Math.round(process.uptime())}s ` +
        `heapUsed=${Math.round((mem.heapUsed ?? 0) / 1024 / 1024)}MB\n`,
    )
  })
})
