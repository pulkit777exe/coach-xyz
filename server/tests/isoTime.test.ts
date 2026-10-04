import { describe, expect, test } from 'bun:test'

import { toIsoString, toOptionalIsoString } from '../src/lib/isoTime'

// ── The behaviour of the shared normaliser ───────────────────────────────────
// `isoTimeGuard.test.ts` proves a private copy has not reappeared. This proves the
// replacement is correct, and the two differ on exactly one input — which is the
// whole reason they are two functions and not one.

describe('toIsoString (non-nullable timestamptz)', () => {
  test('passes a Date through unchanged', () => {
    const d = new Date('2026-09-15T10:30:00.000Z')
    expect(toIsoString(d)).toBe('2026-09-15T10:30:00.000Z')
  })

  test('parses a string, and normalises an offset to UTC', () => {
    // An offset instant and its UTC form are the same moment, so the output must
    // be the UTC one — otherwise two writes of the same instant differ by string.
    expect(toIsoString('2026-09-15T12:00:00+02:00')).toBe('2026-09-15T10:00:00.000Z')
  })

  test('a date-only string is midnight UTC', () => {
    expect(toIsoString('2026-09-15')).toBe('2026-09-15T00:00:00.000Z')
  })

  test('THROWS on a value it cannot parse', () => {
    // Deliberate, and the reason this is not the nullable form: every caller is a
    // non-nullable column, so "this should be an instant and is not" is a real
    // defect. A silent '' or null would bury the cause in a wrong value rather
    // than a stack trace.
    expect(() => toIsoString('not-a-date')).toThrow()
  })
})

describe('toOptionalIsoString (nullable timestamptz, or a projection)', () => {
  test('null and undefined stay null', () => {
    expect(toOptionalIsoString(null)).toBeNull()
    expect(toOptionalIsoString(undefined)).toBeNull()
  })

  test('a Date and a parseable string both normalise', () => {
    expect(toOptionalIsoString(new Date('2026-09-15T10:30:00.000Z'))).toBe(
      '2026-09-15T10:30:00.000Z',
    )
    expect(toOptionalIsoString('2026-09-15T12:00:00+02:00')).toBe('2026-09-15T10:00:00.000Z')
  })

  test('an unparseable value is null, not a thrown RangeError', () => {
    // The behaviour the six copies disagreed about. `notificationPrefs` returned
    // null (its own comment: "or an absent projection"); `privacyRequests` and
    // the other four threw, because they guarded only `null`. Keeping the null is
    // the safer of the two, and `privacyRequests` is the one caller that changes:
    // a 500 becomes a null on an input the database cannot produce.
    expect(toOptionalIsoString('not-a-date')).toBeNull()
    expect(toOptionalIsoString('')).toBeNull()
  })

  test('an Invalid Date is null rather than a thrown RangeError', () => {
    expect(toOptionalIsoString(new Date('nope'))).toBeNull()
  })
})
