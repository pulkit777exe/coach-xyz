// ── Shared API Types ──────────────────────────────────────────────────────────
// These types define the contract between engine → server → frontend.
// Server is the source of truth. Frontend mirrors them.

export const DEFAULT_MODEL = "gemini-3.5-flash"
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

export type Player = {
  player_index: number
  confidence: number
  crop_base64: string
}

export type ScanResult = {
  session_token: string
  player_count: number
  players: Player[]
}

// ── Pipeline States ──────────────────────────────────────────────────────────
// Engine states: uploading → scanning → player_selection → analyzing → rendering → completed

export type EnginePipelineState =
  | "uploading"
  | "scanning"
  | "player_selection"
  | "analyzing"
  | "rendering"
  | "completed"
  | "failed"

// ── Job Status ───────────────────────────────────────────────────────────────
// Returned by GET /api/job-status/:jobId (reads directly from engine Redis)

export type JobStatus = {
  job_id: string
  state: EnginePipelineState
  stage: number
  stage_name: string
  progress: number
  complete: boolean
  summary: AnalysisSummary | null
  video_ready: boolean
  error: string | null
  error_code: string | null
  retryable: boolean
}

// ── Analysis Results ─────────────────────────────────────────────────────────

export type AnalysisSummary = {
  sport: string
  form_score: number
  overall_rating: string
  top_tips: string[]
  summary: string
  strengths: string[]
  priority_drill?: string
  shot_events: ShotEvent[]
  success_rate_percent?: number
  average_form_score?: number
  total_events?: number
}

export type ShotEvent = {
  timestamp: number
  event_type: string
  form_score: number
  key_observation?: string
  feedback: string
}

// ── Error Types ──────────────────────────────────────────────────────────────
// Canonical error shape returned by all layers (engine, server, client).
// Engine: EngineError (Python dataclass) → serialized to this shape.
// Server: CoachAIError (TypeScript) implements this.
// Frontend: CoachAIError (TypeScript) mirrors this.

export type CoachAIError = {
  code: string
  message: string
  layer: "engine" | "server" | "client"
  retryable: boolean
  retry_after?: number
}
