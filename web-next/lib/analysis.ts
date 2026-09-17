/** Behavior shared by the analysis list, history, and player-hub screens for
 *  reading fields out of a job's optional `summary_json` blob. */
export type SummaryCarrier = { summary_json?: unknown } | null | undefined

export function analysisScore(analysis: SummaryCarrier): number | null {
  const s = analysis?.summary_json
  if (!s || typeof s !== "object" || !("form_score" in s)) return null
  const score = (s as { form_score: unknown }).form_score
  return typeof score === "number" ? score : null
}

export function getShotEvents(analysis: SummaryCarrier): Array<Record<string, unknown>> {
  const s = analysis?.summary_json
  if (!s || typeof s !== "object" || !("shot_events" in s)) return []
  const events = (s as { shot_events: unknown }).shot_events
  return Array.isArray(events) ? (events as Array<Record<string, unknown>>) : []
}