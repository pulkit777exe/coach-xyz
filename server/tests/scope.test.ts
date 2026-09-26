import { describe, expect, test } from 'bun:test'

import { canSeeStudent, uuidArrayLiteral, visibleStudentIds } from '../src/lib/org/scope'

// The scope seam encodes a policy with one easy-to-invert mistake: org-wide
// (null) and sees-nothing ([]) are different answers, and collapsing them
// would hide the whole org from an unassigned coach or expose it to everyone.
// These are the paths that need no store, so they stay hermetic.

describe('visibleStudentScope', () => {
  test('an org-wide scope short-circuits to null without querying', async () => {
    expect(await visibleStudentIds('org-1', { all: true })).toBeNull()
  })

  test('a caller with no teams sees no students, not every student', async () => {
    // Reaches the store only for a non-empty team list, so this is hermetic.
    expect(await visibleStudentIds('org-1', { all: false, teamIds: [] })).toEqual([])
  })

  test('a team list that filters down to nothing short-circuits to none', async () => {
    // Bun sends [] as '' which is not a valid uuid[] literal, so a list that
    // filters to empty must never reach the database. Asserting the returned
    // value (rather than only that a Promise came back) is also what keeps this
    // from firing an unhandled rejection when the suite runs against a live DB.
    expect(await visibleStudentIds('org-1', { all: false, teamIds: ['', ''] })).toEqual([])
  })
})

describe('uuidArrayLiteral', () => {
  // A raw JS array bound to a ::uuid[] parameter reaches Postgres as
  // comma-joined text and the cast fails with 22P02 — which is invisible to
  // every fixture test, since those stub `db` as a plain tag function. Pin the
  // wire format so the shape is documented rather than rediscovered live.
  test('renders a Postgres array literal', () => {
    expect(uuidArrayLiteral(['a', 'b'])).toBe('{a,b}')
    expect(uuidArrayLiteral(['only'])).toBe('{only}')
  })

  test('an empty list renders an empty literal, not a broken one', () => {
    // Callers bind NULL for the empty case (see the attendance scopeFilter);
    // this documents what the helper would produce so the choice stays explicit.
    expect(uuidArrayLiteral([])).toBe('{}')
  })

  test('ids are joined, never quoted, so the value stays data not SQL', () => {
    expect(uuidArrayLiteral(['00000000-0000-0000-0000-000000000001'])).toBe(
      '{00000000-0000-0000-0000-000000000001}',
    )
  })
})

describe('canSeeStudent', () => {
  test('null ids mean the whole org is visible', () => {
    expect(canSeeStudent(null, 'student-1')).toBe(true)
    expect(canSeeStudent(null, 'never-heard-of-them')).toBe(true)
  })

  test('an empty id list hides every student', () => {
    expect(canSeeStudent([], 'student-1')).toBe(false)
  })

  test('a scoped list admits only its own students', () => {
    expect(canSeeStudent(['student-1'], 'student-1')).toBe(true)
    expect(canSeeStudent(['student-1'], 'student-2')).toBe(false)
  })
})
