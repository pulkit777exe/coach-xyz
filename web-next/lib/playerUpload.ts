import { postJob } from './data/client'
import { meUrl } from './data/transport'

export type MeAnalyzeInput = {
  session_token: string | null
  player_index?: number | null
  video_key?: string | null
  angle?: string | null
}

/**
 * Kick off an analysis on behalf of the signed-in player. Goes through the
 * self-scoped identity proxy (/api/me/analyze) so the server resolves the
 * linked player's coach + student and attributes the job to the player
 * (requested_by) while making it visible in the coach's history.
 *
 * Returns { job_id } — poll it with getJobStatus (same capability route the
 * coach flow uses). Enqueue behavior (timeout + `{ job_id }` shape) is shared
 * with the coach flow through the core `postJob` helper.
 */
export async function meStartAnalysis(params: MeAnalyzeInput): Promise<{ job_id: string }> {
  return postJob(
    meUrl('/analyze'),
    {
      session_token: params.session_token,
      player_index: params.player_index ?? null,
      video_key: params.video_key ?? null,
      angle: params.angle ?? null,
    },
    { timeoutMs: 30_000 },
  )
}
