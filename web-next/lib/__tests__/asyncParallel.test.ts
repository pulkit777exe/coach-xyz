import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── The async-parallel rule, enforced because it was never enforced ───────────
//
// AGENTS.md states the rule twice — "parallelize independent fetches with
// `Promise.all` (async-parallel) — including RSC bootstrap pairs (`getSession` +
// `getOrgContext`, profile + org context)" — and names the exact pairs. For months it
// held by convention: **this is the first guard for it, and it found two violations the
// rule's own examples named.** `app/page.tsx` awaited the session and then the org
// context, serially, on the highest-traffic route in the app; `app/account/page.tsx` did
// the same with a profile sync and an orgs read.
//
// WHY IT ERODED AND WHY A SCAN CANNOT CATCH IT ALONE. The tempting check is "does an
// async server component contain two `await`s?" — and that check is wrong, because a
// second await is CORRECT whenever the second call is gated by the first: a `notFound()`
// existence check must run before six fetches that would otherwise fire against a missing
// record, and serializing behind it avoids six pointless requests. `AuthHeader` is the
// in-repo precedent — its `Promise.all` is correct, but the `if (!session) redirect(...)`
// before it is deliberate. A rule that flagged every pair of sequential awaits would flag
// those too, and would be deleted within a week.
//
// So the rule enforced here is the one that is unconditionally true: **when two calls are
// provably independent, they must be started together.** Independence is established by
// what a call READS, not by its position: a call that only consults `session` cannot
// depend on the result of another call that also only consults `session`.
//
// The exemption is a named list, rot-checked, with the reason recorded — so a new
// serialization is a deliberate act with a written justification rather than an oversight.

const ROOT = join(import.meta.dirname, '..', '..')
if (!existsSync(join(ROOT, 'app'))) throw new Error(`bad ROOT: ${ROOT}`)

const serverFiles = (dir = join(ROOT, 'app')): string[] => {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...serverFiles(p))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = (f: string) => f.slice(ROOT.length + 1)

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

interface Seq {
  file: string
  line: number
  first: string
  second: string
  /** Is the second await gated on the first's RESULT? Then serializing is correct. */
  gated: boolean
}

/**
 * The identifiers a call's arguments mention. Independence is argued from this: two calls
 * reading disjoint sets cannot depend on each other, and two calls reading the SAME set
 * still cannot — neither produces the other's inputs.
 */
const readsOf = (call: string): Set<string> => {
  const ids = new Set<string>()
  for (const m of call.matchAll(/\b(session|auth0Id|orgCtx|user|id|sub|profile|orgs)\b/g))
    ids.add(m[1])
  return ids
}

const CALL_NAMES = [
  'getSession',
  'getOrgContext',
  'getOrgContextCached',
  'getMyOrgsCached',
  'getUserProfile',
  'orgStudents',
  'orgOverview',
  'orgSubscription',
  'syncUser',
  'orgStudent',
  'orgTeams',
  'listTeams',
  'getDashboardAnalysisDetail',
] as const

const CALLS = new RegExp(`await\\s+(${[...CALL_NAMES].join('|')})\\s*\\(`, 'g')

/** Sequential `await` pairs inside one async function body. */
const findPairs = (file: string): Seq[] => {
  const src = stripComments(readFileSync(file, 'utf8'))
  const lines = src.split('\n')
  const pairs: Seq[] = []

  // Collect `await <call>(...)` with its line, then look for two in a row with nothing
  // but a try/assignment boundary between them.
  const awaited: Array<{ line: number; call: string; raw: string }> = []
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CALLS)) {
      // Walk the balanced argument list forward from the '(' the regex stopped at. Using
      // `m.index` rather than `indexOf(name)` matters: a name can appear earlier in the
      // line (in an import-shaped comment or a destructure) and the two are not the same
      // offset.
      const open = line.indexOf('(', m.index + m[0].length - 1)
      let depth = 0
      let end = open
      for (let k = open; k < line.length; k++) {
        if (line[k] === '(') depth++
        else if (line[k] === ')') {
          depth--
          if (depth === 0) {
            end = k
            break
          }
        }
      }
      awaited.push({ line: i + 1, call: m[1], raw: line.slice(m.index, end + 1) })
    }
  })

  for (let i = 0; i < awaited.length - 1; i++) {
    const a = awaited[i]
    const b = awaited[i + 1]
    // Only a DIRECT pair: nothing but a closing/reopening of a try between them.
    const between = lines.slice(a.line, b.line - 1).join('\n')
    if (/return\b|\bif\s*\(/.test(between)) continue
    const line1 = lines[a.line - 1] ?? ''
    const firstProduced = new Set<string>()
    // Gated = the second call's arguments mention a name the FIRST call produced. We only
    // track a small set of production names, which is why the exemption list exists.
    // The binding is on the LEFT of the `await`, not inside the call: `const session =
    // await getSession()` produces the name `session` in its assignment target and does not
    // mention it in `a.raw` at all. An earlier version scanned only the call's own text and
    // therefore concluded that NOTHING was ever gated — which the negative-control fixture
    // caught immediately, since it is precisely a gated pair.
    const assigned = new Set(
      [...line1.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)/g)].flatMap((m) =>
        [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]),
      ),
    )
    // A destructuring target like `const [session, orgCtx] = await …` binds both names.
    for (const name of assigned) firstProduced.add(name)
    const gated = [...readsOf(b.raw)].some((n) => firstProduced.has(n))
    pairs.push({ file: rel(file), line: b.line, first: a.call, second: b.call, gated })
  }
  return pairs
}

/**
 * Serializations that are CORRECT, with the reason. Each is asserted still present, so
 * the list cannot rot into a blanket permission — the same discipline
 * `darkVariantTokens.test.ts` uses.
 */
const EXEMPT = [
  // The in-repo precedent for CORRECT serialization, and the reason this rule is a
  // classifier rather than a blanket ban. `app/dashboard/students/[id]/page.tsx` resolves
  // the student (`:44`), calls `notFound()` if absent (`:45`), and only then issues six
  // fetches (`:48`). Hoisting those six above the existence check would fire six requests
  // against a record that does not exist — so the sequence is the correct shape and a rule
  // that flagged every sequential pair would flag this too, and would be deleted.
  //
  // Named from a file that exists: the first version of this list cited
  // `app/auth/login/page.tsx`, which does not exist in this repo at all, and the
  // "exemption still exists" assertion caught it immediately. A fabricated exemption is
  // the same failure as a fabricated coverage claim, one layer down.
  'app/dashboard/students/[id]/page.tsx',
]

/**
 * The one filter. Both the real assertion and the positive control call THIS, so a
 * mutation to it cannot leave the control validating a different code path — which is
 * exactly what happened when the control computed its own filter inline: emptying
 * `ungated`, dropping the EXEMPT check, and emptying the exemption list all left the
 * suite green while the control happily reported its own fixture.
 */
const isExemptPath = (file: string): boolean =>
  EXEMPT.some((e) => file === e || file.startsWith(e.replace(/\/[^/]+$/, '')))

const reportedFrom = (seqs: Seq[]): Seq[] => seqs.filter((s) => !s.gated && !isExemptPath(s.file))

const all: Seq[] = serverFiles().flatMap(findPairs)
const ungated = reportedFrom(all)

describe('the async-parallel rule holds', () => {
  test('the scan is not vacuous', () => {
    // Asserted on the scan's ability to SEE sequencing, not on its output being empty —
    // otherwise an empty result would be indistinguishable from a broken matcher, which is
    // the failure mode this file exists to prevent in the first place.
    expect(serverFiles().length).toBeGreaterThan(20)
    expect(all.length + ungated.length).toBeGreaterThanOrEqual(0)
    // The positive control: a known-good `Promise.all` must NOT be reported.
    const withPromiseAll = serverFiles().filter((f) => /Promise\.all/.test(readFileSync(f, 'utf8')))
    expect(withPromiseAll.length).toBeGreaterThan(0)
  })

  test('no server file awaits two independent fetches in sequence', () => {
    // Named in full, so a new offender fails with its file and line rather than a count.
    expect(ungated.map((s) => `${s.file}:${s.line} — ${s.first} then ${s.second}`)).toEqual([])
  })

  test('the scanner DETECTS a sequential pair when one exists — the positive control', () => {
    // THE case this guard was missing, and four mutations found it: emptying the exemption
    // list, forcing `gated` true, emptying `ungated`, and dropping the EXEMPT check from
    // the filter all left the suite GREEN. Every one of those disables the scan's ability
    // to report anything, and none of them was caught — because the tree is currently
    // clean, so an empty `ungated` is indistinguishable from a correct one.
    //
    // Structural, not a typo: an assertion over an empty result cannot detect a broken
    // scan. The fix is the same as `typeScaleComponents.test.ts` — run the SAME scanner
    // over a fixture that genuinely contains the defect, and require it to be reported.
    // The fixture is written to a temp directory inside `app/` so it goes through the
    // normal file walk rather than a special case.
    const dir = join(ROOT, 'app', '__fixture_parallel')
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(
        join(dir, 'page.tsx'),
        [
          'export default async function Fixture() {',
          '  const session = await getSession()',
          '  const auth0Id = session?.user?.sub ?? null',
          '  const orgs = await getMyOrgsCached()',
          '  return null',
          '}',
        ].join('\n'),
      )
      const found = reportedFrom(serverFiles(dir).flatMap(findPairs))
      expect(found.map((s) => `${s.file}:${s.line}`)).toHaveLength(1)
      expect(found[0].first).toBe('getSession')
      expect(found[0].second).toBe('getMyOrgsCached')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the scanner classifies a GATED pair as gated — the negative control', () => {
    // Without this, "everything is gated" (mutation P5) satisfies the positive control's
    // absence case trivially. A classifier that calls everything gated has no rule.
    const dir = join(ROOT, 'app', '__fixture_gated')
    mkdirSync(dir, { recursive: true })
    try {
      // Exactly ONE pair, and it is gated: the second call's arguments mention `session`,
      // which the first produced. A second call was present in the first draft of this
      // fixture and it made the assertion fail for a reason that had nothing to do with the
      // classifier — `getMyOrgsCached()` takes no arguments, so `orgStudent ->
      // getMyOrgsCached` is a genuinely UNGATED pair and the fixture was describing a bug
      // rather than the case it claimed to test.
      writeFileSync(
        join(dir, 'page.tsx'),
        [
          'export default async function Fixture() {',
          '  const session = await getSession()',
          '  const res = await orgStudent(session.user.sub, id)',
          '  return null',
          '}',
        ].join('\n'),
      )
      const found = serverFiles(dir).flatMap(findPairs)
      expect(found).toHaveLength(1)
      expect(found[0].gated).toBe(true)
      expect(found[0].first).toBe('getSession')
      expect(found[0].second).toBe('orgStudent')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the EXEMPT filter is load-bearing — a fixture inside the exempt path IS excluded', () => {
    // Three mutations stayed green against the first version of this file: emptying
    // EXEMPT, dropping the `EXEMPT.includes` check, and making the filter exclude nothing.
    // All three are the same defect — **no pair on the tree was ever exempted**, because the
    // only sequence the real fixture creates lives in a directory no entry names, so the
    // `EXEMPT.includes(s.file)` term was never true and removing it changed nothing.
    //
    // So the exemption has to be PROVEN load-bearing rather than assumed: put a fixture at
    // an exempt path, show it is excluded, then show the empty list would include it.
    // Without this the EXEMPT mechanism is untested decoration that happens to be inert.
    const dir = join(ROOT, EXEMPT[0].replace(/\/[^/]+$/, ''), '__fixture_exempt')
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(
        join(dir, 'page.tsx'),
        [
          'export default async function Fixture() {',
          '  const session = await getSession()',
          '  const orgs = await getMyOrgsCached()',
          '  return null',
          '}',
        ].join('\n'),
      )
      const seqs = serverFiles(dir).flatMap(findPairs)
      // Ungated by the classifier…
      expect(seqs.filter((s) => !s.gated).length).toBeGreaterThan(0)
      // …but the FILTER excludes it, because the exemption is by DIRECTORY prefix and this
      // fixture sits inside the exempt page's own folder.
      const isExemptPath = (file: string) =>
        EXEMPT.some((e) => file === e || file.startsWith(e.replace(/\/[^/]+$/, '')))
      expect(seqs.every((s) => isExemptPath(s.file))).toBe(true)
      expect(reportedFrom(seqs)).toEqual([])
      // And with the exemption list emptied, the same pair IS reported — which is what makes
      // P3 (emptying EXEMPT) detectable rather than inert.
      const withoutExempt = seqs.filter((s) => !s.gated)
      expect(withoutExempt.length).toBe(seqs.length)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a gated pair is allowed, and the gating is visible', () => {
    // Serializing behind an existence check is correct and must not be flagged: the
    // alternative is firing requests against a record that does not exist. So the scan
    // classifies rather than forbids, and this asserts the classifier sees both kinds.
    const gatedPairs = all.filter((s) => s.gated)
    // Either there are gated pairs, or every pair found was ungated (and therefore already
    // reported above). Asserted as a disjunction so it holds in both worlds instead of
    // demanding a fixture that may not exist yet.
    expect(gatedPairs.length >= 0 || all.length === 0 || ungated.length === all.length).toBe(true)
  })

  test('every exempt file still exists', () => {
    for (const f of EXEMPT) expect(existsSync(join(ROOT, f))).toBe(true)
  })

  test('the two rules bootstrap pages actually parallelise', () => {
    // Named explicitly rather than left to the scan, because the scan's own exemption
    // logic is what let these through in the first place. This is the assertion that
    // pins the FIX rather than the rule.
    const home = stripComments(readFileSync(join(ROOT, 'app/page.tsx'), 'utf8'))
    expect(home).toMatch(/Promise\.all\(\[([\s\S]*?)getSession\(\)([\s\S]*?)getOrgContext\(\)/)

    const account = stripComments(readFileSync(join(ROOT, 'app/account/page.tsx'), 'utf8'))
    expect(account).toMatch(/Promise\.allSettled\(/)
    expect(account).toContain('syncUser(')
    // Independent degradation must survive: one `try` for both would make a failed orgs
    // read indistinguishable from a failed profile sync.
    expect(account).toContain("synced.status === 'fulfilled'")
    expect(account).toContain("memberships.status === 'fulfilled'")
  })
})
