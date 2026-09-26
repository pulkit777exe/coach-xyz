import { describe, expect, test } from 'bun:test'

import { isFatalRedisError } from '../src/lib/queue'

// A serverless Redis plan caps requests per billing window. When the cap is hit
// every command fails, and a BullMQ worker retries in a tight loop — which
// cannot recover, keeps the window spent, and buries the cause under thousands
// of identical log lines. These workers are stopped instead, so the classifier
// has to recognise the real provider message without swallowing ordinary
// transient failures.
describe('isFatalRedisError', () => {
  test('recognises the Upstash daily-cap message verbatim', () => {
    // Observed against the dev tenant: this is the exact string that filled the
    // log, and the one that must never be treated as a retryable blip.
    const message =
      'ERR max requests limit exceeded. Limit: 500000, Usage: 500004. ' +
      'See https://upstash.com/docs/redis/troubleshooting/max_requests_limit for details'
    expect(isFatalRedisError(new Error(message))).toBe(true)
    expect(isFatalRedisError(message)).toBe(true)
  })

  test('recognises the other quota-shaped provider errors', () => {
    expect(isFatalRedisError(new Error('ERR plan limit exceeded'))).toBe(true)
    expect(isFatalRedisError(new Error('Request quota exceeded for this month'))).toBe(true)
    expect(isFatalRedisError(new Error('ERR too many requests'))).toBe(true)
  })

  test('leaves ordinary transient failures retryable', () => {
    // These must keep logging and retrying — treating them as fatal would take
    // the queue down over a blip.
    expect(isFatalRedisError(new Error('READONLY You can not write against a replica'))).toBe(false)
    expect(isFatalRedisError(new Error('ECONNRESET'))).toBe(false)
    expect(isFatalRedisError(new Error('Connection is closed.'))).toBe(false)
    expect(isFatalRedisError(undefined)).toBe(false)
  })
})
