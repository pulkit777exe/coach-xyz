import { startMyAnalysis, type MeAnalyzeInput } from './meApi'

export type { MeAnalyzeInput }

/**
 * Kick off an analysis on behalf of the signed-in player. Delegates to the
 * centralized /api/me/analyze wrapper so enqueue behavior (timeout + shape)
 * stays consistent with the coach flow.
 */
export async function meStartAnalysis(params: MeAnalyzeInput): Promise<{ job_id: string }> {
  return startMyAnalysis(params)
}
