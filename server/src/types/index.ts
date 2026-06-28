// ── Shared API Types ──────────────────────────────────────────────────────────
// These types define the contract between engine → server → frontend.
// Server is the source of truth. Frontend mirrors them.

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
// Frontend adds: idle (before upload), error (terminal failure)

export type EnginePipelineState =
  | "uploading"
  | "scanning"
  | "player_selection"
  | "analyzing"
  | "rendering"
  | "completed"
  | "failed"

export type FrontendPipelineState =
  | "idle"
  | "uploading"
  | "scanning"
  | "selecting"
  | "analyzing"
  | "rendering"
  | "completed"
  | "error"

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
}

export type ShotEvent = {
  timestamp: number
  event_type: string
  form_score: number
  key_observation?: string
  feedback: string
}

// ── Error Types ──────────────────────────────────────────────────────────────
// Standard error shape returned by all layers

export type ErrorResponse = {
  code: string
  message: string
  layer: "engine" | "server" | "client"
  retryable: boolean
}

// ── Internal Server Types ────────────────────────────────────────────────────

export type AnalysisJob = {
  job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  model: string
  created_at: number
}
