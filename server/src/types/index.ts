// ── Shared API Types ──────────────────────────────────────────────────────────
// These types define the contract between engine → server → frontend.
// Server is the source of truth. Frontend mirrors them.

export const DEFAULT_MODEL = 'gemini-3.8-flash'
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
  /** ffprobe media inspection (present when the engine probed the bytes). */
  media?: { width: number; height: number; duration: number; has_audio: boolean } | null
}

// ── Pipeline States ──────────────────────────────────────────────────────────
// Engine states: uploading → scanning → player_selection → analyzing → rendering → completed
// Failed is a terminal state outside the forward flow.
//
// This list is a wire contract pinned by the pipeline contract tests in all
// three layers (engine/tests/test_state_machine.py, server/tests/, web-next).
// Keep it in sync with the engine's STATE_FLOW in engine/core/jobs.py.

export const ENGINE_PIPELINE_STATES = [
  'uploading',
  'scanning',
  'player_selection',
  'analyzing',
  'rendering',
  'completed',
  'failed',
] as const

export type EnginePipelineState = (typeof ENGINE_PIPELINE_STATES)[number]

// ── Job Status ───────────────────────────────────────────────────────────────
// Returned by GET /api/job-status/:jobId (server polls engine status; durable state is Postgres-backed)

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

export type AnalysisProvenance = {
  engine: string
  model: string
  analysis_prompt: string
  sport: string | null
  sport_pack_version: number
  analyzed_at: string
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
  /** Experimental composite; never a validated performance measure. */
  form_score?: number | null
  evidence_frames?: number[]
  measured_at_timestamp?: number | null
  model_versions?: Record<string, unknown>
  /** Lifecycle state: a candidate is not a confirmed event. */
  event_state?: EventState
  confirmed?: boolean
  review_state?: string
}

export type PerformanceMetric = {
  key: string
  label: string
  metric?: string
  unit: string
  value: number | null
  ideal?: number[] | null
  score?: number | null
  note?: string
}

export type SessionMetric = {
  key: string
  label: string
  unit: string
  kind: 'metric' | 'session' | 'matchup'
  n?: number
  value: number
  best?: number | null
  worst?: number | null
  /** How the number was produced. */
  source?: ProfessionalStatSource
  /** Sport-pack target band, when the pack declares one. */
  ideal?: number[] | null
  acceptable?: number[] | null
}

// ── Professional stat layer ─────────────────────────────────────────────────
// Engine/core/performance.py labels every stat with how it was produced. Stats
// the clip cannot support are listed in `unavailable` instead of being guessed.

export type ProfessionalStatSource = 'measured' | 'counted' | 'observed'

export type ProfessionalStat = {
  key: string
  label: string
  unit: string
  value: number | null
  /** A non-numeric reading (for example a trend direction). */
  display?: string | null
  source: ProfessionalStatSource
  /** Engine band key; the human meaning is in ProfessionalStats.bands. */
  band?: string | null
  note?: string
}

export type ProfessionalStatGroup = {
  key: string
  label: string
  stats: ProfessionalStat[]
}

export type ProfessionalStats = {
  groups: ProfessionalStatGroup[]
  event_breakdown: Array<{ type: string; label: string; count: number; share: number }>
  outcomes: Array<{
    result: string
    label: string
    count: number
    tone: 'positive' | 'negative' | 'neutral'
  }>
  tags: Array<{ tag: string; count: number }>
  trend: {
    direction: string
    delta: number
    first: number
    second: number
    n: number
    source: ProfessionalStatSource
    note?: string
  } | null
  provenance: { measured: number; counted: number; observed: number }
  bands: Record<string, string>
  unavailable: Array<{ label: string; reason: string }>
}

export type MatchupRole = {
  role: string
  side?: string
  confidence?: number
  metrics?: PerformanceMetric[]
}

export type Matchup = {
  roles: { primary: string; opponent: string }
  primary?: MatchupRole | null
  opponent?: MatchupRole | null
  found_opponent?: boolean
  separation?: {
    side?: string
    distance?: number
    dx?: number
    dy?: number
  } | null
  frames?: Array<{
    t: number
    primary: number[][] | null
    opponent: number[][] | null
  }>
}

// ── Research evidence contract ──────────────────────────────────────────────
// Mirrors engine/core/evidence.py and engine/core/failures.py. The axes are
// independent: a VLM judgement can be valid evidence without being a
// measurement, and an unavailable criterion is missing evidence, not a zero.

export type EvidenceSource = 'pose' | 'object_tracking' | 'vlm' | 'rule' | 'human_reference'
export type EvidenceState =
  | 'valid'
  | 'low_confidence'
  | 'invalid_view'
  | 'occluded'
  | 'unavailable'
  | 'not_applicable'
export type EvidenceType = 'measured' | 'conditional' | 'judged' | 'excluded'
export type ValidationStatus =
  | 'proposed'
  | 'coach_reviewed'
  | 'measurement_tested'
  | 'coach_validated'
  | 'production_approved'
export type EventState = 'confirmed' | 'uncertain' | 'rejected' | 'candidate'
export type AnalysisJobStatus = 'queued' | 'running' | 'completed' | 'degraded' | 'failed' | 'cancelled'
export type ScoringStatus = 'experimental_unvalidated' | 'not_available' | 'excluded_from_research'

/** Experimental composite. Never present this as a validated performance score. */
export type CompositeScore = {
  value: number | null
  scale: '0-10'
  status: ScoringStatus
  validated: false
  method: string
  coverage: number | null
  minimum_coverage: number
  excluded_from_research: true
  reason: string | null
}

export type CriterionEvidence = {
  criterion_id: string
  criterion: string
  label: string
  measured_value: number | null
  unit: string
  ideal_range?: number[] | null
  acceptable_range?: number[] | null
  score: number | null
  weight: number
  source: EvidenceSource | null
  state: EvidenceState
  evidence_type: EvidenceType
  validation_status: ValidationStatus
  measurement_type?: string
  calibration?: string
  source_frames?: number[]
  rationale?: string
}

export type CriteriaRegistryEntry = {
  criterion_id: string
  engine_key: string | null
  label: string
  evidence_type: EvidenceType | string
  validation_status: ValidationStatus | string
  measurement_type?: string
  calibration?: string
  allowed_views?: string[]
  phase_scope?: string[]
  required_landmarks?: string[]
  required_objects?: string[]
  quality_gate?: string
  implementation:
    | 'partial'
    | 'partial_proxy'
    | 'not_implemented'
    | 'excluded_by_protocol'
    | 'engine_only'
    | string
  paper_definition?: string | null
  implementation_note?: string
}

export type EventDetectionSummary = {
  method: string
  candidate_count: number
  confirmed: number
  uncertain: number
  rejected: number
  candidate: number
  validation_status: string
  note: string
}

export type AnalysisFailure = {
  code: string
  stage: string
  message: string
  retryable: boolean
  detail?: Record<string, unknown> | null
}

export type AnalysisSummary = {
  sport: string
  action_id?: string | null
  sport_pack_version?: string | number | null
  player_name?: string
  session_date?: string | null
  job_status?: AnalysisJobStatus
  /** Experimental 0–10 composite. `null` when measured coverage is insufficient. */
  form_score: number | null
  /** Experimental label derived from the composite. `null` when unavailable. */
  overall_rating: string | null
  rating_status?: ScoringStatus
  composite?: CompositeScore
  top_tips: string[]
  summary: string
  strengths: string[]
  priority_drill?: string
  shot_events: ShotEvent[]
  success_rate_percent?: number
  /** @deprecated experimental composite; use `composite` for research output. */
  average_form_score?: number | null
  /** Experimental 0–10 mean technique score across measured events. */
  average_score?: number | null
  /** 0–1 share of judged results that were successful. */
  success_rate?: number
  /** 0–1 mean confidence of the tracked events. */
  confidence?: number
  /** Sport-specific numbers measured over the whole session. */
  session_metrics?: SessionMetric[]
  /** Grouped professional stats with provenance and unavailable-stat disclosure. */
  stats?: ProfessionalStats
  /** Analyst-readable pattern across the session (model, or deterministic fallback). */
  tactical_summary?: string
  /** Up to four specific analyst points for the session. */
  key_insights?: string[]
  tracking_coverage?: number | null
  total_events?: number
  /** Camera perspective the analysis ran on (engine-stamped). */
  angle?: string
  /** Whether the angle was declared by the caller, detected, or defaulted. */
  angle_source?: 'declared' | 'detected' | 'default' | string
  /** Paper criteria this run implemented, partial, or left unimplemented. */
  criteria_registry?: CriteriaRegistryEntry[]
  /** Confirmed vs candidate events, kept separate from technique assessment. */
  event_detection?: EventDetectionSummary
  /** Evidence failures; a degraded job can carry several. */
  failures?: AnalysisFailure[]
  /** The bounded research action this pack assesses, when configured. */
  scope_note?: string | null
  /** Sport-specific guidance for the next angle to film. */
  recommended_angles?: CameraAngleGuidance[]
  /** Model/prompt/pack versions so a report stays explainable (§22). */
  provenance?: AnalysisProvenance
  /** Click-traceable evidence findings (§19). */
  findings?: Finding[]
  /** True when any finding needs human review (§21 job-level flag). */
  needs_review?: boolean
  /** Pre-render quality-gate report (engine-stamped, never blocks). */
  quality?: {
    passed: boolean
    issues: string[]
    needs_review: boolean
  }
}

export type ShotEvent = {
  timestamp: number
  event_type: string
  /** Experimental event composite. `null` when coverage is insufficient. */
  form_score: number | null
  feedback: string
  key_observation?: string
  result?: string
  /** Lifecycle state: only `confirmed` is a confirmed sports action. */
  event_state?: EventState
  confirmed?: boolean
  confidence?: number
  coverage?: number
  metrics?: PerformanceMetric[]
  /** Model-observed short labels for this event. */
  tags?: string[]
  /** Model-observed defender spacing: open, contested, tight or unknown. */
  pressure?: string | null
  /** The ball carrier / action player and the nearest opponent at this event. */
  matchup?: Matchup | null
  form_breakdown?: Record<string, string>
  biomechanics?: Record<string, unknown> | null
  weighted_scoring?: Record<string, unknown> | null
  injury_risk?: Record<string, unknown> | null
}

// ── UUID & Session Regex ──────────────────────────────────────────────────────
// Shared regex patterns used across server routes for session token and
// analysis job ID validation. Centralized here so every route uses the exact
// same pattern and avoids subtle inconsistencies.

export const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const SESSION_TOKEN_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

// ── Error Types ──────────────────────────────────────────────────────────────
// Canonical error shape returned by all layers (engine, server, client).
// Engine: EngineError (Python dataclass) → serialized to this shape.
// Server: CoachAIError (TypeScript) implements this.
// Frontend: CoachAIError (TypeScript) mirrors this.

export type CoachAIError = {
  code: string
  message: string
  layer: 'engine' | 'server' | 'client'
  retryable: boolean
  retry_after?: number
}

// ── Chat Types ─────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
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
