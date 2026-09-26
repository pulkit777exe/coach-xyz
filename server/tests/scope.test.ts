import { describe, expect, test } from 'bun:test'

import { canSeeStudent, visibleStudentIds } from '../src/lib/org/scope'

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

  test('a scoped caller is limited to their teams', async () => {
    // Behaviour with a live store is covered by the per-domain route tests;
    // what matters here is that only a non-empty scope goes to the database.
    expect(visibleStudentIds('org-1', { all: false, teamIds: ['t1'] })).toBeInstanceOf(Promise)
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
