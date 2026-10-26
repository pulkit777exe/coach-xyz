// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// ── A failed read rendered as "no data", and one of them was a false statistic ──
//
// `ObjectivesSection` loads three things independently (objectives, recent findings,
// the 30-day trend) and each one set its list to `[]` on rejection. That merges three
// different answers — "still loading", "loaded and there are none", "could not read it"
// — into one indistinguishable empty list.
//
// The trends case is the reason this matters more than a missing empty state: `total`
// is summed from `trends`, so a FAILED read rendered the confident sentence
// "0 findings in 30 days". That is not a missing value, it is a fabricated statistic —
// the worst thing a dashboard can show a coach, because it reads as good news.
//
// The objectives case had the opposite failure: "No objectives yet" tells a coach to go
// create one, when the truth is the list could not be read. The reader's next action
// differs, so the copy must differ.
//
// The type change (`T[] | null`) is what made the fix type-safe, and the compiler then
// found SEVEN null-derefs in write handlers and derivations that had silently assumed
// the array always existed.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
/** Per-fetch resolution control, so each failure is exercised in isolation. */
const calls = {
  objectives: { ok: true as boolean, value: [] as unknown[] },
  findings: { ok: true as boolean, value: [] as unknown[] },
  trends: { ok: true as boolean, value: [] as unknown[] },
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  calls.objectives = { ok: true, value: [] }
  calls.findings = { ok: true, value: [] }
  calls.trends = { ok: true, value: [] }
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => noise.push(a[0]))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.removeEventListener('unhandledrejection', onRejection)
  window.removeEventListener('error', onError)
  vi.restoreAllMocks()
  vi.resetModules()
})

const settle = async () => {
  // Two microtask turns: one for the promise chain, one for the React commit that
  // renders what it set.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const load = async () => {
  vi.doMock('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined },
    Toaster: () => null,
  }))
  // The three READS the effect performs. Two of them live in `@/lib/org` and one —
  // `getFindingsTrends` — lives in `@/lib/api`. The `@/lib/org` stub SPREADS the real
  // module (`...await importOriginal()`) rather than enumerating exports, so it cannot
  // break the moment a sibling import in this component gains a name. Getting that split wrong is not a
  // harmless slip: stubbing `@/lib/org` alone leaves the real `api` module to throw
  // against no network, which surfaces as a trends FAILURE in every case, so the
  // "genuinely empty" and "real trend" assertions fail while the failure cases pass.
  // A test that mocks the wrong module looks like it is exercising the fix when it is
  // really exercising its own stub. Hence the split stated explicitly.
  vi.doMock('@/lib/library', () => ({
    getFindingsTrends: async () => {
      if (!calls.trends.ok) throw new Error('trends boom')
      return { trends: calls.trends.value }
    },
  }))
  // The WRITES, in their real homes: three in `@/lib/org`, and the CSV export is
  // `downloadStudentFindingsCsv` (not `exportFindingsCsv`, which is not a thing).
  vi.doMock('@/lib/org', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    orgObjectives: async () => {
      if (!calls.objectives.ok) throw new Error('objectives boom')
      return { objectives: calls.objectives.value }
    },
    orgStudentFindings: async () => {
      if (!calls.findings.ok) throw new Error('findings boom')
      return { findings: calls.findings.value }
    },
    orgCreateObjective: async () => ({ objective: { id: 'new', title: 'New' } }),
    orgSetObjectiveStatus: async () => ({ objective: { id: 'x', status: 'done' } }),
    orgDeleteObjective: async () => ({}),
    downloadStudentFindingsCsv: async () => '/x.csv',
  }))
  const mod = await import('@/components/org/ObjectivesSection')
  return mod.default
}

const render = async () => {
  const Section = await load()
  await act(async () => {
    root.render(<Section auth0Id="auth0|org" studentId="s1" canWrite={false} />)
  })
  await settle()
  return container.textContent ?? ''
}

const TREND = { day: '2026-10-06', count: 7, needs_review: 2 }

describe('ObjectivesSection — a failed read must not read as an empty one', () => {
  test('a FAILED trends read does not report "0 findings"', async () => {
    calls.trends.ok = false
    const text = await render()
    // The defect, verbatim from before the fix.
    expect(text).not.toContain('0 findings in 30 days')
    // And the replacement says what is actually true, without inventing a number.
    expect(text).toContain('findings count unavailable')
  })

  test('a FAILED objectives read does not say "No objectives yet"', async () => {
    calls.objectives.ok = false
    const text = await render()
    // "No objectives yet" + "Create one from a recent finding below" would send a coach
    // to write an objective they may already have written, three times over.
    expect(text).not.toContain('No objectives yet')
    expect(text).toContain('Objectives failed to load.')
  })

  test('a FAILED findings read says so rather than hiding the section', async () => {
    calls.findings.ok = false
    const text = await render()
    expect(text).toContain('Recent findings failed to load.')
  })

  test('a GENUINELY empty objectives list still says "No objectives yet"', async () => {
    // The critical other half. Without this, the fix would be indistinguishable from
    // simply replacing every empty state with a failure message — and the failure
    // message would then be the lie.
    calls.objectives = { ok: true, value: [] }
    const text = await render()
    expect(text).toContain('No objectives yet')
    expect(text).not.toContain('Objectives failed to load.')
  })

  test('a GENUINELY empty trend still reports 0 findings', async () => {
    calls.trends = { ok: true, value: [] }
    const text = await render()
    expect(text).toContain('0 findings in 30 days')
    expect(text).not.toContain('count unavailable')
  })

  test('a real trend still reports its true figure', async () => {
    calls.trends = { ok: true, value: [TREND] }
    const text = await render()
    expect(text).toContain('7 findings in 30 days')
    expect(text).toContain('2 need review')
  })

  test('one failing fetch does not blank the other two', async () => {
    // The fetches are independent, so a trends failure must not affect the objectives
    // list. A blanket `catch` that nulled everything would pass every case above and
    // still fail this one.
    calls.trends.ok = false
    calls.objectives = { ok: true, value: [] }
    const text = await render()
    expect(text).toContain('No objectives yet')
    expect(text).toContain('findings count unavailable')
  })

  test('a failure produces no unhandled rejection and nothing thrown', async () => {
    // The rejections above are handled (that is the fix), so they must not escape.
    // A component that "degrades" by throwing still degrades — just noisily.
    calls.objectives.ok = false
    calls.findings.ok = false
    calls.trends.ok = false
    await render()
    expect(noise).toEqual([])
  })
})
