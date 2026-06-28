// ── Shared API Types ──────────────────────────────────────────────────────────
// These types mirror the server/src/types/index.ts (source of truth).
// Frontend adds "idle" and "error" states for UI state management.

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

export type PipelineState =
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
  state: string
  stage: number
  stage_name: string
  progress: number
  complete: boolean
  summary: AnalysisSummary | null
  video_ready?: boolean
  error: string | null
  error_code?: string | null
  retryable?: boolean
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
