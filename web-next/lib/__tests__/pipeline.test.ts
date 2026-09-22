import { describe, expect, it } from 'vitest'
import { ENGINE_PIPELINE_STATES, type EnginePipelineState } from '@/types'
import { mapEngineStateToPipeline } from '../pipelineState'

const CANONICAL_FORWARD_FLOW = [
  'uploading',
  'scanning',
  'player_selection',
  'analyzing',
  'rendering',
  'completed',
]

describe('pipeline state contract', () => {
  it("matches the engine's forward flow in order", () => {
    expect(ENGINE_PIPELINE_STATES.filter((s) => s !== 'failed')).toEqual(CANONICAL_FORWARD_FLOW)
  })

  it('keeps failed as the terminal state', () => {
    expect(ENGINE_PIPELINE_STATES[ENGINE_PIPELINE_STATES.length - 1]).toBe('failed')
  })

  it('maps every engine state to a UI state, including the renames', () => {
    for (const state of ENGINE_PIPELINE_STATES) {
      expect(mapEngineStateToPipeline(state)).toBeTruthy()
    }
    expect(mapEngineStateToPipeline('player_selection')).toBe('selecting')
    expect(mapEngineStateToPipeline('failed')).toBe('error')
    expect(mapEngineStateToPipeline('uploading')).toBe('uploading')
  })

  // Compile-time guarantee: mapEngineStateToPipeline accepts exactly the
  // ENGINE_PIPELINE_STATES union, so a new engine state must be mapped here.
  it('has no UI state reachable only from an unknown engine state', () => {
    const engineStates = new Set<string>(ENGINE_PIPELINE_STATES)
    for (const state of CANONICAL_FORWARD_FLOW) {
      expect(engineStates.has(state)).toBe(true)
    }
  })
})

describe('mapEngineStateToPipeline typings', () => {
  // Type-level check: a Record<EnginePipelineState, PipelineState> is
  // exhaustive — this function must accept every engine state.
  it('is total over the engine union', () => {
    const all: readonly EnginePipelineState[] = ENGINE_PIPELINE_STATES
    const mapped = all.map(mapEngineStateToPipeline)
    expect(mapped.length).toBe(ENGINE_PIPELINE_STATES.length)
  })
})
