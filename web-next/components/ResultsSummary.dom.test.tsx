// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

// ── prefers-reduced-motion was not consulted by the results reveal ───────────
//
// `ResultsSummary` runs one GSAP animation on mount: a staggered fade-and-slide of
// six sections, `y: 24, opacity: 0, duration: 0.3, stagger: 0.05`. Nothing in it
// asked the OS whether the user wanted motion, so a visitor with vestibular
// sensitivity got a 300ms slide they could not decline — on the one screen where
// they read their athlete's results.
//
// This was invisible for the same reason the two effect-gated components were:
// `renderToStaticMarkup` never runs effects, so the sweep that walks every component
// rendered this to markup and observed none of the behaviour. Three files in this app
// DID honour the setting (`interior/progress-bar.tsx`, `TypewriterHighlight.tsx`,
// and the `globals.css` block); this was the conspicuous one that did not.
//
// WHAT IS ASSERTED, and why it is the honest assertion. The visible outcome of a
// skipped reveal and a completed one is identical — both leave the sections in their
// final state — so asserting on opacity would pass either way and prove nothing.
// What is actually a decision is whether the animation is *initiated*, so that is
// what the test observes: GSAP's `from` is a spy, and the assertion is that it is
// never called. A GSAP tween does not reliably apply styles in jsdom anyway, so any
// style-based assertion here would be testing the animation library.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
let fromSpy: ReturnType<typeof vi.fn>
/** Flipped per test; stands in for the OS setting. */
let reduceMotion = false

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  reduceMotion = false
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    noise.push(args[0])
  })
  fromSpy = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.removeEventListener('unhandledrejection', onRejection)
  window.removeEventListener('error', onError)
  vi.restoreAllMocks()
  vi.resetModules()
})

const load = async () => {
  vi.doMock('gsap', () => ({
    default: { from: fromSpy, registerPlugin: () => undefined },
  }))
  vi.doMock('@gsap/react', () => ({ useGSAP: (fn: () => void) => fn() }))
  // `useReducedMotion` is MOCKED rather than driven through `matchMedia`. What is
  // under test is this component's obligation to consult the setting and honour it —
  // not motion's media-query plumbing, which jsdom does not implement and which
  // would make the test a change-detector for a third party. Mocking the hook also
  // makes the two cases independent of each other rather than of ambient state.
  vi.doMock('motion/react', () => ({ useReducedMotion: () => reduceMotion }))
  vi.doMock('@/lib/api', () => ({
    getAuthorizedDownloadUrl: async () => '/signed/video.mp4',
    getDownloadUrl: (id: string) => `/api/download/${id}`,
  }))
  const mod = await import('@/components/ResultsSummary')
  return mod.default
}

const summary = {
  title: 'Match analysis',
  headline: 'Solid shift in the second half',
  overall_score: 7,
  strengths: ['Balance held under pressure'],
  priorities: ['Earlier scanning'],
} as never

const props = {
  status: { summary } as never,
  jobId: 'job-1',
  onReset: () => undefined,
}

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
}

describe('ResultsSummary — reduced motion', () => {
  test('the reveal is NOT initiated when the user prefers reduced motion', async () => {
    reduceMotion = true
    const Summary = await load()
    await render(<Summary {...props} />)

    // The assertion that matters: no animation was started. Asserting on opacity
    // would pass either way, because a skipped reveal and a finished one look alike.
    expect(fromSpy).not.toHaveBeenCalled()
    // And the content is still there — skipping the decoration must not skip the
    // result, which is the failure mode a "return early on reduced motion" fix invites.
    expect(container.textContent).toContain('Balance held under pressure')
    expect(noise).toEqual([])
  })

  test('the reveal still runs when motion is allowed', async () => {
    reduceMotion = false
    const Summary = await load()
    await render(<Summary {...props} />)

    // The inverse, and the reason this is a pair: a fix that simply deleted the
    // animation would satisfy the case above while removing the design intent.
    //
    // `toHaveBeenCalled()` rather than an exact count: the `useGSAP` stub invokes the
    // callback once per render pass, so the number reflects how many times React
    // rendered — a property of this stub, not of the component. The real hook runs
    // once on mount. Asserting a count here would be asserting the mock.
    expect(fromSpy).toHaveBeenCalled()
    expect(fromSpy.mock.calls[0][0]).toBe('.gsap-item')
    // And the timing the design specifies, which IS the component's to choose.
    const tween = fromSpy.mock.calls[0][1] as { duration?: number; stagger?: number }
    expect(tween.duration).toBe(0.3)
    expect(tween.stagger).toBe(0.05)
  })

  test('no summary renders the empty state without animating', async () => {
    reduceMotion = false
    const Summary = await load()
    await render(<Summary {...props} status={{ summary: null } as never} />)
    // The guard is `if (!summary || reducedMotion) return`, so the empty state must
    // not animate either — otherwise a user with no results gets the reveal on an
    // error panel.
    expect(fromSpy).not.toHaveBeenCalled()
    expect(container.textContent).toContain('No analysis summary available')
  })
})
