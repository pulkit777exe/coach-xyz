// ── Shared API Types ──────────────────────────────────────────────────────────
// These types define the contract between engine → server → frontend.
// Server is the source of truth. Frontend mirrors them.

export const DEFAULT_MODEL = "gemini-2.5-flash"
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
// Failed is a terminal state outside the forward flow.
//
// This list is a wire contract pinned by the pipeline contract tests in all
// three layers (engine/tests/test_state_machine.py, server/tests/, web-next).
// Keep it in sync with the engine's STATE_FLOW in engine/core/jobs.py.

export const ENGINE_PIPELINE_STATES = [
  "uploading",
  "scanning",
  "player_selection",
  "analyzing",
  "rendering",
  "completed",
  "failed",
] as const

export type EnginePipelineState = (typeof ENGINE_PIPELINE_STATES)[number]

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
// Wire contract emitted by engine/core/gemini_client.py normalize_gemini_result.
// The engine is the source of truth — keep this type in sync with it and with
// the analysis contract tests in all three layers.

export type AnalysisSummary = {
  sport: string
  player_name?: string
  session_date?: string | null
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
  feedback: string
  key_observation?: string
  result?: string
  form_breakdown?: Record<string, string>
  biomechanics?: Record<string, unknown> | null
  weighted_scoring?: Record<string, unknown> | null
  injury_risk?: Record<string, unknown> | null
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

// ── Chat Types ─────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
  created_at: number
}

// ── Dashboard Types ────────────────────────────────────────────────────────

export type DashboardAnalysis = {
  server_job_id: string
  engine_job_id: string
  session_token: string
  player_index: number | null
  model: string
  stage: number | null
  stage_name: string | null
  progress: number
  complete: boolean
  video_ready: boolean
  summary_json: unknown
  status_json: unknown
  error_code: string | null
  error_message: string | null
  download_count: number
  display_name: string | null
  file_name: string | null
  file_size_bytes: number | null
  player_count: number | null
  requested_at: string
  completed_at: string | null
  auth0_id: string | null
}

export type DashboardStats = {
  total_analyses: number
  completed_analyses: number
  in_progress_analyses: number
  failed_analyses: number
  total_downloads: number
}
