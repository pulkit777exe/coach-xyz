import { describe, expect, test } from 'vitest'

import { adoptUserSettings, hasStoredUserSettings, toSyncedPatch } from '../preferencesSync'

const stored = {
  theme: 'dark' as const,
  reduceMotion: true,
  weekStartsMonday: true,
  updatedAt: '2026-09-25T10:00:00.000Z',
}

describe('preference sync', () => {
  test('a stored account row is adopted', () => {
    expect(hasStoredUserSettings(stored)).toBe(true)
    expect(adoptUserSettings(stored)).toEqual({
      theme: 'dark',
      reduceMotion: true,
      weekStartsMonday: true,
    })
  })

  test('an account that never saved keeps this device’s choices', () => {
    // The default row reports updatedAt: null — adopting it would overwrite a
    // just-made local pick with the default, so callers must skip.
    expect(hasStoredUserSettings({ ...stored, updatedAt: null })).toBe(false)
  })

  test('the pushed patch carries exactly the three synced preferences', () => {
    expect(toSyncedPatch({ theme: 'light', reduceMotion: false, weekStartsMonday: true })).toEqual({
      theme: 'light',
      reduceMotion: false,
      weekStartsMonday: true,
    })
  })

  test('the patch never carries server-owned fields', () => {
    const patch = toSyncedPatch({ theme: 'system', reduceMotion: false, weekStartsMonday: false })
    expect(Object.keys(patch).sort()).toEqual(['reduceMotion', 'theme', 'weekStartsMonday'])
    expect('updatedAt' in patch).toBe(false)
  })

  test('adoption normalizes nothing — the account values pass through', () => {
    expect(adoptUserSettings({ ...stored, theme: 'system' }).theme).toBe('system')
  })
})
