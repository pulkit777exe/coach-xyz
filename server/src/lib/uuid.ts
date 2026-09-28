// ── UUID validation ─────────────────────────────────────────────────────────
// Single source of truth for the canonical (8-4-4-4-12) UUID pattern. Every
// route module and data helper validates ids with this one regex — do not
// redeclare it elsewhere.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The value if it is a canonical UUID, else `null` — for an **optional** id.
 *
 * A malformed id must be a 400 at the route boundary, not a 500 from Postgres.
 * A bare `url.searchParams.get('student_id')` reaches a `::uuid` cast, raises
 * 22P02, and surfaces as INTERNAL_ERROR; the routes that already test `UUID_RE`
 * answer 400. This was defined locally in three route modules (compete twice,
 * objectives once) and belongs here beside the pattern it enforces.
 *
 * `null` means "absent", which for a filter is the org-wide case, so prefer
 * `pickUuid` over rejecting: a caller who omits the param gets the same answer
 * as one who sends nothing at all.
 */
export const pickUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID_RE.test(value) ? value : null

/**
 * A bounded integer from a query string, or `fallback` when it is absent or
 * unparseable.
 *
 * `Math.min(Number(url.searchParams.get('limit')), 100)` is the trap: `?limit=abc`
 * yields NaN and `?limit=-1` yields -1, both of which Postgres rejects. In a
 * handler whose data layer uses the non-throwing `withHistoryStore`, the error is
 * logged and swallowed into the empty-list default, so the caller gets
 * `200 { analyses: [] }` and the History page renders as though the account has
 * no analyses — a wrong answer rather than a visible failure. Clamp instead, and
 * treat "not a number" as "not supplied".
 */
export const pickInt = (
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number => {
  // `?limit=` and `?limit=%20` are "supplied but blank", and Number('') is 0 —
  // which the clamp below would turn into `min`, quietly truncating a list to one
  // item instead of using the default. Treat a blank string as absent.
  if (typeof value === 'string' && value.trim() === '') return fallback
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), min), max)
}
