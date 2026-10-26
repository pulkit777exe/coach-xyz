/** Behavior shared by the analysis list, history, and player-hub screens for
 *  reading fields out of a job's optional `summary_json` blob. */
export type SummaryCarrier = { summary_json?: unknown } | null | undefined

export function analysisScore(analysis: SummaryCarrier): number | null {
  // Delegates rather than re-deciding: this used to answer `typeof score === 'number'`,
  // which is TRUE for `NaN` and `Infinity`, so it returned `NaN` where the `summaryNumber`
  // below returned `null` — two functions on one blob answering one question two ways, which
  // is exactly the split `summaryNumber` was added to end. A parity test now asserts they
  // agree, and it caught this before anything else did.
  return summaryNumber(analysis?.summary_json, 'form_score')
}

export function getShotEvents(analysis: SummaryCarrier): Array<Record<string, unknown>> {
  const s = analysis?.summary_json
  if (!s || typeof s !== 'object' || !('shot_events' in s)) return []
  const events = (s as { shot_events: unknown }).shot_events
  return Array.isArray(events) ? (events as Array<Record<string, unknown>>) : []
}

/**
 * A numeric field out of a `summary_json` blob, or `null` when it is absent or not a number.
 *
 * This is the SSOT for the failure the ledger records twice: **`'form_score' in summary` is
 * true when the value is `null`**, so a presence check passes for a missing value and the
 * consumer then renders a confident wrong one — `null >= 5` is false, so an absent score
 * fell through to the *lowest* branch and the tile was painted `--destructive` red with no
 * number in it, which reads as a failing score rather than a missing one. `Math.round(null)`
 * is `0`, and `null * 100` is `0`, so the sibling tiles printed "0s" and "0%".
 *
 * `analysisScore` above is the carrier-shaped wrapper for `form_score`; this takes the blob
 * directly for the screens that already hold one. Both must agree, and they do because both
 * answer the same question: is it a finite number?
 */
export function summaryNumber(blob: unknown, key: string): number | null {
  if (!blob || typeof blob !== 'object') return null
  const v = (blob as Record<string, unknown>)[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
