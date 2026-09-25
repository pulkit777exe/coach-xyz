import { describe, expect, test } from 'bun:test'

import { isFinalReportFailure } from '../src/lib/queue'

describe('AI report retry publication policy', () => {
  test('does not publish terminal failure for an intermediate retryable attempt', () => {
    expect(isFinalReportFailure(true, 0, 3)).toBe(false)
    expect(isFinalReportFailure(true, 1, 3)).toBe(false)
  })

  test('publishes terminal failure for non-retryable and exhausted errors', () => {
    expect(isFinalReportFailure(false, 0, 3)).toBe(true)
    expect(isFinalReportFailure(true, 2, 3)).toBe(true)
  })
})
