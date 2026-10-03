// ── Batched row writes: one round trip per table, not per row ────────────────
// A leaf on purpose: it holds the rationale for ONE bind shape and imports
// nothing, so both write paths (findings, player_events) can cite it without
// either of them being able to reach back. See the entry on "One multi-row
// ON CONFLICT DO UPDATE" for the duplicate-key half of the story.

/**
 * A whole batch of rows as ONE bind parameter, for
 *
 *   insert into t (cols…)
 *   select r.col, … from jsonb_to_recordset(${batchRows(rows)}::jsonb) as r(col type, …)
 *
 * Two properties, both measured against a live Postgres rather than reasoned
 * about, and both of which point the OPPOSITE way from the array binding the
 * scope filters use — so do not "unify" them:
 *
 *  1. A JS array bound to a `::jsonb` cast arrives as a real jsonb ARRAY, nested
 *     structure intact. `= any($1::uuid[])` is the opposite: the same JS array
 *     arrives as comma-joined TEXT and the cast dies with 22P02, which is why
 *     THAT shape needs `uuidArrayLiteral` and this one must not get it. Passing
 *     `${uuidArrayLiteral(...)}` here would bind a jsonb *string*.
 *  2. Never stringify the batch. On Bun's prepared-statement path (the default,
 *     and what the history store uses) `${JSON.stringify(rows)}::jsonb` is stored
 *     as a jsonb string, and `jsonb_to_recordset` then rejects it — the same
 *     double-encoding class as `jsonb` columns.
 *
 * `jsonb_to_recordset` also does the per-column conversion from the column-type
 * list written next to it in the query, so a JS `null` stays SQL NULL and a
 * missing key is NULL: one code path instead of a per-row coalesce chain.
 *
 * Duplicates, because the batch is now one command:
 *
 *  - `on conflict (…) do NOTHING` is SAFE. Verified against PG 16: a batch
 *    carrying the same unique key twice inserts it once, raises nothing, and the
 *    row that survives is the FIRST occurrence — byte-identical to what a
 *    per-row loop left behind. The "cannot affect row a second time" cardinality
 *    violation belongs to `do UPDATE` alone.
 *  - `on conflict (…) do UPDATE` is NOT safe (verified: it raises that error).
 *    Collapse duplicate keys synchronously first and keep the LAST one, which is
 *    the state the sequential loop would have ended in.
 *
 * Callers short-circuit an empty batch: `jsonb_to_recordset` accepts `'[]'`
 * quietly, but the round trip is still spent.
 */
export const batchRows = <T>(rows: readonly T[]): T[] => rows as T[]
