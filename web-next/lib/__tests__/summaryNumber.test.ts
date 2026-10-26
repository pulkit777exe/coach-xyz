import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analysisScore, summaryNumber } from '@/lib/analysis'

// ── A presence check passes for a value that is `null` ─────────────────────────────────
//
// `'form_score' in summary` is TRUE when the value is `null`. So a "do I have this field?"
// guard passes for a missing value, and the consumer then renders a confident wrong one:
//
//   summary.form_score >= 8   →  null >= 8   → false
//   summary.form_score >= 5   →  null >= 5   → false
//   → the ABSENT score fell through to the LOWEST branch
//
// In `ResultsSummary` that branch is `text-destructive`, so the headline "Total Form Score"
// tile — the first thing a player sees after their video finishes — rendered in destructive
// red with **no number in it**, reading as a failing score rather than a missing one. The
// sibling tiles were worse: `Math.round(null)` is `0` and `null * 100` is `0`, so they
// printed a confident **"0s"** and **"0%"**.
//
// The same class reaches `StudentProfile` through `attendance === null`, which the page sets
// when the read FAILS (`.catch(() => null)`) — not when the player has no attendance. There
// `attendance?.attendance_rate === null` is false for `undefined`, so the guard fell through
// to `?? 0` and a player with a season of attendance read **0%** across five tiles.
//
// These are behaviour tests on the helper plus SOURCE assertions on the two call sites,
// because the bug is not in the helper — it is in the two places that did not use it.

const ROOT = join(import.meta.dirname, '..', '..')

describe('summaryNumber — an absent field is absent, not zero', () => {
  test('returns the number when the field is a finite number', () => {
    expect(summaryNumber({ form_score: 8.5 }, 'form_score')).toBe(8.5)
    expect(summaryNumber({ form_score: 0 }, 'form_score')).toBe(0)
    expect(summaryNumber({ confidence: 0.92 }, 'confidence')).toBe(0.92)
  })

  test('THE DEFECT: null is absent, and `in` would have said otherwise', () => {
    // The whole reason this helper exists. `'form_score' in { form_score: null }` is true.
    const blob = { form_score: null }
    expect('form_score' in blob).toBe(true)
    expect(summaryNumber(blob, 'form_score')).toBeNull()
  })

  test('undefined, missing, and non-numeric values are all absent', () => {
    for (const v of [undefined, {}, [], '8.5', 'N/A', NaN, Infinity, -Infinity, true]) {
      expect(summaryNumber({ form_score: v }, 'form_score')).toBeNull()
    }
    expect(summaryNumber({}, 'form_score')).toBeNull()
  })

  test('a non-object blob is absent rather than a throw', () => {
    // Every one of these is reached from async response data.
    for (const bad of [null, undefined, '', 'text', 42, []]) {
      expect(() => summaryNumber(bad, 'form_score')).not.toThrow()
      expect(summaryNumber(bad, 'form_score')).toBeNull()
    }
  })

  test('analysisScore and summaryNumber agree — one question, one answer', () => {
    // They are two shapes of the same predicate, so a divergence between them would mean a
    // score reads as present in one screen and absent in another.
    for (const v of [7, 0, null, undefined, '8', NaN]) {
      const carrier = { summary_json: { form_score: v } }
      expect(analysisScore(carrier)).toBe(summaryNumber(carrier.summary_json, 'form_score'))
    }
  })
})

describe('the two call sites that fabricated a value now read through the helper', () => {
  const resultsSummary = readFileSync(join(ROOT, 'components', 'ResultsSummary.tsx'), 'utf8')
  const studentProfile = readFileSync(join(ROOT, 'components', 'org', 'StudentProfile.tsx'), 'utf8')

  test('ResultsSummary derives its colour from the resolved number, not the raw field', () => {
    // Source-level because the defect is the COMPARISON, which renders as markup: `null >= 5`
    // is false and lands in the red branch. A render test would show red-vs-muted only if the
    // harness could drive a summary with `form_score: null` through a canvas-adjacent layout.
    expect(resultsSummary).toContain('summaryNumber(summary,')
    expect(resultsSummary).toContain('formScore === null')
    // The raw field must not reach the colour ladder any more.
    expect(resultsSummary).not.toMatch(/summary\.form_score\s*>=/)
    // …and an absent score must not be rendered as the raw value (which React draws as nothing).
    expect(resultsSummary).not.toMatch(/\{summary\.form_score\}/)
  })

  test('StudentProfile does not coerce a failed read to 0', () => {
    expect(studentProfile).toContain('attendance === null')
    expect(studentProfile).not.toMatch(/attendance\?\.attendance_rate \?\? 0/)
    for (const k of ['present', 'late', 'absent', 'excused']) {
      expect(studentProfile).not.toMatch(new RegExp(`attendance\\?\\.${k} \\?\\? 0`))
    }
  })
})
