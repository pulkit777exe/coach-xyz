import { afterEach, describe, expect, test } from 'bun:test'

import {
  MAX_CONCURRENT_UPLOADS,
  __resetUploadSlotsForTests,
  acquireUploadSlot,
  releaseUploadSlot,
} from '../src/routes/scan'

afterEach(() => {
  __resetUploadSlotsForTests()
})

describe('upload slot semaphore', () => {
  test('admits up to the cap, then fails fast until a slot frees', async () => {
    const { MAX_CONCURRENT_UPLOADS: cap } = await import('../src/routes/scan')
    expect(cap).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < cap; i++) {
      expect(acquireUploadSlot()).toBe(true)
    }
    expect(acquireUploadSlot()).toBe(false)
    releaseUploadSlot()
    expect(acquireUploadSlot()).toBe(true)
  })

  test('release never drives the counter negative', () => {
    releaseUploadSlot()
    releaseUploadSlot()
    expect(acquireUploadSlot()).toBe(true)
    for (let i = 1; i < MAX_CONCURRENT_UPLOADS; i++) {
      expect(acquireUploadSlot()).toBe(true)
    }
    expect(acquireUploadSlot()).toBe(false)
  })
})
