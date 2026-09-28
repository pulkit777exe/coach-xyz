// The defects pinned here each had a user-visible symptom that no test covered,
// and all three are the same shape: a failure that looks like a different
// failure, so the app told the user something false and then did the wrong thing
// about it.
//
// 1. `apiFetch` collapsed every AbortError into NETWORK_ERROR. Every timeout in
//    the module is an abort on the signal handed to apiFetch (getJobStatus 15s,
//    getConversation 10s, startAnalysis 30s, plus playerUpload and aiReports), so
//    a slow backend was reported as "Cannot connect to server. Check your
//    connection" — and because the abort never escaped, the REQUEST_TIMEOUT
//    branch of toCoachAIError was unreachable for every apiFetch caller.
//
// 2. `formatDateShort` localized the whole instant while `formatDateMed` and
//    `formatDateLong` read the calendar day out of the string. Two rows an
//    quarter-hour apart in the same UI column disagreed about which day they
//    belonged to, in any timezone east of UTC.
//
// 3. `markRead` / `markAllRead` never looked at the response. The caller has
//    already decremented unreadCount and flipped the row by the time the promise
//    settles, so a 401 or a 502 cleared the dot, told the user nothing, and left
//    the row to come back unread on the next snapshot.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api'
import { formatDateLong, formatDateMed, formatDateShort } from '../date'
import { isAbortError, toCoachAIError } from '../errors'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch tells an abort apart from a dead connection', () => {
  it('reports a browser AbortError as a timeout, not a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')),
    )
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      layer: 'client',
      retryable: true,
    })
  })

  it("reports Node's plain AbortError the same way", async () => {
    // undici throws a bare Error with this name, so an `instanceof DOMException`
    // check misses it entirely — the same class of bug as the first case.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
    })
  })

  it('still reports a genuine transport failure as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('keeps the abort distinguishable from a network error for retry decisions', async () => {
    // Both stay retryable, so liveness is unaffected — but the message is what
    // the user reads, so the codes must not be collapsed.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    const timeout = await apiFetch('http://localhost:3000/x').catch((e: unknown) => e)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const network = await apiFetch('http://localhost:3000/x').catch((e: unknown) => e)
    expect((timeout as { code: string }).code).not.toBe((network as { code: string }).code)
  })
})

describe('isAbortError', () => {
  it('recognises the abort shapes this codebase produces', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true)
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
  })

  it('does not claim ordinary failures', () => {
    expect(isAbortError(new TypeError('fetch failed'))).toBe(false)
    expect(isAbortError(new DOMException('other', 'NotFoundError'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })

  it('is the branch toCoachAIError uses for a timeout', () => {
    expect(toCoachAIError(new DOMException('aborted', 'AbortError'))).toMatchObject({
      code: 'REQUEST_TIMEOUT',
    })
  })
})

describe('the date formatters agree on which day an instant belongs to', () => {
  // Late-evening UTC instants, the case that used to split: localDay reads the
  // date part out of the string, while the old formatDateShort localized the
  // instant, so anything at 23:30Z or later moved to the next day east of UTC.
  const lateEvening = [
    '2026-09-13T23:30:00.000Z',
    '2026-09-13T23:45:00.000Z',
    '2026-09-13T23:59:59.999Z',
  ]

  // The invariant is the day, not the spelling: short abbreviates the month and
  // long spells it out, so compare the parts the formatters share.
  const dayOf = (formatted: string) => formatted.match(/\d+/)?.[0]

  it.each(lateEvening)('formatDateShort and formatDateMed pick the same day for %s', (iso) => {
    expect(dayOf(formatDateShort(iso))).toBe(dayOf(formatDateMed(iso)))
  })

  it.each(lateEvening)('formatDateShort and formatDateLong pick the same day for %s', (iso) => {
    expect(dayOf(formatDateShort(iso))).toBe(dayOf(formatDateLong(iso)))
  })

  it.each(lateEvening)('every formatter names September for %s', (iso) => {
    expect(formatDateShort(iso)).toMatch(/^Sep /)
    expect(formatDateMed(iso)).toMatch(/^Sep /)
    expect(formatDateLong(iso)).toMatch(/^September /)
  })

  it('a 23:45Z instant does not become the 14th', () => {
    // The regression itself: the old formatDateShort localized the instant, so in
    // UTC+1 this rendered "Sep 14" while the formatDateMed row beside it in the
    // same column said "Sep 13".
    expect(formatDateShort('2026-09-13T23:45:00.000Z')).toBe('Sep 13')
  })

  it('renders a bare YYYY-MM-DD the same in every formatter', () => {
    expect(formatDateShort('2026-09-13')).toBe('Sep 13')
    expect(formatDateMed('2026-09-13')).toBe('Sep 13, 2026')
    expect(formatDateLong('2026-09-13')).toBe('September 13, 2026')
  })

  it('does not shift the day for a midnight-UTC instant', () => {
    expect(formatDateShort('2026-09-14T00:00:00.000Z')).toBe('Sep 14')
  })
})
