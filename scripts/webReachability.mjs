#!/usr/bin/env node
/**
 * web-next reachability, because the tier has no coverage number at all.
 *
 * `vitest --coverage` needs `@vitest/coverage-v8`, which is a dependency this
 * repo is not allowed to add mid-review, so this measures the thing that CAN be
 * derived honestly without one: **is each source file reachable from any test's
 * import graph?** That is a lower bound on coverage and an upper bound on the
 * untested surface, and — unlike a percentage — it points at specific files.
 *
 * Why reachability and not a percentage, stated plainly so the number is not
 * over-read:
 *   • `server/scripts/coverage.ts` exists because Bun instruments only the parent
 *     process, so a module tested through a probe reports near-zero while being
 *     heavily tested. The same trap exists here in a different shape: a file
 *     reached only through a barrel (`@/components/...`) is counted as reachable
 *     while its own branch may never execute.
 *   • "Reachable" is a graph fact, not an execution fact. A file can be imported
 *     and have none of its interesting lines run.
 *
 * So this answers ONE question precisely — which files does no test even load —
 * and declines to answer the one that needs an instrumented runtime. The files it
 * names are the honest starting list for a DOM environment.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Derived from this file's own location, NOT hardcoded. It used to be
// `/home/pulkit/.../web-next`, which meant the script silently reported 0 source
// files anywhere else: `walk()` returns [] when the root does not exist, so the
// run "succeeded" with a plausible-looking empty report rather than failing. It
// went unnoticed because the ledger only ever asked for a re-derive on the
// machine the path named — the first run in CI (via reachabilityStamp.test.ts)
// is what exposed it. An absolute path to one workstation is a bug that only
// fires for everyone except its author.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web-next')

// Fail LOUDLY, because the alternative is the worst possible report. With a root
// that does not exist, `walk()` returns [], so the run prints "0 source files,
// 0 untouched, static import edge 100.0%" and exits 0 — an empty set reported as
// total coverage. That is a fail-open reading as good news, which is precisely
// the shape this repo keeps paying for. Measured: pointing ROOT at CI's own
// checkout path from a host that does not have it reproduces exactly that.
if (!existsSync(ROOT)) {
  console.error(`webReachability: web-next not found at ${ROOT}`)
  process.exit(1)
}
const SOURCE_DIRS = ['app', 'components', 'lib']
const EXTS = ['.ts', '.tsx']

const walk = (dir) => {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e === '.next') return []
      return walk(p)
    }
    return EXTS.includes(p.slice(p.lastIndexOf('.'))) ? [p] : []
  })
}

const walked = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)))
const isTest = (f) => /\.(test|spec)\.[jt]sx?$/.test(f)
const tests = walked.filter(isTest)
// A file that IS a test is not "source under test".
const allSource = walked.filter((f) => !isTest(f))
// Resolve a specifier the way the bundler would, but only for the three things
// this repo actually uses: the `@/` alias, and relative paths. Anything else
// (next/*, react, a package) is a leaf and contributes nothing.
const toFile = (from, spec) => {
  const base = spec.startsWith('@/')
    ? join(ROOT, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null
  if (!base) return null
  for (const candidate of [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, 'index' + e)),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

// Breadth-first from every test file, so the answer is "reachable from SOME test"
// rather than "mentioned once".
const reachable = new Set()
const queue = [...tests]
const edges = []
while (queue.length) {
  const file = queue.shift()
  if (reachable.has(file)) continue
  reachable.add(file)
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = toFile(file, m[1])
    if (target && !reachable.has(target)) {
      edges.push([relative(ROOT, file), relative(ROOT, target)])
      queue.push(target)
    }
  }
}

const uncovered = allSource.filter((f) => !reachable.has(f))
const lines = (f) => readFileSync(f, 'utf8').split('\n').length
const totalLines = allSource.reduce((n, f) => n + lines(f), 0)

// ── The bucket a static import graph cannot see ─────────────────────────────
// `components/a11y-name-sweep.test.tsx` enumerates `components/**` with
// `readdirSync` and dynamically imports whatever it finds. That genuinely renders
// every component — but it leaves NO static import edge, so a reachability graph
// built from imports alone reports those files as untouched, which is wrong, and
// wrong in the direction that INFLATES the number.
//
// So the remainder splits in two, and the split is the whole point:
//   • loaded only by a generic sweep — rendered, but by a test written for markup
//     rather than behaviour. This is the bucket that reads as covered and is not:
//     it would not catch a wrong value.
//   • touched by nothing at all.
// A component only reaches the second bucket by losing BOTH edges.
const testSrc = (f) => readFileSync(f, 'utf8')
const enumeratesAtRuntime = tests.some((f) => /\breaddir(Sync)?\s*\(/.test(testSrc(f)))
const runtimeOnly = enumeratesAtRuntime ? uncovered.filter((f) => f.startsWith(join(ROOT, 'components') + '/')) : []
const untouched = uncovered.filter((f) => !runtimeOnly.includes(f))

const pct = (a, b) => (b === 0 ? '100.0' : ((a / b) * 100).toFixed(1))
const sumLines = (fs) => fs.reduce((n, f) => n + lines(f), 0)

console.log('web-next source reachability from tests')
console.log('='.repeat(72))
console.log(`source files                     ${allSource.length}`)
console.log(`test files                       ${tests.length}`)
console.log()
console.log(`statically imported by a test     ${allSource.length - uncovered.length}`)
console.log(`loaded only by a generic sweep    ${runtimeOnly.length}    (readdirSync enumeration, no import edge)`)
console.log(`touched by nothing at all         ${untouched.length}`)
console.log(`  static import edge              ${pct(allSource.length - uncovered.length, allSource.length)}% of files`)
console.log(`  any loader at all (edge+sweep)  ${pct(allSource.length - untouched.length, allSource.length)}% of files`)
console.log()
console.log(`lines in source                  ${totalLines}`)
console.log(`lines in untouched files         ${sumLines(untouched)}  (${pct(sumLines(untouched), totalLines)}%)`)
console.log()

const byDir = {}
for (const f of untouched) {
  const d = relative(ROOT, dirname(f)).split('/')[0]
  byDir[d] ??= { n: 0, lines: 0 }
  byDir[d].n += 1
  byDir[d].lines += lines(f)
}
console.log('touched by nothing, by top-level directory')
for (const [d, v] of Object.entries(byDir).sort((a, b) => b[1].lines - a[1].lines)) {
  console.log(`  ${d.padEnd(12)} ${String(v.n).padStart(4)} files  ${String(v.lines).padStart(6)} lines`)
}
console.log()
console.log('components with NO test written for them (sweep-rendered only)')
for (const f of runtimeOnly.sort((a, b) => lines(b) - lines(a))) {
  console.log(`  ${String(lines(f)).padStart(5)}  ${relative(ROOT, f)}`)
}
console.log()
console.log(`the ${Math.min(25, untouched.length)} largest untouched files`)
for (const f of untouched.sort((a, b) => lines(b) - lines(a)).slice(0, 25)) {
  console.log(`  ${String(lines(f)).padStart(5)}  ${relative(ROOT, f)}`)
}
console.log()
console.log('LIMITS, stated so this number is not over-read:')
console.log('  * Reachability is a graph fact, not an execution fact. A reachable file')
console.log('    may have none of its branches run — the render sweep proves markup,')
console.log('    not values.')
console.log('  * "Loaded only by a generic sweep" is the bucket that READS as covered and')
console.log('    is not: the render sweep proves markup and accessible names, never a')
console.log('    value. A component in that bucket has no test written for its behaviour.')
console.log('  * That bucket is an UPPER BOUND, and measurably so: it is keyed on "some')
console.log('    test calls readdirSync", not on "this file was enumerated". Mutating the')
console.log('    sweep so it walks NOTHING leaves the numbers unchanged, because the')
console.log('    detection cannot see it. It is right for this repo only because the')
console.log('    sweep walks from the components directory itself, so enumerating means')
console.log("    every component — revisit this line if the sweep's roots ever change.")
console.log('  * Barrel imports make this an OVER-count in the covered direction — a file')
console.log('    reached through `@/components` counts as reachable while its own code')
console.log('    never executes. Same trap server/scripts/coverage.ts documents for Bun')
console.log('    and its child-process probes.')
console.log('  * Line counts are whole-file, so a 3-line helper weighs the same as a')
console.log('    400-line component. Sorted by lines to make that visible, not to')
console.log('    pretend it is a priority score.')
