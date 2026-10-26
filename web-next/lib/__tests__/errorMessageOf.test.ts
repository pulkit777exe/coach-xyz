import { describe, expect, test } from 'vitest'
import { errorMessageOf } from '@/lib/errors'

// ── Two copies of "read an error's message" disagreed on a blank one ───────────
//
// `errorMessage(error, fallback)` existed ×3 and `messageOf(err, fallback)` ×2 —
// byte-identical except for one clause:
//
//   errorMessage:  if (typeof message === 'string' && message.trim()) return message
//   messageOf:     if (typeof message === 'string') return message
//
// So a write failing with `message: ""` toasted the caller's fallback on three settings
// sections and **an empty toast** on the other two. The user sees a notification with no
// text, no explanation, and no error — which is worse than either alternative, because a
// blank toast looks like a rendering bug rather than a failed request.
//
// The blank-message guard is kept, because a blank string is the ABSENCE of a message
// rather than a message. One SSOT now, in `lib/errors.ts`, which already owned the error
// shape and conspicuously lacked the message accessor.

describe('errorMessageOf', () => {
  test('reads a CoachAIError message', () => {
    const err = {
      code: 'FORBIDDEN',
      message: 'You need player.manage',
      layer: 'client' as const,
      retryable: false,
    }
    expect(errorMessageOf(err, 'fallback')).toBe('You need player.manage')
  })

  test('reads an Error message', () => {
    expect(errorMessageOf(new Error('network down'), 'fallback')).toBe('network down')
  })

  test('THE DIVERGENCE: a BLANK message yields the fallback, not an empty toast', () => {
    // This is the case the two copies disagreed on. `messageOf` returned `''`.
    expect(errorMessageOf({ message: '' }, 'Could not save')).toBe('Could not save')
    expect(errorMessageOf({ message: '   ' }, 'Could not save')).toBe('Could not save')
    expect(errorMessageOf({ message: '\n\t' }, 'Could not save')).toBe('Could not save')
  })

  test('a message of only whitespace is the absence of a message', () => {
    // Stated separately from the blank case because it is the one a naive
    // `if (message)` check gets RIGHT by accident and a `if (!message?.trim())` gets
    // right by intent. Both land here; only one explains why.
    expect(errorMessageOf({ message: '  x  ' }, 'fb')).toBe('  x  ')
  })

  test('a non-string message falls back', () => {
    for (const bad of [null, undefined, 42, {}, [], { message: 123 }, { message: null }]) {
      expect(errorMessageOf({ message: bad }, 'Could not save')).toBe('Could not save')
    }
  })

  test('a thrown primitive stringifies rather than falling back', () => {
    expect(errorMessageOf('something broke', 'fb')).toBe('something broke')
    expect(errorMessageOf('', 'fb')).toBe('fb')
    expect(errorMessageOf('   ', 'fb')).toBe('fb')
  })

  test('null and undefined fall back', () => {
    expect(errorMessageOf(null, 'fb')).toBe('fb')
    expect(errorMessageOf(undefined, 'fb')).toBe('fb')
  })

  test('a subclassed Error with a blank message reports its name', () => {
    // `class HttpError extends Error` with an empty message: the name is the only signal
    // left, and reporting it beats a blank toast. A plain `Error` is excluded because its
    // name is the useless string "Error".
    class HttpError extends Error {
      override name = 'HttpError'
    }
    expect(errorMessageOf(new HttpError(''), 'fb')).toBe('HttpError')
    expect(errorMessageOf(new Error(''), 'fb')).toBe('fb')
  })

  test('a message is never returned as a non-string', () => {
    // The invariant the whole helper exists to guarantee: whatever comes back is a string
    // a user can read, never undefined and never an object that React would throw on.
    const inputs: unknown[] = [null, undefined, 0, '', '  ', {}, { message: {} }, new Error('x')]
    for (const i of inputs) {
      expect(typeof errorMessageOf(i, 'fb')).toBe('string')
      expect(errorMessageOf(i, 'fb').length).toBeGreaterThan(0)
    }
  })
})
