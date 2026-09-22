import { describe, expect, it } from 'vitest'
import { cn } from '../utils'

describe('cn', () => {
  it('joins static strings and drops falsy values', () => {
    expect(cn('a', 'b')).toBe('a b')
    expect(cn('a', false, undefined, null, '', 'b')).toBe('a b')
  })

  it('flattens conditional object maps', () => {
    expect(cn('base', { 'is-active': true, hidden: false })).toBe('base is-active')
  })

  it('accepts numbers', () => {
    expect(cn('px', 2)).toBe('px 2')
  })

  it('returns a state function when a state fn is passed', () => {
    const classes = cn('base', (s: { active: boolean }) => (s.active ? 'on' : 'off'))
    expect(typeof classes).toBe('function')
    if (typeof classes === 'function') {
      expect(classes({ active: true })).toBe('base on')
      expect(classes({ active: false })).toBe('base off')
    }
  })
})
