import { afterEach, describe, expect, test } from 'bun:test'

import { retentionDays } from '../src/lib/analysisPolicy'

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).RETENTION_DAYS
  } else {
    process.env.RETENTION_DAYS = value
  }
}

afterEach(() => {
  setEnv(undefined)
})

describe('retentionDays', () => {
  test('defaults to 365 days', () => {
    setEnv(undefined)
    expect(retentionDays()).toBe(365)
  })

  test('honors explicit values', () => {
    setEnv('90')
    expect(retentionDays()).toBe(90)
  })

  test('clamps to 30..3650 and falls back on garbage', () => {
    setEnv('1')
    expect(retentionDays()).toBe(30)
    setEnv('99999')
    expect(retentionDays()).toBe(3650)
    setEnv('abc')
    expect(retentionDays()).toBe(365)
  })
})
