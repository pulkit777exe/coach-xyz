import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// ── The RSC data-access rule, enforced across app/ ───────────────────────────
//
// `AGENTS.md` states it as a per-request invariant:
//
//   RSC pages import data fetchers from `lib/serverData.ts` (React.cache-wrapped)
//   and the session via `lib/session.ts` (`getSession`, React.cache) — never call
//   `lib/org`/`lib/api` fetchers or `auth0.getSession()` directly from pages.
//
// The reason is deduplication: `getSession` and `getOrgContext` are React.cache
// -wrapped, so N calls in one render are ONE request. A page that reaches past
// them re-issues that request per call site, and on a dashboard page with a
// handful of tiles that is the difference between one session fetch and six.
//
// Why a source scan: the rule is about an IMPORT SHAPE. Rendering each page would
// need a DOM, a request context and a live API, none of which exist here — and
// reading the import list is not a proxy for the rule, it is the rule.
//
// WHAT THIS FILE DOES NOT FLAG, because doing so would be wrong:
//   - `import type { … }` — erased at compile time, no request, no cost. Several
//     pages legitimately import their types from `@/lib/api` / `@/lib/org`, and
//     the first version of this scan flagged all ten of them. That would have
//     driven someone to delete correct code to satisfy a test.
//   - CONSTANTS (`REPORT_TYPE_LABELS`) — a frozen label map, not a fetcher.
//
// Both are distinguished below by parsing each import statement individually. An
// earlier attempt used a greedy regex that spanned statements and reported
// nonsense like `["getSession } from '@/lib/session'"]`, which is the failure
// mode of checking imports with a regex instead of parsing them.
//
// This is a source-level guard and says so, in the spirit of `typeScale.test.ts`:
// it sees the import statement, not the rendered output. What it cannot check is
// whether a page fetches the right THING, or whether it calls `noStore()`.

const APP_DIR = join(import.meta.dirname, '..', '..', 'app')

/**
 * Modules whose exported FUNCTIONS perform requests, and which therefore must be
 * reached through `lib/serverData.ts` rather than imported directly by a page.
 *
 * This list was already stale when an independent audit read it: it named four
 * modules and missed `@/lib/meApi` and `@/lib/teams`, both of which perform requests
 * AND both of which have cached wrappers in `serverData` — so the dedup path existed
 * for them while the guard watched neither. `parseImports` `continue`s on an unlisted
 * specifier, so a page doing `import { listTeams } from '@/lib/teams'` passed the
 * guard while re-fetching per call site, and the guard was green while it happened.
 *
 * A test below now asserts this list stays complete against `lib/serverData.ts`'s own
 * imports, so the drift cannot come back — the lesson being that a hand-maintained
 * list reads exactly like a derived one until something needs adding to it.
 *
 * `orgContext`, `orgCookie` and `session` are deliberately absent: `serverData`
 * imports them but they hold no request-performing export of their own, so watching
 * them would flag the wrapper module's own legitimate imports.
 */
const FETCHER_MODULES = [
  '@/lib/meApi',
  '@/lib/user',
  '@/lib/library',
  '@/lib/members',
  '@/lib/org',
  '@/lib/teams',
  // Performs requests too, and is legitimately imported by the UNAUTHENTICATED
  // share page, which has no session to dedupe against (an exemption below). Watched
  // anyway: the exemption is per-IMPORT while the guard is per-MODULE, so keeping it
  // listed is what stops the share page becoming cover for a new violation elsewhere.
  '@/lib/aiReports',
]

function appFiles(dir = APP_DIR, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) appFiles(full, out)
    else if (/\.(tsx?|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** One parsed import: the module and the value bindings it brings in. */
type Binding = { specifier: string; values: string[]; typeOnly: boolean }

/**
 * Parse import statements one at a time.
 *
 * `import type { X } from 'm'` yields `{ typeOnly: true }`; `import { X } from 'm'`
 * yields the named values; a bare `import 'm'` or default import is recorded with
 * whatever it binds. Matching is done statement-by-statement rather than with one
 * greedy regex across the file, which is what produced nonsense before.
 */
function parseImports(source: string): Binding[] {
  const out: Binding[] = []
  const stmt = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g
  for (const m of source.matchAll(stmt)) {
    const typeOnly = Boolean(m[1])
    const clause = m[2] ?? ''
    const specifier = m[3] ?? m[4] ?? ''
    if (!specifier) continue
    if (!FETCHER_MODULES.includes(specifier)) continue
    const values: string[] = []
    const braced = /\{([\s\S]*?)\}/.exec(clause)
    if (braced) {
      for (const raw of braced[1].split(',')) {
        const name = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim()
        if (name) values.push(name)
      }
    }
    // A default import binds the module's main export by convention.
    const def = clause
      .replace(/\{[\s\S]*?\}/, '')
      .replace(/,/g, '')
      .trim()
    if (def && !def.startsWith('*')) values.push('default')
    out.push({ specifier, values, typeOnly })
  }
  return out
}

/**
 * A binding that performs a request, as opposed to a type or a constant.
 *
 * The export lists are the real contract — a lowerCamelCase name in these modules
 * is a fetcher (`orgStudents`, `getMyReport`), while SCREAMING_CASE is a frozen
 * constant (`REPORT_TYPE_LABELS`). Deriving the split from the naming convention
 * keeps this in step with the modules without hand-listing every export.
 */
function isRequestBinding(name: string): boolean {
  if (name === 'default') return false
  if (/^[A-Z0-9_]+$/.test(name)) return false // REPORT_TYPE_LABELS
  return /^[a-z]/.test(name)
}

const files = appFiles().map((full) => ({
  path: relative(join(APP_DIR, '..'), full),
  source: readFileSync(full, 'utf8'),
}))

/**
 * Pages that are exempt, each with the reason it is exempt.
 *
 * An exemption list is only honest if it says WHY, because "exempt" is otherwise
 * just a place to hide the next violation. Both of these were reported as
 * violations by the first version of this scan, and both are correct as written.
 */
const EXEMPT: Record<string, string> = {
  // Unauthenticated BY DESIGN — a share link must work for a reader with no
  // login, so there is no getSession to dedupe against and no org context to
  // resolve. It calls resolveShareToken once, on its own.
  'app/share/[token]/page.tsx':
    'public share page: unauthenticated by design, one uncached call by construction',

  // This IS the proxy. `web-next/proxy.ts` forwards /api/* to the server and this
  // route is the server-side half, so reaching the raw fetcher is its job — and it
  // reads auth0 directly because verifying the caller IS its purpose. The rule
  // exists for RSC PAGES; a route handler is not one.
  'app/api/service/[[...path]]/route.ts':
    'the service proxy itself: it is the layer the wrappers call through',
}

const isExempt = (path: string): boolean => path in EXEMPT

const isClient = (src: string) => /^\s*(['"])use client\1/.test(src)
const serverFiles = files.filter((f) => !isClient(f.source))
const clientFiles = files.filter((f) => isClient(f.source))

describe('the RSC data-access rule holds across app/', () => {
  test('the scan found the app tree, and both kinds of module', () => {
    // Non-vacuity: a scan matching nothing asserts everything trivially.
    expect(files.length).toBeGreaterThan(30)
    expect(serverFiles.length).toBeGreaterThan(20)
    expect(clientFiles.length).toBeGreaterThan(0)
  })

  test('no server page imports a REQUEST function from a non-cached module', () => {
    const violations = serverFiles
      .filter((f) => !isExempt(f.path))
      .flatMap((f) =>
        parseImports(f.source)
          .filter((b) => !b.typeOnly && b.values.some(isRequestBinding))
          .map(
            (b) =>
              `${f.path} imports ${b.values.filter(isRequestBinding).join(', ')} from ${b.specifier}`,
          ),
      )
    expect(violations).toEqual([])
  })

  test('no server page calls auth0.getSession() directly', () => {
    // `getSession` from lib/session is React.cache-wrapped; `auth0.getSession()`
    // is not, so calling it from a page re-runs verification per call site.
    const violations = serverFiles
      .filter((f) => /auth0\.getSession\s*\(/.test(f.source))
      .filter((f) => !/export (const|async function) getSession/.test(f.source))
      .filter((f) => !isExempt(f.path))
      .map((f) => f.path)
    expect(violations).toEqual([])
  })

  test('every exemption names a reason', () => {
    // An exemption with an empty or vague reason is how the list rots.
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(20)
      expect(files.some((f) => f.path === path)).toBe(true)
    }
    expect(Object.keys(EXEMPT).length).toBe(2)
  })

  test('the watch list covers every module serverData wraps — derived, not remembered', () => {
    // The guard's own blind spot, closed. `FETCHER_MODULES` was a hand-written list
    // of four modules; `@/lib/meApi` and `@/lib/teams` were missing while BOTH had
    // cached wrappers in `serverData`, which is the whole point of the wrapper. So a
    // page could import `listTeams` straight from `@/lib/teams`, re-fetch per call
    // site, and pass — and the guard was green the entire time.
    //
    // Derived from `serverData`'s own imports rather than restated, because the
    // failure mode is precisely a list that reads complete until something is added
    // to the thing it mirrors. `orgContext`, `orgCookie` and `session` are excluded
    // by name: they hold no request-performing export.
    const source = readFileSync(
      join(import.meta.dirname, '..', '..', 'lib', 'serverData.ts'),
      'utf8',
    )
    const NOT_FETCHERS = new Set(['orgContext', 'orgCookie', 'session'])
    const wrapped = [...source.matchAll(/from\s*['"]\.\/([A-Za-z0-9_]+)['"]/g)]
      .map((m) => m[1])
      .filter((name) => !NOT_FETCHERS.has(name))
    expect(wrapped.length).toBeGreaterThan(0)
    const unwatched = [...new Set(wrapped)]
      .filter((name) => !FETCHER_MODULES.includes(`@/lib/${name}`))
      .map((name) => `@/lib/${name}`)
    expect(unwatched).toEqual([])
  })

  test("no 'use client' module imports a server-only data source", () => {
    // A client component has no render pass to cache within, so importing
    // `lib/serverData` is itself the bug: it loses the dedup the wrapper exists
    // for and ships a fetcher into the browser bundle.
    const violations = clientFiles
      .filter((f) => /from\s*['"][^'"]*(serverData|session)['"]/.test(f.source))
      .map((f) => f.path)
    expect(violations).toEqual([])
  })

  test('type-only and constant imports are correctly NOT flagged', () => {
    // The first version of this scan reported all ten of these as violations,
    // which was wrong: `import type` is erased at compile time. Pinning the
    // distinction means a future edit to the parser cannot quietly re-break it.
    const typeOnly = serverFiles.flatMap((f) =>
      parseImports(f.source)
        .filter((b) => b.typeOnly)
        .map((b) => `${f.path}:${b.specifier}`),
    )
    // The scan must be able to SEE type-only imports…
    expect(typeOnly.length).toBeGreaterThan(0)
    // …while excluding them from the violation list.
    const dashboard = serverFiles.find((f) => f.path.endsWith('dashboard/page.tsx'))
    expect(dashboard).toBeDefined()
    const dashboardValues = parseImports(dashboard!.source).filter((b) => !b.typeOnly)
    expect(dashboardValues.every((b) => !b.values.some(isRequestBinding))).toBe(true)

    // A constant is not a fetcher.
    expect(isRequestBinding('REPORT_TYPE_LABELS')).toBe(false)
    expect(isRequestBinding('orgStudents')).toBe(true)
    expect(isRequestBinding('default')).toBe(false)
  })

  test('the wrapper is actually used, so the rule is not vacuous', () => {
    const usingWrapper = serverFiles.filter((f) =>
      /from\s*['"]@\/lib\/(serverData|session)['"]/.test(f.source),
    )
    // If nothing used the wrapper, every page would satisfy the rule by having no
    // imports at all — which is what "vacuously true" looks like for a scan.
    expect(usingWrapper.length).toBeGreaterThan(10)
  })
})

describe('the limits of this guard, stated rather than implied', () => {
  test('it reads imports, not behaviour — so it is not proof a page renders', () => {
    // Asserting the LIMIT on purpose: a green run here must never be read as
    // "these pages work". A page importing the right symbol and never calling it
    // passes; a page fetching the WRONG data through the right wrapper passes.
    // Those are what the contract tests and a real render are for.
    const file = serverFiles.find((f) => f.path.endsWith('dashboard/page.tsx'))
    expect(file).toBeDefined()
    expect(file!.source.length).toBeGreaterThan(0)
  })

  test('the noStore() requirement on authenticated pages is NOT checked here', () => {
    // Named as a known gap. `AGENTS.md` requires unstable_noStore on
    // authenticated dashboard pages serving fresh data; nothing in this file
    // verifies it, and pretending otherwise would be the same error as the
    // original 43-skip gate — a claim in the ledger that no assertion backs.
    const noStorePages = serverFiles.filter((f) => /unstable_noStore|noStore\(\)/.test(f.source))
    expect(noStorePages.length).toBeGreaterThan(0)
    // Recorded, not asserted: the count is informational so a drop is visible in
    // a diff rather than silent.
  })
})
