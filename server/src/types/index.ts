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

export type AnalysisJob = {
  job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  created_at: number
}

export type JobStatus = {
  job_id: string
  stage: number
  stage_name: string
  progress: number
  complete: boolean
  summary: AnalysisSummary | null
  video_ready: boolean
  error: string | null
}

export type AnalysisSummary = {
  sport: string
  form_score: number
  overall_rating: string
  top_tips: string[]
  summary: string
  strengths: string[]
  shot_events: ShotEvent[]
}

export type ShotEvent = {
  timestamp: number
  event_type: string
  form_score: number
  feedback: string
}

export type ErrorResponse = {
  error: string
  message: string
}
