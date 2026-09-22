import { describe, expect, it } from 'vitest'
import { isCoachAIError, isTransientError, toCoachAIError } from '../errors'
import type { CoachAIError } from '@/types'

const RETRYABLE: CoachAIError = {
  code: 'NETWORK_ERROR',
  message: 'down',
  layer: 'client',
  retryable: true,
}
const FATAL: CoachAIError = {
  code: 'JOB_NOT_FOUND',
  message: 'gone',
  layer: 'engine',
  retryable: false,
}

describe('toCoachAIError', () => {
  it('passes through canonical CoachAIError shapes', () => {
    expect(toCoachAIError(RETRYABLE)).toBe(RETRYABLE)
    expect(toCoachAIError(FATAL)).toBe(FATAL)
  })

  it('maps AbortError to a transient timeout error', () => {
    const err = toCoachAIError(new DOMException('aborted', 'AbortError'))
    expect(err.code).toBe('REQUEST_TIMEOUT')
    expect(err.retryable).toBe(true)
  })

  it('falls back to an UNKNOWN client error', () => {
    const err = toCoachAIError(new Error('boom'))
    expect(err.code).toBe('UNKNOWN')
    expect(err.retryable).toBe(false)
  })
})

describe('isTransientError', () => {
  it('classifies by the retryable flag, not by message keywords', () => {
    expect(isTransientError(RETRYABLE)).toBe(true)
    expect(isTransientError(FATAL)).toBe(false)

    // A structured 5xx the engine marks retryable is transient even though
    // its message contains no "network"/"timeout"/"fetch" keyword.
    expect(
      isTransientError({ ...RETRYABLE, code: 'GEMINI_TIMEOUT', message: 'upstream 504' }),
    ).toBe(true)
  })

  it('treats AbortError and unknown errors correctly', () => {
    expect(isTransientError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isTransientError(new Error('boom'))).toBe(false)
  })

  it('isCoachAIError narrows to the canonical shape', () => {
    expect(isCoachAIError(RETRYABLE)).toBe(true)
    expect(isCoachAIError(null)).toBe(false)
    expect(isCoachAIError('string')).toBe(false)
  })
})
