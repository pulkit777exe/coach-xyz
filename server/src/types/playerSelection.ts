export type PlayerBBox = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

export type DetectedFramePlayer = {
  player_index: number;
  bbox: PlayerBBox;
  head_y: number;
};

export type FrameExtractionResponse = {
  frame_url: string;
  session_token: string;
  players: DetectedFramePlayer[];
};

export type CandidateFrame = {
  frame_index: number;
  timestamp_s: number;
  score: number;
  frame_url: string;
  players: DetectedFramePlayer[];
};

export type ConfirmPlayerInput = {
  player_index: number;
  label: string;
  bbox: Record<string, unknown>;
  reference_crop_base64: string;
};

export type FrameSessionState = {
  session_token: string;
  file_path: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
  retake_count: number;
  candidate_frames?: CandidateFrame[];
  video_meta?: {
    width: number;
    height: number;
    duration_seconds: number;
  };
  selected_players?: ConfirmPlayerInput[];
  last_frame?: FrameExtractionResponse;
};
