import { describe, expect, test } from 'bun:test'

import { EMAIL_RE, UUID_RE, forbidOrg, isEmail, isUuid } from '../src/lib/orgRoute'

describe('org validators', () => {
  test('UUID_RE accepts v4-shaped ids only', () => {
    expect(UUID_RE.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(UUID_RE.test('not-a-uuid')).toBe(false)
    expect(UUID_RE.test('')).toBe(false)
  })

  test('isUuid narrows unknown inputs', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isUuid(42)).toBe(false)
    expect(isUuid(null)).toBe(false)
  })

  test('EMAIL_RE accepts plain addresses only', () => {
    expect(EMAIL_RE.test('coach@example.com')).toBe(true)
    expect(EMAIL_RE.test('not-an-email')).toBe(false)
    expect(EMAIL_RE.test('a@b')).toBe(false)
  })

  test('isEmail narrows unknown inputs', () => {
    expect(isEmail('coach@example.com')).toBe(true)
    expect(isEmail(undefined)).toBe(false)
    expect(isEmail('  spaced@example.com  ')).toBe(false)
  })
})

describe('forbidOrg', () => {
  test('maps to 403 with the default org message', () => {
    const box: { status?: number | string } = {}
    const body = forbidOrg(box)
    expect(box.status).toBe(403)
    expect(body).toMatchObject({ code: 'FORBIDDEN' })
  })

  test('accepts a custom message', () => {
    const box: { status?: number | string } = {}
    const body = forbidOrg(box, 'Medical staff only')
    expect(box.status).toBe(403)
    expect(body).toMatchObject({ message: 'Medical staff only' })
  })
})
