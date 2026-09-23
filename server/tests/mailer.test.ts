import { describe, expect, test } from 'bun:test'

import { escapeHtml } from '../src/lib/mailer'

describe('escapeHtml', () => {
  test('escapes markup characters', () => {
    expect(escapeHtml('<b>"a"&\'b\'</b>')).toBe("&lt;b&gt;&quot;a&quot;&amp;'b'&lt;/b&gt;")
  })

  test('passes plain strings through', () => {
    expect(escapeHtml('Smoke Coach')).toBe('Smoke Coach')
  })

  test('nullish becomes empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  test('coerces Dates and numbers instead of throwing (Bun returns date columns as Date)', () => {
    expect(() => escapeHtml(new Date('2026-09-15T00:00:00Z'))).not.toThrow()
    expect(escapeHtml(new Date('2026-09-15T00:00:00Z'))).toContain('2026')
    expect(escapeHtml(7)).toBe('7')
  })
})
