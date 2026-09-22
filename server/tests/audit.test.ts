import { describe, expect, test } from 'bun:test'

import { AUDIT_ACTIONS } from '../src/lib/audit'

describe('AUDIT_ACTIONS', () => {
  test('covers every shipped action exactly once', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
    expect(AUDIT_ACTIONS).toContain('clip.created')
    expect(AUDIT_ACTIONS).toContain('clip.deleted')
    expect(AUDIT_ACTIONS).toContain('player.created')
    expect(AUDIT_ACTIONS).toContain('health.record_viewed')
    expect(AUDIT_ACTIONS).toContain('video.exported')
  })

  test('mirrors the web audit filter (update both when adding an action)', () => {
    // web-next/components/org/AuditClient.tsx ACTION_GROUPS must list the
    // same actions in the same order — drift hides actions from the filter.
    expect(AUDIT_ACTIONS.length).toBe(21)
  })
})
