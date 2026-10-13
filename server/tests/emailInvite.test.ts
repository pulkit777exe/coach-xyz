import { describe, expect, test } from 'bun:test'

import { MAX_INVITE_BATCH, validateInviteBatch } from '../src/routes/email'

describe('validateInviteBatch', () => {
  test('accepts a small batch and normalizes addresses', () => {
    const result = validateInviteBatch(['Coach@Example.com ', 'player@example.com'])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.addresses).toEqual(['coach@example.com', 'player@example.com'])
  })

  test('rejects an empty batch', () => {
    const result = validateInviteBatch([])
    expect(result.ok).toBe(false)
  })

  test('rejects batches over the cap (one POST must not be a spam cannon)', () => {
    const batch = Array.from({ length: MAX_INVITE_BATCH + 1 }, (_, i) => `a${i}@example.com`)
    const result = validateInviteBatch(batch)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(String(MAX_INVITE_BATCH))
  })

  test('accepts exactly the cap', () => {
    const batch = Array.from({ length: MAX_INVITE_BATCH }, (_, i) => `a${i}@example.com`)
    const result = validateInviteBatch(batch)
    expect(result.ok).toBe(true)
  })

  test('rejects when no address survives shaping', () => {
    const result = validateInviteBatch(['not-an-email', 42, null])
    expect(result.ok).toBe(false)
  })
})
