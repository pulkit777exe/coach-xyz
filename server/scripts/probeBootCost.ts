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
//   bun scripts/probeBootCost.ts               # every preset
//   bun scripts/probeBootCost.ts --preset ci   # exactly what ci.yml gives a probe
//   bun scripts/probeBootCost.ts --json
//
// It is a measurement tool, not a test, and deliberately not under `tests/` so it is not
// part of the suite: it spawns ~40 processes and would add to the very cost it measures.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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
const CHILD = (target: string, stubRedis: boolean, runtime: 'node' | 'bun' = 'bun') => {
  // node resolves an ABSOLUTE PATH through its ESM loader only when it is a file:// URL —
  // a bare path raises `ERR_MODULE_NOT_FOUND`, which is why the bun-vs-node row first read
  // "NEVER BOOTED": a harness artefact that looked exactly like the failure mode under
  // investigation. bun accepts the bare path.
  const spec = runtime === 'node' ? pathToFileURL(join(SERVER, target.slice(2))).href : target
  return `
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
${target === '(none)' ? '' : `await import(${JSON.stringify(target)})`}
const t1 = Date.now()
process.stdout.write(JSON.stringify({ t0, t1 }))
process.exit(0)
`
}

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
  opts: { stubRedis: boolean; env: Record<string, string>; runtime?: 'node' },
): Phase => {
  const args = ['-e', CHILD(target, opts.stubRedis, opts.runtime ?? 'bun')]
  const bin = opts.runtime === 'node' ? 'node' : process.execPath
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
  spawnSync(bin, args, { cwd: SERVER, env: opts.env, encoding: 'utf8', timeout: CHILD_BUDGET_MS })

  for (let i = 0; i < REPEATS; i++) {
    const p0 = Date.now()
    const r = spawnSync(bin, args, {
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

const CASES: { label: string; target: string; stubRedis: boolean }[] = [
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
]

const only = process.argv.find((a) => a.startsWith('--preset='))?.split('=')[1]
const presets = only ? [only] : Object.keys(PRESETS)

const phases: Phase[] = []
process.stdout.write(`${HEADER}\n${'-'.repeat(96)}\n`)
for (const preset of presets) {
  process.stdout.write(`\n── env preset: ${preset} ──\n`)
  const env = PRESETS[preset]()
  if (!env) throw new Error(`unknown preset: ${preset}`)
  for (const c of CASES) phases.push(run(c.label, c.target, { stubRedis: c.stubRedis, env }))
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
