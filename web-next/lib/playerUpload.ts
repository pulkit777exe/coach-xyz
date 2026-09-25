import { apiFetch, IDENTITY_BASE } from './api'

export type MeAnalyzeInput = {
  session_token: string | null
  player_index?: number | null
  video_key?: string | null
  angle?: string | null
  /** Cancel the enqueue when the scan flow is reset or superseded. */
  signal?: AbortSignal
}

/**
 * Kick off an analysis on behalf of the signed-in player. Goes through the
 * self-scoped identity proxy (/api/me/analyze) so the server resolves the
 * linked player's coach + student and attributes the job to the player
 * (requested_by) while making it visible in the coach's history.
 *
 * Returns { job_id } — poll it with getJobStatus (same capability route the
 * coach flow uses).
 */
export async function meStartAnalysis(params: MeAnalyzeInput): Promise<{ job_id: string }> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (params.signal) {
    if (params.signal.aborted) controller.abort()
    else params.signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    return await apiFetch<{ job_id: string }>(`${IDENTITY_BASE}/api/me/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_token: params.session_token,
        player_index: params.player_index ?? null,
        video_key: params.video_key ?? null,
        angle: params.angle ?? null,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
    params.signal?.removeEventListener('abort', abortFromCaller)
  }
}
