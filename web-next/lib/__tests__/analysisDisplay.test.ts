import { describe, expect, it } from 'vitest'
import {
  eventStateBadgeLabel,
  formatAverageScore,
  formatConfidencePercent,
  formatCoveragePercent,
  formatFormScore,
  formatRatePercent,
  formatScore10,
  getEventDetectionCounts,
  historyConfirmedEventsLabel,
} from '../analysisDisplay'

describe('analysisDisplay formatting', () => {
  it('formats experimental scores as x/10 or unavailable', () => {
    expect(formatFormScore(7)).toBe('7/10')
    expect(formatFormScore(7.24)).toBe('7.2/10')
    expect(formatScore10(8)).toBe('8/10')
    expect(formatAverageScore(6.66)).toBe('6.7/10')
    expect(formatFormScore(null)).toBe('—')
    expect(formatFormScore(undefined)).toBe('—')
    expect(formatFormScore(Number.NaN)).toBe('—')
  })

  it('formats 0-1 rates/confidence/coverage as percentages null-safely', () => {
    expect(formatConfidencePercent(0.815)).toBe('82%')
    expect(formatCoveragePercent(0)).toBe('0%')
    expect(formatRatePercent(1)).toBe('100%')
    expect(formatSuccessRateCompat(0.5)).toBe('50%')
    expect(formatConfidencePercent(null)).toBe('—')
    expect(formatRatePercent('0.5' as unknown as number)).toBe('—')
  })
})

function formatSuccessRateCompat(v: number | null | undefined) {
  return formatRatePercent(v)
}

describe('event detection counts and labels', () => {
  it('reads event_detection counts', () => {
    expect(
      getEventDetectionCounts({
        summary_json: { event_detection: { confirmed: 3, candidate: 2, uncertain: 1 } },
      }),
    ).toEqual({ confirmed: 3, candidate: 2, uncertain: 1 })
  })

  it('falls back to total_events then shot_events for confirmed count', () => {
    expect(getEventDetectionCounts({ summary_json: { total_events: 4, event_detection: { candidate: 1 } } })).toEqual({
      confirmed: 4,
      candidate: 1,
      uncertain: 0,
    })
    expect(
      getEventDetectionCounts({ summary_json: { shot_events: [{}, {}], event_detection: { candidate: 0 } } }),
    ).toEqual({ confirmed: 2, candidate: 0, uncertain: 0 })
  })

  it('returns null confirmed when unavailable without fallbacks', () => {
    expect(getEventDetectionCounts({ summary_json: { form_score: 7 } })).toEqual({
      confirmed: null,
      candidate: 0,
      uncertain: 0,
    })
  })

  it('labels event states consistently', () => {
    expect(eventStateBadgeLabel('confirmed')).toBeNull()
    expect(eventStateBadgeLabel(null)).toBeNull()
    expect(eventStateBadgeLabel(undefined)).toBeNull()
    expect(eventStateBadgeLabel('candidate')).toBe('Unconfirmed candidate')
    expect(eventStateBadgeLabel('uncertain')).toBe('Unconfirmed (uncertain)')
  })

  it('builds history confirmed-event labels when available', () => {
    expect(historyConfirmedEventsLabel({ summary_json: { event_detection: { confirmed: 1 } } })).toBe('1 confirmed event')
    expect(historyConfirmedEventsLabel({ summary_json: { event_detection: { confirmed: 2, candidate: 1 } } })).toBe('2 confirmed events')
    expect(historyConfirmedEventsLabel({ summary_json: {} })).toBeNull()
  })
})
