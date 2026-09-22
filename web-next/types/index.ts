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
  /** Camera perspective this upload was scanned as (engine-normalized). */
  angle?: string
  /** All perspectives accumulated in this session (primary first). */
  angles?: string[]
  player_count: number
  players: Player[]
}

// ── Pipeline States ──────────────────────────────────────────────────────────
// Engine states: uploading → scanning → player_selection → analyzing → rendering → completed
// Frontend adds: idle (before upload), error (terminal failure)
//
// This list is a wire contract pinned by the pipeline contract tests in all
// three layers. Keep it in sync with the engine's STATE_FLOW in engine/core/jobs.py.

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

// UI-only states layer on top of the engine states. "selecting" is the
// user-facing name for engine "player_selection"; "error" for "failed".

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

export type CameraAngleGuidance = {
  id: string
  label: string
  description: string
}

export type Finding = {
  id: string
  category?: string
  start_ms?: number
  end_ms?: number
  confidence?: number | null
  confidence_band?: string
  severity?: string
  observation?: string
  feedback?: string
  form_score?: number
  evidence_frames?: number[]
  measured_at_timestamp?: number | null
  model_versions?: Record<string, unknown>
  review_state?: string
}

export type AnalysisProvenance = {
  engine: string
  model: string
  analysis_prompt: string
  sport: string | null
  sport_pack_version: number
  analyzed_at: string
}

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
  /** Camera perspective the analysis ran on (engine-stamped). */
  angle?: string
  /** Sport-specific guidance for the next angle to film. */
  recommended_angles?: CameraAngleGuidance[]
  /** True when any finding needs human review (§21 job-level flag). */
  needs_review?: boolean
  /** Click-traceable evidence findings (§19). */
  findings?: Finding[]
  /** Model/prompt/pack versions so a report stays explainable (§22). */
  provenance?: AnalysisProvenance
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
