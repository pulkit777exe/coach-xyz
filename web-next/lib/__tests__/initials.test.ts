import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { initials } from '@/lib/initials'

// The duplication guard needs the same ROOT the other guards use: this file lives at
// `web-next/lib/__tests__/`, which is two levels below the app root, and `ROOT` is checked
// against a known directory so a wrong value fails loudly rather than walking nothing.
const ROOT = join(import.meta.dirname, '..', '..')

/** Does this module define something that takes a name-ish parameter? */
const takesNameParam = (src: string): boolean =>
  /(?:function\s+\w*\s*\(\s*\w*name|\(\s*\w*name\s*:\s*string)/.test(src)

// ── Six copies of one helper, three behaviours, and the same player wearing two ──
//
// `initials()` existed in SIX places with THREE different implementations:
//
//   first+LAST   ×3  (app/dashboard/org, MembersSection, buildSettingsSections)
//   first+SECOND ×2  (StudentsClient, StudentProfile) — a middle name steals the second
//   substring(0,2)×3 for a single-word name, same as above — so `Cher` is `CH` in the
//                        roster and `C` on the profile
//   `initialsOf` ×1  (OwnerHome) — first+LAST but with a `'?'` fallback, and correctly
//                        filtering blank parts. Missed by the audit that found the other
//                        five, because it was named differently.
//
// The observable defect: **the same player rendered a different avatar on the roster and
// on their profile.** `"Ada Byron King"` was `AK` in one and `AB` in the other. Nobody
// wrote a test for any of the six, which is why copies drifted rather than converged.
//
// WHY THE CASES BELOW ARE PAIRS. An assertion that only covers the two-word happy path
// passes against all three implementations — they agree there. The divergence is only
// visible on three-or-more-word names and on single-word names, so every discriminating
// case has a counterpart that pins the behaviour the SSOT chose.

describe('initials', () => {
  test('two-word names take the first and last initial', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('grace hopper')).toBe('GH')
  })

  test('three-or-more-word names take the FIRST and LAST, not the first two', () => {
    // THE case the two divergent copies got wrong. A middle name must not become the
    // second initial: "Ada Byron King" is AK, and `first+SECOND` produced AB.
    expect(initials('Ada Byron King')).toBe('AK')
    expect(initials('A B C D')).toBe('AD')
    expect(initials('Jean Luc Picard Sky')).toBe('JS')
  })

  test('a single-word name yields ONE initial', () => {
    // The other discriminating case. Three copies used `substring(0, 2)`, which renders
    // `CH` for `Cher` — two letters for one word, while a two-word name renders two.
    expect(initials('Cher')).toBe('C')
    expect(initials('X')).toBe('X')
  })

  test('a blank or whitespace-only name yields an empty string, not a stray letter', () => {
    // The copies relied on `parts[0]` being non-empty, but `''.trim().split(/\s+/)` returns
    // `['']` — so an unguarded `parts[0].charAt(0)` is `''` and `undefined?.toUpperCase()`
    // is `undefined`. Asserted because "no crash" and "correct value" are different claims.
    expect(initials('')).toBe('')
    expect(initials('   ')).toBe('')
    expect(initials('\t\n ')).toBe('')
  })

  test('null and undefined are accepted, not thrown on', () => {
    // The call sites pass `profile?.name ?? identity.name`, where `identity.name` is
    // nullable — so `null` is a reachable argument, not a theoretical one.
    expect(initials(null)).toBe('')
    expect(initials(undefined)).toBe('')
    expect(initials(null, '?')).toBe('?')
  })

  test('with no name, the EMAIL supplies the initials', () => {
    // The seventh copy's behaviour, now owned by the SSOT rather than duplicated. Two
    // callers pass an email SPECIFICALLY to reach this branch (`SidebarProfileMenu.tsx:83`,
    // `HeaderClient.tsx:345`), so it is load-bearing, not incidental.
    expect(initials(null, 'grace@example.com')).toBe('GR')
    expect(initials('', 'grace@example.com')).toBe('GR')
    // And it is only a fallback: a real name wins over the email.
    expect(initials('Ada Lovelace', 'grace@example.com')).toBe('AL')
  })

  test('with neither a name nor an email, the fallback is used', () => {
    expect(initials(null, null)).toBe('')
    expect(initials(null, null, '?')).toBe('?')
    expect(initials('', '   ', '?')).toBe('?')
  })

  test('the fallback is used only when there is no name at all', () => {
    // `OwnerHome` rendered `'?'` for a member with no name. That is a deliberate product
    // choice, so it became an OPTION rather than being lost or hard-coded — and it must
    // not fire for a name that merely has no surname.
    expect(initials('Cher', '?')).toBe('C')
    expect(initials('Ada Lovelace', '?')).toBe('AL')
    expect(initials('', '?')).toBe('?')
    expect(initials(null, '?')).toBe('?')
  })

  test('hyphenated names are ONE part, so a single initial is correct', () => {
    // My first expectation here was `O'` and it was wrong: `O'Brien` is one
    // whitespace-delimited word, so the last part IS the first part and the correct answer
    // is one initial. `Jean-Luc Picard` is two parts, so `JP`.
    //
    // Recorded because the assertion looked obviously right and the implementation was
    // right — the direction that gets misdiagnosed as a bug in the helper.
    expect(initials('Jean-Luc Picard')).toBe('JP')
    expect(initials("O'Brien")).toBe('O')
    expect(initials("O'Brien O'Sullivan")).toBe('OO')
  })

  test('whitespace inside the name does not create an empty part', () => {
    // The filter is load-bearing: without it, a double space yields a part of `''` and the
    // LAST initial becomes `''`, so `'Ada  Lovelace'` would render `A`.
    expect(initials('Ada  Lovelace')).toBe('AL')
    expect(initials('  Ada Lovelace  ')).toBe('AL')
  })

  test('non-ASCII first characters are preserved', () => {
    expect(initials('José Álvarez')).toBe('JÁ')
  })
})

// ── The duplication guard, in the same file because it is the same subject ─────
//
// The behaviour tests above pass identically whether ONE implementation or SEVEN exist.
// They pin what `initials` does; nothing pinned that it is the only one — which is
// precisely how six copies with three behaviours accumulated. So the rule itself needs
// an assertion, and it needs to detect a differently-NAMED copy, since `initialsOf` was
// invisible to the name-based audit that found the other five.
describe('initials has exactly one implementation', () => {
  test('no file outside lib/initials.ts defines one', () => {
    // Matched by SHAPE as well as name: `parts[0]` combined with `.substring(0, 2)` is what
    // the three `substring` copies had, and a copy called anything at all would carry it.
    const suspects: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const rel = relative(ROOT, p)
          if (rel === 'lib/initials.ts') continue
          const src = readFileSync(join(ROOT, p), 'utf8')
          // Detected by SHAPE, not by identifier. Chasing names was the wrong approach and
          // the mutations proved it: a planted `const initials2 = (n) => …` and a
          // differently-named `initialsOf` both slipped past a name-keyed pattern, and
          // widening the name list would just be a longer list to fall out of again.
          //
          // What every hand-rolled copy has in common is the WORK: splitting a name on
          // whitespace and taking characters from the parts. So the guard looks for a
          // declaration whose body does that, which catches any name and either form.
          // `lib/initials.ts` itself is excluded above by path, not by pattern — so the
          // SSOT does not need to be shaped to avoid its own guard.
          // Narrower, and it must not fire on unrelated `split` helpers — the first
          // version of this matched ANY declaration containing `.split(` and reported 40+
          // files. An initials copy has a distinctive shape: it takes a `name`-like
          // parameter, splits it on whitespace, and takes a leading character from the
          // parts. Requiring the whitespace regex literal is what makes it specific —
          // `toJerseyNumber` splits on nothing, and `downloadCSV` has no name parameter.
          const looksLikeInitialsHelper =
            /(?:function\s+\w*[Ii]nitials\w*|const\s+\w*[Ii]nitials\w*\s*=)/.test(src)
          const splitsNameOnWhitespace = /\.split\(\s*\/\\s\+\/\s*\)/.test(src)
          if (looksLikeInitialsHelper || (splitsNameOnWhitespace && takesNameParam(src))) {
            suspects.push(rel)
          }
        }
      }
    }
    // The walk is asserted to have VISITED each root, because dropping one is otherwise
    // invisible: mutation D3 removed `walk('lib')` and this suite stayed green, since no
    // copy lives in `lib/` today. The same failure shape as a guard over an empty result.
    const visited: string[] = []
    const count = (dir: string) => {
      visited.push(dir)
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) count(p)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) visited.push(p)
      }
    }
    count('components')
    count('app')
    count('lib')
    expect(visited.some((v) => v.startsWith('components'))).toBe(true)
    expect(visited.some((v) => v.startsWith('app'))).toBe(true)
    expect(visited.some((v) => v.startsWith('lib'))).toBe(true)
    expect(visited.length).toBeGreaterThan(150)

    walk('components')
    walk('app')
    walk('lib')
    expect(suspects).toEqual([])
  })

  test('every call site imports the shared module', () => {
    // The other direction, and the one that catches a caller that kept a local copy while
    // the copy itself was removed from this check.
    const localDefs: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = readFileSync(join(ROOT, p), 'utf8')
          const rel = relative(ROOT, p)
          if (rel === 'lib/initials.ts') continue
          // A file that CALLS initials but does not import it has a local definition.
          if (/\binitials\(/.test(src) && !/from ['"]@\/lib\/initials['"]/.test(src)) {
            localDefs.push(rel)
          }
        }
      }
    }
    walk('components')
    walk('app')
    expect(localDefs).toEqual([])
  })
})
