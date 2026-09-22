import { describe, expect, test } from 'bun:test'

import { MAX_CLIP_DURATION_MS, parseClipInput } from '../src/lib/clips'

describe('parseClipInput', () => {
  test('accepts a clean clip and trims the label', () => {
    const res = parseClipInput({ label: '  Release sequence  ', start_ms: 1200, end_ms: 3400 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.cleaned).toEqual({
        label: 'Release sequence',
        start_ms: 1200,
        end_ms: 3400,
        finding_id: null,
      })
    }
  })

  test('floors fractional bounds', () => {
    const res = parseClipInput({ label: 'x', start_ms: 10.9, end_ms: 20.1 })
    expect(res).toEqual({
      ok: true,
      cleaned: { label: 'x', start_ms: 10, end_ms: 20, finding_id: null },
    })
  })

  test('keeps a finding link, trims blanks to null', () => {
    const linked = parseClipInput({ label: 'x', start_ms: 0, end_ms: 1000, finding_id: 'job1:e2' })
    expect(linked.ok && linked.cleaned.finding_id).toBe('job1:e2')
    const blank = parseClipInput({ label: 'x', start_ms: 0, end_ms: 1000, finding_id: '   ' })
    expect(blank.ok && blank.cleaned.finding_id).toBeNull()
  })

  test('rejects non-numeric bounds', () => {
    for (const input of [
      { label: 'x', end_ms: 5 },
      { label: 'x', start_ms: 0, end_ms: '5' },
      { label: 'x', start_ms: NaN, end_ms: 5 },
      { label: 'x', start_ms: 0, end_ms: Infinity },
    ]) {
      expect(parseClipInput(input).ok).toBe(false)
    }
  })

  test('rejects negative bounds and inverted ranges', () => {
    expect(parseClipInput({ label: 'x', start_ms: -1, end_ms: 5 }).ok).toBe(false)
    expect(parseClipInput({ label: 'x', start_ms: 5, end_ms: 5 }).ok).toBe(false)
    expect(parseClipInput({ label: 'x', start_ms: 9, end_ms: 5 }).ok).toBe(false)
  })

  test('rejects zero-length labels and caps duration', () => {
    expect(parseClipInput({ label: '   ', start_ms: 0, end_ms: 5 }).ok).toBe(false)
    expect(parseClipInput({ start_ms: 0, end_ms: 5 }).ok).toBe(false)
    const over = parseClipInput({ label: 'x', start_ms: 0, end_ms: MAX_CLIP_DURATION_MS + 1 })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toContain('capped')
    expect(parseClipInput({ label: 'x', start_ms: 0, end_ms: MAX_CLIP_DURATION_MS }).ok).toBe(true)
  })
})
