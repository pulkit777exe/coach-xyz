#!/usr/bin/env bun
// ── Where does a spawned probe's wall-clock actually go? ──────────────────────
//
// WHY THIS EXISTS. The suite spawns ~57 fresh `bun` processes (server/tests/spawnProbe.ts).
// On a laptop a spawn is ~0.9s median. On a GitHub runner a large minority take the whole
// `PROBE_TIMEOUT_MS` budget — which is why runs intermittently fail 46 and then 167 tests,
// every one of them a child killed at the budget with zero assertion failures.
//
// Everything known about that was an INFERENCE from the timeouts:
//   - "in-process work is p50 1ms"      → measured, off the runner's own log timings
//   - "the same boot exceeds 10s on CI" → inferred from children being killed, never timed
//   - "transpilation is not the cost"    → measured, a real 0.00s delta
//
// Nobody had ever run a stopwatch on a child ON the runner. This does, and it splits the
// parent-observed duration into three named phases, because the three have three different
// causes and three different fixes:
//
//   execAndLoader  parent's pre-spawn → the child's FIRST statement
//                  = fork/exec + bun runtime init + resolving the script
//   childWork      the child's first statement → its last
//                  = transpile + resolve + evaluate of the module graph
//   teardown       the child's last statement → the parent's spawnSync returning
//                  = process exit + stdio drain
//
// AND IT SEPARATES "hung on exit" FROM "never booted", which are different diagnoses with
// different fixes and which the existing helper cannot tell apart:
//
//   The first version of this script discarded a timed-out child's stdout and reported
//   only "TIMED OUT". That is exactly the mistake it was written to diagnose: a child that
//   finished all its work in 300ms and then sat there for 19.7s because an ioredis client
//   held the event loop open looks IDENTICAL, in that output, to a child that never reached
//   its first statement. So stdout is now parsed on timeout too, and `exitHang` says which
//   it was. (That was not hypothetical — it is exactly what happened locally.)
//
// Usage:
//   bun scripts/probeBootCost.ts                        # every preset, every case
//   bun scripts/probeBootCost.ts --preset=ci            # exactly what ci.yml gives a probe
//   bun scripts/probeBootCost.ts --only='composed app'  # one case, for a per-run CI step
//   bun scripts/probeBootCost.ts --json
//
// It is a measurement tool, not a test, and deliberately not under `tests/` so it is not
// part of the suite: it spawns ~40 processes and would add to the very cost it measures.

import { spawnSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

const SERVER = join(import.meta.dirname, '..')
const REPEATS = Number(process.env.PROBE_BOOT_REPEATS ?? 5)
const CHILD_BUDGET_MS = Number(process.env.PROBE_BOOT_CHILD_BUDGET_MS ?? 20_000)

// ── The child ────────────────────────────────────────────────────────────────
// Two markers, so the parent can place the child's first and last statement on its own
// clock. Same machine, so `Date.now()` is directly comparable — no clock skew.
//
// `stubRedis` mirrors what 15 of the 57 real probes do: `mock.module('../src/lib/redis')`
// registered BEFORE the dynamic import, because `lib/redis.ts` runs `new IORedis(...)` at
// module scope and a live client holds the event loop open so the process never exits.
const CHILD = (target: string, stubRedis: boolean, importBunTest = false) => `
const t0 = Date.now()
${
  stubRedis
    ? `const { mock } = await import('bun:test')
mock.module(${JSON.stringify(join(SERVER, 'src/lib/redis.ts'))}, () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))`
    : ''
}
${importBunTest ? `await import('bun:test')` : ''}
${
  target.startsWith('run:')
    ? `await (async () => { ${target.slice(4)} })()`
    : target === '(none)'
      ? ''
      : `await import(${JSON.stringify(target)})`
}
const t1 = Date.now()
process.stdout.write(JSON.stringify({ t0, t1 }))
process.exit(0)
`

interface Phase {
  label: string
  parent: number
  execAndLoader: number | null
  childWork: number | null
  teardown: number | null
  /** The child hit the budget. */
  timedOut: boolean
  /**
   * The child PRINTED both markers but the parent still waited the full budget — so all
   * its work finished and the cost is in exiting. Distinct from `neverBooted`.
   */
  exitHang: boolean
  /** No markers at all: the child never reached its first statement. */
  neverBooted: boolean
  note: string
}

// ── Environment presets ──────────────────────────────────────────────────────
// `ci` is ci.yml's server job transcribed: the two database vars are set, `DATABASE_URL`
// is deliberately EMPTY (the workflow leaves it unset, and `DATABASE_URL=` is an ordinary
// way to spell "not set"), and — the detail that matters — there is NO `UPSTASH_*`. With
// those unset `getRedisConnectionUrl()` returns null, `createRedisClient()` returns a noop,
// and NOTHING CONNECTS AT IMPORT. So redis is not a candidate for the CI cost, and this
// preset is what proves it rather than what assumes it.
const PRESETS: Record<string, () => Record<string, string>> = {
  ci: () => ({
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: 'Linux',
    DATABASE_URL: '',
    TEST_DATABASE_URL: 'postgres://coachxyz:coachxyz@localhost:55433/coachxyz',
    PERF_DATABASE_URL: 'postgres://coachxyz:coachxyz@localhost:55433/coachxyz',
    TZ: 'UTC',
  }),
  'ci+local-redis': () => ({
    ...PRESETS.ci(),
    UPSTASH_REDIS_REST_URL: 'redis://127.0.0.1:56380',
    UPSTASH_REDIS_IOREDIS_URL: 'redis://127.0.0.1:56380',
  }),
  'inherited (full)': () => ({ ...process.env }) as Record<string, string>,
  'bare (PATH only)': () => ({ PATH: process.env.PATH ?? '' }),
}

const ms = (n: number | null) => (n === null ? '  —' : `${n}ms`)

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

const HEADER =
  'phase'.padEnd(40) +
  'parent'.padStart(9) +
  'exec+load'.padStart(11) +
  'childWork'.padStart(11) +
  'teardown'.padStart(10) +
  '  diagnosis'

const run = (
  label: string,
  target: string,
  opts: { stubRedis: boolean; env: Record<string, string>; importBunTest?: boolean },
): Phase => {
  const args = ['-e', CHILD(target, opts.stubRedis, opts.importBunTest)]
  const parents: number[] = []
  const execs: number[] = []
  const works: number[] = []
  const tears: number[] = []
  let timedOut = false
  let exitHang = false
  let neverBooted = false
  let note = ''

  // Discarded warm-up: the FIRST spawn in a process pays a cold module-resolution path,
  // and charging that to the median would make every machine look slow.
  spawnSync(process.execPath, args, {
    cwd: SERVER,
    env: opts.env,
    encoding: 'utf8',
    timeout: CHILD_BUDGET_MS,
  })

  for (let i = 0; i < REPEATS; i++) {
    const p0 = Date.now()
    const r = spawnSync(process.execPath, args, {
      cwd: SERVER,
      env: opts.env,
      encoding: 'utf8',
      timeout: CHILD_BUDGET_MS,
      maxBuffer: 32 * 1024 * 1024,
    })
    const p1 = Date.now()
    parents.push(p1 - p0)
    const killed =
      (r.error as { code?: string } | undefined)?.code === 'ETIMEDOUT' || r.signal != null
    if (killed) timedOut = true

    // Parse markers EVEN ON TIMEOUT. This is the whole reason the script exists in this
    // shape: a child that finished its work and hung on exit is a different defect from
    // one that never booted, and throwing its stdout away makes them the same event.
    const m = /\{[^{}]*"t0"[^{}]*\}/.exec(r.stdout ?? '')
    if (m) {
      const { t0, t1 } = JSON.parse(m[0]) as { t0: number; t1: number }
      execs.push(t0 - p0)
      works.push(t1 - t0)
      tears.push(p1 - t1)
      if (killed) exitHang = true
    } else {
      neverBooted = true
      if (!note) note = (r.stderr ?? r.stdout ?? '').slice(0, 120).replace(/\s+/g, ' ')
    }
  }

  const diagnosis = neverBooted
    ? 'NEVER BOOTED — no markers at all'
    : exitHang
      ? 'EXIT HANG — all work done, process never exited'
      : timedOut
        ? 'timed out after markers'
        : ''

  const phase: Phase = {
    label,
    parent: median(parents),
    execAndLoader: execs.length ? median(execs) : null,
    childWork: works.length ? median(works) : null,
    teardown: tears.length ? median(tears) : null,
    timedOut,
    exitHang,
    neverBooted,
    note,
  }
  // Printed as it completes, so a hang in a LATER target cannot discard the phases that
  // already produced a number.
  process.stdout.write(
    `${label.padEnd(40)}${ms(phase.parent).padStart(9)}${ms(phase.execAndLoader).padStart(11)}` +
      `${ms(phase.childWork).padStart(11)}${ms(phase.teardown).padStart(10)}  ${diagnosis}\n`,
  )
  return phase
}

const CASES: {
  label: string
  target: string
  stubRedis: boolean
  importBunTest?: boolean
}[] = [
  {
    label: 'bun:test ALONE (every probe imports it)',
    target: '(none)',
    stubRedis: false,
    importBunTest: true,
  },
  {
    label: 'bun:test + app.ts (what a probe does)',
    target: './src/app.ts',
    stubRedis: true,
    importBunTest: true,
  },
  { label: 'bare bun, no import', target: '(none)', stubRedis: false },
  { label: 'bun + lib/logger', target: './src/lib/logger.ts', stubRedis: false },
  { label: 'bun + lib/redis (real, ci env)', target: './src/lib/redis.ts', stubRedis: false },
  { label: 'bun + lib/redis (stubbed)', target: './src/lib/redis.ts', stubRedis: true },
  {
    label: 'bun + routes/email (heaviest graph)',
    target: './src/routes/email.ts',
    stubRedis: true,
  },
  { label: 'bun + app.ts (the composed app)', target: './src/app.ts', stubRedis: true },
  {
    // The one row that is a HYPOTHESIS rather than an import. 20 of the 41 probe files do
    // not mock `lib/historyStore`, so each of those spawns runs the real
    // `ensureInitialized()` — the full DDL for ~20 tables — against the ephemeral Postgres.
    // `initPromise` is memoised PER PROCESS and every spawn is a new process, so that DDL
    // is re-run by every one of them. On a laptop the database is fast and this is
    // invisible; on a runner the Postgres container shares CPU and I/O with the suite.
    // Measured here rather than reasoned about, because the last three hypotheses all
    // measured fast and the cost is still 10 seconds somewhere.
    label: 'ensureInitialized() DDL vs ephemeral PG',
    // `setHistoryStoreConnectionForTests` takes a `SQL`, not a URL — it assigns the module's
    // connection and clears the memoised `initPromise` so the DDL is genuinely re-run.
    target:
      "run: const { SQL } = await import('bun:sql'); const h = await import('./src/lib/historyStore.ts'); h.setHistoryStoreConnectionForTests(new SQL(process.env.TEST_DATABASE_URL)); await h.withHistoryStoreOrThrow(async () => {})",
    stubRedis: false,
  },
]

const onlyPreset = process.argv.find((a) => a.startsWith('--preset='))?.split('=')[1]
const presets = onlyPreset ? [onlyPreset] : Object.keys(PRESETS)

/**
 * `--only=<substring>` keeps a case by label. Exists so the server CI job can afford to
 * measure this on EVERY run rather than only on a red one: two cases at three repeats is
 * ~7s on a healthy runner, and a red run's evidence is otherwise lost because the next
 * attempt usually passes.
 */
/**
 * `--probes=<substring>` runs the REAL probe files from `tests/`, not a synthetic import.
 *
 * This exists because every synthetic case measured FAST on a runner that was failing 41
 * tests: a fresh spawn importing `src/app.ts` takes 284ms there, against 290ms on a
 * laptop — 2% apart — while the probes it replaced were hitting a 10s budget. So the cost
 * is in something a synthetic import does not do, and the only way to find it is to stop
 * approximating and time the actual thing that fails.
 */
const onlyProbe = process.argv.find((a) => a.startsWith('--probes='))?.split('=')[1]

const onlyCase = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]
const cases = onlyCase ? CASES.filter((c) => c.label.includes(onlyCase)) : CASES
if (cases.length === 0) throw new Error(`--only=${onlyCase} matched no case`)

const phases: Phase[] = []
process.stdout.write(`${HEADER}\n${'-'.repeat(96)}\n`)

if (onlyProbe) {
  const files = readdirSync(join(SERVER, 'tests'))
    .filter((f) => f.endsWith('Probe.ts') && f.includes(onlyProbe))
    .sort()
  if (files.length === 0) throw new Error(`--probes=${onlyProbe} matched no probe file`)
  process.stdout.write(`\n── REAL PROBES (tests/*${onlyProbe}*) ──\n`)
  for (const f of files) {
    const t0 = Date.now()
    const r = spawnSync(process.execPath, [join('tests', f)], {
      cwd: SERVER,
      env: PRESETS.ci(),
      encoding: 'utf8',
      timeout: CHILD_BUDGET_MS,
      maxBuffer: 32 * 1024 * 1024,
    })
    const wall = Date.now() - t0
    const killed =
      (r.error as { code?: string } | undefined)?.code === 'ETIMEDOUT' || r.signal != null
    const tail = (r.stderr ?? r.stdout ?? '').trim().slice(-90).replace(/\s+/g, ' ')
    phases.push({
      label: `tests/${f}`,
      parent: wall,
      execAndLoader: null,
      childWork: null,
      teardown: null,
      timedOut: killed,
      exitHang: false,
      neverBooted: false,
      note: killed ? `KILLED at ${CHILD_BUDGET_MS}ms; last output: ${tail}` : tail,
    })
    process.stdout.write(
      `  ${`tests/${f}`.padEnd(46)}${`${wall}ms`.padStart(10)}  ${killed ? `KILLED — ${tail}` : tail}\n`,
    )
  }
  process.stdout.write(
    `\nA probe above that boots fast is NOT evidence the suite is healthy: it ran on its own.\nThe suite runs them under \`bun test --isolate\`, so the difference between those two contexts\nis itself unmeasured and is the next thing to time.\n`,
  )
}
for (const preset of presets) {
  process.stdout.write(`\n── env preset: ${preset} ──\n`)
  const env = PRESETS[preset]()
  if (!env) throw new Error(`unknown preset: ${preset}`)
  for (const c of cases)
    phases.push(
      run(c.label, c.target, { stubRedis: c.stubRedis, env, importBunTest: c.importBunTest }),
    )
}

process.stdout.write(
  [
    '',
    `bun    ${process.version}`,
    `node   ${spawnSync('node', ['--version']).stdout.toString().trim()}`,
    `cores  ${cpus().length}`,
    `repeats ${REPEATS}, child budget ${CHILD_BUDGET_MS}ms`,
    '',
    'exec+load = fork/exec + bun runtime init; childWork = the module graph;',
    'teardown = exit + stdio drain. NEVER BOOTED and EXIT HANG are different',
    'defects with different fixes, so they are reported separately.',
  ].join('\n') + '\n',
)

if (process.argv.includes('--json')) {
  const out = join(SERVER, 'probe-boot-cost.json')
  writeFileSync(out, JSON.stringify(phases, null, 2))
  console.log(`\nwrote ${out}`)
}
