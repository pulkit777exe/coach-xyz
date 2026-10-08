// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'

// ── A bulk action that reported what it did not do ────────────────────────────
//
// `StudentsClient` has two bulk paths — set status, and delete — and both took the same
// shape: issue `Promise.allSettled` over the selected ids, then rewrite local state for
// EVERY selected row regardless of the outcome, while the toast was built from the
// success count.
//
// The result is the worst kind of UI bug, because it is a false claim about PERSISTED
// data rather than a visual glitch:
//
//   - bulk archive with one failure → the toast says "Updated 17" beside twenty rows
//     all reading `archived`, and the three that failed reappear on reload.
//   - bulk delete with one failure → the toast says "Removed 18 · 2 could not be
//     removed", but ALL twenty vanish from the roster. The two survivors still have
//     their attendance, objectives and plans, and because the selection was cleared they
//     could not be re-selected or retried. In a product with erasure and data-rights
//     surfaces, a false "removed" is a wrong belief about the user's data.
//
// Delete had a second defect on top: it filtered on the component's `selected` Set, which
// SURVIVES a filter change, while the request was built from `selectedIds` — derived from
// the FILTERED list. So it also removed rows that were never part of the request at all.
//
// These are pure functions precisely so the invariant is testable without a DOM, a
// network, or a 973-line component — the rule had no test at all inside the component,
// which is why the broken version shipped.

import { applyBulkDeleteResult, applyBulkStatusResult } from '@/components/org/StudentsClient'

type Row = { id: string; status: 'active' | 'inactive' | 'transferred' | 'archived' }

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, status: 'active' as const }))

const ok = (): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value: {} })
const boom = (): PromiseSettledResult<unknown> => ({ status: 'rejected', reason: new Error('500') })

/** All succeeded / all failed / a mix, aligned positionally with `ids`. */
const all = (n: number, f: () => PromiseSettledResult<unknown>) => Array.from({ length: n }, f)

describe('applyBulkStatusResult — only a fulfilled write changes local state', () => {
  test('every success updates its row', () => {
    const r = applyBulkStatusResult(rows('a', 'b', 'c'), ['a', 'b', 'c'], all(3, ok), 'archived')
    expect(r.rows.map((x) => x.status)).toEqual(['archived', 'archived', 'archived'])
    expect(r.failed).toEqual([])
  })

  test('a PARTIAL failure leaves the failed row alone', () => {
    // THE case. Under the old behaviour all three rows became `archived` while the toast
    // reported two.
    const r = applyBulkStatusResult(
      rows('a', 'b', 'c'),
      ['a', 'b', 'c'],
      [ok(), boom(), ok()],
      'archived',
    )
    expect(r.rows.map((x) => x.status)).toEqual(['archived', 'active', 'archived'])
    expect(r.succeeded).toEqual(['a', 'c'])
    expect(r.failed).toEqual(['b'])
  })

  test('a TOTAL failure changes nothing at all', () => {
    const r = applyBulkStatusResult(rows('a', 'b'), ['a', 'b'], all(2, boom), 'archived')
    expect(r.rows.every((x) => x.status === 'active')).toBe(true)
    expect(r.succeeded).toEqual([])
    expect(r.failed).toEqual(['a', 'b'])
  })

  test('rows that were never selected are untouched', () => {
    // The `selected` vs `selectedIds` confusion in reverse: a row outside the request
    // must not move even when it shares the new status.
    const r = applyBulkStatusResult(rows('a', 'z'), ['a'], [ok()], 'archived')
    expect(r.rows[1].status).toBe('active')
    expect(r.rows[1].id).toBe('z')
  })

  test('the input rows are not mutated', () => {
    // `setStudents(rows)` replaces state with this array, so a shared reference would let
    // React see the same object and skip the re-render — the update would be invisible.
    const input = rows('a', 'b')
    const r = applyBulkStatusResult(input, ['a', 'b'], all(2, ok), 'archived')
    expect(input.every((x) => x.status === 'active')).toBe(true)
    expect(r.rows).not.toBe(input)
    expect(r.rows[0]).not.toBe(input[0])
  })

  test('a short results array cannot silently drop rows', () => {
    // `results[i]` is optional-chained inside the reducer precisely so a length mismatch
    // reads as "not fulfilled" rather than throwing mid-render.
    const r = applyBulkStatusResult(rows('a', 'b', 'c'), ['a', 'b', 'c'], [ok()], 'archived')
    expect(r.succeeded).toEqual(['a'])
    expect(r.failed).toEqual(['b', 'c'])
    expect(r.rows.map((x) => x.status)).toEqual(['archived', 'active', 'active'])
  })

  test('an empty selection is a no-op', () => {
    const r = applyBulkStatusResult(rows('a'), [], [], 'archived')
    expect(r.rows.map((x) => x.status)).toEqual(['active'])
    expect(r.succeeded).toEqual([])
  })
})

describe('applyBulkDeleteResult — only a fulfilled delete removes the row', () => {
  test('every success removes its row', () => {
    const r = applyBulkDeleteResult(rows('a', 'b'), ['a', 'b'], all(2, ok))
    expect(r.rows).toEqual([])
    expect(r.failed).toEqual([])
  })

  test('a PARTIAL failure KEEPS the failed row on the roster', () => {
    // THE case. The old filter removed every selected row, so the survivor disappeared
    // from the UI while still existing server-side with all its history.
    const r = applyBulkDeleteResult(rows('a', 'b', 'c'), ['a', 'b', 'c'], [ok(), boom(), ok()])
    expect(r.rows.map((x) => x.id)).toEqual(['b'])
    expect(r.succeeded).toEqual(['a', 'c'])
    expect(r.failed).toEqual(['b'])
  })

  test('a TOTAL failure removes nothing', () => {
    const r = applyBulkDeleteResult(rows('a', 'b'), ['a', 'b'], all(2, boom))
    expect(r.rows.map((x) => x.id)).toEqual(['a', 'b'])
  })

  test('rows outside the request survive — the selected-vs-selectedIds bug', () => {
    // `selected` holds ids chosen before a filter change; `selectedIds` is what was sent.
    // The old filter used the former, so it deleted rows that were never requested.
    const r = applyBulkDeleteResult(rows('a', 'hidden', 'b'), ['a', 'b'], all(2, ok))
    expect(r.rows.map((x) => x.id)).toEqual(['hidden'])
  })

  test('a short results array keeps the unmatched rows', () => {
    const r = applyBulkDeleteResult(rows('a', 'b', 'c'), ['a', 'b', 'c'], [ok(), ok()])
    expect(r.rows.map((x) => x.id)).toEqual(['c'])
    expect(r.failed).toEqual(['c'])
  })

  test('a stale id in the results that is not in rows is harmless', () => {
    const r = applyBulkDeleteResult(rows('a'), ['a', 'gone'], [ok(), boom()])
    expect(r.rows).toEqual([])
    expect(r.failed).toEqual(['gone'])
  })
})
