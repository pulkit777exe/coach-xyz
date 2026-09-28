// `pickUuid` and `pickInt` are the two boundary helpers that turn a malformed
// request into a 400 instead of a 500 from Postgres, so their contract is worth
// pinning directly. Both are pure, which is the point: they run before the store
// is touched, so a fixture can test them even though no fixture can test what
// happens after.

import { describe, expect, it } from 'bun:test'
import { UUID_RE, pickInt, pickUuid } from '../src/lib/uuid'

const A_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('UUID_RE', () => {
  it('accepts the canonical 8-4-4-4-12 form in either case', () => {
    expect(UUID_RE.test(A_UUID)).toBe(true)
    expect(UUID_RE.test(A_UUID.toUpperCase())).toBe(true)
  })

  it.each([
    'not-a-uuid',
    '',
    '3f2504e0-4f89-11d3-9a0c',
    `${A_UUID}-extra`,
    ' 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    '3f2504e04f8911d39a0c0305e82c3301',
    '../../etc/passwd',
    '1; drop table students',
  ])('rejects %j', (value) => {
    expect(UUID_RE.test(value)).toBe(false)
  })
})

describe('pickUuid', () => {
  it('returns the value when it is a uuid', () => {
    expect(pickUuid(A_UUID)).toBe(A_UUID)
  })

  it.each([null, undefined, '', 'not-a-uuid', 42, {}, true, ` ${A_UUID}`])(
    'returns null for %j',
    (value) => {
      expect(pickUuid(value)).toBeNull()
    },
  )

  it('rejects a non-string container', () => {
    // Kept out of the it.each table above: Bun reads an array element there as a
    // tuple of arguments, and this case hangs the runner for its full timeout.
    for (const value of [[], [A_UUID], { id: A_UUID }]) {
      expect(pickUuid(value)).toBeNull()
    }
  })

  it('distinguishes absent from malformed only by returning null for both', () => {
    // Deliberate: for a filter parameter, "absent" and "malformed" both mean the
    // caller supplied nothing usable. Routes that must reject a malformed value
    // test `raw !== null && !pickUuid(raw)` rather than relying on this.
    expect(pickUuid(null)).toBeNull()
    expect(pickUuid('nope')).toBeNull()
  })
})

describe('pickInt', () => {
  const bounds = { min: 1, max: 100, fallback: 20 } as const

  it('returns a value inside the bounds unchanged', () => {
    expect(pickInt('50', bounds)).toBe(50)
    expect(pickInt('1', bounds)).toBe(1)
    expect(pickInt('100', bounds)).toBe(100)
  })

  it('clamps rather than forwarding an out-of-range value to Postgres', () => {
    expect(pickInt('0', bounds)).toBe(1)
    expect(pickInt('-5', bounds)).toBe(1)
    expect(pickInt('101', bounds)).toBe(100)
  })

  it.each(['abc', '', '  ', '1e999', '-Infinity', 'NaN', '12abc', null, undefined, {}])(
    'falls back for %j',
    (value) => {
      expect(pickInt(value, bounds)).toBe(20)
    },
  )

  it.each(['', ' ', '\t', '\n'])('treats a blank value %j as absent, not as zero', (value) => {
    // Number('') is 0, which the clamp would turn into `min` — so `?limit=`
    // would silently narrow a list to one item instead of using the default.
    expect(pickInt(value, bounds)).toBe(20)
  })

  it('truncates a float rather than passing one to a LIMIT', () => {
    expect(pickInt('7.9', bounds)).toBe(7)
  })

  it('honours a zero lower bound', () => {
    // offset legitimately starts at 0, which the attendance-shaped bounds above
    // (min 1) would have clamped away.
    expect(pickInt('0', { min: 0, max: 10, fallback: 0 })).toBe(0)
  })

  it('never returns a non-finite number, which is the whole point', () => {
    for (const value of ['abc', '1e999', '-1e999', 'Infinity', '-Infinity', '']) {
      const result = pickInt(value, bounds)
      expect(Number.isFinite(result), `pickInt(${JSON.stringify(value)})`).toBe(true)
    }
  })
})
