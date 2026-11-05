import { describe, expect, test } from 'bun:test'

import { confirmedEventsOnly } from '../src/lib/registry'

// A motion peak is a candidate until an independently validated rule or model
// confirms it. The trend tables must not count candidates as confirmed events.
describe('confirmedEventsOnly', () => {
  test('drops candidates and rejected events but keeps confirmed and legacy rows', () => {
    const events = [
      { event_type: 'free_throw', event_state: 'confirmed' },
      { event_type: 'free_throw', event_state: 'candidate' },
      { event_type: 'free_throw', event_state: 'rejected' },
      { event_type: 'free_throw', event_state: 'uncertain' },
      { event_type: 'free_throw' },
    ]
    expect(confirmedEventsOnly(events)).toEqual([
      { event_type: 'free_throw', event_state: 'confirmed' },
      { event_type: 'free_throw' },
    ])
  })

  test('tolerates a non-array payload', () => {
    expect(confirmedEventsOnly(undefined as unknown as [])).toEqual([])
  })
})
