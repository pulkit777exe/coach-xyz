import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── The state fixes, pinned by the properties that are easy to undo by accident ────────
//
// A blind audit found reads collapsing into confident claims; five fixes landed with no
// tests, so nothing would stop a well-meaning edit from putting each defect back. This file
// does not re-test the copy — it pins the ORDERINGS, KEYINGS and CONTROL-FLOW decisions that
// every one of those fixes turned on, because each is a single line that can be moved without
// any type error and with no visible consequence in review.
//
// SOURCE assertions, stated up front because it matters: these components fetch from hooks
// with abort controllers and effects, so asserting their behaviour by rendering means standing
// up each one with a mocked fetch, a mock roster, and a mounted router. What a source
// assertion CAN settle is precisely the class of thing that broke here — a branch order, a
// fallback label, a rethrow, an `else` that is missing. Each is mutation-checked below, and a
// mutation that came back green is recorded in the comment on the assertion that caught it.

const ROOT = join(import.meta.dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

const sidebar = read('components', 'SidebarSearch.tsx')
const bell = read('components', 'notifications', 'NotificationBell.tsx')
const link = read('components', 'org', 'AnalysisLinkControl.tsx')
const history = read('app', 'dashboard', 'history', 'page.tsx')
const wellness = read('components', 'org', 'WellnessSection.tsx')
const plans = read('components', 'org', 'PlansSection.tsx')
const clips = read('components', 'ClipsSection.tsx')
const invites = read('components', 'org', 'InvitesClient.tsx')

/** Index of `needle`, searching from `from`; -1 when absent. */
const at = (src: string, needle: string, from = 0) => src.indexOf(needle, from)

describe('a failed read is never re-reported as an empty one', () => {
  // ── ORDER ──────────────────────────────────────────────────────────────────────────
  const ORDERED = [
    // `playersFailed` in SidebarSearch is NOT a ternary arm: the fix built a four-armed chain
    // (`playersFailed ? … : searching ? … : query.trim() ? …`), so the flag is tested without a
    // `?`. My matcher demanded a ternary and reported the flag ABSENT — a shape assumption
    // rather than the property being asserted. `arm` overrides the matcher per case.
    {
      name: 'SidebarSearch',
      src: sidebar,
      fail: 'playersFailed',
      empty: "'No matches.'",
      arm: /\n\s*\{playersFailed\n/,
    },
    { name: 'WellnessSection', src: wellness, fail: 'checkinsFailed', empty: 'No check-ins yet.' },
    { name: 'PlansSection', src: plans, fail: 'plansFailed', empty: 'No training plans yet.' },
    { name: 'ClipsSection', src: clips, fail: 'failed', empty: 'No clips yet' },
  ] as const

  for (const c of ORDERED) {
    test(`${c.name}: the failure branch is decided before the empty copy`, () => {
      // A failed read leaves the list empty, so the reverse order routes the failure into the
      // empty branch and reinstates the original defect with the fix still in the file.
      // `at` is anchored on the RENDER's use, not the declaration — anchoring on the name
      // finds `const [xFailed, setXFailed] = useState(...)` and is satisfied by neutering the
      // render entirely, which is how the roster guard's first version came back green.
      // `[^=]*` is UNBOUNDED, so `failed\b[^=]*\?` can start at any occurrence of the name
      // and run to a `?` far downstream — which is why deleting the whole branch left this
      // green. The class is now bounded to a single ternary arm, which is the thing being
      // ordered.
      const fail =
        'arm' in c && c.arm
          ? c.src.search(c.arm)
          : c.src.search(new RegExp(`\\{?${c.fail}\\s*\\?\\s*\\(`))
      expect(fail, `${c.name} must branch on ${c.fail}`).toBeGreaterThan(-1)
      const empty = at(c.src, c.empty, fail)
      expect(empty, `${c.name}: the empty copy must come AFTER the failure branch`).toBeGreaterThan(
        fail,
      )
    })
  }

  test('InvitesClient prints no pending COUNT at all when the read failed', () => {
    // The count is the defect, not the copy: "0 pending" is a number about the org, and there
    // is no honest number to print when the read failed.
    // ORDER, not absence: `{pending.length}` must sit in the NON-failed arm, so the fallback
    // text is what renders when the read failed. My first version asserted the count string
    // was absent from a 400-char window, which says nothing about which arm renders.
    const fallback = at(invites, 'Pending count unavailable.')
    const count = at(invites, 'pending.length')
    expect(fallback).toBeGreaterThan(-1)
    expect(count).toBeGreaterThan(-1)
    expect(
      fallback,
      'the unavailable fallback must be decided BEFORE the count renders',
    ).toBeLessThan(count)
    expect(invites.slice(Math.max(0, fallback - 300), fallback)).toMatch(/Failed\b/)
  })

  test('WellnessSection keeps the 403 refusal OUT of the failure flag', () => {
    // A refusal is a real answer, not a broken read. Setting `failed` on the 403 branch would
    // tell medical staff their read broke when the server correctly refused them.
    const denied = at(wellness, 'setDenied(true)')
    expect(denied).toBeGreaterThan(-1)
    const branch = wellness.slice(denied, denied + 260)
    expect(branch).not.toMatch(/set(Checkins)?Failed\(true\)/)
  })

  // ── KEYING ─────────────────────────────────────────────────────────────────────────
  test('WellnessSection keys its outcome by studentId, not by a bare boolean', () => {
    // Without the key, student A's rows sit under a "Loading…" line for student B — the same
    // class as TeamsClient's `panelError?.teamId === selectedId`.
    expect(wellness).toMatch(/checkinsOutcome\?\.studentId !== studentId/)
    expect(wellness).not.toMatch(/const checkinsLoading = loading/)
  })

  // ── FALLBACK LABEL ────────────────────────────────────────────────────────────────
  test('AnalysisLinkControl falls back to "Linked", never to the unlinked label', () => {
    // Falling back to the unlinked label would tell a coach their own linked analysis is
    // unattached. Wrong label is worse than no label.
    // The ternary legitimately ENDS in UNLINKED_LABEL — that is the correct unlinked arm. My
    // first version asserted the label was absent, which would have demanded deleting correct
    // behaviour. The property is the ORDER of the arms: linked name, then hasLink -> 'Linked',
    // and only then the unlinked label.
    expect(link).toMatch(/linkedStudent\.full_name : hasLink \? ['"]Linked['"] : UNLINKED_LABEL/)
  })

  test('AnalysisLinkControl only renders nothing when the analysis is genuinely unlinked', () => {
    expect(link).toMatch(/students\.length === 0 && linkedId === null/)
    // …and the two data pieces are named separately, because they are separate facts.
    expect(link).toContain('linkedId')
    expect(link).toContain('rosterFailed')
  })

  // ── CONTROL FLOW ──────────────────────────────────────────────────────────────────
  test('NotificationBell records the failure AND rethrows', () => {
    // Swallowing at BOTH levels was the defect: `.catch(() => { /* Non-fatal */ })` meant an
    // outage rendered an empty bell reading "No notifications yet". Recording without
    // rethrowing would leave the mount call site's own catch as the only consumer.
    expect(bell).toMatch(/if \(!controller\.signal\.aborted\) setLoadFailed\(true\)/)
    expect(bell).toMatch(/setLoadFailed\(true\)\n\s*throw err/)
    // The old shape was a catch whose whole body was a comment.
    expect(bell).not.toMatch(/\.catch\(\(\) => \{\s*\/\*[^*]*\*\/\s*\}\)/)
  })

  test('NotificationBell does not stamp a failure on unmount', () => {
    // Without the abort guard, tearing the component down records a failure against a live
    // one, and the next open shows "Notifications failed to load" for a bell that worked.
    expect(bell).toMatch(/if \(!controller\.signal\.aborted\) setLoadFailed\(true\)/)
  })

  test('history: the error banner and the empty state are MUTUALLY EXCLUSIVE', () => {
    // Stacked, they showed a red "Failed to load history" beside "No analyses found — Upload a
    // video" with a live Start button: two contradictory states, and the one inviting a
    // DUPLICATE upload was the prominent one.
    // The two arms are mutually exclusive because they are the SAME ternary, so what matters
    // is that the empty arm is the `else` of the error arm rather than a sibling block.
    expect(history).toMatch(/\{error \? \([\s\S]*?\) : analyses\.length === 0 \?/)
    expect(history).not.toMatch(/\}\)\s*\}\s*\n\s*\{error \?/)
  })

  test('SidebarSearch clears the failure at the START of an attempt, not only on success', () => {
    // Clearing only on success leaves the previous failure standing through a whole retry — a
    // flag reporting on the past tense. Same lesson as `clearPanelFailure`.
    // FOUR sites clear it, and the one that matters is the one inside the ATTEMPT — clearing
    // only in the palette-reset and on success would leave the flag standing through a retry.
    const clears = [...sidebar.matchAll(/setPlayersFailed\(false\)/g)]
    expect(clears.length).toBeGreaterThanOrEqual(2)
    // Every clearing must sit within reach of the fetch kick-off rather than only in a reset.
    expect(sidebar).toMatch(
      /setPlayersFailed\(false\)[\s\S]{0,300}(setSearching|searchPlayers|void |const )/,
    )
  })

  test('every file asserted on still exists and still contains its landmark', () => {
    // So a rename cannot leave this passing vacuously against files that are gone.
    for (const [src, needle] of [
      [sidebar, 'playersFailed'],
      [bell, 'loadFailed'],
      [link, 'rosterFailed'],
      [history, 'analyses.length === 0'],
      [wellness, 'checkinsOutcome'],
      [plans, 'plansFailed'],
      [clips, 'setFailed'],
      [invites, 'invitesFailed'],
    ] as const) {
      expect(src).toContain(needle)
    }
  })
})
