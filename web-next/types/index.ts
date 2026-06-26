export type AppState =
  | "idle"
  | "scanning"
  | "selecting"
  | "analyzing"
  | "done"
  | "error"

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

export type JobStatus = {
  job_id: string
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
