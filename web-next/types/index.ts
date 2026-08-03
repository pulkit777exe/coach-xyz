// ── Shared API Types ──────────────────────────────────────────────────────────
// These types mirror the server/src/types/index.ts (source of truth).
// Frontend adds "idle" and "error" states for UI state management.

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

export type Player = {
  player_index: number
  confidence: number
  crop_base64: string
}

export type ScanResult = {
  session_token: string
  video_key: string
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
  | "chatting"
  | "error"

// ── Job Status ───────────────────────────────────────────────────────────────
// Returned by GET /api/job-status/:jobId (reads directly from engine Redis)

export type EnginePipelineState =
  | "uploading"
  | "scanning"
  | "player_selection"
  | "analyzing"
  | "rendering"
  | "completed"
  | "failed"

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
// Canonical error shape shared across all layers.
// Matches server/src/types/index.ts CoachAIError.

export type CoachAIError = {
  code: string
  message: string
  layer: "engine" | "server" | "client"
  retryable: boolean
  retry_after?: number
}

// ── Upload Progress ──────────────────────────────────────────────────────────

export type UploadProgress =
  | { phase: 'uploading'; percent: number }
  | { phase: 'scanning'; percent: number }

// ── Chat Types ───────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
  created_at: number
}
