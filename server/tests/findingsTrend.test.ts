import { describe, expect, test } from 'bun:test'

import { parseFindingsTrendQuery } from '../src/routes/auth'

const params = (qs: string) => new URLSearchParams(qs)

describe('parseFindingsTrendQuery', () => {
  test('defaults to 30 days with no filters', () => {
    expect(parseFindingsTrendQuery(params(''))).toEqual({
      days: 30,
      category: null,
      severity: null,
      studentId: null,
      teamId: null,
    })
  })

  test('clamps days to 1..365 and floors fractions', () => {
    expect(parseFindingsTrendQuery(params('days=7')).days).toBe(7)
    expect(parseFindingsTrendQuery(params('days=0')).days).toBe(1)
    expect(parseFindingsTrendQuery(params('days=9999')).days).toBe(365)
    expect(parseFindingsTrendQuery(params('days=abc')).days).toBe(30)
  })

  test('normalizes filter values to a safe alphabet', () => {
    const q = parseFindingsTrendQuery(params("category=Drive'; DROP&severity=HIGH "))
    expect(q.category).toBe('drive drop')
    expect(q.severity).toBe('high')
  })

  test('blank filters become null', () => {
    const q = parseFindingsTrendQuery(params('category=!!!'))
    expect(q.category).toBeNull()
  })

  test('accepts well-formed UUID id filters, rejects the rest', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const q = parseFindingsTrendQuery(params(`student_id=${id}&team_id=not-a-uuid`))
    expect(q.studentId).toBe(id)
    expect(q.teamId).toBeNull()
  })
})
