// Coverage, reported HONESTLY.
//
//   TEST_DATABASE_URL=postgres://…/coachxyz PERF_DATABASE_URL=$TEST_DATABASE_URL \
//   DATABASE_URL= bun scripts/coverage.ts
//
// Why this exists instead of just reading `bun test --coverage`: **Bun only
// instruments the parent process.** This repo runs ~57 authorization probes as
// child `bun` processes plus a matrix probe that drives the real composed app
// across 1452 route x role cases. A module exercised only through a probe is
// reported at ~5% in-process while being heavily tested, and a module exercised
// only in-process is reported truthfully. So the raw "All files" number is a
// LOWER BOUND, and — worse — it is a lower bound that is *least* wrong exactly
// where the security-critical code lives, because the security suites are the
// probe ones.
//
// So this script does two things the raw table cannot. It parses the table, and
// it classifies every sub-threshold module as PROBE-EXERCISED (the number is an
// artifact; chasing it is wasted work) or REAL GAP (the number means something).
// The classification is a reachability question — is the module imported by any
// probe, or reachable from the composed app in src/app.ts? — not a guess about
// which suites "feel" thorough.
//
// The distinction matters because the wrong reading of this table costs real
// effort: `src/routes/auth.ts` reports 9.71% and has held a genuine §5 medical
// leak, so it is the obvious first target, and closing "it" would be a waste —
// the authMatrixProbe drives it in a child process that coverage cannot see.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SERVER_DIR = join(import.meta.dir, '..')
const THRESHOLD = 50

const run = (args: string[]): string => {
  const r = spawnSync(process.execPath, args, {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    // The suite spawns probes and takes ~2min; do not inherit an outer timeout.
    timeout: 20 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error) throw r.error
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
}

const dbUrl = (process.env.TEST_DATABASE_URL ?? process.env.PERF_DATABASE_URL ?? '').trim()
if (!dbUrl) {
  console.error(
    'Refusing to run: set TEST_DATABASE_URL (or PERF_DATABASE_URL) to a LOCAL Postgres.\n' +
      'The live-database suites are gated on it, so without it this measures a\n' +
      'fraction of the code and the number would be meaningless.',
  )
  process.exit(1)
}
if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
  console.error('Refusing to run: the coverage database must be local.')
  process.exit(1)
}

process.stdout.write('running the suite with coverage…\n')
const raw = run(['test', '--coverage', '--timeout', '30000', '--isolate'])

// The pass/fail/skip line is the part that decides whether the numbers mean
// anything, so it is parsed rather than eyeballed.
const tally = /^\s*(\d+) pass\s*$/m.exec(raw)
const fails = /^\s*(\d+) fail\s*$/m.exec(raw)
const skips = /^\s*(\d+) skip\s*$/m.exec(raw)
console.log(
  `\nsuite: ${tally?.[1] ?? '?'} pass / ${fails?.[1] ?? '?'} fail / ${skips?.[1] ?? '?'} skip`,
)

type Row = { file: string; funcs: number; lines: number }
const rows: Row[] = []
for (const line of raw.split('\n')) {
  if (!line.includes('|')) continue
  const cells = line.split('|').map((c) => c.trim())
  if (cells.length < 3) continue
  if (!/^\d+(\.\d+)?$/.test(cells[1] ?? '')) continue
  if (!cells[0].startsWith('src/')) continue
  rows.push({ file: cells[0], funcs: Number(cells[1]), lines: Number(cells[2]) })
}
if (rows.length === 0) {
  console.error('No coverage rows parsed — the table format changed, or the run failed.')
  process.exit(1)
}

// Reachability: imported by a probe, or reachable from the composed app.
let probeText = ''
for (const name of readdirSync(join(SERVER_DIR, 'tests'))) {
  if (/probe/i.test(name) && name.endsWith('.ts')) {
    probeText += readFileSync(join(SERVER_DIR, 'tests', name), 'utf8')
  }
}
const appText = ['src/app.ts', 'src/index.ts']
  .map((f) => readFileSync(join(SERVER_DIR, f), 'utf8'))
  .join('\n')

const isProbeExercised = (file: string): boolean => {
  const base = file.split('/').pop()?.replace(/\.ts$/, '') ?? ''
  return probeText.includes(base) || appText.includes(base)
}

const sub = rows.filter((r) => r.lines < THRESHOLD)
const artifacts = sub.filter((r) => isProbeExercised(r.file))
const gaps = sub.filter((r) => !isProbeExercised(r.file))

console.log(`\nsrc files measured: ${rows.length}`)
console.log(`  at 0% lines:            ${rows.filter((r) => r.lines === 0).length}`)
console.log(`  at 100% lines:          ${rows.filter((r) => r.lines === 100).length}`)
console.log(`  below ${THRESHOLD}% lines:          ${sub.length}`)
console.log(`    probe-exercised (artifact): ${artifacts.length}`)
console.log(`    REAL gaps:                  ${gaps.length}`)

const avg = rows.reduce((t, r) => t + r.lines, 0) / rows.length
console.log(`\nmean per-file line coverage: ${avg.toFixed(2)}%  (in-process; a LOWER BOUND)`)

if (gaps.length > 0) {
  console.log(`\n── REAL gaps (below ${THRESHOLD}%, not probe-exercised) ──`)
  for (const r of gaps.sort((a, b) => a.lines - b.lines)) {
    console.log(`  ${r.lines.toFixed(2).padStart(6)}%  ${r.file}`)
  }
}
if (artifacts.length > 0) {
  console.log(`\n── probe-exercised below ${THRESHOLD}%; numbers are artifacts, not gaps ──`)
  for (const r of artifacts.sort((a, b) => a.lines - b.lines)) {
    console.log(`  ${r.lines.toFixed(2).padStart(6)}%  ${r.file}`)
  }
}
