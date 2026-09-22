import type { EnginePipelineState, PipelineState } from '@/types'

// UI names for engine states. Engine "player_selection" is shown as
// "selecting"; terminal "failed" is shown as "error". UI-only states
// (idle / chatting) are never producers of engine states.
const ENGINE_STATE_MAP: Record<EnginePipelineState, PipelineState> = {
  uploading: 'uploading',
  scanning: 'scanning',
  player_selection: 'selecting',
  analyzing: 'analyzing',
  rendering: 'rendering',
  completed: 'completed',
  failed: 'error',
}

// Every engine state maps to a UI pipeline state. Adding an engine state now
// forces an explicit UI decision at compile time (Record is exhaustive)
// instead of silently degrading to a stale UI branch.
export function mapEngineStateToPipeline(state: EnginePipelineState): PipelineState {
  return ENGINE_STATE_MAP[state]
}
