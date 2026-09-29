import { describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { buildError } from '../src/lib/errors'

// Pure shaper tests: no app needed. Logger silenced (the 500 path logs).

mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const { shapeEscapingError } = await import('../src/lib/httpErrors')

const set: { status?: number | string } = {}
const req = new Request('http://localhost/api/org/x/students')

describe('shapeEscapingError', () => {
  test('shaped errors pass through with retryability status', () => {
    const err = buildError('ENGINE_UNAVAILABLE', 'down', true)
    const out = shapeEscapingError(err, req, set)
    expect(set.status).toBe(503)
    expect(out?.body).toBe(err)
  })

  test('404s pass through (body and access hook survive)', () => {
    const out = shapeEscapingError({ status: 404 }, req, set)
    expect(set.status).toBe(404)
    expect(out).toBeUndefined()
  })

  test('escaping throws become a message-free envelope', () => {
    const out = shapeEscapingError(new Error('db password=hunter2'), req, set)
    expect(set.status).toBe(500)
    expect(out?.body.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(out?.body)).not.toContain('hunter2')
  })
})
