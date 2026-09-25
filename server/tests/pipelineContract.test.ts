import { describe, expect, test } from 'bun:test'
import { ENGINE_PIPELINE_STATES } from '../src/types'

// The engine owns the state machine (engine/core/jobs.py STATE_FLOW). This
// test pins the wire contract so a rename/removal in any layer fails here
// instead of silently mis-mapping states in the UI.
const CANONICAL_FORWARD_FLOW = [
  'uploading',
  'scanning',
  'player_selection',
  'analyzing',
  'rendering',
  'completed',
]

describe('pipeline state contract', () => {
  // JSON-stringified comparison: pins values AND order exactly while staying
  // immune to readonly-tuple vs mutable-array variance between the layers.
  test('engine forward flow matches the canonical order', () => {
    expect(JSON.stringify(ENGINE_PIPELINE_STATES.filter((s) => s !== 'failed'))).toBe(
      JSON.stringify(CANONICAL_FORWARD_FLOW),
    )
  })

  test('failed is a terminal state outside the forward flow', () => {
    expect(ENGINE_PIPELINE_STATES).toContain('failed')
    expect(ENGINE_PIPELINE_STATES[ENGINE_PIPELINE_STATES.length - 1]).toBe('failed')
  })

  test('union covers exactly the documented set', () => {
    expect(JSON.stringify([...ENGINE_PIPELINE_STATES])).toBe(
      JSON.stringify([...CANONICAL_FORWARD_FLOW, 'failed']),
    )
  })
})
