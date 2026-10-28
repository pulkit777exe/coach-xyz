import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── No barrel imports: statically analyzable paths only ───────────────────────
//
// AGENTS.md: "No barrel imports. Import directly (`@/components/org/ScheduleClient`, not
// `@/components`). Statically analyzable paths only." The reason given is the whole
// point — a barrel re-exports its neighbours, so importing one module drags every sibling
// into the graph, which is how a client bundle ends up carrying a dependency nothing
// references.
//
// WHY THIS NEEDS A GUARD DESPITE ZERO VIOLATIONS TODAY. There is no `index.ts` anywhere in
// `app/`, `components/` or `lib/`, and nothing imports a bare directory, so the rule is
// satisfied by ABSENCE — and that is the weakest possible form of satisfaction. A single
// `index.ts` added for convenience, or one `from '@/components'`, would import a dozen
// modules into every consumer and no existing assertion would notice. **A rule kept only
// by convention is a rule that erodes the first time it is inconvenient**, and this one
// would be convenient exactly when someone is in a hurry.
//
// Two halves, because "no barrel file" and "no directory import" can be violated
// independently: a directory can resolve through its package.json or a bundler alias
// without an `index.ts`, and an `index.ts` can exist without anything importing it yet.

const ROOT = join(import.meta.dirname, '..', '..')
if (!existsSync(join(ROOT, 'components'))) throw new Error(`bad ROOT: ${ROOT}`)

/**
 * `types/` is at the app root, NOT under any of the three scanned directories — so the
 * barrel-file rule has to name it explicitly. The first version of this file listed only
 * `app`/`components`/`lib`, found no `index.ts` anywhere, and then asserted that
 * `types/index.ts` WAS present as its exemption — a contradiction that failed
 * `expected [] to deeply equal [ 'types/index.ts' ]`.
 *
 * That is the same class as a fabricated coverage claim: the assertion named a file the
 * scan could not have found.
 */
const SOURCE_DIRS = ['app', 'components', 'lib', 'types']

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * Repo-relative path.
 *
 * `path.relative` rather than a manual `slice`: this file lives at
 * `web-next/lib/__tests__/`, and `ROOT` is that same string prefix — so slicing
 * `ROOT.length + 1` off `lib/api.ts` returns `""`, because the leading `lib/` matches
 * the tail of `.../web-next/lib`. Every report then read `: './api'` and every
 * relative import resolved against `web-next/` instead of `web-next/lib/`, so the guard
 * flagged good code with nonsense paths. `path.relative` has no such overlap problem.
 */
const rel = (f: string): string => relative(ROOT, f)

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx']
const STYLE_EXTS = ['.css', '.scss', '.sass']

/**
 * Does a first-party specifier resolve to something real?
 *
 * ONE definition, called by both the tree-wide assertion and the negative control. They
 * each had their own copy, and the negative-control mutation (disabling the tree-wide
 * check) came back GREEN because the control was validating a different function — the
 * same defect `asyncParallel.test.ts` had, and the third instance in this repo of a
 * control that does not share the code path it is meant to validate.
 *
 * `abs` already carries any extension the specifier declared, so the stylesheet branch
 * tests `abs` directly; `abs + '.css'` would look for `globals.css.css`.
 */
const resolves = (spec: string, fromRel: string): boolean => {
  const abs = spec.startsWith('@/')
    ? join(ROOT, spec.slice(2))
    : resolve(ROOT, dirname(fromRel), spec)
  return (
    CODE_EXTS.some((e) => existsSync(abs + e)) ||
    DIRECTORY_EXEMPT.includes(spec) ||
    (CODE_EXTS.some((e) => existsSync(join(abs, `index${e}`))) && existsSync(abs)) ||
    // Stylesheets are imported for their SIDE EFFECT and have no JS counterpart.
    STYLE_EXTS.some((e) => spec.endsWith(e) && existsSync(abs))
  )
}

/**
 * The one legitimate directory import in the repo, named rather than allowed by pattern.
 *
 * `types/index.ts` is a TYPE-CONTRACT module — the shared API shapes mirroring
 * `server/src/types/index.ts` — not a barrel that re-exports neighbours. Every importer
 * uses `import type`, so it is erased at compile time and contributes nothing to a
 * bundle. `lib/types.ts` does not exist, so `@/types` cannot name a file.
 *
 * Named because the alternative — a pattern like "any directory import whose importers
 * are all `import type`" — is a rule that would accept a barrel full of components as
 * soon as one type-only import appeared beside it. **A named exemption is a decision
 * somebody made; a pattern is a hole with a shape.**
 */
const DIRECTORY_EXEMPT = ['@/types']

describe('no barrel imports — statically analyzable paths only', () => {
  test('the scan is not vacuous: it reads a real number of imports', () => {
    // Asserted on the SCAN's reach, not on its output being empty. Otherwise "no
    // violations" and "the matcher broke" would be the same green run — the failure mode
    // this repo has now paid for three separate times.
    const files = SOURCE_DIRS.flatMap(sourceFiles)
    expect(files.length).toBeGreaterThan(100)
    let imports = 0
    for (const f of files)
      imports += [...readFileSync(join(ROOT, f), 'utf8').matchAll(IMPORT_RE)].length
    expect(imports).toBeGreaterThan(300)
  })

  test('no barrel file exists — except the named type-contract module', () => {
    // The half that fails silently. A new `index.ts` under `components/` or `lib/` is the
    // precondition for the violation, and nothing else in the suite would notice one.
    //
    // `types/index.ts` is the exemption and it is asserted PRESENT, so the allowance cannot
    // outlive its justification: if that module were ever split into per-type files, this
    // test fails and asks whether the exemption is still needed.
    const barrels: string[] = []
    for (const dir of SOURCE_DIRS) {
      const walk = (d: string) => {
        for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
          const p = join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (/^index\.(ts|tsx|js|jsx)$/.test(e.name)) barrels.push(rel(p))
        }
      }
      walk(dir)
    }
    const allowed = barrels.filter((b) => b === 'types/index.ts')
    expect(allowed).toEqual(['types/index.ts'])
    expect(barrels.filter((b) => b !== 'types/index.ts')).toEqual([])
  })

  test('the `@/types` exemption is bounded: value imports name ONLY the runtime constant', () => {
    // The reason the exemption exists, asserted rather than assumed — and the assertion I
    // wrote first was WRONG in a way that would have been a false claim of safety.
    //
    // It required every `@/types` import to be `import type`. Two are not:
    // `components/LandingPage.tsx:5` and `lib/useScanFlow.ts:7` both import
    // `MAX_FILE_SIZE_BYTES`, a runtime `const` the file genuinely exports alongside its
    // types. So `types/index.ts` is NOT type-only, it is a small module with one runtime
    // value — which is a different and more accurate justification than the one I wrote,
    // and is the reason the exemption is safe: the runtime surface is one named constant,
    // not a re-export surface that could grow.
    //
    // So the rule is: every VALUE import from `@/types` must name exactly that constant.
    // A second runtime export fails here, which is the signal to split the module.
    const RUNTIME_EXPORTS = new Set(['MAX_FILE_SIZE_BYTES'])
    const offenders: string[] = []
    for (const f of SOURCE_DIRS.flatMap(sourceFiles)) {
      const src = readFileSync(join(ROOT, f), 'utf8')
      const re = /(?:^|\n)\s*import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@\/types['"]/g
      for (const m of src.matchAll(re)) {
        if (m[1]) continue // `import type` — erased at compile time
        for (const raw of m[2].split(',')) {
          const name = raw
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]
            .trim()
          if (name && !RUNTIME_EXPORTS.has(name)) offenders.push(`${rel(f)}: ${name}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('no import resolves to a bare directory', () => {
    // The other half, independent of the first: a bundler alias or a package.json
    // "main" can resolve `@/components` with no `index.ts` anywhere.
    const offenders: string[] = []
    for (const dir of SOURCE_DIRS) {
      for (const f of sourceFiles(dir)) {
        const src = readFileSync(join(ROOT, f), 'utf8')
        for (const m of src.matchAll(IMPORT_RE)) {
          const spec = m[1]
          if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
          const abs = spec.startsWith('@/')
            ? join(ROOT, spec.slice(2))
            : resolve(ROOT, dirname(rel(f)), spec)
          // A directory import: the path exists, is a directory, and has no extension.
          const looksLikeDir = !/\.[a-z]+$/.test(spec) && existsSync(abs)
          if (looksLikeDir && !DIRECTORY_EXEMPT.includes(spec))
            offenders.push(`${rel(f)}: '${spec}'`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('the resolution check REJECTS a path that does not exist — the negative control', () => {
    // Mutation B6 (`if (false && !ok)`) left this suite GREEN, which is the point: the
    // check asserts every import resolves, and the tree has no broken import, so disabling
    // the check is invisible. An assertion over a clean tree cannot detect its own removal.
    //
    // So the resolver is exercised against a specifier that genuinely does not exist. This
    // is the same positive-control shape `typeScaleComponents.test.ts` and
    // `asyncParallel.test.ts` both needed, and it is the third time in this repo that a
    // guard has passed vacuously.
    expect(resolves('@/components/NoSuchModule', 'app/layout.tsx')).toBe(false)
    expect(resolves('./NoSuchFile', 'app/layout.tsx')).toBe(false)
    // And a real one still resolves, so the check is not simply always-false.
    // The root layout is the static shell now; the session header is imported by
    // the dynamic segment layouts that render it.
    expect(resolves('@/components/AuthHeader', 'app/dashboard/layout.tsx')).toBe(true)
    expect(resolves('./globals.css', 'app/layout.tsx')).toBe(true)
  })

  test('every first-party import resolves to a real file', () => {
    // The property the rule actually exists for: a path that resolves is statically
    // analyzable, which is what lets the bundler drop what is unused. An unresolvable
    // relative or aliased import is a build-time surprise at best, and this catches it
    // before `next build` does. Bare package specifiers are exempt — they resolve in
    // node_modules, which is not walked here.
    //
    // KNOWN LIMIT, recorded rather than papered over: disabling the LOOP (`if (false && …)`)
    // is still not detectable from inside this file, because the tree has no broken import
    // and the negative control calls `resolves` directly rather than the loop. What does
    // pin it is planting a real violation in the tree — a barrel `index.ts` and a second
    // runtime import from `@/types` were both added to the source and both turned this
    // file red. So the loop is verified by external mutation rather than by a self-check,
    // which is weaker than a control and is the honest statement of where it stands.
    const missing: string[] = []
    for (const dir of SOURCE_DIRS) {
      for (const f of sourceFiles(dir)) {
        const src = readFileSync(join(ROOT, f), 'utf8')
        for (const m of src.matchAll(IMPORT_RE)) {
          const spec = m[1]
          if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
          if (!resolves(spec, rel(f))) missing.push(`${rel(f)}: '${spec}'`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
