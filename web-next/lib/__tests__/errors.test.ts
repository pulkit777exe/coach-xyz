import { describe, expect, it } from 'vitest'
import {
  clientError,
  engineError,
  errorFromResponse,
  isCoachAIError,
  isTransientError,
  toCoachAIError,
} from '../errors'
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

describe('errorFromResponse (single response-mapping rule)', () => {
  const FALLBACK = { code: 'REQUEST_FAILED', message: 'Request failed (500)' }

  it('maps 429 to RATE_LIMITED with the server message + numeric retry_after', () => {
    expect(errorFromResponse(429, { message: 'Slow down', retry_after: 12 }, FALLBACK)).toEqual({
      code: 'RATE_LIMITED',
      message: 'Slow down',
      layer: 'server',
      retryable: true,
      retry_after: 12,
    })
  })

  it('falls back on 429 when the body message is missing', () => {
    expect(errorFromResponse(429, {}, FALLBACK)).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Request failed (500)',
      retryable: true,
    })
  })

  it('passes structured engine bodies through (never re-derives)', () => {
    expect(
      errorFromResponse(
        400,
        { code: 'NO_PLAYERS', message: 'No players', layer: 'engine', retryable: false },
        FALLBACK,
      ),
    ).toEqual({
      code: 'NO_PLAYERS',
      message: 'No players',
      layer: 'engine',
      retryable: false,
    })
  })

  it('sanitizes non-string message/code and non-numeric retry_after', () => {
    expect(errorFromResponse(400, { code: 42, message: 42 }, FALLBACK)).toMatchObject({
      code: FALLBACK.code,
    })
    expect(
      errorFromResponse(429, { message: 'x', retry_after: 'soon' }, FALLBACK),
    ).not.toHaveProperty('retry_after')
  })

  it('falls back with status-derived retryability for opaque bodies', () => {
    expect(errorFromResponse(503, null, FALLBACK)).toMatchObject({
      code: 'REQUEST_FAILED',
      retryable: true,
    })
    expect(errorFromResponse(404, '<html>gone</html>', FALLBACK)).toMatchObject({
      code: 'REQUEST_FAILED',
      retryable: false,
    })
  })
})

describe('clientError (client-layer shaping)', () => {
  it('pins layer client and defaults to NOT retryable', () => {
    // The counterpart to engineError, added so the scan flow stops
    // hand-building the literal (`throw { … } as CoachAIError`) — a cast is
    // unchecked, so a typo in `retryable` shipped silently.
    expect(clientError('REQUEST_TIMEOUT', 'Scan cancelled.')).toEqual({
      code: 'REQUEST_TIMEOUT',
      message: 'Scan cancelled.',
      layer: 'client',
      retryable: false,
    })
  })

  it('takes an explicit retryability verdict', () => {
    expect(clientError('X', 'y', true)).toMatchObject({ layer: 'client', retryable: true })
  })

  it('produces a shape the consumers recognise', () => {
    // isCoachAIError is what fetchNotificationsWithRetry reads to decide
    // whether another attempt could ever succeed.
    expect(isCoachAIError(clientError('X', 'y'))).toBe(true)
    expect(isTransientError(clientError('X', 'y'))).toBe(false)
  })
})

describe('engineError (engine-layer shaping)', () => {
  it('pins layer engine with an explicit retryability verdict', () => {
    expect(engineError('ANALYSIS_FAILED', 'boom', false)).toEqual({
      code: 'ANALYSIS_FAILED',
      message: 'boom',
      layer: 'engine',
      retryable: false,
    })
  })

  it('defaults nullish retryability to true (wire nulls are transient)', () => {
    expect(engineError('X', 'y')).toMatchObject({ retryable: true })
    expect(engineError('X', 'y', null)).toMatchObject({ retryable: true })
  })
})
