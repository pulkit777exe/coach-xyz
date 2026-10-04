// ── `timestamptz` → ISO instant: the one normalisation ───────────────────────
//
// A DELIBERATE LEAF — it imports nothing, so any module can cite it without
// creating an edge. Same reasoning as `lib/batchRows.ts`.
//
// Bun decodes a `timestamptz` column to a `Date`, so a field typed `string` in a
// domain object is a lie until something converts it. That something was a
// private `toIsoString` copy in SEVEN places across six files, and AGENTS.md's
// standing instruction was to collapse them rather than add a sixth:
//
//   src/lib/consents.ts             src/lib/org/performance.ts  (× 2)
//   src/lib/notificationPrefs.ts    src/lib/org/settings.ts
//   src/lib/privacyRequests.ts      src/lib/userSettings.ts
//
// Six of them were byte-identical, which is exactly why they were safe to share
// and exactly why nobody did: nothing distinguishes a copy from the original
// until you diff them. The seventh (`performance.ts`, twice) was identical too.
//
// Two behaviours were in circulation, and that difference is the reason this is
// not just a move. `notificationPrefs` returned `null` for an UNPARSEABLE value;
// `privacyRequests` and the rest THREW on one, because they only guarded `null`.
// For a `timestamptz` that is a distinction without a difference — the database
// cannot store an unparseable timestamp — except via a hand-rolled projection,
// which is the case `notificationPrefs`' own comment names ("or an absent
// projection"). `toOptionalIsoString` keeps the safer of the two: it answers
// `null`, never a throw. So `privacyRequests` gains a null-guard it did not
// have, on an input the database cannot produce. That is the only behavioural
// delta in this change, and it is strictly a 500 becoming a `null`.
//
// What is NOT unified: `toIsoString` still throws on an unparseable value. Its
// callers are all non-nullable columns, where "this should be an instant and is
// not" is a real defect and a silent `''` or `null` would bury it. A read path
// that must never throw wants `toOptionalIsoString` — that is the whole choice.

/**
 * A `timestamptz` value as an ISO instant.
 *
 * THROWS on a value that is neither a `Date` nor a parseable date string, which
 * is deliberate: every caller here is a non-nullable column, so an unparseable
 * value is a real defect and swallowing it would hide the cause. Use
 * `toOptionalIsoString` when the column is nullable or the value came from a
 * projection.
 */
export const toIsoString = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

/**
 * The nullable form: `null` in, `null` out — and `null` for a value that does not
 * parse either, rather than a thrown `RangeError` from a read path.
 */
export const toOptionalIsoString = (value: string | Date | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}
