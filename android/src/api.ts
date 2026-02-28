// android/src/api.ts — Shared API client for the CoachAI backend

import AsyncStorage from "@react-native-async-storage/async-storage";

const DEFAULT_BASE = "http://10.0.2.2:8000"; // Android emulator → localhost

export async function getApiBase(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem("api_base");
    return saved || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

export async function setApiBase(url: string): Promise<void> {
  await AsyncStorage.setItem("api_base", url.replace(/\/$/, ""));
}

// ── Requests ──────────────────────────────────────────────────────────────────

export async function checkHealth(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface Job {
  job_id: string;
  status: "queued" | "analyzing" | "rendering" | "done" | "error";
  progress: number;
  message: string;
  result?: AnalysisResult;
  error?: string;
  created_at: number;
  updated_at: number;
}

export interface AnalysisResult {
  sport: string;
  player_name: string;
  session_date: string | null;
  video_duration_seconds: number;
  shots: Shot[];
  session_summary: SessionSummary;
}

export interface Shot {
  event_index: number;
  timestamp_of_shot: string;
  timestamp_of_outcome: string;
  result: string;
  shot_type: string;
  form_score: number;
  form_breakdown: Record<string, string>;
  feedback: string;
  [key: string]: unknown;
}

export interface SessionSummary {
  total_events: number;
  success_rate_percent: number;
  average_form_score: number;
  top_issues: string[];
  strengths: string[];
  priority_drill: string;
  overall_rating: string;
}

export async function uploadVideo(
  base: string,
  fileUri: string,
  fileName: string,
  model: string,
  render: boolean,
): Promise<Job> {
  const form = new FormData();
  form.append("video", {
    uri: fileUri,
    name: fileName,
    type: "video/mp4",
  } as any);
  form.append("model", model);
  form.append("render", String(render));

  const res = await fetch(`${base}/api/analyze`, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function getJob(base: string, jobId: string): Promise<Job> {
  const res = await fetch(`${base}/api/jobs/${jobId}`);
  if (!res.ok) throw new Error("Job not found");
  return res.json();
}

export function downloadUrl(base: string, jobId: string): string {
  return `${base}/api/download/${jobId}`;
}

export async function deleteJob(base: string, jobId: string): Promise<void> {
  await fetch(`${base}/api/jobs/${jobId}`, { method: "DELETE" });
}
