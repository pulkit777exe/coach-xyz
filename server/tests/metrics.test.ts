import { beforeEach, describe, expect, test } from 'bun:test'

import { recordRequest, resetMetricsForTests, snapshot } from '../src/lib/metrics'

beforeEach(() => {
  resetMetricsForTests()
})

describe('request metrics', () => {
  test('counts per method + route pattern', () => {
    recordRequest('GET', '/api/org/:auth0Id/students', 200, 5)
    recordRequest('GET', '/api/org/:auth0Id/students', 200, 15)
    recordRequest('POST', '/api/org/:auth0Id/students', 201, 8)
    const { routes } = snapshot()
    expect(routes['GET /api/org/:auth0Id/students']).toMatchObject({
      count: 2,
      errors: 0,
      avg_ms: 10,
    })
    expect(routes['POST /api/org/:auth0Id/students']?.count).toBe(1)
  })

  test('only 5xx counts as an error; slow counts past one second', () => {
    recordRequest('GET', '/a', 400, 5)
    recordRequest('GET', '/a', 403, 5)
    recordRequest('GET', '/a', 500, 5)
    recordRequest('GET', '/a', 200, 1500)
    expect(snapshot().routes['GET /a']).toMatchObject({ count: 4, errors: 1, slow: 1 })
  })

  test('pattern-less requests fold into one unmatched bucket', () => {
    recordRequest('GET', null, 404, 1)
    recordRequest('GET', undefined, 404, 1)
    const { routes } = snapshot()
    expect(routes['GET unmatched']?.count).toBe(2)
  })

  test('reset clears the table for the next probe', () => {
    recordRequest('GET', '/a', 200, 1)
    resetMetricsForTests()
    expect(snapshot().routes).toEqual({})
  })
})
