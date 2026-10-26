import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── gsap must not be in any eager client bundle ──────────────────────────────
//
// `gsap` has exactly ONE importer in this app — `components/ResultsSummary.tsx`, which
// uses it for a single 0.3s staggered fade-in of six sections. It was previously
// imported statically by BOTH `AppClient` and `AnalysisDetailClient`, which put all
// ~6.4MB of gsap plus `@gsap/react` into the initial bundle of the landing page, for a
// component that renders nothing until `jobStatus.summary` exists. Every visitor who had
// not finished an analysis downloaded it and saw no trace of it.
//
// This is the rule AGENTS.md already states for recharts ("heavy client visuals load via
// `next/dynamic` with `ssr: false`"), so the fix is the repo's own pattern rather than a
// new one — and `motion` (884K, 7x smaller) is already a dependency already used for
// this class of animation, if anyone wants to go further.
//
// WHAT IS AND IS NOT PROVEN. This walks the STATIC import graph, so it is a reachability
// claim, not an execution one: it proves nothing statically imports gsap into these
// entries, and it cannot measure bytes or prove the lazy chunk is ever fetched. What it
// DOES catch is the regression that actually happened — someone adding a plain
// `import ResultsSummary from ...` and silently putting 6.4MB back on the landing page.
// Reachability is not execution, and this file says so rather than implying otherwise.

// `lib/__tests__/` is two levels below the app root, not one.
const ROOT = resolve(import.meta.dirname, '..', '..')
const EXTS = ['.tsx', '.ts', '.jsx', '.js']

/** Resolve an import specifier to a first-party file, or null for a bare package. */
function resolveSpec(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  if (EXTS.some((e) => base.endsWith(e))) return existsSync(base) ? base : null
  for (const e of EXTS) if (existsSync(base + e)) return base + e
  if (existsSync(base)) {
    for (const e of EXTS) {
      const f = join(base, `index${e}`)
      if (existsSync(f)) return f
    }
  }
  return null
}

/**
 * Every bare package reachable through static imports from `entry`, plus the count of
 * first-party files traversed. `dynamic(() => import(...))` is deliberately NOT followed:
 * that is the whole point — a lazy edge moves the module out of the eager bundle.
 */
function staticClosure(entry: string): { packages: Set<string>; files: number } {
  const packages = new Set<string>()
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    let src: string
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // `import … from 'x'` and bare `import 'x'`. Next's own specifiers are skipped:
    // `next/dynamic` is the sanctioned lazy boundary, not a dependency.
    const stmt = /(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
    for (const m of src.matchAll(stmt)) {
      const spec = m[1]
      if (spec.startsWith('next/')) continue
      const file2 = resolveSpec(spec, file)
      if (file2) stack.push(file2)
      else packages.add(spec)
    }
  }
  return { packages, files: seen.size }
}

const entry = (rel: string) => join(ROOT, rel)

/** Entries that ship to the browser on a normal page view. */
const EAGER_CLIENT_ENTRIES = ['components/AppClient.tsx', 'components/AnalysisDetailClient.tsx']

describe('heavy libraries stay behind a lazy boundary', () => {
  for (const rel of EAGER_CLIENT_ENTRIES) {
    test(`${rel} does not statically reach gsap`, () => {
      const { packages } = staticClosure(entry(rel))
      // Named individually rather than as a list, so a failure says which library.
      expect([...packages].filter((p) => p.startsWith('gsap'))).toEqual([])
      expect(packages.has('@gsap/react')).toBe(false)
    })
  }

  test('the closure walk is not vacuous — it really traverses the app', () => {
    // A resolver that silently matched nothing would make the cases above pass for the
    // wrong reason. That is the trap this repo has already paid for twice.
    const { files } = staticClosure(entry(EAGER_CLIENT_ENTRIES[0]))
    expect(files).toBeGreaterThan(20)
  })

  test('ResultsSummary itself DOES reach gsap, so the guard is measuring something', () => {
    // The inverse. Without this, a broken resolver — or someone deleting the animation
    // outright — satisfies every check above vacuously.
    const { packages } = staticClosure(entry('components/ResultsSummary.tsx'))
    expect(packages.has('gsap')).toBe(true)
  })

  test('both importers of ResultsSummary load it lazily', () => {
    // The direct, readable check on the two sites that used to be eager, so the intent
    // is legible without reverse-engineering the graph walker.
    for (const rel of EAGER_CLIENT_ENTRIES) {
      const src = readFileSync(entry(rel), 'utf8')
      expect(src).not.toMatch(/^import\s+ResultsSummary\s+from/m)
      expect(src).toContain("dynamic(() => import('@/components/ResultsSummary')")
    }
  })

  test('recharts is confined to a lazy chunk, via a type-only chart import', () => {
    // Named separately because this exemption took the most care: the only direct
    // reference to `chart.tsx` outside itself is `import type`, which is erased, so the
    // eager graph never reaches recharts. If someone changes it to a VALUE import, the
    // eager-closure check above catches it; this states the mechanism so a reader need
    // not re-derive it.
    const src = readFileSync(entry('components/org/StudentProfile.tsx'), 'utf8')
    expect(src).toContain("import type { ChartConfig } from '@/components/9ui/ui/chart'")
    expect(src).toContain("dynamic(() => import('./PerformanceChart')")
  })

  test('no EAGER client entry reaches recharts either', () => {
    // The same class as gsap, checked for the other heavy visual. Confines it to the
    // lazy `PerformanceChart` chunk.
    for (const rel of EAGER_CLIENT_ENTRIES) {
      const { packages } = staticClosure(entry(rel))
      expect(packages.has('recharts')).toBe(false)
    }
  })
})
