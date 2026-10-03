// ── Safe `form_score` from a summary blob (one SSOT) ────────────────────────
// A leaf with no imports, like `lib/csv.ts` and `lib/uuid.ts`: four call sites
// across three modules need the same answer to "is this row's `form_score` a number
// Postgres can cast?", and a second spelling of the predicate is how they drift.
//
// `summary_json ->> 'form_score'` is TEXT, so the obvious
// `(summary_json->>'form_score')::float8` raises 22P02 on ONE row whose score is
// `"N/A"` — and it raises it for the WHOLE query, so a single bad row turns a
// read into a 500 INTERNAL_ERROR reported to whichever member happened to ask.
// Two reads cast it bare (`org/performance.ts`), and a third asks
// "analyses WITH A SCORE" while only checking `is not null`, which admits `"N/A"`
// and lets `Number('N/A')` become `NaN` in a stored report.
//
// Three failures to close, and the guard closes all three:
//
//   1. 22P02 — anything non-numeric never reaches the cast; it takes the NULL arm,
//      which is the same answer the client computed for itself before (the web
//      required `typeof score === 'number'`, so an unscorable row rendered no
//      score rather than a wrong one).
//   2. 22003 — float8 overflow on a 300-digit integer. The length bound is what
//      rules it out; a bare regex admits it, because it also *matches*.
//   3. A pattern that does not mean what it looks like. The dot is written `[.]`,
//      not `\.`, because the pattern is a Postgres string literal and
//      `standard_conforming_strings = off` degrades a backslash to a bare
//      wildcard — `"1x2"` would then pass. Escaping it inside a character class
//      needs no backslash at all, so it cannot depend on the setting either way.
//
// The pattern admits only an optionally-signed decimal: no exponent, no leading
// `+`, no whitespace, no trailing dot. That is deliberately narrower than float8,
// because the only value that has to survive is a 0–10 form score.

/** Max length of a `form_score` text that is worth casting (rules out 22003). */
const FORM_SCORE_MAX_LENGTH = 40

/** The `->>` text of one row's score, for `jsonb` being a jsonb column reference. */
const formScoreText = (jsonb: string): string => `${jsonb} ->> 'form_score'`

/**
 * The predicate: TRUE only when this row's `form_score` is a decimal that the
 * `::float8` cast can take. Use it in a `where` clause to mean "has a score".
 */
export const hasNumericFormScore = (jsonb: string): string =>
  `length(${formScoreText(jsonb)}) <= ${FORM_SCORE_MAX_LENGTH}` +
  ` and ${formScoreText(jsonb)} ~ '^-?[0-9]+([.][0-9]+)?$'`

/**
 * The expression: the row's `form_score` as `float8`, or NULL when it is absent
 * or not a number. Total — it cannot raise 22P02 or 22003.
 */
export const safeFormScore = (jsonb: string): string =>
  `case when ${hasNumericFormScore(jsonb)} then (${formScoreText(jsonb)})::float8 else null end`

/**
 * A list row's `summary_json`: `{"form_score": <number>}`, or SQL NULL for a
 * blob with no usable score.
 *
 * The `case` is what keeps the NULL answer honest. `jsonb_build_object(
 * 'form_score', NULL)` is `{"form_score": null}` — an object that HAS the key,
 * and every consumer gates on having it: the History score tile
 * (`'form_score' in a.summary_json`) and `org/reports.ts`'s `analysesBlock`,
 * whose `Number(summary.form_score)` turns a JSON null into **0**, printing 0/10
 * for an analysis that was never scored. `null` for the whole column is also what
 * the unprojected read used to give them, so this is strictly less surprising
 * than the blob it replaces.
 *
 * Used by `ANALYSES_LIST_COLUMNS` in `lib/analyses.ts` (every list consumer),
 * which documents the rest of why a list ships this instead of the blob.
 */
export const listFormScoreJson = (jsonb: string): string => `
  case
    when ${hasNumericFormScore(jsonb)}
      then jsonb_build_object('form_score', (${jsonb} ->> 'form_score')::float8)
    else null
  end
`
