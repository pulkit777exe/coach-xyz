import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── Three properties the state fixes depend on, none of them obvious from reading ──────
//
// A blind audit found roster and dashboard reads collapsing failures into "you have none".
// The fixes thread failure flags through, and three things about HOW they are threaded are
// load-bearing in ways that read as incidental:
//
//   1. ORDER. `StudentsClient` checks `rosterFailed` BEFORE `filtered.length === 0`, because a
//      failed read also leaves the list empty and would otherwise match the "No students yet"
//      branch — reinstating the original defect with the fix still in the file.
//   2. KEYING. `TeamsClient` derives its panel state from `panelLoadedFor !== selectedId` and
//      `panelError?.teamId === selectedId` rather than storing booleans. Three stored flags
//      would survive a team switch and show TEAM A's failure against TEAM B — and switching
//      teams previously left A's rows on screen, which the same keying fixes.
//   3. CLEARING. A write that re-reads the panel must clear the failure flag, or the
//      "failed to load" banner sits on top of rows that just arrived. An agent's first cut
//      shipped exactly that and caught it itself.
//
// These are SOURCE assertions, and the file says so: the derivations live inside a component
// with hooks and three fetches, so asserting them by rendering would mean standing up the
// whole component. What a source assertion CAN settle is exactly these three — an ordering, a
// key, and a call site — and each is mutation-checked below. **A source-level guard that does
// not say it is one reads as a rendered check.**

const ROOT = join(import.meta.dirname, '..', '..')
const students = readFileSync(join(ROOT, 'components', 'org', 'StudentsClient.tsx'), 'utf8')
const teams = readFileSync(join(ROOT, 'components', 'org', 'TeamsClient.tsx'), 'utf8')
const teamsPage = readFileSync(join(ROOT, 'app', 'dashboard', 'teams', 'page.tsx'), 'utf8')
const studentsPage = readFileSync(join(ROOT, 'app', 'dashboard', 'students', 'page.tsx'), 'utf8')

/** Index of the first occurrence at or after `from`, or -1. */
const at = (src: string, needle: string, from = 0): number => src.indexOf(needle, from)

describe('a failed read cannot be re-reported as an empty one', () => {
  test('ORDER: the failure branch is decided before the empty branch', () => {
    // The specific regression: moving the empty check first makes a failed read render
    // "No students yet — Add your first student", which is the defect this whole pass exists
    // to remove. Asserted as an ORDER because that is the only thing that can change it.
    // Anchored on the RENDER's use of the flag, not its declaration: my first version took
    // `at(students, 'rosterReadFailed')`, which finds the `useState(rosterReadFailed)` on
    // line 463 — so neutering the render branch left the assertion satisfied and the mutation
    // came back green. The declaration is not the decision.
    const fail = at(students, '{rosterReadFailed ?')
    // Anchored on the TERNARY, not on the bare expression: `filtered.length === 0` occurs
    // first inside the comment that explains why this ordering exists, so the bare anchor
    // resolved there and truncated the branch before its own copy — which made the assertion
    // fail against correct code. The comment is the first mention; the ternary is the decision.
    const renderEmpty = at(students, ') : filtered.length === 0 ? (', fail)
    expect(fail).toBeGreaterThan(-1)
    expect(renderEmpty).toBeGreaterThan(fail)
    // …and the failure branch must WITHHOLD the add affordance, because the original defect
    // was a false claim shipped together with the button that acts on it: "No students yet"
    // plus a live Add button. My first version asserted both that this branch contains
    // "Add student" AND that it does not, which is self-contradictory and made the baseline
    // red for a reason that had nothing to do with the code under test.
    const failureBranch = students.slice(fail, renderEmpty)
    expect(failureBranch).toContain('Roster failed to load.')
    expect(failureBranch).not.toMatch(/<Button/)
    expect(failureBranch).not.toMatch(/Add your first student/)

    const teamFail = at(teams, 'teamsFailed')
    const teamEmpty = at(teams, 'No teams yet')
    expect(teamFail).toBeGreaterThan(-1)
    expect(teamEmpty).toBeGreaterThan(-1)
    expect(teamFail).toBeLessThan(teamEmpty)
  })

  test('KEYING: panel state is scoped to the SELECTED team, not just "a team"', () => {
    // `panelError?.teamId === selectedId` and `panelLoadedFor !== selectedId` are what stop a
    // previous team's rows and failure from being shown against the team now on screen.
    expect(teams).toContain('panelError?.teamId === selectedId')
    expect(teams).toContain('panelLoadedFor !== selectedId')
    // Every one of the three derived flags must carry the key, not just the first.
    for (const kind of ['members', 'trends', 'matches']) {
      expect(teams, `${kind}Failed must be keyed on the selected team`).toMatch(
        new RegExp(`const ${kind}Failed = [^\\n]*panelError\\?\\.teamId === selectedId`),
      )
    }
  })

  test('CLEARING: a write that re-reads the panel clears its failure flag', () => {
    // Without this the banner sits on rows that just arrived — which is what an agent's first
    // cut shipped, and which is a NEW false claim introduced by the fix for a false claim.
    expect(teams).toContain('clearPanelFailure')
    // FOUR call sites, and my first version asserted one of each — so neutering a single one
    // left the assertion satisfied and the mutation green. Every call site is counted.
    const calls = [...teams.matchAll(/clearPanelFailure\('(members|matches)'\)/g)]
    expect(calls.length).toBeGreaterThanOrEqual(4)
    expect(calls.filter((c) => c[1] === 'members').length).toBeGreaterThanOrEqual(2)
    expect(calls.filter((c) => c[1] === 'matches').length).toBeGreaterThanOrEqual(2)
    // …and StudentsClient mirrors the same reset for its re-read paths.
    expect(students).toMatch(/setRosterReadFailed\(false\)/)
  })

  test('the roster prop is mirrored into state, and the mirror has a stated reason', () => {
    // `refreshStudents` / `toggleArchived` re-run the same read, so the flag has to reset or a
    // SUCCESSFUL re-read leaves the failure banner over a loaded roster. The mirror is only
    // correct because something resets it; the test above is what proves that.
    expect(students).toMatch(/useState\(rosterFailed\)/)
  })

  test('the pages resolve to null on rejection rather than to an empty list', () => {
    // `catch(() => ({ students: [] }))` is the shape that made a failed read indistinguishable
    // from an empty org. `null` is what lets the client tell them apart at all.
    expect(studentsPage).not.toMatch(/\.catch\(\(\) => \(\{ students: \[\] \}\)\)/)
    expect(teamsPage).not.toMatch(/\.catch\(\(\) => \(\{ teams: \[\] \}\)\)/)
    expect(studentsPage).toContain('rosterFailed')
    expect(teamsPage).toContain('teamsFailed')
  })

  test('the files being asserted on are the ones that carry the flags', () => {
    // So a rename cannot leave this passing vacuously against files that no longer exist.
    for (const [src, needle] of [
      [students, 'rosterReadFailed'],
      [teams, 'panelError'],
      [studentsPage, 'rosterFailed'],
      [teamsPage, 'teamsFailed'],
    ] as const) {
      expect(src).toContain(needle)
    }
  })
})
